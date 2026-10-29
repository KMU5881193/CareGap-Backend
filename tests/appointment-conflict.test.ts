import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  findAppointmentConflicts,
  type ConflictPolicy,
} from '../src/modules/be2-consultations/appointment-conflict.js';

const staffA = '11111111-1111-4111-8111-111111111111';
const staffB = '22222222-2222-4222-8222-222222222222';
const personA = '33333333-3333-4333-8333-333333333333';
const personB = '44444444-4444-4444-8444-444444444444';
const existingId = '55555555-5555-4555-8555-555555555555';
const otherId = '66666666-6666-4666-8666-666666666666';

function candidate(overrides: Partial<{ staff_user_id: string; person_id: string; starts_at: string; ends_at: string }> = {}) {
  return {
    staff_user_id: staffA,
    person_id: personA,
    starts_at: '2026-10-29T09:00:00Z',
    ends_at: '2026-10-29T11:00:00Z',
    ...overrides,
  };
}

function row(overrides: Partial<{
  appointment_id: string;
  staff_user_id: string;
  person_id: string;
  status: string;
  starts_at: string;
  ends_at: string;
}> = {}) {
  return {
    appointment_id: existingId,
    staff_user_id: staffA,
    person_id: personB,
    status: 'confirmed',
    starts_at: '2026-10-29T10:00:00Z',
    ends_at: '2026-10-29T12:00:00Z',
    ...overrides,
  };
}

function policy(overrides: Partial<ConflictPolicy> = {}): ConflictPolicy {
  return {
    occupyingStatuses: ['confirmed'],
    blockingRelations: ['overlaps'],
    ...overrides,
  };
}

