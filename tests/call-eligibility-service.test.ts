import { describe, expect, it } from 'vitest';
import { InMemoryPersonAccountBindingStore } from '../src/modules/be1-auth/identity-resolver.js';
import { InMemoryAppointmentSnapshotRepository } from '../src/modules/be2-consultations/appointment-snapshot.js';
import { evaluateCallEligibilityForActor } from '../src/modules/be2-consultations/call-eligibility-service.js';
import type {
  CallAppointmentSnapshot,
  CallEligibilityPolicy,
} from '../src/modules/be2-consultations/call-eligibility.js';
import type { Actor } from '../src/shared/contracts.js';

const appointmentId = '11111111-1111-4111-8111-111111111111';
const personId = '22222222-2222-4222-8222-222222222222';
const staffUserId = '33333333-3333-4333-8333-333333333333';
const patientUserId = '44444444-4444-4444-8444-444444444444';
const familyUserId = '55555555-5555-4555-8555-555555555555';

const startsAt = '2026-10-30T10:00:00.000Z';
const endsAt = '2026-10-30T10:30:00.000Z';
const nowInWindow = '2026-10-30T09:55:00.000Z';
const tooEarly = '2026-10-30T09:49:00.000Z';

const policy: CallEligibilityPolicy = {
  allowedStatuses: ['confirmed'],
  requiredConsultationType: 'PHONE',
  joinWindow: {
    earliestBeforeStartMs: 10 * 60 * 1000,
    latestRelativeTo: 'ends_at',
    latestOffsetMs: 0,
  },
  allowedCallerRoles: ['staff', 'patient'],
};

const staff: Actor = { user_id: staffUserId, role: 'staff' };
const patient: Actor = { user_id: patientUserId, role: 'patient' };
const family: Actor = { user_id: familyUserId, role: 'family' };

function seedAppointment(
  appointments: InMemoryAppointmentSnapshotRepository,
  overrides: Partial<CallAppointmentSnapshot> = {},
) {
  appointments.seed({
    appointment_id: appointmentId,
    status: 'confirmed',
    consultation_type: 'PHONE',
    starts_at: startsAt,
    ends_at: endsAt,
    person_id: personId,
    staff_user_id: staffUserId,
    ...overrides,
  });
}

describe('evaluateCallEligibilityForActor', () => {
  it('allows assigned staff inside the 10-minute window', async () => {
    const appointments = new InMemoryAppointmentSnapshotRepository();
    seedAppointment(appointments);
    const result = await evaluateCallEligibilityForActor(
      { appointment_id: appointmentId, actor: staff, now: nowInWindow, policy },
      { appointments, personAccounts: new InMemoryPersonAccountBindingStore() },
    );
    expect(result).toMatchObject({ allowed: true, capacity: 'assigned_staff' });
  });

  it('denies staff before the 10-minute boundary', async () => {
    const appointments = new InMemoryAppointmentSnapshotRepository();
    seedAppointment(appointments);
    const result = await evaluateCallEligibilityForActor(
      { appointment_id: appointmentId, actor: staff, now: tooEarly, policy },
      { appointments, personAccounts: new InMemoryPersonAccountBindingStore() },
    );
    expect(result).toMatchObject({ allowed: false, reason: 'join_too_early' });
  });

  it('allows patient only with verified person↔user binding', async () => {
    const appointments = new InMemoryAppointmentSnapshotRepository();
    seedAppointment(appointments);
    const personAccounts = new InMemoryPersonAccountBindingStore();
    expect(await evaluateCallEligibilityForActor(
      { appointment_id: appointmentId, actor: patient, now: nowInWindow, policy },
      { appointments, personAccounts },
    )).toMatchObject({ allowed: false, reason: 'participation_missing' });

    personAccounts.seed({
      person_id: personId,
      user_id: patientUserId,
      verified: true,
      status: 'ACTIVE',
    });
    expect(await evaluateCallEligibilityForActor(
      { appointment_id: appointmentId, actor: patient, now: nowInWindow, policy },
      { appointments, personAccounts },
    )).toMatchObject({ allowed: true, capacity: 'person_account' });
  });

  it('denies family participation until policy is decided', async () => {
    const appointments = new InMemoryAppointmentSnapshotRepository();
    seedAppointment(appointments);
    const result = await evaluateCallEligibilityForActor(
      { appointment_id: appointmentId, actor: family, now: nowInWindow, policy },
      { appointments, personAccounts: new InMemoryPersonAccountBindingStore() },
    );
    expect(result.allowed).toBe(false);
  });

  it('denies unset production policy and missing appointments', async () => {
    const appointments = new InMemoryAppointmentSnapshotRepository();
    expect(await evaluateCallEligibilityForActor(
      {
        appointment_id: appointmentId,
        actor: staff,
        now: nowInWindow,
        policy: { ...policy, allowedStatuses: undefined },
      },
      { appointments, personAccounts: new InMemoryPersonAccountBindingStore() },
    )).toMatchObject({ allowed: false, reason: 'appointment_not_found' });

    seedAppointment(appointments);
    expect(await evaluateCallEligibilityForActor(
      {
        appointment_id: appointmentId,
        actor: staff,
        now: nowInWindow,
        policy: { ...policy, allowedStatuses: undefined },
      },
      { appointments, personAccounts: new InMemoryPersonAccountBindingStore() },
    )).toMatchObject({ allowed: false, reason: 'policy_unset_statuses' });
  });

  it('denies non-PHONE consultation types', async () => {
    const appointments = new InMemoryAppointmentSnapshotRepository();
    seedAppointment(appointments, { consultation_type: 'IN_PERSON' });
    expect(await evaluateCallEligibilityForActor(
      { appointment_id: appointmentId, actor: staff, now: nowInWindow, policy },
      { appointments, personAccounts: new InMemoryPersonAccountBindingStore() },
    )).toMatchObject({ allowed: false, reason: 'consultation_type_not_allowed' });
  });
});
