import type { Pool, QueryResult, QueryResultRow } from 'pg';
import type { RecordVersion } from '../../shared/contracts.js';
import { findAppointmentConflicts, type ConflictPolicy } from './appointment-conflict.js';
import { applyTransition, type TransitionRule } from './appointment-transition.js';
import {
  appendRecordVersion,
  readAuthorizedRecordVersion,
  reviseRecordVersion,
} from './consultation-record.js';
import {
  createFollowUp,
  FollowUpCreateInput,
  reviseFollowUp,
  transitionFollowUp,
  type FollowUpCreatePolicy,
  type FollowUpTask,
  type FollowUpTransitionRule,
} from './follow-up.js';
import {
  acceptNotification,
  listNotifications,
  markNotificationRead,
  NotificationAcceptInput,
  type Notification,
  type NotificationAcceptPolicy,
} from './notification.js';

export interface Db {
  query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export type AccessDecision =
  | { verified: false }
  | { verified: true; allowed: boolean };

type VersionRow = {
  consultation_id: string;
  record_version_id: string;
  person_id: string;
  text: string;
};

type ConsultationRow = {
  consultation_id: string;
  person_id: string;
  appointment_id: string | null;
};

type TaskRow = {
  follow_up_id: string;
  person_id: string;
  title: string;
  status: string;
  consultation_id: string | null;
  record_version_id: string | null;
  assignee_user_id: string | null;
  due_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type AppointmentRow = {
  appointment_id: string;
  person_id: string;
  staff_user_id: string;
  requester_user_id: string | null;
  starts_at: Date | string;
  ends_at: Date | string;
  status: string;
};

type NotificationRow = {
  notification_id: string;
  recipient_user_id: string;
  kind: string;
  title: string;
  body: string;
  event_id: string | null;
  appointment_id: string | null;
  follow_up_id: string | null;
  person_id: string | null;
  created_at: Date | string | null;
  read_at: Date | string | null;
};

export async function withTransaction<T>(pool: Pool, run: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await run(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function instant(value: Date | string | null): string | undefined {
  if (value == null) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function versionFromRow(row: VersionRow): RecordVersion {
  return {
    consultation_id: row.consultation_id,
    record_version_id: row.record_version_id,
    person_id: row.person_id,
    text: row.text,
  };
}

function taskFromRow(row: TaskRow): FollowUpTask {
  const dueAt = instant(row.due_at);
  const createdAt = instant(row.created_at);
  const updatedAt = instant(row.updated_at);
  return {
    follow_up_id: row.follow_up_id,
    person_id: row.person_id,
    title: row.title,
    status: row.status,
    ...(row.consultation_id != null ? { consultation_id: row.consultation_id } : {}),
    ...(row.record_version_id != null ? { record_version_id: row.record_version_id } : {}),
    ...(row.assignee_user_id != null ? { assignee_user_id: row.assignee_user_id } : {}),
    ...(dueAt !== undefined ? { due_at: dueAt } : {}),
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}),
  };
}

function notificationFromRow(row: NotificationRow): Notification {
  const createdAt = instant(row.created_at);
  const readAt = instant(row.read_at);
  return {
    notification_id: row.notification_id,
    recipient_user_id: row.recipient_user_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    ...(row.event_id != null ? { event_id: row.event_id } : {}),
    ...(row.appointment_id != null ? { appointment_id: row.appointment_id } : {}),
    ...(row.follow_up_id != null ? { follow_up_id: row.follow_up_id } : {}),
    ...(row.person_id != null ? { person_id: row.person_id } : {}),
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    ...(readAt !== undefined ? { read_at: readAt } : {}),
  };
}

async function loadVersions(db: Db, consultationId: string): Promise<RecordVersion[]> {
  const found = await db.query<VersionRow>(
    `SELECT consultation_id, record_version_id, person_id, text
     FROM consultation_record_versions
     WHERE consultation_id = $1`,
    [consultationId],
  );
  return found.rows.map(versionFromRow);
}

async function loadVersion(db: Db, consultationId: string, versionId: string): Promise<RecordVersion[]> {
  const found = await db.query<VersionRow>(
    `SELECT consultation_id, record_version_id, person_id, text
     FROM consultation_record_versions
     WHERE consultation_id = $1 AND record_version_id = $2`,
    [consultationId, versionId],
  );
  return found.rows.map(versionFromRow);
}

export async function insertConsultation(
  db: Db,
  input: {
    consultation_id: string;
    person_id: string;
    record_version_id: string;
    text: string;
    appointment_id?: string;
  },
  access: AccessDecision,
): Promise<
  | { outcome: 'created'; consultation_id: string; person_id: string; record_version_id: string }
  | { outcome: 'rejected'; reason: 'access_not_verified' | 'access_denied' | 'duplicate_version' | 'person_mismatch' | 'consultation_mismatch' }
> {
  if (!access.verified) return { outcome: 'rejected', reason: 'access_not_verified' };
  if (!access.allowed) return { outcome: 'rejected', reason: 'access_denied' };
  const version: RecordVersion = {
    consultation_id: input.consultation_id,
    record_version_id: input.record_version_id,
    person_id: input.person_id,
    text: input.text,
  };
  const appended = appendRecordVersion([], version);
  if (!appended.ok) return { outcome: 'rejected', reason: appended.reason };
  await db.query(
    `INSERT INTO consultations (consultation_id, person_id, appointment_id) VALUES ($1, $2, $3)`,
    [input.consultation_id, input.person_id, input.appointment_id ?? null],
  );
  await db.query(
    `INSERT INTO consultation_record_versions (record_version_id, consultation_id, person_id, text)
     VALUES ($1, $2, $3, $4)`,
    [version.record_version_id, version.consultation_id, version.person_id, version.text],
  );
  return {
    outcome: 'created',
    consultation_id: version.consultation_id,
    person_id: version.person_id,
    record_version_id: version.record_version_id,
  };
}

export async function listConsultations(db: Db, personId: string): Promise<ConsultationRow[]> {
  const found = await db.query<ConsultationRow>(
    `SELECT consultation_id, person_id, appointment_id
     FROM consultations
     WHERE person_id = $1`,
    [personId],
  );
  return found.rows;
}

export async function findConsultation(db: Db, consultationId: string): Promise<ConsultationRow | null> {
  const found = await db.query<ConsultationRow>(
    `SELECT consultation_id, person_id, appointment_id
     FROM consultations
     WHERE consultation_id = $1`,
    [consultationId],
  );
  return found.rows[0] ?? null;
}

export async function listVersionIds(db: Db, consultationId: string): Promise<string[]> {
  const found = await db.query<{ record_version_id: string }>(
    `SELECT record_version_id FROM consultation_record_versions WHERE consultation_id = $1`,
    [consultationId],
  );
  return found.rows.map((row) => row.record_version_id);
}

export async function readVersion(
  db: Db,
  consultationId: string,
  versionId: string,
  access: AccessDecision,
) {
  const versions = await loadVersions(db, consultationId);
  return readAuthorizedRecordVersion(versions, consultationId, versionId, access);
}

export async function insertVersion(
  db: Db,
  consultationId: string,
  revision: unknown,
  access: AccessDecision,
): Promise<
  | { outcome: 'created'; version: RecordVersion }
  | { outcome: 'rejected'; reason: 'access_not_verified' | 'access_denied' | 'not_found' | 'duplicate_version' | 'person_mismatch' | 'consultation_mismatch' | 'ambiguous_version' }
> {
  if (!access.verified) return { outcome: 'rejected', reason: 'access_not_verified' };
  if (!access.allowed) return { outcome: 'rejected', reason: 'access_denied' };
  const versions = await loadVersions(db, consultationId);
  const source = versions[0];
  if (source === undefined) return { outcome: 'rejected', reason: 'not_found' };
  const revised = reviseRecordVersion(source, revision);
  if (!revised.ok) return { outcome: 'rejected', reason: 'duplicate_version' };
  const appended = appendRecordVersion(versions, revised.version);
  if (!appended.ok) return { outcome: 'rejected', reason: appended.reason };
  await db.query(
    `INSERT INTO consultation_record_versions (record_version_id, consultation_id, person_id, text)
     VALUES ($1, $2, $3, $4)`,
    [revised.version.record_version_id, revised.version.consultation_id, revised.version.person_id, revised.version.text],
  );
  return { outcome: 'created', version: revised.version };
}

export async function findFollowUp(db: Db, followUpId: string): Promise<FollowUpTask | null> {
  return loadTask(db, followUpId);
}

async function loadTask(db: Db, followUpId: string): Promise<FollowUpTask | null> {
  const found = await db.query<TaskRow>(
    `SELECT follow_up_id, person_id, title, status, consultation_id, record_version_id,
            assignee_user_id, due_at, created_at, updated_at
     FROM follow_up_tasks
     WHERE follow_up_id = $1`,
    [followUpId],
  );
  const row = found.rows[0];
  return row === undefined ? null : taskFromRow(row);
}

export async function insertFollowUp(
  db: Db,
  input: unknown,
  policy: FollowUpCreatePolicy,
  access: AccessDecision,
) {
  const draft = FollowUpCreateInput.parse(input);
  const existing = await loadTask(db, draft.follow_up_id);
  const versions = draft.consultation_id !== undefined && draft.record_version_id !== undefined
    ? await loadVersion(db, draft.consultation_id, draft.record_version_id)
    : [];
  const result = createFollowUp(existing === null ? [] : [existing], versions, draft, policy, access);
  if (result.outcome !== 'created') return result;
  const task = result.task;
  await db.query(
    `INSERT INTO follow_up_tasks (
       follow_up_id, person_id, title, status, consultation_id, record_version_id,
       assignee_user_id, due_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      task.follow_up_id,
      task.person_id,
      task.title,
      task.status,
      task.consultation_id ?? null,
      task.record_version_id ?? null,
      task.assignee_user_id ?? null,
      task.due_at ?? null,
      task.created_at ?? null,
      task.updated_at ?? null,
    ],
  );
  return result;
}

export async function listFollowUps(db: Db, personId: string): Promise<FollowUpTask[]> {
  const found = await db.query<TaskRow>(
    `SELECT follow_up_id, person_id, title, status, consultation_id, record_version_id,
            assignee_user_id, due_at, created_at, updated_at
     FROM follow_up_tasks
     WHERE person_id = $1`,
    [personId],
  );
  return found.rows.map(taskFromRow);
}

export async function updateFollowUp(db: Db, followUpId: string, patch: unknown, access: AccessDecision) {
  const current = await loadTask(db, followUpId);
  const result = reviseFollowUp(current === null ? [] : [current], followUpId, patch, access);
  if (result.outcome !== 'updated') return result;
  const task = result.task;
  await db.query(
    `UPDATE follow_up_tasks
     SET title = $2, assignee_user_id = $3, due_at = $4, updated_at = $5
     WHERE follow_up_id = $1`,
    [task.follow_up_id, task.title, task.assignee_user_id ?? null, task.due_at ?? null, task.updated_at ?? null],
  );
  return result;
}

export async function changeFollowUpStatus(
  db: Db,
  followUpId: string,
  action: unknown,
  rules: readonly FollowUpTransitionRule[],
  access: AccessDecision,
) {
  const current = await loadTask(db, followUpId);
  const result = transitionFollowUp(current === null ? [] : [current], followUpId, action, rules, access);
  if (result.outcome !== 'transitioned') return result;
  await db.query(
    `UPDATE follow_up_tasks SET status = $2 WHERE follow_up_id = $1`,
    [result.task.follow_up_id, result.task.status],
  );
  return result;
}

export function decideAppointmentPersistence(policy: ConflictPolicy): 'policy_unset' | 'concurrency_unconfigured' {
  const analysis = findAppointmentConflicts(
    {
      staff_user_id: '00000000-0000-4000-8000-000000000000',
      person_id: '00000000-0000-4000-8000-000000000001',
      starts_at: '2026-01-01T00:00:00Z',
      ends_at: '2026-01-01T01:00:00Z',
    },
    [],
    policy,
  );
  if (!analysis.configured) return 'policy_unset';
  return 'concurrency_unconfigured';
}

export async function findAppointment(db: Db, appointmentId: string) {
  const found = await db.query<AppointmentRow>(
    `SELECT appointment_id, person_id, staff_user_id, requester_user_id, starts_at, ends_at, status
     FROM appointments
     WHERE appointment_id = $1`,
    [appointmentId],
  );
  const row = found.rows[0];
  if (row === undefined) return null;
  return {
    appointment_id: row.appointment_id,
    person_id: row.person_id,
    staff_user_id: row.staff_user_id,
    requester_user_id: row.requester_user_id,
    starts_at: instant(row.starts_at) ?? '',
    ends_at: instant(row.ends_at) ?? '',
    status: row.status,
  };
}

export async function listAppointments(db: Db, filter: { personId?: string; staffUserId?: string }) {
  const column = filter.personId !== undefined ? 'person_id' : 'staff_user_id';
  const value = filter.personId ?? filter.staffUserId;
  if (value === undefined) throw new Error('appointment filter is missing');
  const found = await db.query<AppointmentRow>(
    `SELECT appointment_id, person_id, staff_user_id, requester_user_id, starts_at, ends_at, status
     FROM appointments
     WHERE ${column} = $1
     ORDER BY starts_at, appointment_id`,
    [value],
  );
  return found.rows.map((row) => ({
    appointment_id: row.appointment_id,
    person_id: row.person_id,
    starts_at: instant(row.starts_at) ?? '',
    ends_at: instant(row.ends_at) ?? '',
    status: row.status,
    staff_user_id: row.staff_user_id,
    requester_user_id: row.requester_user_id,
  }));
}

export async function changeAppointmentStatus(
  db: Db,
  appointmentId: string,
  action: string,
  actorRole: Parameters<typeof applyTransition>[2],
  rules: readonly TransitionRule[],
) {
  const found = await db.query<AppointmentRow>(
    `SELECT appointment_id, person_id, staff_user_id, requester_user_id, starts_at, ends_at, status
     FROM appointments
     WHERE appointment_id = $1`,
    [appointmentId],
  );
  const row = found.rows[0];
  if (row === undefined) return { outcome: 'rejected' as const, reason: 'not_found' as const };
  const result = applyTransition(
    {
      status: row.status,
      starts_at: instant(row.starts_at) ?? '',
      ends_at: instant(row.ends_at) ?? '',
    },
    action,
    actorRole,
    rules,
  );
  if (!result.ok) return { outcome: 'rejected' as const, reason: result.reason, person_id: row.person_id };
  await db.query(`UPDATE appointments SET status = $2 WHERE appointment_id = $1`, [appointmentId, result.status]);
  return {
    outcome: 'updated' as const,
    appointment_id: row.appointment_id,
    person_id: row.person_id,
    starts_at: instant(row.starts_at) ?? '',
    ends_at: instant(row.ends_at) ?? '',
    status: result.status,
  };
}

export async function insertNotification(
  db: Db,
  input: unknown,
  policy: NotificationAcceptPolicy,
  access: AccessDecision,
) {
  const draft = NotificationAcceptInput.parse(input);
  const existing = draft.notification_id === undefined
    ? []
    : (await db.query<NotificationRow>(
      `SELECT notification_id, recipient_user_id, kind, title, body, event_id, appointment_id,
              follow_up_id, person_id, created_at, read_at
       FROM notifications
       WHERE notification_id = $1`,
      [draft.notification_id],
    )).rows.map(notificationFromRow);
  const result = acceptNotification(existing, draft, policy, access);
  if (result.outcome !== 'accepted') return result;
  const notification = result.notification;
  await db.query(
    `INSERT INTO notifications (
       notification_id, recipient_user_id, kind, title, body, event_id, appointment_id,
       follow_up_id, person_id, created_at, read_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)`,
    [
      notification.notification_id,
      notification.recipient_user_id,
      notification.kind,
      notification.title,
      notification.body,
      notification.event_id ?? null,
      notification.appointment_id ?? null,
      notification.follow_up_id ?? null,
      notification.person_id ?? null,
      notification.created_at ?? null,
    ],
  );
  return result;
}

export async function listOwnNotifications(db: Db, actorUserId: string, access: AccessDecision) {
  const found = await db.query<NotificationRow>(
    `SELECT notification_id, recipient_user_id, kind, title, body, event_id, appointment_id,
            follow_up_id, person_id, created_at, read_at
     FROM notifications
     WHERE recipient_user_id = $1`,
    [actorUserId],
  );
  return listNotifications(found.rows.map(notificationFromRow), actorUserId, access);
}

export async function markOwnNotificationRead(
  db: Db,
  notificationId: string,
  readAt: unknown,
  actorUserId: string,
  access: AccessDecision,
) {
  if (!access.verified) return { outcome: 'rejected' as const, reason: 'access_not_verified' as const };
  if (!access.allowed) return { outcome: 'rejected' as const, reason: 'access_denied' as const };
  const found = await db.query<NotificationRow>(
    `SELECT notification_id, recipient_user_id, kind, title, body, event_id, appointment_id,
            follow_up_id, person_id, created_at, read_at
     FROM notifications
     WHERE recipient_user_id = $1`,
    [actorUserId],
  );
  const owned = found.rows.map(notificationFromRow);
  const hidden = await db.query<{ notification_id: string }>(
    `SELECT notification_id FROM notifications WHERE notification_id = $1 AND recipient_user_id <> $2`,
    [notificationId, actorUserId],
  );
  if (hidden.rows.length > 0 && !owned.some((item) => item.notification_id.toLowerCase() === notificationId.toLowerCase())) {
    return { outcome: 'rejected' as const, reason: 'not_found' as const };
  }
  const result = markNotificationRead(owned, notificationId, readAt, actorUserId, access);
  if (result.outcome === 'rejected') {
    return { outcome: 'rejected' as const, reason: result.reason === 'recipient_mismatch' ? 'not_found' as const : result.reason };
  }
  if (result.outcome === 'read') {
    await db.query(
      `UPDATE notifications SET read_at = $2 WHERE notification_id = $1 AND recipient_user_id = $3`,
      [result.notification.notification_id, result.notification.read_at, actorUserId],
    );
  }
  return result;
}
