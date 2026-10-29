import { describe, expect, it } from 'vitest';
import {
  evaluateCallEligibility,
  type CallAppointmentSnapshot,
  type CallEligibilityPolicy,
  type ParticipationClaim,
} from '../src/modules/be2-consultations/call-eligibility.js';
import type { Actor } from '../src/shared/contracts.js';

const appointmentId = '11111111-1111-4111-8111-111111111111';
const personId = '22222222-2222-4222-8222-222222222222';
const staffUserId = '33333333-3333-4333-8333-333333333333';
const patientUserId = '44444444-4444-4444-8444-444444444444';
const otherUserId = '55555555-5555-4555-8555-555555555555';

const startsAt = '2026-10-30T10:00:00.000Z';
const endsAt = '2026-10-30T10:30:00.000Z';
const tenMinutesMs = 10 * 60 * 1000;

const staffActor: Actor = { user_id: staffUserId, role: 'staff' };
const patientActor: Actor = { user_id: patientUserId, role: 'patient' };

/** Test-only policy. Production status names and join end anchor remain DECISION REQUIRED. */
const testPolicy: CallEligibilityPolicy = {
  allowedStatuses: ['confirmed'],
  requiredConsultationType: 'PHONE',
  joinWindow: {
    earliestBeforeStartMs: tenMinutesMs,
    latestRelativeTo: 'ends_at',
    latestOffsetMs: 0,
  },
  allowedCallerRoles: ['staff', 'patient'],
};

function phoneAppointment(overrides: Partial<CallAppointmentSnapshot> = {}): CallAppointmentSnapshot {
  return {
    appointment_id: appointmentId,
    status: 'confirmed',
    consultation_type: 'PHONE',
    starts_at: startsAt,
    ends_at: endsAt,
    person_id: personId,
    staff_user_id: staffUserId,
    ...overrides,
  };
}

function staffClaim(): ParticipationClaim {
  return { capacity: 'assigned_staff' };
}

function patientClaim(): ParticipationClaim {
  return {
    capacity: 'person_account',
    binding: { person_id: personId, user_id: patientUserId, verified: true },
  };
}

