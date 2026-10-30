import { createCallId, createEventId, createMediaIdentity, createRoomName } from './ids.js';
import type {
  CallAuthorizationPort,
  CallIdentityPort,
  CallMediaProvider,
  CallRepositoryPort,
  CallSignalingPort,
  CallSignalEvent,
  CreateCallInput,
} from './ports.js';
import { assertTransition, canTransition, isTerminalCallState } from './state-machine.js';
import {
  CallError,
  toPublicSession,
  type CallEndReason,
  type CallSession,
  type CallState,
  type JoinTokenResult,
} from './types.js';

export const DEFAULT_RINGING_TIMEOUT_MS = 30_000;
export const DEFAULT_JOIN_TOKEN_TTL_SECONDS = 300;
export const MAX_CALL_PARTICIPANTS = 2;

export type CallSessionServiceDeps = {
  identity: CallIdentityPort;
  authz: CallAuthorizationPort;
  repo: CallRepositoryPort;
  media: CallMediaProvider;
  signaling: CallSignalingPort;
  now?: () => Date;
  ringingTimeoutMs?: number;
  joinTokenTtlSeconds?: number;
};

/**
 * Orchestrates call lifecycle. ACTIVE only after both participants report media readiness.
 * Join tokens are issued only after ACCEPTED (and while CONNECTING/ACTIVE).
 */
export class CallSessionService {
  readonly #identity: CallIdentityPort;
  readonly #authz: CallAuthorizationPort;
  readonly #repo: CallRepositoryPort;
  readonly #media: CallMediaProvider;
  readonly #signaling: CallSignalingPort;
  readonly #now: () => Date;
  readonly #ringingTimeoutMs: number;
  readonly #joinTokenTtlSeconds: number;
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(deps: CallSessionServiceDeps) {
    this.#identity = deps.identity;
    this.#authz = deps.authz;
    this.#repo = deps.repo;
    this.#media = deps.media;
    this.#signaling = deps.signaling;
    this.#now = deps.now ?? (() => new Date());
    this.#ringingTimeoutMs = deps.ringingTimeoutMs ?? DEFAULT_RINGING_TIMEOUT_MS;
    this.#joinTokenTtlSeconds = deps.joinTokenTtlSeconds ?? DEFAULT_JOIN_TOKEN_TTL_SECONDS;
  }

  dispose(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }

