import { z } from 'zod';
import { Id } from '../../shared/contracts.js';
import { UtcInstant, compareUtcInstants } from './availability.js';

const FieldPolicy = z.enum(['unset', 'optional', 'required']);
const EventRepeatPolicy = z.enum(['unset', 'allow', 'reject']);

export const NotificationAcceptPolicy = z.object({
  event: FieldPolicy,
  subject: FieldPolicy,
  event_repeat: EventRepeatPolicy,
}).strict();

export type NotificationAcceptPolicy = z.infer<typeof NotificationAcceptPolicy>;

export const NotificationAcceptInput = z.object({
  notification_id: Id,
  recipient_user_id: Id,
  kind: z.string().min(1),
  title: z.string(),
  body: z.string(),
  event_id: Id.optional(),
  appointment_id: Id.optional(),
  follow_up_id: Id.optional(),
  person_id: Id.optional(),
  created_at: UtcInstant.optional(),
}).strict();

export type NotificationAcceptInput = z.infer<typeof NotificationAcceptInput>;

export type Notification = {
  notification_id: string;
  recipient_user_id: string;
  kind: string;
  title: string;
  body: string;
  event_id?: string;
  appointment_id?: string;
  follow_up_id?: string;
  person_id?: string;
  created_at?: string;
  read_at?: string;
};

const AccessDecision = z.union([
  z.object({ verified: z.literal(false) }).strict(),
  z.object({ verified: z.literal(true), allowed: z.boolean() }).strict(),
]);

export type NotificationRejectReason =
  | 'access_not_verified'
  | 'access_denied'
  | 'policy_unset'
  | 'event_required'
  | 'subject_required'
  | 'event_repeat_rejected'
  | 'notification_not_found'
  | 'recipient_mismatch';

export type NotificationWrite =
  | { outcome: 'accepted'; notification: Notification; notifications: Notification[] }
  | { outcome: 'duplicate'; notification: Notification }
  | { outcome: 'conflict'; reason: 'notification_id_conflict' }
  | { outcome: 'rejected'; reason: NotificationRejectReason };

export type NotificationRead =
  | { outcome: 'read' | 'already_read'; notification: Notification; notifications: Notification[] }
  | { outcome: 'rejected'; reason: 'access_not_verified' | 'access_denied' | 'notification_not_found' | 'recipient_mismatch' };

export type NotificationList =
  | { outcome: 'listed'; notifications: Notification[] }
  | { outcome: 'rejected'; reason: 'access_not_verified' | 'access_denied' };

export type NotificationPolicyResult = {
  outcome: 'rejected';
  reason: 'access_not_verified' | 'access_denied' | 'policy_unset';
};

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameOptionalUuid(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return sameUuid(left, right);
}

function sameOptionalInstant(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return compareUtcInstants(left, right) === 0;
}

function copyNotification(notification: Notification): Notification {
  return {
    notification_id: notification.notification_id,
    recipient_user_id: notification.recipient_user_id,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    ...(notification.event_id !== undefined ? { event_id: notification.event_id } : {}),
    ...(notification.appointment_id !== undefined ? { appointment_id: notification.appointment_id } : {}),
    ...(notification.follow_up_id !== undefined ? { follow_up_id: notification.follow_up_id } : {}),
    ...(notification.person_id !== undefined ? { person_id: notification.person_id } : {}),
    ...(notification.created_at !== undefined ? { created_at: notification.created_at } : {}),
    ...(notification.read_at !== undefined ? { read_at: notification.read_at } : {}),
  };
}

function reject<Reason extends NotificationRejectReason>(reason: Reason): { outcome: 'rejected'; reason: Reason } {
  return { outcome: 'rejected', reason };
}

function accessFailure(access: unknown): 'access_not_verified' | 'access_denied' | null {
  const decision = AccessDecision.parse(access);
  if (!decision.verified) return 'access_not_verified';
  if (!decision.allowed) return 'access_denied';
  return null;
}

function storedNotifications(notifications: readonly Notification[]): Notification[] {
  return notifications.map((notification) => copyNotification(notification));
}

function notificationFromInput(input: NotificationAcceptInput): Notification {
  return copyNotification({
    notification_id: input.notification_id,
    recipient_user_id: input.recipient_user_id,
    kind: input.kind,
    title: input.title,
    body: input.body,
    event_id: input.event_id,
    appointment_id: input.appointment_id,
    follow_up_id: input.follow_up_id,
    person_id: input.person_id,
    created_at: input.created_at,
  });
}

function sameContent(stored: Notification, incoming: Notification): boolean {
  return sameUuid(stored.recipient_user_id, incoming.recipient_user_id)
    && stored.kind === incoming.kind
    && stored.title === incoming.title
    && stored.body === incoming.body
    && sameOptionalUuid(stored.event_id, incoming.event_id)
    && sameOptionalUuid(stored.appointment_id, incoming.appointment_id)
    && sameOptionalUuid(stored.follow_up_id, incoming.follow_up_id)
    && sameOptionalUuid(stored.person_id, incoming.person_id)
    && sameOptionalInstant(stored.created_at, incoming.created_at);
}

