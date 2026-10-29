import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';

describe('unconfigured legacy authorization fails closed', () => {
  for (const path of [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/staff/pending',
    '/api/auth/staff/approve',
    '/api/relationships',
    '/api/consultations/records',
    '/api/welfare',
  ]) {
    it(path, async () => {
      const app = createApp(parseConfig({ NODE_ENV: 'production' }));
      expect((await request(app).get(path)).status).toBe(503);
      expect((await request(app).post(path).send({})).status).toBe(503);
    });
  }
});

describe('phase2 notification HTTP on createApp', () => {
  it('rejects unauthenticated notification access via BE1 auth port', async () => {
    const app = createApp(parseConfig({ NODE_ENV: 'production' }));
    expect((await request(app).get('/api/notifications')).status).toBe(401);
    expect((await request(app).get('/api/notification-preferences')).status).toBe(401);
    expect((await request(app).post('/api/notification-devices').send({})).status).toBe(401);
  });
});

it('does not expose internal exception messages', async () => {
  const app = createApp(parseConfig({ NODE_ENV: 'production' }));
  const response = await request(app)
    .post('/api/unconfigured')
    .set('content-type', 'application/json')
    .send('{');
  expect(response.status).toBe(400);
  expect(response.body).toEqual({
    error: { code: 'INVALID_REQUEST', message: 'Invalid JSON request' },
  });
});