  async createCall(input: CreateCallInput): Promise<CallSession> {
    const caller = await this.#identity.resolveParticipant(input.callerId);
    const callee = await this.#identity.resolveParticipant(input.calleeId);
    if (!caller || !callee) {
      throw new CallError('FORBIDDEN', 'Unknown call participant', 403);
    }
    if (input.callerId === input.calleeId) {
      throw new CallError('INVALID_REQUEST', 'Caller and callee must differ', 400);
    }
    if (!(await this.#authz.canCreateCall(input.callerId, input.calleeId))) {
      throw new CallError('FORBIDDEN', 'Call not authorized', 403);
    }

    const existingCaller = await this.#repo.findActiveForParticipant(input.callerId);
    const existingCallee = await this.#repo.findActiveForParticipant(input.calleeId);
    if (existingCaller || existingCallee) {
      throw new CallError('CALL_BUSY', 'Participant already in an active call', 409);
    }

    const now = this.#now();
    const timeoutMs = input.ringingTimeoutMs ?? this.#ringingTimeoutMs;
    const session: CallSession = {
      call_id: createCallId(),
      state: 'RINGING',
      state_version: 1,
      room_name: createRoomName(),
      caller: {
        participant_id: input.callerId,
        role: 'caller',
        media_identity: createMediaIdentity('caller'),
      },
      callee: {
        participant_id: input.calleeId,
        role: 'callee',
        media_identity: createMediaIdentity('callee'),
      },
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      ringing_expires_at: new Date(now.getTime() + timeoutMs).toISOString(),
      accepted_at: null,
      connecting_at: null,
      active_at: null,
      ended_at: null,
      end_reason: null,
      media_ready: [],
      token_generation: 1,
    };

    await this.#repo.save(session);
    this.#armRingingTimeout(session.call_id, timeoutMs);

    await this.#publish(session, 'call.incoming', [session.callee.participant_id], {
      from: session.caller.participant_id,
      ringing_expires_at: session.ringing_expires_at,
    });
    await this.#publish(session, 'call.ringing', [session.caller.participant_id], {
      to: session.callee.participant_id,
      ringing_expires_at: session.ringing_expires_at,
    });

    return session;
  }

  async accept(callId: string, calleeId: string): Promise<CallSession> {
    const session = await this.#requireSession(callId);
    if (!(await this.#authz.canAccept(calleeId, session))) {
      throw new CallError('FORBIDDEN', 'Not allowed to accept this call', 403);
    }

    if (session.state === 'ACCEPTED' || session.state === 'CONNECTING' || session.state === 'ACTIVE') {
      // Idempotent accept for the same callee.
      if (calleeId === session.callee.participant_id) return session;
      throw new CallError('ALREADY_HANDLED', 'Call already accepted', 409);
    }

    this.#ensureNotExpiredWhileRinging(session);
    assertTransition(session.state, 'ACCEPTED');

    if (!this.#media.isConfigured()) {
      throw new CallError('LIVEKIT_CONFIG_MISSING', 'LiveKit is not configured', 503);
    }

    const now = this.#now().toISOString();
    session.state = 'ACCEPTED';
    session.state_version += 1;
    session.accepted_at = now;
    session.updated_at = now;
    await this.#repo.save(session);
    this.#clearTimer(callId);

    await this.#media.ensureRoom(session.room_name, MAX_CALL_PARTICIPANTS);

    // Move to CONNECTING immediately — clients may request join tokens now.
    assertTransition(session.state, 'CONNECTING');
    session.state = 'CONNECTING';
    session.state_version += 1;
    session.connecting_at = this.#now().toISOString();
    session.updated_at = session.connecting_at;
    await this.#repo.save(session);

    await this.#publish(session, 'call.accepted', this.#both(session), {
      status: 'ACCEPTED',
    });
    await this.#publish(session, 'call.connecting', this.#both(session), {
      status: 'CONNECTING',
      room_name: session.room_name,
    });

    return session;
  }

  async decline(callId: string, calleeId: string): Promise<CallSession> {
    const session = await this.#requireSession(callId);
    if (!(await this.#authz.canDecline(calleeId, session))) {
      throw new CallError('FORBIDDEN', 'Not allowed to decline this call', 403);
    }

    if (session.state === 'DECLINED') return session;
    if (isTerminalCallState(session.state)) {
      throw new CallError('ALREADY_HANDLED', 'Call already finished', 409);
    }

    assertTransition(session.state, 'DECLINED');
    return this.#finalize(session, 'DECLINED', 'declined', 'call.declined');
  }

  async end(callId: string, actorId: string): Promise<CallSession> {
    const session = await this.#requireSession(callId);
    if (!(await this.#authz.canEnd(actorId, session))) {
      throw new CallError('FORBIDDEN', 'Not allowed to end this call', 403);
    }

    if (session.state === 'ENDED') return session;
    if (session.state === 'DECLINED' || session.state === 'MISSED' || session.state === 'FAILED') {
      return session;
    }

    const reason: CallEndReason =
      session.state === 'RINGING' && actorId === session.caller.participant_id
        ? 'cancelled_by_caller'
        : actorId === session.caller.participant_id
          ? 'ended_by_caller'
          : 'ended_by_callee';

    if (session.state === 'RINGING') {
      // Caller cancel while ringing → ENDED (cancelled).
      assertTransition(session.state, 'ENDED');
      return this.#finalize(session, 'ENDED', reason, 'call.ended');
    }

    assertTransition(session.state, 'ENDED');
    return this.#finalize(session, 'ENDED', reason, 'call.ended');
  }

  async markMissed(callId: string): Promise<CallSession | null> {
    const session = await this.#repo.getById(callId);
    if (!session) return null;
    if (session.state !== 'RINGING') return session;
    assertTransition(session.state, 'MISSED');
    return this.#finalize(session, 'MISSED', 'missed_timeout', 'call.missed');
  }

  async reportMediaReady(callId: string, participantId: string): Promise<CallSession> {
    const session = await this.#requireSession(callId);
    if (!(await this.#authz.canRequestJoinToken(participantId, session))) {
      throw new CallError('FORBIDDEN', 'Not a call participant', 403);
    }
    if (session.state !== 'CONNECTING' && session.state !== 'ACTIVE') {
      throw new CallError('INVALID_TRANSITION', 'Media ready only while connecting or active', 409);
    }

    if (!session.media_ready.includes(participantId)) {
      session.media_ready = [...session.media_ready, participantId];
      session.updated_at = this.#now().toISOString();
      await this.#repo.save(session);
    }

    if (
      session.state === 'CONNECTING'
      && session.media_ready.includes(session.caller.participant_id)
      && session.media_ready.includes(session.callee.participant_id)
    ) {
      assertTransition(session.state, 'ACTIVE');
      session.state = 'ACTIVE';
      session.state_version += 1;
      session.active_at = this.#now().toISOString();
      session.updated_at = session.active_at;
      await this.#repo.save(session);
      await this.#publish(session, 'call.active', this.#both(session), { status: 'ACTIVE' });
    }

    return session;
  }

  /**
   * Issues a LiveKit join token only after accept (CONNECTING/ACTIVE).
   * Never issues while RINGING. Never issues for non-participants or terminal states.
   */
  async issueJoinToken(callId: string, participantId: string): Promise<JoinTokenResult> {
    const session = await this.#requireSession(callId);
    if (!(await this.#authz.canRequestJoinToken(participantId, session))) {
      throw new CallError('FORBIDDEN', 'Not allowed to join this call', 403);
    }
    if (session.state === 'RINGING' || session.state === 'IDLE') {
      throw new CallError('TOKEN_DENIED', 'Join token denied before accept', 403);
    }
    if (isTerminalCallState(session.state)) {
      throw new CallError('TOKEN_DENIED', 'Join token denied for finished call', 403);
    }
    if (session.state !== 'ACCEPTED' && session.state !== 'CONNECTING' && session.state !== 'ACTIVE') {
      throw new CallError('TOKEN_DENIED', 'Join token denied for current call state', 403);
    }
    if (!this.#media.isConfigured()) {
      throw new CallError('LIVEKIT_CONFIG_MISSING', 'LiveKit is not configured', 503);
    }

    const ref =
      participantId === session.caller.participant_id
        ? session.caller
        : participantId === session.callee.participant_id
          ? session.callee
          : null;
    if (!ref) {
      throw new CallError('PARTICIPANT_LIMIT', 'Third-party join denied', 403);
    }

    const issued = await this.#media.createJoinToken({
      roomName: session.room_name,
      identity: ref.media_identity,
      ttlSeconds: this.#joinTokenTtlSeconds,
    });

    return {
      call_id: session.call_id,
      room_name: session.room_name,
      identity: ref.media_identity,
      token: issued.token,
      livekit_url: issued.livekitUrl,
      expires_at: issued.expiresAt,
      token_generation: session.token_generation,
    };
  }

  async getSession(callId: string, actorId: string): Promise<CallSession> {
    const session = await this.#requireSession(callId);
    if (
      actorId !== session.caller.participant_id
      && actorId !== session.callee.participant_id
    ) {
      throw new CallError('FORBIDDEN', 'Not a call participant', 403);
    }
    return session;
  }

  toPublic(session: CallSession): ReturnType<typeof toPublicSession> {
    const includeRoom =
      session.state === 'ACCEPTED'
      || session.state === 'CONNECTING'
      || session.state === 'ACTIVE';
    return toPublicSession(session, includeRoom);
  }

  /** Expose transition helper for tests. */
  static canTransition(from: CallState, to: CallState): boolean {
    return canTransition(from, to);
  }

  async #finalize(
    session: CallSession,
    state: 'DECLINED' | 'MISSED' | 'ENDED' | 'FAILED',
    reason: CallEndReason,
    eventType: CallSignalEvent['type'],
  ): Promise<CallSession> {
    const now = this.#now().toISOString();
    session.state = state;
    session.state_version += 1;
    session.ended_at = now;
    session.updated_at = now;
    session.end_reason = reason;
    session.token_generation += 1;
    await this.#repo.save(session);
    this.#clearTimer(session.call_id);

    await this.#media.removeParticipant(session.room_name, session.caller.media_identity);
    await this.#media.removeParticipant(session.room_name, session.callee.media_identity);
    await this.#media.deleteRoom(session.room_name);

    await this.#publish(session, eventType, this.#both(session), {
      status: state,
      end_reason: reason,
    });
    return session;
  }

  #ensureNotExpiredWhileRinging(session: CallSession): void {
    if (session.state !== 'RINGING') return;
    if (Date.parse(session.ringing_expires_at) <= this.#now().getTime()) {
      throw new CallError('CALL_EXPIRED', 'Call ringing window expired', 410);
    }
  }

  async #requireSession(callId: string): Promise<CallSession> {
    const session = await this.#repo.getById(callId);
    if (!session) throw new CallError('CALL_NOT_FOUND', 'Call not found', 404);
    return session;
  }

  #both(session: CallSession): string[] {
    return [session.caller.participant_id, session.callee.participant_id];
  }

  async #publish(
    session: CallSession,
    type: CallSignalEvent['type'],
    participantIds: string[],
    data: Record<string, unknown>,
  ): Promise<void> {
    const event: CallSignalEvent = {
      schema_version: 1,
      event_id: createEventId(),
      type,
      call_id: session.call_id,
      state_version: session.state_version,
      occurred_at: this.#now().toISOString(),
      data,
    };
    await this.#signaling.publish(participantIds, event);
  }

  #armRingingTimeout(callId: string, timeoutMs: number): void {
    this.#clearTimer(callId);
    const timer = setTimeout(() => {
      void this.markMissed(callId);
    }, timeoutMs);
    // Unref so tests/process can exit; demo server keeps event loop via HTTP/WS.
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    this.#timers.set(callId, timer);
  }

  #clearTimer(callId: string): void {
    const timer = this.#timers.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.#timers.delete(callId);
    }
  }
}
