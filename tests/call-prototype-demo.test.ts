import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  CallError,
  DEMO_PATIENT_ID,
  DEMO_STAFF_ID,
  FakeCallMediaProvider,
} from '../src/modules/be2-calls/index.js';
import { createCallPrototypeDemoApp, type DemoApp } from '../examples/call-prototype/server/demo-app.js';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';

async function listenDemo(demo: DemoApp): Promise<DemoApp> {
  await new Promise<void>((resolve, reject) => {
    demo.httpServer.once('error', reject);
    demo.httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  return demo;
}

describe('call prototype demo harness security', () => {
  const demos: DemoApp[] = [];
  afterEach(async () => {
    while (demos.length) {
      const d = demos.pop();
      if (d) await d.close();
    }
  });

  it('refuses to construct demo app in production', () => {
    expect(() => createCallPrototypeDemoApp({
      env: { NODE_ENV: 'production', CALL_PROTOTYPE_ENABLED: 'true' },
      media: new FakeCallMediaProvider(),
    })).toThrow(CallError);
  });

  it('rejects unknown origin', async () => {
    const demo = await listenDemo(createCallPrototypeDemoApp({
      env: { NODE_ENV: 'test', CALL_PROTOTYPE_ENABLED: 'true' },
      media: new FakeCallMediaProvider(),
    }));
    demos.push(demo);
    const res = await request(demo.httpServer)
      .get('/health')
      .set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('requires demo participant header for call create', async () => {
    const demo = await listenDemo(createCallPrototypeDemoApp({
      env: { NODE_ENV: 'test', CALL_PROTOTYPE_ENABLED: 'true' },
      media: new FakeCallMediaProvider(),
    }));
    demos.push(demo);
    const res = await request(demo.httpServer)
      .post('/api/demo/calls')
      .set('Origin', 'http://127.0.0.1:5173')
      .send({ callee_id: DEMO_PATIENT_ID });
    expect(res.status).toBe(401);
  });

  it('runs create → accept → join-token happy path on demo API', async () => {
    const media = new FakeCallMediaProvider();
    const demo = await listenDemo(createCallPrototypeDemoApp({
      env: { NODE_ENV: 'test', CALL_PROTOTYPE_ENABLED: 'true' },
      media,
    }));
    demos.push(demo);

    const created = await request(demo.httpServer)
      .post('/api/demo/calls')
      .set('Origin', 'http://127.0.0.1:5173')
      .set('X-Demo-Participant', DEMO_STAFF_ID)
      .send({ callee_id: DEMO_PATIENT_ID });
    expect(created.status).toBe(201);
    const callId = created.body.data.call_id as string;

    const preToken = await request(demo.httpServer)
      .post(`/api/demo/calls/${callId}/join-token`)
      .set('Origin', 'http://127.0.0.1:5173')
      .set('X-Demo-Participant', DEMO_STAFF_ID);
    expect(preToken.status).toBe(403);

    const accepted = await request(demo.httpServer)
      .post(`/api/demo/calls/${callId}/accept`)
      .set('Origin', 'http://127.0.0.1:5173')
      .set('X-Demo-Participant', DEMO_PATIENT_ID);
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.state).toBe('CONNECTING');

    const token = await request(demo.httpServer)
      .post(`/api/demo/calls/${callId}/join-token`)
      .set('Origin', 'http://127.0.0.1:5173')
      .set('X-Demo-Participant', DEMO_STAFF_ID);
    expect(token.status).toBe(200);
    expect(token.body.data.token).toBeTruthy();
    expect(token.body.data.room_name).toBe(accepted.body.data.room_name);
  });

  it('does not mount demo call routes on production app.ts', async () => {
    const app = createApp(parseConfig({ NODE_ENV: 'test' }));
    const res = await request(app).post('/api/demo/calls').send({});
    expect(res.status).toBe(404);
    const prodish = createApp(parseConfig({ NODE_ENV: 'production' }));
    expect((await request(prodish).post('/api/demo/calls').send({})).status).toBe(404);
  });
});