describe('evaluateCallEligibility', () => {
  it('allows a confirmed PHONE appointment for the assigned staff within the join window', () => {
    const result = evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: staffActor,
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: staffClaim(),
    });
    expect(result).toEqual({
      allowed: true,
      appointment_id: appointmentId,
      capacity: 'assigned_staff',
      earliest_join_at: '2026-10-30T09:50:00.000Z',
      latest_join_at: endsAt,
    });
  });

  it('allows a confirmed PHONE appointment for a verified person-account binding', () => {
    const result = evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: patientActor,
      now: '2026-10-30T10:00:00.000Z',
      policy: testPolicy,
      participation: patientClaim(),
    });
    expect(result).toMatchObject({
      allowed: true,
      appointment_id: appointmentId,
      capacity: 'person_account',
    });
  });

  it('denies an unconfirmed appointment status', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment({ status: 'requested' }),
      actor: staffActor,
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: staffClaim(),
    })).toEqual({ allowed: false, reason: 'status_not_allowed', appointment_id: appointmentId });
  });

  it('denies a non-PHONE consultation type', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment({ consultation_type: 'IN_PERSON' }),
      actor: staffActor,
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: staffClaim(),
    })).toEqual({
      allowed: false,
      reason: 'consultation_type_not_allowed',
      appointment_id: appointmentId,
    });
  });

  it('allows join at the exact earliest boundary (10 minutes before start)', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: staffActor,
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: staffClaim(),
    }).allowed).toBe(true);
  });

  it('denies join earlier than 10 minutes before start', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: staffActor,
      now: '2026-10-30T09:49:59.999Z',
      policy: testPolicy,
      participation: staffClaim(),
    })).toEqual({ allowed: false, reason: 'join_too_early', appointment_id: appointmentId });
  });

  it('allows join at the configured latest boundary (ends_at inclusive in test policy)', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: staffActor,
      now: endsAt,
      policy: testPolicy,
      participation: staffClaim(),
    }).allowed).toBe(true);
  });

  it('denies join after the configured latest boundary', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: staffActor,
      now: '2026-10-30T10:30:00.001Z',
      policy: testPolicy,
      participation: staffClaim(),
    })).toEqual({ allowed: false, reason: 'join_too_late', appointment_id: appointmentId });
  });

  it('denies when appointment status is missing', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment({ status: '' }),
      actor: staffActor,
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: staffClaim(),
    })).toEqual({ allowed: false, reason: 'status_missing', appointment_id: appointmentId });

    expect(evaluateCallEligibility({
      appointment: phoneAppointment({ status: null }),
      actor: staffActor,
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: staffClaim(),
    })).toEqual({ allowed: false, reason: 'status_missing', appointment_id: appointmentId });
  });

  it('denies when consultation type is missing', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment({ consultation_type: undefined }),
      actor: staffActor,
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: staffClaim(),
    })).toEqual({
      allowed: false,
      reason: 'consultation_type_missing',
      appointment_id: appointmentId,
    });
  });

  it('denies when participation evidence is missing or unspecified', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: staffActor,
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: undefined,
    })).toEqual({ allowed: false, reason: 'participation_missing', appointment_id: appointmentId });

    expect(evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: staffActor,
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: { capacity: 'unspecified' },
    })).toEqual({
      allowed: false,
      reason: 'participation_unspecified',
      appointment_id: appointmentId,
    });
  });

  it('denies an actor whose role is outside the policy list without case folding', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: { user_id: staffUserId, role: 'admin' },
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: staffClaim(),
    })).toEqual({
      allowed: false,
      reason: 'actor_role_not_allowed',
      appointment_id: appointmentId,
    });
  });

  it('does not treat person_id as user_id for staff assignment', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: { user_id: personId, role: 'staff' },
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: staffClaim(),
    })).toEqual({
      allowed: false,
      reason: 'staff_assignment_mismatch',
      appointment_id: appointmentId,
    });
  });

  it('rejects person_id === user_id as an Identity Resolver binding', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: { user_id: personId, role: 'patient' },
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: {
        capacity: 'person_account',
        binding: { person_id: personId, user_id: personId, verified: true },
      },
    })).toEqual({
      allowed: false,
      reason: 'person_id_confused_with_user_id',
      appointment_id: appointmentId,
    });
  });

  it('does not treat staff_user_id as person_id', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: staffActor,
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: {
        capacity: 'person_account',
        binding: { person_id: staffUserId, user_id: staffUserId, verified: true },
      },
    })).toEqual({
      allowed: false,
      reason: 'person_id_confused_with_user_id',
      appointment_id: appointmentId,
    });

    expect(evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: patientActor,
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: {
        capacity: 'person_account',
        binding: { person_id: staffUserId, user_id: patientUserId, verified: true },
      },
    })).toEqual({
      allowed: false,
      reason: 'person_binding_person_mismatch',
      appointment_id: appointmentId,
    });
  });

  it('denies a wrong actor for assigned staff capacity', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: { user_id: otherUserId, role: 'staff' },
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: staffClaim(),
    })).toEqual({
      allowed: false,
      reason: 'staff_assignment_mismatch',
      appointment_id: appointmentId,
    });
  });

  it('denies mismatched person-account bindings', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: patientActor,
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: {
        capacity: 'person_account',
        binding: { person_id: otherUserId, user_id: patientUserId, verified: true },
      },
    })).toEqual({
      allowed: false,
      reason: 'person_binding_person_mismatch',
      appointment_id: appointmentId,
    });

    expect(evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: patientActor,
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: {
        capacity: 'person_account',
        binding: { person_id: personId, user_id: otherUserId, verified: true },
      },
    })).toEqual({
      allowed: false,
      reason: 'person_binding_user_mismatch',
      appointment_id: appointmentId,
    });
  });

  it('denies invalid appointment or now timestamps', () => {
    expect(evaluateCallEligibility({
      appointment: phoneAppointment({ starts_at: 'not-a-time' }),
      actor: staffActor,
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: staffClaim(),
    })).toEqual({
      allowed: false,
      reason: 'invalid_appointment_time',
      appointment_id: appointmentId,
    });

    expect(evaluateCallEligibility({
      appointment: phoneAppointment({ starts_at: endsAt, ends_at: startsAt }),
      actor: staffActor,
      now: '2026-10-30T09:50:00.000Z',
      policy: testPolicy,
      participation: staffClaim(),
    })).toEqual({
      allowed: false,
      reason: 'invalid_appointment_time',
      appointment_id: appointmentId,
    });

    expect(evaluateCallEligibility({
      appointment: phoneAppointment(),
      actor: staffActor,
      now: '2026-10-30T09:50:00+09:00',
      policy: testPolicy,
      participation: staffClaim(),
    })).toEqual({ allowed: false, reason: 'invalid_now', appointment_id: appointmentId });
  });

  it('denies when required policy sections are unset', () => {
    const now = '2026-10-30T09:50:00.000Z';
    const base = {
      appointment: phoneAppointment(),
      actor: staffActor,
      now,
      participation: staffClaim(),
    };

    expect(evaluateCallEligibility({
      ...base,
      policy: { ...testPolicy, allowedStatuses: undefined },
    })).toEqual({ allowed: false, reason: 'policy_unset_statuses', appointment_id: appointmentId });

    expect(evaluateCallEligibility({
      ...base,
      policy: { ...testPolicy, allowedStatuses: [] },
    })).toEqual({ allowed: false, reason: 'policy_unset_statuses', appointment_id: appointmentId });

    expect(evaluateCallEligibility({
      ...base,
      policy: { ...testPolicy, requiredConsultationType: undefined },
    })).toEqual({
      allowed: false,
      reason: 'policy_unset_consultation_type',
      appointment_id: appointmentId,
    });

    expect(evaluateCallEligibility({
      ...base,
      policy: { ...testPolicy, joinWindow: undefined },
    })).toEqual({ allowed: false, reason: 'policy_unset_join_window', appointment_id: appointmentId });

    expect(evaluateCallEligibility({
      ...base,
      policy: { ...testPolicy, allowedCallerRoles: undefined },
    })).toEqual({ allowed: false, reason: 'policy_unset_roles', appointment_id: appointmentId });

    expect(evaluateCallEligibility({
      ...base,
      policy: { ...testPolicy, allowedCallerRoles: [] },
    })).toEqual({ allowed: false, reason: 'policy_unset_roles', appointment_id: appointmentId });
  });
});
