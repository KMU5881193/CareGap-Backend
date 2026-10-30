import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import { Actor, Id, type AuthorizationPort } from '../../shared/contracts.js';
import { AppointmentCreateInput } from './api-schema.js';
import { UtcInstant } from './availability.js';
import type { ConflictPolicy } from './appointment-conflict.js';
import type { TransitionRule } from './appointment-transition.js';
import {
  FollowUpCreateInput,
  FollowUpPatch,
  type FollowUpCreatePolicy,
  type FollowUpTransitionRule,
} from './follow-up.js';
import { type NotificationAcceptPolicy } from './notification.js';
import {
  changeAppointmentStatus,
  changeFollowUpStatus,
  decideAppointmentPersistence,
  findAppointment,
  findConsultation,
  findFollowUp,
  insertConsultation,
  insertFollowUp,
  insertNotification,
  insertVersion,
  listAppointments,
  listConsultations,
  listFollowUps,
  listOwnNotifications,
  listVersionIds,
  markOwnNotificationRead,
  readVersion,
  updateFollowUp,
  withTransaction,
  type AccessDecision,
  type Db,
} from './repository.js';
import { z } from 'zod';

// This router is not mounted by src/app.ts.
// authenticateUser is not in this branch, so a caller must inject authentication and AuthorizationPort.
// Request bodies are not evidence of identity, role, or access.
export type Be2Dependencies = {
  pool: Pool;
  authenticate(req: Request): Promise<Actor | null>;
  authorize: AuthorizationPort;
  followUpPolicy: FollowUpCreatePolicy;
  followUpRules: readonly FollowUpTransitionRule[];
  appointmentRules: readonly TransitionRule[];
  appointmentConflict: ConflictPolicy;
  notificationPolicy: NotificationAcceptPolicy;
};

const VersionInput = z.object({
  record_version_id: Id,
  text: z.string(),
}).strict();

const ConsultationInput = VersionInput.extend({
  consultation_id: Id,
  person_id: Id,
  appointment_id: Id.optional(),
}).strict();

const PersonQuery = z.object({ person_id: Id }).strict();

const AppointmentQuery = z.object({
  person_id: Id.optional(),
  staff_user_id: Id.optional(),
}).strict().superRefine((value, ctx) => {
  const filters = Number(value.person_id !== undefined) + Number(value.staff_user_id !== undefined);
  if (filters !== 1) ctx.addIssue('Choose one appointment filter');
});

const ActionInput = z.object({ action: z.string().min(1) }).strict();

const NotificationInput = z.object({
  notification_id: Id,
  kind: z.string().min(1),
  title: z.string(),
  body: z.string(),
}).strict();

const ReadInput = z.object({ read_at: UtcInstant }).strict();

function sendError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

function sendData(res: Response, status: number, data: unknown) {
  res.status(status).json({ data });
}

function reject(res: Response, reason: string, reading: boolean) {
  if (reason === 'access_not_verified') return sendError(res, 401, 'UNAUTHENTICATED', 'Authentication required');
  if (reason === 'access_denied') {
    return reading
      ? sendError(res, 404, 'NOT_FOUND', 'Not found')
      : sendError(res, 403, 'FORBIDDEN', 'Forbidden');
  }
  if (
    reason === 'not_found'
    || reason === 'notification_not_found'
    || reason === 'task_not_found'
    || reason === 'version_not_found'
    || reason === 'consultation_mismatch'
    || reason === 'ambiguous_version'
    || reason === 'recipient_mismatch'
  ) {
    return sendError(res, 404, 'NOT_FOUND', 'Not found');
  }
  if (
    reason === 'policy_unset'
    || reason === 'concurrency_unconfigured'
    || reason === 'illegal_transition'
    || reason === 'actor_not_allowed'
    || reason === 'duplicate_task'
    || reason === 'duplicate_version'
    || reason === 'duplicate_event'
    || reason === 'event_repeat_rejected'
    || reason === 'notification_id_conflict'
    || reason === 'empty_patch'
    || reason === 'person_mismatch'
    || reason === 'source_incomplete'
  ) {
    return sendError(res, 409, 'CONFLICT', 'Conflict');
  }
  return sendError(res, 400, 'INVALID_REQUEST', 'Invalid request');
}

function databaseCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  return undefined;
}

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function route(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: unknown) => {
      if (error instanceof ZodError) {
        sendError(res, 400, 'INVALID_REQUEST', 'Invalid request');
        return;
      }
      const code = databaseCode(error);
      if (code === '23505' || code === '23503' || code === '23514') {
        sendError(res, 409, 'CONFLICT', 'Conflict');
        return;
      }
      sendError(res, 500, 'INTERNAL_ERROR', 'Internal error');
    });
  };
}

async function actorOf(deps: Be2Dependencies, req: Request, res: Response) {
  const actor = await deps.authenticate(req);
  if (actor === null) {
    sendError(res, 401, 'UNAUTHENTICATED', 'Authentication required');
    return null;
  }
  return actor;
}

async function accessFor(
  deps: Be2Dependencies,
  actor: Actor,
  personId: string,
  action: 'read' | 'write',
): Promise<{ verified: true; allowed: boolean }> {
  const allowed = await deps.authorize.canAccess(actor, personId, action);
  return { verified: true, allowed };
}

function publicAppointment(row: {
  appointment_id: string;
  person_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
}) {
  return {
    appointment_id: row.appointment_id,
    person_id: row.person_id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    status: row.status,
  };
}

export function createBe2Router(deps: Be2Dependencies): Router {
  const router = Router();
  const db = deps.pool as Db;

  router.post('/consultations', route(async (req, res) => {
    const actor = await actorOf(deps, req, res);
    if (actor === null) return;
    const input = ConsultationInput.parse(req.body);
    const access = await accessFor(deps, actor, input.person_id, 'write');
    if (!access.allowed) return reject(res, 'access_denied', false);
    const created = await withTransaction(deps.pool, (tx) => insertConsultation(tx, input, access));
    if (created.outcome === 'rejected') return reject(res, created.reason, false);
    sendData(res, 201, created);
  }));

  router.get('/consultations', route(async (req, res) => {
    const actor = await actorOf(deps, req, res);
    if (actor === null) return;
    const query = PersonQuery.parse(req.query);
    const access = await accessFor(deps, actor, query.person_id, 'read');
    if (!access.allowed) return reject(res, 'access_denied', true);
    const rows = await listConsultations(db, query.person_id);
    sendData(res, 200, rows.map((row) => ({
      consultation_id: row.consultation_id,
      person_id: row.person_id,
      appointment_id: row.appointment_id,
    })));
  }));

  router.get('/consultations/:consultationId', route(async (req, res) => {
    const actor = await actorOf(deps, req, res);
    if (actor === null) return;
    const consultationId = Id.parse(req.params.consultationId);
    const row = await findConsultation(db, consultationId);
    if (row === null) return sendError(res, 404, 'NOT_FOUND', 'Not found');
    const access = await accessFor(deps, actor, row.person_id, 'read');
    if (!access.allowed) return reject(res, 'access_denied', true);
    const versions = await listVersionIds(db, consultationId);
    sendData(res, 200, {
      consultation_id: row.consultation_id,
      person_id: row.person_id,
      appointment_id: row.appointment_id,
      record_version_ids: versions,
    });
  }));

  router.get('/consultations/:consultationId/versions/:versionId', route(async (req, res) => {
    const actor = await actorOf(deps, req, res);
    if (actor === null) return;
    const consultationId = Id.parse(req.params.consultationId);
    const versionId = Id.parse(req.params.versionId);
    const row = await findConsultation(db, consultationId);
    if (row === null) return sendError(res, 404, 'NOT_FOUND', 'Not found');
    const access = await accessFor(deps, actor, row.person_id, 'read');
    if (!access.allowed) return reject(res, 'access_denied', true);
    const found = await readVersion(db, consultationId, versionId, access);
    if (!found.ok) return reject(res, found.reason, true);
    sendData(res, 200, found.version);
  }));

  router.post('/consultations/:consultationId/versions', route(async (req, res) => {
    const actor = await actorOf(deps, req, res);
    if (actor === null) return;
    const consultationId = Id.parse(req.params.consultationId);
    const revision = VersionInput.parse(req.body);
    const row = await findConsultation(db, consultationId);
    if (row === null) return sendError(res, 404, 'NOT_FOUND', 'Not found');
    const access = await accessFor(deps, actor, row.person_id, 'write');
    if (!access.allowed) return reject(res, 'access_denied', false);
    const created = await withTransaction(deps.pool, (tx) => insertVersion(tx, consultationId, revision, access));
    if (created.outcome === 'rejected') return reject(res, created.reason, false);
    sendData(res, 201, {
      consultation_id: created.version.consultation_id,
      record_version_id: created.version.record_version_id,
      person_id: created.version.person_id,
    });
  }));

  router.post('/follow-ups', route(async (req, res) => {
    const actor = await actorOf(deps, req, res);
    if (actor === null) return;
    const input = FollowUpCreateInput.parse(req.body);
    const access = await accessFor(deps, actor, input.person_id, 'write');
    if (!access.allowed) return reject(res, 'access_denied', false);
    const created = await withTransaction(deps.pool, (tx) => insertFollowUp(tx, input, deps.followUpPolicy, access));
    if (created.outcome === 'rejected') return reject(res, created.reason, false);
    sendData(res, 201, created.task);
  }));

  router.get('/follow-ups', route(async (req, res) => {
    const actor = await actorOf(deps, req, res);
    if (actor === null) return;
    const query = PersonQuery.parse(req.query);
    const access = await accessFor(deps, actor, query.person_id, 'read');
    if (!access.allowed) return reject(res, 'access_denied', true);
    sendData(res, 200, await listFollowUps(db, query.person_id));
  }));

  router.patch('/follow-ups/:followUpId', route(async (req, res) => {
    const actor = await actorOf(deps, req, res);
    if (actor === null) return;
    const followUpId = Id.parse(req.params.followUpId);
    const patch = FollowUpPatch.parse(req.body);
    const current = await findFollowUp(db, followUpId);
    if (current === null) return sendError(res, 404, 'NOT_FOUND', 'Not found');
    const access = await accessFor(deps, actor, current.person_id, 'write');
    if (!access.allowed) return reject(res, 'access_denied', false);
    const updated = await withTransaction(deps.pool, (tx) => updateFollowUp(tx, followUpId, patch, access));
    if (updated.outcome === 'rejected') return reject(res, updated.reason, updated.reason === 'task_not_found');
    sendData(res, 200, updated.task);
  }));

  router.post('/follow-ups/:followUpId/actions', route(async (req, res) => {
    const actor = await actorOf(deps, req, res);
    if (actor === null) return;
    const followUpId = Id.parse(req.params.followUpId);
    const body = ActionInput.parse(req.body);
    const current = await findFollowUp(db, followUpId);
    if (current === null) return sendError(res, 404, 'NOT_FOUND', 'Not found');
    const access = await accessFor(deps, actor, current.person_id, 'write');
    if (!access.allowed) return reject(res, 'access_denied', false);
    const updated = await withTransaction(deps.pool, (tx) => changeFollowUpStatus(
      tx,
      followUpId,
      body.action,
      deps.followUpRules,
      access,
    ));
    if (updated.outcome === 'rejected') return reject(res, updated.reason, updated.reason === 'task_not_found');
    sendData(res, 200, updated.task);
  }));

  router.post('/appointments', route(async (req, res) => {
    const actor = await actorOf(deps, req, res);
    if (actor === null) return;
    const input = AppointmentCreateInput.parse(req.body);
    const access = await accessFor(deps, actor, input.person_id, 'write');
    if (!access.allowed) return reject(res, 'access_denied', false);
    const decision = decideAppointmentPersistence(deps.appointmentConflict);
    return reject(res, decision, false);
  }));

  router.get('/appointments', route(async (req, res) => {
    const actor = await actorOf(deps, req, res);
    if (actor === null) return;
    const query = AppointmentQuery.parse(req.query);
    if (query.person_id !== undefined) {
      const access = await accessFor(deps, actor, query.person_id, 'read');
      if (!access.allowed) return reject(res, 'access_denied', true);
      const rows = await listAppointments(db, { personId: query.person_id });
      sendData(res, 200, rows.map(publicAppointment));
      return;
    }
    if (query.staff_user_id === undefined || !sameUuid(query.staff_user_id, actor.user_id)) {
      sendError(res, 404, 'NOT_FOUND', 'Not found');
      return;
    }
    const rows = await listAppointments(db, { staffUserId: query.staff_user_id });
    sendData(res, 200, rows.map(publicAppointment));
  }));

  router.post('/appointments/:appointmentId/actions', route(async (req, res) => {
    const actor = await actorOf(deps, req, res);
    if (actor === null) return;
    const appointmentId = Id.parse(req.params.appointmentId);
    const body = ActionInput.parse(req.body);
    const current = await findAppointment(db, appointmentId);
    if (current === null) return sendError(res, 404, 'NOT_FOUND', 'Not found');
    const access = await accessFor(deps, actor, current.person_id, 'write');
    if (!access.allowed) return reject(res, 'access_denied', true);
    const updated = await withTransaction(deps.pool, (tx) => changeAppointmentStatus(
      tx,
      appointmentId,
      body.action,
      actor.role,
      deps.appointmentRules,
    ));
    if (updated.outcome === 'rejected') return reject(res, updated.reason, true);
    sendData(res, 200, publicAppointment(updated));
  }));

  router.post('/notifications', route(async (req, res) => {
    const actor = await actorOf(deps, req, res);
    if (actor === null) return;
    const input = NotificationInput.parse(req.body);
    // Mailbox scope is the authenticated actor. This flag is not read from the body and is not an AuthorizationPort result.
    const access: AccessDecision = { verified: true, allowed: true };
    const created = await withTransaction(deps.pool, (tx) => insertNotification(tx, {
      ...input,
      recipient_user_id: actor.user_id,
    }, deps.notificationPolicy, access));
    if (created.outcome === 'rejected' || created.outcome === 'conflict') {
      return reject(res, created.outcome === 'conflict' ? 'notification_id_conflict' : created.reason, false);
    }
    sendData(res, created.outcome === 'accepted' ? 201 : 200, {
      notification_id: created.notification.notification_id,
      recipient_user_id: created.notification.recipient_user_id,
      kind: created.notification.kind,
      title: created.notification.title,
      body: created.notification.body,
      read_at: created.notification.read_at ?? null,
    });
  }));

  router.get('/notifications', route(async (req, res) => {
    const actor = await actorOf(deps, req, res);
    if (actor === null) return;
    const listed = await listOwnNotifications(db, actor.user_id, { verified: true, allowed: true });
    if (listed.outcome === 'rejected') return reject(res, listed.reason, true);
    sendData(res, 200, listed.notifications.map((item) => ({
      notification_id: item.notification_id,
      recipient_user_id: item.recipient_user_id,
      kind: item.kind,
      title: item.title,
      body: item.body,
      read_at: item.read_at ?? null,
    })));
  }));

  router.post('/notifications/:notificationId/read', route(async (req, res) => {
    const actor = await actorOf(deps, req, res);
    if (actor === null) return;
    const notificationId = Id.parse(req.params.notificationId);
    const body = ReadInput.parse(req.body);
    const updated = await withTransaction(deps.pool, (tx) => markOwnNotificationRead(
      tx,
      notificationId,
      body.read_at,
      actor.user_id,
      { verified: true, allowed: true },
    ));
    if (updated.outcome === 'rejected') return reject(res, updated.reason, true);
    sendData(res, 200, {
      notification_id: updated.notification.notification_id,
      read_at: updated.notification.read_at ?? null,
    });
  }));

  return router;
}
