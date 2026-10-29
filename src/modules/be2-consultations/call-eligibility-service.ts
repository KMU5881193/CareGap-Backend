import type { Actor } from '../../shared/contracts.js';
import {
  resolvePersonAccountBinding,
  type PersonAccountBindingStore,
} from '../be1-auth/identity-resolver.js';
import { isAppointmentAssignedStaff } from '../be1-auth/authorization.js';
import type { AppointmentSnapshotRepository } from './appointment-snapshot.js';
import {
  evaluateCallEligibility,
  type CallEligibilityPolicy,
  type CallEligibilityResult,
  type ParticipationClaim,
} from './call-eligibility.js';

export type CallEligibilityServiceInput = {
  appointment_id: string;
  actor: Actor;
  now: string;
  /**
   * Caller-supplied policy. Unset / empty fields → DENY inside evaluateCallEligibility.
   * Do not hardcode production status vocabulary here.
   */
  policy: CallEligibilityPolicy;
};

export type CallEligibilityServiceDeps = {
  appointments: AppointmentSnapshotRepository;
  personAccounts: PersonAccountBindingStore;
};

/**
 * Loads the appointment snapshot, derives participation via Identity Resolver /
 * staff assignment, then runs Wave A evaluateCallEligibility.
 * Does not mount HTTP. Does not call AuthorizationPort (Wave A contract).
 * Family proxy calling remains DENY until product policy is set (role/policy).
 */
export async function evaluateCallEligibilityForActor(
  input: CallEligibilityServiceInput,
  deps: CallEligibilityServiceDeps,
): Promise<CallEligibilityResult> {
  const appointment = await deps.appointments.getById(input.appointment_id);
  if (!appointment) {
    return { allowed: false, reason: 'appointment_not_found', appointment_id: input.appointment_id };
  }

  const participation = await deriveParticipation(input.actor, appointment, deps.personAccounts);
  return evaluateCallEligibility({
    appointment,
    actor: input.actor,
    now: input.now,
    policy: input.policy,
    participation,
  });
}

async function deriveParticipation(
  actor: Actor,
  appointment: {
    person_id: string;
    staff_user_id: string;
  },
  personAccounts: PersonAccountBindingStore,
): Promise<ParticipationClaim | undefined> {
  if (isAppointmentAssignedStaff(actor, appointment)) {
    return { capacity: 'assigned_staff' };
  }

  if (actor.role === 'patient') {
    const resolved = await resolvePersonAccountBinding(
      appointment.person_id,
      actor.user_id,
      personAccounts,
    );
    if (!resolved.ok) {
      // Missing binding must not become unspecified capacity that looks like a policy bug.
      return undefined;
    }
    return { capacity: 'person_account', binding: resolved.binding };
  }

  // Family / admin / unmatched staff: no verified participation claim yet.
  return { capacity: 'unspecified' };
}
