import type { Actor } from '../../shared/contracts.js';
import { compareUtcInstants, parseUtcInstant } from './availability.js';

// Pure eligibility checks for future call join. No HTTP mount, DB, or push side effects.
// Deny when policy fields or verification evidence are missing. Do not invent production defaults.

export type CallAppointmentSnapshot = {
  appointment_id: string;
  status: string | null | undefined;
  consultation_type: string | null | undefined;
  starts_at: string;
  ends_at: string;
  person_id: string;
  staff_user_id: string;
};

/** Verified person_id → user_id link from an Identity Resolver. Not inferred from equality. */
export type PersonAccountBinding = {
  person_id: string;
  user_id: string;
  verified: true;
};

/**
 * Caller-supplied participation claim. Role alone is never enough.
 * assigned_staff compares actor.user_id to appointments.staff_user_id (users FK).
 * person_account requires a verified Identity Resolver binding; person_id is never a user_id.
 */
export type ParticipationClaim =
  | { capacity: 'assigned_staff' }
  | { capacity: 'person_account'; binding: PersonAccountBinding }
  | { capacity: 'unspecified' };

export type JoinWindowPolicy = {
  /** Milliseconds before starts_at when join becomes allowed (e.g. 10 minutes = 600_000). */
  earliestBeforeStartMs: number;
  /**
   * Anchor for the latest allowed join instant.
   * DECISION REQUIRED for production: ends_at vs starts_at vs other absolute cutoff.
   */
  latestRelativeTo: 'starts_at' | 'ends_at';
  /** Added to the anchor instant. 0 means the anchor itself. */
  latestOffsetMs: number;
};

/**
 * All fields must be supplied by the caller. Undefined / empty collections mean policy unset → DENY.
 * Status string names and consultation_type vocabulary are DECISION REQUIRED for production.
 */
export type CallEligibilityPolicy = {
  allowedStatuses: readonly string[] | undefined;
  requiredConsultationType: string | undefined;
  joinWindow: JoinWindowPolicy | undefined;
  allowedCallerRoles: readonly Actor['role'][] | undefined;
};

export type CallEligibilityInput = {
  appointment: CallAppointmentSnapshot;
  actor: Actor;
  now: string;
  policy: CallEligibilityPolicy;
  participation: ParticipationClaim | undefined;
};

export type CallEligibilityDenialReason =
  | 'policy_unset_statuses'
  | 'policy_unset_consultation_type'
  | 'policy_unset_join_window'
  | 'policy_unset_roles'
  | 'appointment_not_found'
  | 'status_missing'
  | 'status_not_allowed'
  | 'consultation_type_missing'
  | 'consultation_type_not_allowed'
  | 'invalid_appointment_time'
  | 'invalid_now'
  | 'join_too_early'
  | 'join_too_late'
  | 'actor_role_not_allowed'
  | 'participation_missing'
  | 'participation_unspecified'
  | 'staff_assignment_mismatch'
  | 'person_binding_unverified'
  | 'person_binding_person_mismatch'
  | 'person_binding_user_mismatch'
  | 'person_id_confused_with_user_id';

export type CallEligibilityResult =
  | {
      allowed: true;
      appointment_id: string;
      capacity: 'assigned_staff' | 'person_account';
      earliest_join_at: string;
      latest_join_at: string;
    }
  | {
      allowed: false;
      reason: CallEligibilityDenialReason;
      appointment_id?: string;
    };

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function shiftUtcInstant(instant: string, offsetMs: number): string {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) throw new Error('invalid_instant');
  return new Date(ms + offsetMs).toISOString();
}

function parseOrderedAppointmentTimes(appointment: CallAppointmentSnapshot):
  | { ok: true; starts_at: string; ends_at: string }
  | { ok: false } {
  try {
    const starts_at = parseUtcInstant(appointment.starts_at);
    const ends_at = parseUtcInstant(appointment.ends_at);
    if (compareUtcInstants(starts_at, ends_at) >= 0) return { ok: false };
    return { ok: true, starts_at, ends_at };
  } catch {
    return { ok: false };
  }
}

