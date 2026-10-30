import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import request from 'supertest';
import {
  createBe2DemoApp,
  demoAccounts,
  demoAppointmentId,
  demoNotice,
  demoNotificationId,
  demoPastConsultationId,
  demoPastText,
  demoPastVersionId,
  demoPersonId,
  ensureDemoSchema,
  resetDemoData,
} from '../src/demo/be2-local.js';

const databaseUrl = process.env.BE2_DEMO_DATABASE_URL;
const newConsultationId = '10101010-1010-4101-8101-101010101010';
const newVersionId = '20202020-2020-4202-8202-202020202020';
const nextVersionId = '30303030-3030-4303-8303-303030303030';
const followUpId = '40404040-4040-4404-8404-404040404040';
const newText = '합성 기록: 이번 상담에서 제출 서류의 순서를 정리했습니다.';
const revisedText = '합성 기록: 제출 순서를 한 번 더 확인했습니다.';
const staff = `Bearer ${demoAccounts.staff.token}`;

describe.skipIf(databaseUrl === undefined)('local demo counselor flow', () => {
  let pool: Pool;

  beforeAll(async () => {
    if (databaseUrl === undefined) throw new Error('BE2_DEMO_DATABASE_URL is required');
    pool = new Pool({ connectionString: databaseUrl });
    await ensureDemoSchema(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDemoData(pool);
  });

  it('reads history, adds a version, updates a follow-up, and rejects other accounts', async () => {
    const app = createBe2DemoApp(pool);

    const listed = await request(app).get('/api/be2/consultations').query({ person_id: demoPersonId }).set('Authorization', staff);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([{ consultation_id: demoPastConsultationId, person_id: demoPersonId, appointment_id: null }]);
    expect(listed.text).not.toContain(demoPastText);

    const past = await request(app).get(`/api/be2/consultations/${demoPastConsultationId}/versions/${demoPastVersionId}`).set('Authorization', staff);
    expect(past.status).toBe(200);
    expect(past.body.data.text).toBe(demoPastText);

    const created = await request(app).post('/api/be2/consultations').set('Authorization', staff).send({
      consultation_id: newConsultationId,
      person_id: demoPersonId,
      record_version_id: newVersionId,
      text: newText,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.record_version_id).toBe(newVersionId);

    const revised = await request(app).post(`/api/be2/consultations/${newConsultationId}/versions`).set('Authorization', staff).send({
      record_version_id: nextVersionId,
      text: revisedText,
    });
    expect(revised.status).toBe(201);
    const kept = await request(app).get(`/api/be2/consultations/${newConsultationId}/versions/${newVersionId}`).set('Authorization', staff);
    expect(kept.body.data.text).toBe(newText);
    const stored = await pool.query<{ record_version_id: string; text: string }>(
      `SELECT record_version_id, text FROM consultation_record_versions WHERE consultation_id = $1 ORDER BY record_version_id`,
      [newConsultationId],
    );
    expect(stored.rows).toEqual([
      { record_version_id: newVersionId, text: newText },
      { record_version_id: nextVersionId, text: revisedText },
    ]);

    const task = await request(app).post('/api/be2/follow-ups').set('Authorization', staff).send({
      follow_up_id: followUpId,
      person_id: demoPersonId,
      title: '서류 순서 안내',
      status: 'fixture-open',
      consultation_id: newConsultationId,
      record_version_id: nextVersionId,
    });
    expect(task.status).toBe(201);
    const tasks = await request(app).get('/api/be2/follow-ups').query({ person_id: demoPersonId }).set('Authorization', staff);
    expect(tasks.status).toBe(200);
    expect(tasks.body.data).toEqual([expect.objectContaining({
      follow_up_id: followUpId,
      record_version_id: nextVersionId,
      title: '서류 순서 안내',
    })]);
    const patched = await request(app).patch(`/api/be2/follow-ups/${followUpId}`).set('Authorization', staff).send({ title: '서류 순서 재안내' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.title).toBe('서류 순서 재안내');
    const saved = await pool.query<{ title: string; record_version_id: string }>(
      `SELECT title, record_version_id FROM follow_up_tasks WHERE follow_up_id = $1`,
      [followUpId],
    );
    expect(saved.rows).toEqual([{ title: '서류 순서 재안내', record_version_id: nextVersionId }]);

    const notes = await request(app).get('/api/be2/notifications').set('Authorization', staff);
    expect(notes.status).toBe(200);
    expect(notes.body.data).toEqual([expect.objectContaining({ notification_id: demoNotificationId, body: demoNotice, read_at: null })]);
    expect(notes.text).not.toContain(newText);
    const read = await request(app).post(`/api/be2/notifications/${demoNotificationId}/read`).set('Authorization', staff).send({
      read_at: '2026-10-30T04:00:00.000Z',
    });
    expect(read.status).toBe(200);
    const foreign = await request(app).post(`/api/be2/notifications/${demoNotificationId}/read`)
      .set('Authorization', `Bearer ${demoAccounts.otherStaff.token}`)
      .send({ read_at: '2026-10-30T05:00:00.000Z' });
    const missing = await request(app).post('/api/be2/notifications/12345678-1234-4234-8234-123456789012/read')
      .set('Authorization', staff)
      .send({ read_at: '2026-10-30T05:00:00.000Z' });
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);

    const versionPath = `/api/be2/consultations/${newConsultationId}/versions/${nextVersionId}`;
    for (const account of [demoAccounts.otherStaff, demoAccounts.family, demoAccounts.admin]) {
      const denied = await request(app).get(versionPath).set('Authorization', `Bearer ${account.token}`);
      expect(denied.status).toBe(404);
      expect(denied.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      expect(denied.text).not.toContain(newText);
      expect(denied.text).not.toContain(revisedText);
    }
    const still = await pool.query<{ text: string }>(
      `SELECT text FROM consultation_record_versions WHERE record_version_id = $1`,
      [newVersionId],
    );
    expect(still.rows[0]?.text).toBe(newText);

    const schedule = await request(app).get('/api/be2/appointments').query({ person_id: demoPersonId }).set('Authorization', staff);
    expect(schedule.status).toBe(200);
    expect(schedule.body.data).toEqual([expect.objectContaining({ appointment_id: demoAppointmentId, status: 'fixture-held' })]);
    expect(schedule.body.data[0]).not.toHaveProperty('staff_user_id');
    const blocked = await request(app).post('/api/be2/appointments').set('Authorization', staff).send({
      person_id: demoPersonId,
      starts_at: '2026-11-02T01:00:00.000Z',
      ends_at: '2026-11-02T02:00:00.000Z',
    });
    expect(blocked.status).toBe(409);
    const count = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM appointments`);
    expect(count.rows[0]?.n).toBe('1');
  });

  it('reloads the same synthetic seed on a second reset', async () => {
    await resetDemoData(pool);
    await pool.query(
      `INSERT INTO consultations (consultation_id, person_id) VALUES ($1, $2)`,
      [newConsultationId, demoPersonId],
    );
    await resetDemoData(pool);
    const rows = await pool.query<{ consultation_id: string; text: string }>(
      `SELECT c.consultation_id, v.text
       FROM consultations c
       JOIN consultation_record_versions v ON v.consultation_id = c.consultation_id`,
    );
    expect(rows.rows).toEqual([{ consultation_id: demoPastConsultationId, text: demoPastText }]);
    const notes = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM notifications`);
    expect(notes.rows[0]?.n).toBe('1');
  });
});
