import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express, { type Request } from 'express';
import { Pool } from 'pg';
import request from 'supertest';
import { Actor, type Actor as ActorType } from '../src/shared/contracts.js';
import type { ConflictPolicy } from '../src/modules/be2-consultations/appointment-conflict.js';
import type { TransitionRule } from '../src/modules/be2-consultations/appointment-transition.js';
import type { FollowUpTransitionRule } from '../src/modules/be2-consultations/follow-up.js';
import { createBe2Router } from '../src/modules/be2-consultations/http.js';

const databaseUrl = process.env.BE2_TEST_DATABASE_URL;
const staffId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const personId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherPersonId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const consultationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const versionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const nextVersionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const followUpId = '11111111-1111-4111-8111-111111111111';
const notificationId = '22222222-2222-4222-8222-222222222222';
const otherConsultationId = '99999999-9999-4999-8999-999999999999';
const otherVersionId = '88888888-8888-4888-8888-888888888888';
const source = '합성 기록: 대상자가 서류 준비를 아직 마치지 못했습니다.';
const otherSource = '다른 대상자용 합성 문장';
const safeNotice = '후속 업무가 등록되었습니다.';

function actorHeader(userId: string, role: ActorType['role']): string {
  return JSON.stringify({ user_id: userId, role });
}

function authenticate(req: Request): Promise<ActorType | null> {
  const raw = req.get('X-Test-Actor');
  if (raw === undefined) return Promise.resolve(null);
  try {
    const parsed = Actor.safeParse(JSON.parse(raw));
    return Promise.resolve(parsed.success ? parsed.data : null);
  } catch {
    return Promise.resolve(null);
  }
}

function testApp(
  pool: Pool,
  options: {
    followUpRules?: readonly FollowUpTransitionRule[];
    appointmentRules?: readonly TransitionRule[];
    appointmentConflict?: ConflictPolicy;
  } = {},
) {
  const app = express();
  app.use(express.json());
  app.use('/api/be2', createBe2Router({
    pool,
    authenticate,
    authorize: {
      async canAccess(actor, subjectId) {
        return actor.user_id.toLowerCase() === staffId && subjectId.toLowerCase() === personId;
      },
    },
    followUpPolicy: { source: 'optional', assignee: 'optional', due: 'optional' },
    followUpRules: options.followUpRules ?? [{ from: 'fixture-open', action: 'advance', to: 'fixture-next' }],
    appointmentRules: options.appointmentRules ?? [],
    appointmentConflict: options.appointmentConflict ?? { occupyingStatuses: [], blockingRelations: [] },
    notificationPolicy: { event: 'optional', subject: 'optional', event_repeat: 'unset' },
  }));
  return app;
}

