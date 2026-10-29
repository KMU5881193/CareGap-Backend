import { describe, expect, it } from 'vitest';
import express, { type Request } from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import type { Actor } from '../src/shared/contracts.js';
import { createBe2Router } from '../src/modules/be2-consultations/http.js';
import { decideAppointmentPersistence } from '../src/modules/be2-consultations/repository.js';

const staffId = '33333333-3333-4333-8333-333333333333';
const personId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const consultationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const versionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const source = '합성 기록: 대상자가 서류 준비를 아직 마치지 못했습니다.';

function authenticate(req: Request): Promise<Actor | null> {
  const raw = req.get('X-Test-Actor');
  if (raw === undefined) return Promise.resolve(null);
  return Promise.resolve({ user_id: staffId, role: 'staff' });
}

function routerApp(allowed: boolean, queries: string[] = []) {
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes('FROM consultations')) {
        return { rows: [{ consultation_id: consultationId, person_id: personId, appointment_id: null }] };
      }
      throw new Error('unexpected query');
    },
    async connect() {
      throw new Error('connect should not run');
    },
  } as unknown as Pool;
  const app = express();
  app.use(express.json());
  app.use('/api/be2', createBe2Router({
    pool,
    authenticate,
    authorize: { canAccess: async () => allowed },
    followUpPolicy: { source: 'optional', assignee: 'optional', due: 'optional' },
    followUpRules: [],
    appointmentRules: [],
    appointmentConflict: { occupyingStatuses: [], blockingRelations: [] },
    notificationPolicy: { event: 'optional', subject: 'optional', event_repeat: 'unset' },
  }));
  return app;
}

describe('be2 http boundary', () => {
  it('does not mount consultation routes on the public app', async () => {
    const app = createApp(parseConfig({ NODE_ENV: 'test' }));
    const response = await request(app).post('/api/be2/consultations').send({ verified: true, allowed: true, text: source });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    expect(response.text).not.toContain(source);
  });

  it('rejects a body that claims access when authentication returns null', async () => {
    const app = routerApp(true);
    const response = await request(app).post('/api/be2/consultations').send({
      verified: true,
      allowed: true,
      user_id: staffId,
      role: 'admin',
      consultation_id: consultationId,
      person_id: personId,
      record_version_id: versionId,
      text: source,
    });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    expect(response.text).not.toContain(source);
  });

  it('does not treat verified flags in the body as authorization', async () => {
    const app = routerApp(false);
    const response = await request(app).post('/api/be2/consultations').set('X-Test-Actor', 'present').send({
      verified: true,
      allowed: true,
      consultation_id: consultationId,
      person_id: personId,
      record_version_id: versionId,
      text: source,
    });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: 'INVALID_REQUEST', message: 'Invalid request' } });
    expect(response.text).not.toContain(source);
  });

  it('does not read record text when the injected authorizer denies access', async () => {
    const queries: string[] = [];
    const app = routerApp(false, queries);
    const response = await request(app).get(`/api/be2/consultations/${consultationId}/versions/${versionId}`).set('X-Test-Actor', 'present');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    expect(queries.some((sql) => sql.includes('consultation_record_versions'))).toBe(false);
    expect(response.text).not.toContain(source);
  });

  it('rejects notification fields that could carry consultation text', async () => {
    const app = routerApp(true);
    const response = await request(app).post('/api/be2/notifications').set('X-Test-Actor', 'present').send({
      notification_id: '22222222-2222-4222-8222-222222222222',
      kind: 'follow_up',
      title: '후속 업무',
      body: '후속 업무가 등록되었습니다.',
      text: source,
      recipient_user_id: staffId,
    });
    expect(response.status).toBe(400);
    expect(response.text).not.toContain(source);
  });

  it('keeps appointment confirmation unconfigured until occupancy policy and an exclusion constraint exist', () => {
    expect(decideAppointmentPersistence({ occupyingStatuses: [], blockingRelations: [] })).toBe('policy_unset');
    expect(decideAppointmentPersistence({ occupyingStatuses: ['fixture-held'], blockingRelations: ['overlaps'] })).toBe('concurrency_unconfigured');
  });
});