function fieldGap(policy: NotificationAcceptPolicy, input: NotificationAcceptInput): NotificationRejectReason | null {
  if (input.event_id === undefined && policy.event === 'unset') return 'policy_unset';
  if (input.event_id === undefined && policy.event === 'required') return 'event_required';
  const subjectAbsent = input.appointment_id === undefined && input.follow_up_id === undefined;
  if (subjectAbsent && policy.subject === 'unset') return 'policy_unset';
  if (subjectAbsent && policy.subject === 'required') return 'subject_required';
  if (input.event_id !== undefined && policy.event_repeat === 'unset') return 'policy_unset';
  return null;
}

// notification_id is the identity. event_id is not a global key.
// Accepting a notification does not send a push, create a follow-up, or read an analysis event.
// verified:true is a caller-supplied flag, not proof that AuthorizationPort ran.
export function acceptNotification(
  notifications: readonly Notification[],
  input: unknown,
  policy: unknown,
  access: unknown,
): NotificationWrite {
  const draft = NotificationAcceptInput.parse(input);
  const rules = NotificationAcceptPolicy.parse(policy);
  const failure = accessFailure(access);
  if (failure) return reject(failure);
  const existing = storedNotifications(notifications);
  const incoming = notificationFromInput(draft);
  const prior = existing.find((notification) => sameUuid(notification.notification_id, incoming.notification_id));
  if (prior) {
    if (!sameContent(prior, incoming)) return { outcome: 'conflict', reason: 'notification_id_conflict' };
    return { outcome: 'duplicate', notification: copyNotification(prior) };
  }
  const gap = fieldGap(rules, draft);
  if (gap) return reject(gap);
  const incomingEventId = draft.event_id;
  if (incomingEventId !== undefined && rules.event_repeat === 'reject') {
    const repeated = existing.some((notification) =>
      notification.event_id !== undefined && sameUuid(notification.event_id, incomingEventId));
    if (repeated) return reject('event_repeat_rejected');
  }
  const created = copyNotification(incoming);
  return {
    outcome: 'accepted',
    notification: copyNotification(created),
    notifications: [...existing, created],
  };
}

// read_at is not a push receipt. The actor user id must match recipient_user_id.
// A role is not an input. verified:true does not prove that AuthorizationPort ran.
export function markNotificationRead(
  notifications: readonly Notification[],
  notificationId: string,
  readAt: unknown,
  actorUserId: string,
  access: unknown,
): NotificationRead {
  const requestedId = Id.parse(notificationId);
  const requestedReadAt = UtcInstant.parse(readAt);
  const actor = Id.parse(actorUserId);
  const failure = accessFailure(access);
  if (failure) return reject(failure);
  const existing = storedNotifications(notifications);
  const index = existing.findIndex((notification) => sameUuid(notification.notification_id, requestedId));
  if (index < 0) return reject('notification_not_found');
  const current = existing[index];
  if (current === undefined) return reject('notification_not_found');
  if (!sameUuid(current.recipient_user_id, actor)) return reject('recipient_mismatch');
  if (current.read_at !== undefined) {
    return {
      outcome: 'already_read',
      notification: copyNotification(current),
      notifications: existing.map((notification) => copyNotification(notification)),
    };
  }
  const updated = copyNotification({ ...current, read_at: requestedReadAt });
  return {
    outcome: 'read',
    notification: copyNotification(updated),
    notifications: existing.map((notification, notificationIndex) =>
      notificationIndex === index ? copyNotification(updated) : copyNotification(notification)),
  };
}

// Event id does not select a notification by itself. Rows for other recipients are omitted.
export function listNotifications(
  notifications: readonly Notification[],
  actorUserId: string,
  access: unknown,
  eventId?: string,
): NotificationList {
  const actor = Id.parse(actorUserId);
  const requestedEvent = eventId === undefined ? undefined : Id.parse(eventId);
  const failure = accessFailure(access);
  if (failure) return reject(failure);
  const visible = storedNotifications(notifications).filter((notification) => {
    if (!sameUuid(notification.recipient_user_id, actor)) return false;
    if (requestedEvent === undefined) return true;
    return notification.event_id !== undefined && sameUuid(notification.event_id, requestedEvent);
  });
  return {
    outcome: 'listed',
    notifications: visible.map((notification) => copyNotification(notification)),
  };
}

// Clearing read_at is not agreed. This does not change a stored notification.
export function revertNotificationRead(access: unknown): NotificationPolicyResult {
  const failure = accessFailure(access);
  if (failure) return reject(failure);
  return reject('policy_unset');
}

// Retention and deletion are not agreed. This does not change a stored notification.
export function removeNotification(access: unknown): NotificationPolicyResult {
  const failure = accessFailure(access);
  if (failure) return reject(failure);
  return reject('policy_unset');
}