describe.skipIf(databaseUrl === undefined)('be2 postgres integration', () => {
  let pool: Pool;

  beforeAll(async () => {
    if (databaseUrl === undefined) throw new Error('BE2_TEST_DATABASE_URL is required');
    pool = new Pool({ connectionString: databaseUrl });
    const ready = await pool.query<{ name: string | null }>(`SELECT to_regclass('public.consultations') AS name`);
    if (ready.rows[0]?.name == null) {
      const usersSql = execFileSync('git', ['show', 'main:migrations/0001_be1_create_users_table.sql'], { encoding: 'utf8' });
      const draftSql = readFileSync(new URL('../migrations/drafts/0002_be2_consultations.sql', import.meta.url), 'utf8');
      await pool.query(usersSql);
      await pool.query(draftSql);
    }
    await pool.query(
      `INSERT INTO users (user_id, email, password_hash, name, role, status) VALUES
       ($1, 'be2-staff@example.test', 'not-a-secret', 'synthetic staff', 'staff', 'APPROVED'),
       ($2, 'be2-other@example.test', 'not-a-secret', 'synthetic other', 'patient', 'APPROVED')
       ON CONFLICT (user_id) DO NOTHING`,
      [staffId, otherId],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE notifications, follow_up_tasks, consultation_record_versions, consultations, appointments`);
  });

  it('stores a consultation version, keeps the old text, and links a follow-up', async () => {
    const app = testApp(pool);
    const staff = actorHeader(staffId, 'staff');
    const created = await request(app).post('/api/be2/consultations').set('X-Test-Actor', staff).send({
      consultation_id: consultationId,
      person_id: personId,
      record_version_id: versionId,
      text: source,
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ consultation_id: consultationId, person_id: personId, record_version_id: versionId });

    const stored = await pool.query<{ text: string }>(
      `SELECT text FROM consultation_record_versions WHERE record_version_id = $1`,
      [versionId],
    );
    expect(stored.rows.map((row) => row.text)).toEqual([source]);

    const listed = await request(app).get('/api/be2/consultations').query({ person_id: personId }).set('X-Test-Actor', staff);
    expect(listed.status).toBe(200);
    expect(listed.text).not.toContain(source);
    expect(listed.body.data).toEqual([{ consultation_id: consultationId, person_id: personId, appointment_id: null }]);

    const header = await request(app).get(`/api/be2/consultations/${consultationId}`).set('X-Test-Actor', staff);
    expect(header.status).toBe(200);
    expect(header.body.data.record_version_ids).toEqual([versionId]);
    expect(header.text).not.toContain(source);

    const first = await request(app).get(`/api/be2/consultations/${consultationId}/versions/${versionId}`).set('X-Test-Actor', staff);
    expect(first.status).toBe(200);
    expect(first.body.data.text).toBe(source);

    const revised = await request(app).post(`/api/be2/consultations/${consultationId}/versions`).set('X-Test-Actor', staff).send({
      record_version_id: nextVersionId,
      text: '수정한 합성 기록',
    });
    expect(revised.status).toBe(201);
    expect(revised.body.data.record_version_id).toBe(nextVersionId);

    const versions = await pool.query<{ record_version_id: string; text: string }>(
      `SELECT record_version_id, text FROM consultation_record_versions WHERE consultation_id = $1 ORDER BY record_version_id`,
      [consultationId],
    );
    expect(versions.rows).toEqual([
      { record_version_id: versionId, text: source },
      { record_version_id: nextVersionId, text: '수정한 합성 기록' },
    ]);

    await expect(pool.query(
      `UPDATE consultation_record_versions SET text = $2 WHERE record_version_id = $1`,
      [versionId, 'replaced'],
    )).rejects.toThrow(/cannot be updated/);
    const unchanged = await pool.query<{ text: string }>(
      `SELECT text FROM consultation_record_versions WHERE record_version_id = $1`,
      [versionId],
    );
    expect(unchanged.rows[0]?.text).toBe(source);

    const duplicate = await request(app).post('/api/be2/consultations').set('X-Test-Actor', staff).send({
      consultation_id: consultationId,
      person_id: personId,
      record_version_id: '77777777-7777-4777-8777-777777777777',
      text: source,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.text).not.toContain(source);

    const hidden = await request(app).get(`/api/be2/consultations/${consultationId}/versions/${versionId}`)
      .set('X-Test-Actor', actorHeader(otherId, 'admin'));
    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    expect(hidden.text).not.toContain(source);

    const task = await request(app).post('/api/be2/follow-ups').set('X-Test-Actor', staff).send({
      follow_up_id: followUpId,
      person_id: personId,
      title: '서류 안내',
      status: 'fixture-open',
      consultation_id: consultationId,
      record_version_id: versionId,
    });
    expect(task.status).toBe(201);
    const linked = await pool.query<{ record_version_id: string; consultation_id: string; person_id: string }>(
      `SELECT record_version_id, consultation_id, person_id FROM follow_up_tasks WHERE follow_up_id = $1`,
      [followUpId],
    );
    expect(linked.rows).toEqual([{ record_version_id: versionId, consultation_id: consultationId, person_id: personId }]);

    const tasks = await request(app).get('/api/be2/follow-ups').query({ person_id: personId }).set('X-Test-Actor', staff);
    expect(tasks.status).toBe(200);
    expect(tasks.body.data.map((item: { follow_up_id: string }) => item.follow_up_id)).toEqual([followUpId]);
    expect(tasks.text).not.toContain(source);

    const blocked = await request(testApp(pool, { followUpRules: [] }))
      .post(`/api/be2/follow-ups/${followUpId}/actions`)
      .set('X-Test-Actor', staff)
      .send({ action: 'advance' });
    expect(blocked.status).toBe(409);
    const stillOpen = await pool.query<{ status: string }>(`SELECT status FROM follow_up_tasks WHERE follow_up_id = $1`, [followUpId]);
    expect(stillOpen.rows[0]?.status).toBe('fixture-open');

    const advanced = await request(app).post(`/api/be2/follow-ups/${followUpId}/actions`).set('X-Test-Actor', staff).send({ action: 'advance' });
    expect(advanced.status).toBe(200);
    expect(advanced.body.data.status).toBe('fixture-next');

    const patched = await request(app).patch(`/api/be2/follow-ups/${followUpId}`).set('X-Test-Actor', staff).send({
      title: '서류 안내 수정',
      updated_at: '2026-10-30T03:00:00.000Z',
    });
    expect(patched.status).toBe(200);
    const saved = await pool.query<{ title: string; status: string }>(
      `SELECT title, status FROM follow_up_tasks WHERE follow_up_id = $1`,
      [followUpId],
    );
    expect(saved.rows).toEqual([{ title: '서류 안내 수정', status: 'fixture-next' }]);

    const missingVersion = await request(app).post('/api/be2/follow-ups').set('X-Test-Actor', staff).send({
      follow_up_id: '66666666-6666-4666-8666-666666666666',
      person_id: personId,
      title: '없는 버전',
      status: 'fixture-open',
      consultation_id: consultationId,
      record_version_id: '55555555-5555-4555-8555-555555555555',
    });
    expect(missingVersion.status).toBe(404);
    expect(missingVersion.text).not.toContain(source);

    await pool.query(
      `INSERT INTO consultations (consultation_id, person_id) VALUES ($1, $2)`,
      [otherConsultationId, otherPersonId],
    );
    await pool.query(
      `INSERT INTO consultation_record_versions (record_version_id, consultation_id, person_id, text) VALUES ($1, $2, $3, $4)`,
      [otherVersionId, otherConsultationId, otherPersonId, otherSource],
    );
    const wrongPerson = await request(app).post('/api/be2/follow-ups').set('X-Test-Actor', staff).send({
      follow_up_id: '12121212-1212-4121-8121-121212121212',
      person_id: personId,
      title: '잘못된 연결',
      status: 'fixture-open',
      consultation_id: otherConsultationId,
      record_version_id: otherVersionId,
    });
    expect(wrongPerson.status).toBe(409);
    expect(wrongPerson.text).not.toContain(source);
    expect(wrongPerson.text).not.toContain(otherSource);
    const wrongCount = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM follow_up_tasks WHERE follow_up_id = $1`, ['12121212-1212-4121-8121-121212121212']);
    expect(wrongCount.rows[0]?.n).toBe('0');

    const duplicateTask = await request(app).post('/api/be2/follow-ups').set('X-Test-Actor', staff).send({
      follow_up_id: followUpId,
      person_id: personId,
      title: '중복',
      status: 'fixture-open',
    });
    expect(duplicateTask.status).toBe(409);
    expect(duplicateTask.text).not.toContain(source);
  });

  it('does not persist appointment confirmation and the database does not exclude overlaps', async () => {
    const app = testApp(pool);
    const staff = actorHeader(staffId, 'staff');
    const body = { person_id: personId, starts_at: '2026-10-30T01:00:00.000Z', ends_at: '2026-10-30T02:00:00.000Z' };
    const [first, second] = await Promise.all([
      request(app).post('/api/be2/appointments').set('X-Test-Actor', staff).send(body),
      request(app).post('/api/be2/appointments').set('X-Test-Actor', staff).send(body),
    ]);
    expect(first.status).toBe(409);
    expect(second.status).toBe(409);
    expect(first.body).toEqual(second.body);
    const none = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM appointments`);
    expect(none.rows[0]?.n).toBe('0');

    const configured = testApp(pool, {
      appointmentConflict: { occupyingStatuses: ['fixture-held'], blockingRelations: ['overlaps'] },
    });
    const refused = await request(configured).post('/api/be2/appointments').set('X-Test-Actor', staff).send(body);
    expect(refused.status).toBe(409);
    expect((await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM appointments`)).rows[0]?.n).toBe('0');

    const sameStaff = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
    const sameStaffLater = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac';
    const otherStaffAppointment = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad';
    await pool.query(
      `INSERT INTO appointments (appointment_id, person_id, staff_user_id, requester_user_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, '2026-10-30T01:00:00Z', '2026-10-30T02:00:00Z', 'fixture-held'),
              ($5, $2, $3, $4, '2026-10-30T01:30:00Z', '2026-10-30T02:30:00Z', 'fixture-held'),
              ($6, $7, $8, $4, '2026-10-30T01:00:00Z', '2026-10-30T02:00:00Z', 'fixture-held')`,
      [sameStaff, personId, staffId, otherId, sameStaffLater, otherStaffAppointment, otherPersonId, otherId],
    );
    const byPerson = await request(app).get('/api/be2/appointments').query({ person_id: personId }).set('X-Test-Actor', staff);
    expect(byPerson.status).toBe(200);
    expect(byPerson.body.data.map((row: { appointment_id: string }) => row.appointment_id)).toEqual([sameStaff, sameStaffLater]);
    expect(byPerson.body.data[0]).not.toHaveProperty('staff_user_id');
    const byStaff = await request(app).get('/api/be2/appointments').query({ staff_user_id: staffId }).set('X-Test-Actor', staff);
    expect(byStaff.status).toBe(200);
    expect(byStaff.body.data).toHaveLength(2);
    const otherStaffView = await request(app).get('/api/be2/appointments').query({ staff_user_id: staffId }).set('X-Test-Actor', actorHeader(otherId, 'staff'));
    expect(otherStaffView.status).toBe(404);
    const otherPerson = await request(app).get('/api/be2/appointments').query({ person_id: otherPersonId }).set('X-Test-Actor', staff);
    expect(otherPerson.status).toBe(404);

    const held = await request(app).post(`/api/be2/appointments/${sameStaff}/actions`).set('X-Test-Actor', staff).send({ action: 'advance' });
    expect(held.status).toBe(409);
    const status = await pool.query<{ status: string }>(`SELECT status FROM appointments WHERE appointment_id = $1`, [sameStaff]);
    expect(status.rows[0]?.status).toBe('fixture-held');

    const ruled = testApp(pool, {
      appointmentRules: [{ from: 'fixture-held', action: 'advance', to: 'fixture-next', actors: ['staff'] }],
    });
    const moved = await request(ruled).post(`/api/be2/appointments/${sameStaff}/actions`).set('X-Test-Actor', staff).send({ action: 'advance' });
    expect(moved.status).toBe(200);
    expect(moved.body.data.status).toBe('fixture-next');
    expect(moved.body.data.starts_at.startsWith('2026-10-30T01:00:00')).toBe(true);
  });

  it('stores a notification for the authenticated recipient and hides other mailboxes', async () => {
    const app = testApp(pool);
    const staff = actorHeader(staffId, 'staff');
    const created = await request(app).post('/api/be2/notifications').set('X-Test-Actor', staff).send({
      notification_id: notificationId,
      kind: 'follow_up',
      title: '후속 업무',
      body: safeNotice,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.body).toBe(safeNotice);
    expect(created.body.data.recipient_user_id).toBe(staffId);
    expect(created.text).not.toContain(source);

    const stored = await pool.query<{ body: string; read_at: Date | null }>(
      `SELECT body, read_at FROM notifications WHERE notification_id = $1`,
      [notificationId],
    );
    expect(stored.rows[0]?.body).toBe(safeNotice);
    expect(stored.rows[0]?.read_at).toBeNull();
    const delivery = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'notifications' AND column_name IN ('sent_at', 'delivered_at', 'text')`,
    );
    expect(delivery.rows).toEqual([]);

    const foreign = await request(app).post(`/api/be2/notifications/${notificationId}/read`)
      .set('X-Test-Actor', actorHeader(otherId, 'patient'))
      .send({ read_at: '2026-10-30T04:00:00.000Z' });
    const missing = await request(app).post('/api/be2/notifications/12345678-1234-4234-8234-123456789012/read')
      .set('X-Test-Actor', staff)
      .send({ read_at: '2026-10-30T04:00:00.000Z' });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(foreign.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    const unread = await pool.query<{ read_at: Date | null }>(`SELECT read_at FROM notifications WHERE notification_id = $1`, [notificationId]);
    expect(unread.rows[0]?.read_at).toBeNull();

    const read = await request(app).post(`/api/be2/notifications/${notificationId}/read`).set('X-Test-Actor', staff).send({
      read_at: '2026-10-30T04:00:00.000Z',
    });
    expect(read.status).toBe(200);
    expect(read.body.data.read_at).toBe('2026-10-30T04:00:00.000Z');
    const ownList = await request(app).get('/api/be2/notifications').set('X-Test-Actor', staff);
    const otherList = await request(app).get('/api/be2/notifications').set('X-Test-Actor', actorHeader(otherId, 'patient'));
    expect(ownList.body.data).toHaveLength(1);
    expect(otherList.body.data).toEqual([]);
  });
});
