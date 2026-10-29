import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { WebSocket } from 'ws';
import {
  CallError,
  DEMO_PATIENT_ID,
  DEMO_STAFF_ID,
  FakeCallMediaProvider,
  StagingAuthService,
  createCallStagingApp,
  parseStagingAuthConfig,
  type StagingApp,
} from '../src/modules/be2-calls/index.js';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { createCallPrototypeDemoApp } from '../examples/call-prototype/server/demo-app.js';

const secret = 'staging-token-secret-at-least-32-chars!!';

function stagingEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    CALL_STAGING_ENABLED: 'true',
    CALL_STAGING_TOKEN_SECRET: secret,
    CALL_STAGING_STAFF_USERNAME: 'staff.tester',
    CALL_STAGING_STAFF_PASSWORD: 'staff-password-12',
    CALL_STAGING_PATIENT_USERNAME: 'patient.tester',
    CALL_STAGING_PATIENT_PASSWORD: 'patient-password-12',
    CALL_STAGING_ALLOWED_ORIGINS: 'https://app.example',
    ...extra,
  };
}

async function listen(app: StagingApp): Promise<StagingApp> {
  await new Promise<void>((resolve, reject) => {
    app.httpServer.once('error', reject);
    app.httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  return app;
}

function portOf(app: StagingApp): number {
  const addr = app.httpServer.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  return addr.port;
}

describe('call staging server security', () => {
  const apps: StagingApp[] = [];
  afterEach(async () => {
    while (apps.length) {
      const a = apps.pop();
      if (a) await a.close();
    }
  });

  it('refuses construction without CALL_STAGING_ENABLED', () => {
    expect(() => createCallStagingApp({
      env: stagingEnv({ CALL_STAGING_ENABLED: 'false' }),
      media: new FakeCallMediaProvider(),
    })).toThrow(CallError);
  });

  it('keeps local demo forbidden in production', () => {
    expect(() => createCallPrototypeDemoApp({
      env: { NODE_ENV: 'production', CALL_PROTOTYPE_ENABLED: 'true' },
      media: new FakeCallMediaProvider(),
    })).toThrow(CallError);
  });

  it('does not mount staging routes on src/app.ts', async () => {
    const app = createApp(parseConfig({ NODE_ENV: 'production' }));
    expect((await request(app).post('/api/staging/auth/login').send({})).status).toBe(404);
    expect((await request(app).post('/api/staging/calls').send({})).status).toBe(404);
  });

  it('rejects login without credentials and accepts approved accounts', async () => {
    const staging = await listen(createCallStagingApp({
      env: stagingEnv(),
      media: new FakeCallMediaProvider(),
      auth: new StagingAuthService(parseStagingAuthConfig(stagingEnv())),
    }));
    apps.push(staging);

    expect((await request(staging.httpServer).post('/api/staging/auth/login').send({})).status).toBe(400);
    const bad = await request(staging.httpServer)
      .post('/api/staging/auth/login')
      .send({ username: 'staff.tester', password: 'wrong-password!!' });
    expect(bad.status).toBe(401);

    const ok = await request(staging.httpServer)
      .post('/api/staging/auth/login')
      .send({ username: 'staff.tester', password: 'staff-password-12' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.access_token).toBeTruthy();
    expect(ok.body.data.participant_id).toBe(DEMO_STAFF_ID);
    expect(ok.body.data.role).toBe('staff');
  });

  it('denies unauthenticated join-token and rejects X-Demo-Participant', async () => {
    const staging = await listen(createCallStagingApp({
      env: stagingEnv(),
      media: new FakeCallMediaProvider(),
      auth: new StagingAuthService(parseStagingAuthConfig(stagingEnv())),
    }));
    apps.push(staging);

    const denied = await request(staging.httpServer)
      .post('/api/staging/calls/00000000-0000-4000-8000-000000000001/join-token');
    expect(denied.status).toBe(401);

    const demoHeader = await request(staging.httpServer)
      .post('/api/staging/auth/login')
      .set('X-Demo-Participant', 'demo-staff')
      .send({ username: 'staff.tester', password: 'staff-password-12' });
    expect(demoHeader.status).toBe(403);
  });

  it('runs authenticated staff→patient call without client-chosen room', async () => {
    const media = new FakeCallMediaProvider();
    const staging = await listen(createCallStagingApp({
      env: stagingEnv(),
      media,
      auth: new StagingAuthService(parseStagingAuthConfig(stagingEnv())),
    }));
    apps.push(staging);

    const staffLogin = await request(staging.httpServer)
      .post('/api/staging/auth/login')
      .send({ username: 'staff.tester', password: 'staff-password-12' });
    const patientLogin = await request(staging.httpServer)
      .post('/api/staging/auth/login')
      .send({ username: 'patient.tester', password: 'patient-password-12' });
    const staffToken = staffLogin.body.data.access_token as string;
    const patientToken = patientLogin.body.data.access_token as string;

    const created = await request(staging.httpServer)
      .post('/api/staging/calls')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ callee_id: 'attacker', room_name: 'evil' });
    expect(created.status).toBe(201);
    expect(created.body.data.callee_participant_id).toBe(DEMO_PATIENT_ID);
    expect(created.body.data.caller_participant_id).toBe(DEMO_STAFF_ID);
    const callId = created.body.data.call_id as string;

    const preToken = await request(staging.httpServer)
      .post(`/api/staging/calls/${callId}/join-token`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({});
    expect(preToken.status).toBe(403);

    const accepted = await request(staging.httpServer)
      .post(`/api/staging/calls/${callId}/accept`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({});
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.state).toBe('CONNECTING');

    const join = await request(staging.httpServer)
      .post(`/api/staging/calls/${callId}/join-token`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ room_name: 'evil', identity: 'spoof' });
    expect(join.status).toBe(403);

    const joinOk = await request(staging.httpServer)
      .post(`/api/staging/calls/${callId}/join-token`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({});
    expect(joinOk.status).toBe(200);
    expect(joinOk.body.data.room_name).toBe(accepted.body.data.room_name);
  });

  it('blocks third-party websocket subscription without valid token', async () => {
    const staging = await listen(createCallStagingApp({
      env: stagingEnv(),
      media: new FakeCallMediaProvider(),
      auth: new StagingAuthService(parseStagingAuthConfig(stagingEnv())),
    }));
    apps.push(staging);
    const port = portOf(staging);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?participant=${DEMO_STAFF_ID}`);
      // Server may complete the WS handshake then close with 1008 (participant query forbidden).
      ws.on('close', () => resolve());
      ws.on('error', () => resolve());
      setTimeout(() => reject(new Error('unauth ws timeout')), 2000);
    });

    const login = await request(staging.httpServer)
      .post('/api/staging/auth/login')
      .send({ username: 'staff.tester', password: 'staff-password-12' });
    const token = login.body.data.access_token as string;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?access_token=${encodeURIComponent(token)}`);
      ws.on('open', () => {
        ws.close();
        resolve();
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('auth ws timeout')), 2000);
    });
  });
});
