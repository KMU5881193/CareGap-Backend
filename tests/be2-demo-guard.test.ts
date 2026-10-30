import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { assertLocalDemo, createBe2DemoApp, demoAccounts, demoPersonId } from '../src/demo/be2-local.js';

const closed: Server[] = [];

function unusedPool(): Pool {
  return {
    query() {
      throw new Error('query should not run');
    },
    connect() {
      throw new Error('connect should not run');
    },
  } as unknown as Pool;
}

afterEach(async () => {
  await Promise.all(closed.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('local demo guard', () => {
  it('keeps the public app closed', async () => {
    const response = await request(createApp(parseConfig({ NODE_ENV: 'test' }))).get('/api/be2/consultations');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  it('refuses production, shared databases, and non-loopback targets', () => {
    expect(() => assertLocalDemo({ NODE_ENV: 'production', BE2_DEMO_DATABASE_URL: 'postgres://127.0.0.1:1/demo' })).toThrow(/production/);
    expect(() => assertLocalDemo({ NODE_ENV: 'development', BE2_DEMO_DATABASE_URL: 'postgres://127.0.0.1:1/caregap_local' })).toThrow(/caregap_local/);
    expect(() => assertLocalDemo({ NODE_ENV: 'development', BE2_DEMO_DATABASE_URL: 'postgres://db.example:1/demo' })).toThrow(/loopback/);
    expect(assertLocalDemo({ NODE_ENV: 'development', BE2_DEMO_DATABASE_URL: 'postgres://127.0.0.1:55434/caregap_be2_demo' }).port).toBe(4010);
  });

  it('rejects missing, invalid, and unapproved demo tokens before any query', async () => {
    const app = createBe2DemoApp(unusedPool());
    const path = `/api/be2/consultations?person_id=${demoPersonId}`;
    const missing = await request(app).get(path);
    const invalid = await request(app).get(path).set('Authorization', 'Bearer not-a-demo-token');
    const pending = await request(app).get(path).set('Authorization', `Bearer ${demoAccounts.pending.token}`);
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    expect(invalid.status).toBe(401);
    expect(invalid.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Invalid demo token' } });
    expect(pending.status).toBe(403);
    expect(pending.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Demo account is not approved' } });
  });

  it('denies another staff member, a family account, and an admin before reading records', async () => {
    const app = createBe2DemoApp(unusedPool());
    const path = `/api/be2/consultations?person_id=${demoPersonId}`;
    for (const account of [demoAccounts.otherStaff, demoAccounts.family, demoAccounts.admin]) {
      const response = await request(app).get(path).set('Authorization', `Bearer ${account.token}`);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
  });

  it('listens on loopback and reports demo mode', async () => {
    const server = createBe2DemoApp(unusedPool()).listen(0, '127.0.0.1');
    closed.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a loopback port');
    expect(address.address).toBe('127.0.0.1');
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { status: 'ok', mode: 'local-demo' } });
  });
});