function parseNow(now: string): string | null {
  try {
    const parsed = parseUtcInstant(now);
    // parseUtcInstant may accept offset forms; compareUtcInstants requires Z.
    compareUtcInstants(parsed, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function deny(reason: CallEligibilityDenialReason, appointment_id?: string): CallEligibilityResult {
  return appointment_id === undefined
    ? { allowed: false, reason }
    : { allowed: false, reason, appointment_id };
}

/**
 * Decides whether the authenticated actor may join a phone consultation for this appointment.
 * Does not call AuthorizationPort, Identity Resolver, or any network service.
 * Does not treat person_id as user_id. Does not invent a separate staff_id entity.
 */
export function evaluateCallEligibility(input: CallEligibilityInput): CallEligibilityResult {
  const appointmentId = input.appointment.appointment_id;
  const { policy } = input;

  if (policy.allowedStatuses === undefined || policy.allowedStatuses.length === 0) {
    return deny('policy_unset_statuses', appointmentId);
  }
  if (policy.requiredConsultationType === undefined || policy.requiredConsultationType.length === 0) {
    return deny('policy_unset_consultation_type', appointmentId);
  }
  if (policy.joinWindow === undefined) {
    return deny('policy_unset_join_window', appointmentId);
  }
  if (policy.allowedCallerRoles === undefined || policy.allowedCallerRoles.length === 0) {
    return deny('policy_unset_roles', appointmentId);
  }

  const status = input.appointment.status;
  if (status === null || status === undefined || status.length === 0) {
    return deny('status_missing', appointmentId);
  }
  if (!policy.allowedStatuses.includes(status)) {
    return deny('status_not_allowed', appointmentId);
  }

  const consultationType = input.appointment.consultation_type;
  if (consultationType === null || consultationType === undefined || consultationType.length === 0) {
    return deny('consultation_type_missing', appointmentId);
  }
  if (consultationType !== policy.requiredConsultationType) {
    return deny('consultation_type_not_allowed', appointmentId);
  }

  const times = parseOrderedAppointmentTimes(input.appointment);
  if (!times.ok) return deny('invalid_appointment_time', appointmentId);

  const now = parseNow(input.now);
  if (now === null) return deny('invalid_now', appointmentId);

  const window = policy.joinWindow;
  if (!Number.isFinite(window.earliestBeforeStartMs) || window.earliestBeforeStartMs < 0
    || !Number.isFinite(window.latestOffsetMs)) {
    return deny('policy_unset_join_window', appointmentId);
  }

  let earliestJoinAt: string;
  let latestJoinAt: string;
  try {
    earliestJoinAt = shiftUtcInstant(times.starts_at, -window.earliestBeforeStartMs);
    const anchor = window.latestRelativeTo === 'starts_at' ? times.starts_at : times.ends_at;
    latestJoinAt = shiftUtcInstant(anchor, window.latestOffsetMs);
  } catch {
    return deny('invalid_appointment_time', appointmentId);
  }

  if (compareUtcInstants(earliestJoinAt, latestJoinAt) > 0) {
    return deny('policy_unset_join_window', appointmentId);
  }
  if (compareUtcInstants(now, earliestJoinAt) < 0) {
    return deny('join_too_early', appointmentId);
  }
  if (compareUtcInstants(now, latestJoinAt) > 0) {
    return deny('join_too_late', appointmentId);
  }

  if (!policy.allowedCallerRoles.includes(input.actor.role)) {
    return deny('actor_role_not_allowed', appointmentId);
  }

  const participation = input.participation;
  if (participation === undefined) {
    return deny('participation_missing', appointmentId);
  }
  if (participation.capacity === 'unspecified') {
    return deny('participation_unspecified', appointmentId);
  }

  if (participation.capacity === 'assigned_staff') {
    // staff_user_id is a users(user_id) FK on the appointment, not a separate staff entity id.
    if (!sameUuid(input.actor.user_id, input.appointment.staff_user_id)) {
      return deny('staff_assignment_mismatch', appointmentId);
    }
    // Matching person_id is never proof of staff assignment.
    if (sameUuid(input.actor.user_id, input.appointment.person_id)) {
      return deny('person_id_confused_with_user_id', appointmentId);
    }
    return {
      allowed: true,
      appointment_id: appointmentId,
      capacity: 'assigned_staff',
      earliest_join_at: earliestJoinAt,
      latest_join_at: latestJoinAt,
    };
  }

  const binding = participation.binding;
  if (binding.verified !== true) {
    return deny('person_binding_unverified', appointmentId);
  }
  // person_id and user_id are different concepts; equal UUIDs are not a valid binding.
  if (sameUuid(binding.person_id, binding.user_id)) {
    return deny('person_id_confused_with_user_id', appointmentId);
  }
  if (!sameUuid(binding.person_id, input.appointment.person_id)) {
    return deny('person_binding_person_mismatch', appointmentId);
  }
  if (!sameUuid(binding.user_id, input.actor.user_id)) {
    return deny('person_binding_user_mismatch', appointmentId);
  }

  return {
    allowed: true,
    appointment_id: appointmentId,
    capacity: 'person_account',
    earliest_join_at: earliestJoinAt,
    latest_join_at: latestJoinAt,
  };
}
