import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CallError,
  CallSessionService,
  DEMO_PATIENT_ID,
  DEMO_STAFF_ID,
  DenyAllCallAuthorizationAdapter,
  FakeCallMediaProvider,
  InMemoryCallRepository,
  LocalCallSignalingAdapter,
  SyntheticCallAuthorizationAdapter,
  SyntheticCallIdentityAdapter,
} from '../src/modules/be2-calls/index.js';

function build(opts?: { ringingTimeoutMs?: number; mediaConfigured?: boolean; denyAuthz?: boolean }) {
  const media = new FakeCallMediaProvider({ configured: opts?.mediaConfigured ?? true });
  const signaling = new LocalCallSignalingAdapter();
  const repo = new InMemoryCallRepository();
  const service = new CallSessionService({
    identity: new SyntheticCallIdentityAdapter(),
    authz: opts?.denyAuthz
      ? new DenyAllCallAuthorizationAdapter()
      : new SyntheticCallAuthorizationAdapter(),
    repo,
    media,
    signaling,
    ringingTimeoutMs: opts?.ringingTimeoutMs ?? 30_000,
  });
  return { service, media, signaling, repo };
}

describe('CallSessionService', () => {
  const disposers: CallSessionService[] = [];
  afterEach(() => {
    for (const s of disposers) s.dispose();
    disposers.length = 0;
    vi.useRealTimers();
  });

  function track(service: CallSessionService): CallSessionService {
    disposers.push(service);
    return service;
  }

  it('creates a RINGING call between demo participants', async () => {
    const { service, signaling } = build();
    track(service);
    const session = await service.createCall({
      callerId: DEMO_STAFF_ID,
      calleeId: DEMO_PATIENT_ID,
    });
    expect(session.state).toBe('RINGING');
    expect(session.room_name.startsWith('cg_')).toBe(true);
    expect(session.caller.media_identity).not.toContain('@');
    expect(signaling.history.map((e) => e.type)).toEqual(
      expect.arrayContaining(['call.incoming', 'call.ringing']),
    );
  });

  it('rejects duplicate active call requests', async () => {
    const { service } = build();
    track(service);
    await service.createCall({ callerId: DEMO_STAFF_ID, calleeId: DEMO_PATIENT_ID });
    await expect(
      service.createCall({ callerId: DEMO_STAFF_ID, calleeId: DEMO_PATIENT_ID }),
    ).rejects.toMatchObject({ code: 'CALL_BUSY' });
  });

  it('accepts call, moves to CONNECTING, and issues join tokens only after accept', async () => {
    const { service, media } = build();
    track(service);
    const ringing = await service.createCall({
      callerId: DEMO_STAFF_ID,
      calleeId: DEMO_PATIENT_ID,
    });

    await expect(service.issueJoinToken(ringing.call_id, DEMO_STAFF_ID))
      .rejects.toMatchObject({ code: 'TOKEN_DENIED' });

    const accepted = await service.accept(ringing.call_id, DEMO_PATIENT_ID);
    expect(accepted.state).toBe('CONNECTING');
    expect(media.rooms.has(accepted.room_name)).toBe(true);

    const callerToken = await service.issueJoinToken(accepted.call_id, DEMO_STAFF_ID);
    const calleeToken = await service.issueJoinToken(accepted.call_id, DEMO_PATIENT_ID);
    expect(callerToken.room_name).toBe(accepted.room_name);
    expect(calleeToken.identity).toBe(accepted.callee.media_identity);
    expect(callerToken.identity).not.toBe(calleeToken.identity);
  });

  it('treats duplicate accept as idempotent for the same callee', async () => {
    const { service } = build();
    track(service);
    const ringing = await service.createCall({
      callerId: DEMO_STAFF_ID,
      calleeId: DEMO_PATIENT_ID,
    });
    const first = await service.accept(ringing.call_id, DEMO_PATIENT_ID);
    const second = await service.accept(ringing.call_id, DEMO_PATIENT_ID);
    expect(second.state_version).toBe(first.state_version);
    expect(second.state).toBe('CONNECTING');
  });

  it('declines a ringing call', async () => {
    const { service } = build();
    track(service);
    const ringing = await service.createCall({
      callerId: DEMO_STAFF_ID,
      calleeId: DEMO_PATIENT_ID,
    });
    const declined = await service.decline(ringing.call_id, DEMO_PATIENT_ID);
    expect(declined.state).toBe('DECLINED');
    await expect(service.issueJoinToken(declined.call_id, DEMO_PATIENT_ID))
      .rejects.toMatchObject({ code: 'TOKEN_DENIED' });
  });

  it('marks missed after ringing timeout', async () => {
    vi.useFakeTimers();
    const { service } = build({ ringingTimeoutMs: 1_000 });
    track(service);
    const ringing = await service.createCall({
      callerId: DEMO_STAFF_ID,
      calleeId: DEMO_PATIENT_ID,
    });
    await vi.advanceTimersByTimeAsync(1_050);
    const missed = await service.getSession(ringing.call_id, DEMO_STAFF_ID);
    expect(missed.state).toBe('MISSED');
  });

  it('ends an active-path call and deletes the room', async () => {
    const { service, media } = build();
    track(service);
    const ringing = await service.createCall({
      callerId: DEMO_STAFF_ID,
      calleeId: DEMO_PATIENT_ID,
    });
    const connecting = await service.accept(ringing.call_id, DEMO_PATIENT_ID);
    const ended = await service.end(connecting.call_id, DEMO_STAFF_ID);
    expect(ended.state).toBe('ENDED');
    expect(media.rooms.has(connecting.room_name)).toBe(false);
    await expect(service.issueJoinToken(ended.call_id, DEMO_STAFF_ID))
      .rejects.toMatchObject({ code: 'TOKEN_DENIED' });
  });

  it('rejects third-party join token requests', async () => {
    const { service } = build();
    track(service);
    const ringing = await service.createCall({
      callerId: DEMO_STAFF_ID,
      calleeId: DEMO_PATIENT_ID,
    });
    await service.accept(ringing.call_id, DEMO_PATIENT_ID);
    await expect(service.issueJoinToken(ringing.call_id, 'demo-stranger'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects wrong-room style third party getSession', async () => {
    const { service } = build();
    track(service);
    const ringing = await service.createCall({
      callerId: DEMO_STAFF_ID,
      calleeId: DEMO_PATIENT_ID,
    });
    await expect(service.getSession(ringing.call_id, 'outsider'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reaches ACTIVE only after both media-ready reports', async () => {
    const { service } = build();
    track(service);
    const ringing = await service.createCall({
      callerId: DEMO_STAFF_ID,
      calleeId: DEMO_PATIENT_ID,
    });
    const connecting = await service.accept(ringing.call_id, DEMO_PATIENT_ID);
    const afterCaller = await service.reportMediaReady(connecting.call_id, DEMO_STAFF_ID);
    expect(afterCaller.state).toBe('CONNECTING');
    const active = await service.reportMediaReady(connecting.call_id, DEMO_PATIENT_ID);
    expect(active.state).toBe('ACTIVE');
    expect(active.active_at).toBeTruthy();
  });

  it('fails closed when LiveKit is not configured on accept', async () => {
    const { service } = build({ mediaConfigured: false });
    track(service);
    const ringing = await service.createCall({
      callerId: DEMO_STAFF_ID,
      calleeId: DEMO_PATIENT_ID,
    });
    await expect(service.accept(ringing.call_id, DEMO_PATIENT_ID))
      .rejects.toMatchObject({ code: 'LIVEKIT_CONFIG_MISSING' });
  });

  it('denies production-shaped authorization adapter', async () => {
    const { service } = build({ denyAuthz: true });
    track(service);
    await expect(
      service.createCall({ callerId: DEMO_STAFF_ID, calleeId: DEMO_PATIENT_ID }),
    ).rejects.toBeInstanceOf(CallError);
  });

  it('idempotently handles duplicate end', async () => {
    const { service } = build();
    track(service);
    const ringing = await service.createCall({
      callerId: DEMO_STAFF_ID,
      calleeId: DEMO_PATIENT_ID,
    });
    const first = await service.end(ringing.call_id, DEMO_STAFF_ID);
    const second = await service.end(ringing.call_id, DEMO_STAFF_ID);
    expect(first.state).toBe('ENDED');
    expect(second.state).toBe('ENDED');
    expect(second.state_version).toBe(first.state_version);
  });
});