describe('appointment conflict analysis', () => {
  it('reports an overlap on the same staff user', () => {
    expect(findAppointmentConflicts(candidate(), [row()], policy())).toEqual({
      configured: true,
      conflicts: [{ appointment_id: existingId, relation: 'overlaps', axis: 'staff' }],
    });
  });

  it('reports an overlap on the same person', () => {
    expect(findAppointmentConflicts(
      candidate(),
      [row({ staff_user_id: staffB, person_id: personA })],
      policy(),
    )).toEqual({
      configured: true,
      conflicts: [{ appointment_id: existingId, relation: 'overlaps', axis: 'person' }],
    });
  });

  it('keeps before and after distinct from overlaps', () => {
    const earlier = row({
      starts_at: '2026-10-29T07:00:00Z',
      ends_at: '2026-10-29T08:00:00Z',
    });
    const later = row({
      appointment_id: otherId,
      starts_at: '2026-10-29T12:00:00Z',
      ends_at: '2026-10-29T13:00:00Z',
    });
    expect(findAppointmentConflicts(candidate(), [earlier, later], policy())).toEqual({
      configured: true,
      conflicts: [],
    });
    expect(findAppointmentConflicts(candidate(), [earlier], policy({ blockingRelations: ['after'] }))).toEqual({
      configured: true,
      conflicts: [{ appointment_id: existingId, relation: 'after', axis: 'staff' }],
    });
    expect(findAppointmentConflicts(candidate(), [later], policy({ blockingRelations: ['before'] }))).toEqual({
      configured: true,
      conflicts: [{ appointment_id: otherId, relation: 'before', axis: 'staff' }],
    });
  });

  it('includes meets only when the caller lists that relation', () => {
    const touching = row({
      starts_at: '2026-10-29T11:00:00Z',
      ends_at: '2026-10-29T12:00:00Z',
    });
    const metBy = row({
      starts_at: '2026-10-29T08:00:00Z',
      ends_at: '2026-10-29T09:00:00Z',
    });
    expect(findAppointmentConflicts(candidate(), [touching, metBy], policy())).toEqual({
      configured: true,
      conflicts: [],
    });
    expect(findAppointmentConflicts(
      candidate(),
      [touching, metBy],
      policy({ blockingRelations: ['meets'] }),
    )).toEqual({
      configured: true,
      conflicts: [{ appointment_id: existingId, relation: 'meets', axis: 'staff' }],
    });
  });

  it('reports equal on both the staff axis and the person axis', () => {
    const same = row({
      person_id: personA,
      starts_at: '2026-10-29T09:00:00Z',
      ends_at: '2026-10-29T11:00:00Z',
    });
    expect(findAppointmentConflicts(candidate(), [same], policy({ blockingRelations: ['equal'] }))).toEqual({
      configured: true,
      conflicts: [
        { appointment_id: existingId, relation: 'equal', axis: 'staff' },
        { appointment_id: existingId, relation: 'equal', axis: 'person' },
      ],
    });
  });

  it('reports contains without treating the inverse as the same relation', () => {
    const inner = row({
      person_id: personA,
      starts_at: '2026-10-29T09:30:00Z',
      ends_at: '2026-10-29T10:00:00Z',
    });
    expect(findAppointmentConflicts(candidate(), [inner], policy({ blockingRelations: ['contains'] }))).toEqual({
      configured: true,
      conflicts: [
        { appointment_id: existingId, relation: 'contains', axis: 'staff' },
        { appointment_id: existingId, relation: 'contains', axis: 'person' },
      ],
    });
    expect(findAppointmentConflicts(
      candidate({ starts_at: '2026-10-29T09:30:00Z', ends_at: '2026-10-29T10:00:00Z' }),
      [row({
        person_id: personA,
        starts_at: '2026-10-29T09:00:00Z',
        ends_at: '2026-10-29T11:00:00Z',
      })],
      policy({ blockingRelations: ['contains'] }),
    )).toEqual({ configured: true, conflicts: [] });
  });

  it('detects an overlap that crosses midnight in UTC', () => {
    expect(findAppointmentConflicts(
      candidate({ starts_at: '2026-10-29T23:00:00Z', ends_at: '2026-10-30T01:00:00Z' }),
      [row({ starts_at: '2026-10-30T00:30:00Z', ends_at: '2026-10-30T02:00:00Z' })],
      policy(),
    )).toEqual({
      configured: true,
      conflicts: [{ appointment_id: existingId, relation: 'overlaps', axis: 'staff' }],
    });
  });

  it('can skip the appointment being changed', () => {
    const self = row({
      appointment_id: existingId,
      person_id: personA,
      starts_at: '2026-10-29T09:00:00Z',
      ends_at: '2026-10-29T11:00:00Z',
    });
    const other = row({ appointment_id: otherId, person_id: personB });
    expect(findAppointmentConflicts(candidate(), [self, other], policy({ excludeAppointmentId: existingId }))).toEqual({
      configured: true,
      conflicts: [{ appointment_id: otherId, relation: 'overlaps', axis: 'staff' }],
    });
  });

  it('matches staff and person ids when only the UUID letter case differs', () => {
    const staffLower = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const personLower = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const storedId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const subject = candidate({
      staff_user_id: staffLower.toUpperCase(),
      person_id: personLower.toUpperCase(),
    });
    const stored = row({
      appointment_id: storedId.toUpperCase(),
      staff_user_id: staffLower,
      person_id: personLower,
      starts_at: '2026-10-29T09:00:00Z',
      ends_at: '2026-10-29T11:00:00Z',
    });
    expect(findAppointmentConflicts(subject, [stored], policy({ blockingRelations: ['equal'] }))).toEqual({
      configured: true,
      conflicts: [
        { appointment_id: storedId.toUpperCase(), relation: 'equal', axis: 'staff' },
        { appointment_id: storedId.toUpperCase(), relation: 'equal', axis: 'person' },
      ],
    });
    expect(subject.staff_user_id).toBe(staffLower.toUpperCase());
    expect(subject.person_id).toBe(personLower.toUpperCase());
    expect(stored.appointment_id).toBe(storedId.toUpperCase());
    expect(stored.staff_user_id).toBe(staffLower);
    expect(stored.person_id).toBe(personLower);
  });

  it('excludes only the same appointment when the excluded id uses a different case', () => {
    const selfId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const self = row({
      appointment_id: selfId,
      person_id: personA,
      starts_at: '2026-10-29T09:00:00Z',
      ends_at: '2026-10-29T11:00:00Z',
    });
    const other = row({ appointment_id: otherId, person_id: personB });
    expect(findAppointmentConflicts(candidate(), [self, other], policy({
      blockingRelations: ['equal', 'overlaps'],
      excludeAppointmentId: selfId.toUpperCase(),
    }))).toEqual({
      configured: true,
      conflicts: [{ appointment_id: otherId, relation: 'overlaps', axis: 'staff' }],
    });
  });

  it('follows the caller occupancy list for requested and confirmed rows', () => {
    const pending = row({ status: 'requested' });
    expect(findAppointmentConflicts(candidate(), [pending], policy())).toEqual({
      configured: true,
      conflicts: [],
    });
    expect(findAppointmentConflicts(
      candidate(),
      [pending],
      policy({ occupyingStatuses: ['requested'] }),
    )).toEqual({
      configured: true,
      conflicts: [{ appointment_id: existingId, relation: 'overlaps', axis: 'staff' }],
    });
  });

  it('does not treat an empty policy as an approval', () => {
    const analysis = findAppointmentConflicts(candidate(), [row()], policy({ occupyingStatuses: [], blockingRelations: [] }));
    expect(analysis).toEqual({ configured: false, reason: 'policy_unset' });
    expect(analysis).not.toEqual({ configured: true, conflicts: [] });
    expect(findAppointmentConflicts(candidate(), [row()], policy({ blockingRelations: [] }))).toEqual({
      configured: false,
      reason: 'policy_unset',
    });
  });

  it('rejects a malformed id or UTC time', () => {
    expect(() => findAppointmentConflicts(candidate({ staff_user_id: 'staff-1' }), [], policy())).toThrow(ZodError);
    expect(() => findAppointmentConflicts(
      candidate({ starts_at: '2026-10-29T09:00:00+09:00' }),
      [],
      policy(),
    )).toThrow(ZodError);
    expect(() => findAppointmentConflicts(candidate(), [row({ appointment_id: 'appt-1' })], policy())).toThrow(ZodError);
  });
});
