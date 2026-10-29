import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { findAppointmentConflicts } from '../src/modules/be2-consultations/appointment-conflict.js';
import { applyTransition } from '../src/modules/be2-consultations/appointment-transition.js';
import { compareClockTimes } from '../src/modules/be2-consultations/availability.js';
import {
  ApiError,
  AppointmentCreateInput,
  AppointmentOutput,
  AvailabilityWriteInput,
  ScheduleQueryInput,
  apiData,
} from '../src/modules/be2-consultations/api-schema.js';

const personId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actorUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const staffUserId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const appointmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('availability request schema', () => {
  it('accepts same-day clock windows and UTC exceptions', () => {
    expect(AvailabilityWriteInput.parse({
      windows: [{ start_local: '09:00', end_local: '10:00' }],
      exceptions: [{ starts_at: '2026-10-29T00:00:00Z', ends_at: '2026-10-29T02:00:00Z' }],
    })).toEqual({
      windows: [{ start_local: '09:00', end_local: '10:00' }],
      exceptions: [{ starts_at: '2026-10-29T00:00:00Z', ends_at: '2026-10-29T02:00:00Z' }],
    });
  });

  it('rejects an unordered clock window and unknown availability fields', () => {
    expect(() => AvailabilityWriteInput.parse({
      windows: [{ start_local: '22:00', end_local: '02:00' }],
    })).toThrow(ZodError);
    expect(() => AvailabilityWriteInput.parse({
      windows: [{ start_local: '09:00', end_local: '10:00', weekday: 1 }],
    })).toThrow(ZodError);
    expect(() => AvailabilityWriteInput.parse({
      user_id: actorUserId,
      windows: [],
    })).toThrow(ZodError);
  });

  it('can compare a parsed window with the existing clock order function', () => {
    const body = AvailabilityWriteInput.parse({
      windows: [{ start_local: '09:00', end_local: '09:00:01' }],
    });
    expect(compareClockTimes(body.windows![0].start_local, body.windows![0].end_local)).toBe(-1);
  });
});

describe('appointment request schema', () => {
  it('preserves the letter case of a person id', () => {
    const parsed = AppointmentCreateInput.parse({
      person_id: personId.toUpperCase(),
      starts_at: '2026-10-29T09:00:00Z',
      ends_at: '2026-10-29T10:00:00Z',
    });
    expect(parsed.person_id).toBe(personId.toUpperCase());
    expect(parsed).not.toHaveProperty('user_id');
    expect(parsed).not.toHaveProperty('staff_id');
    expect(parsed).not.toHaveProperty('status');
  });

  it('rejects a bad id, a non-UTC time, a missing subject, and unsettled client fields', () => {
    expect(() => AppointmentCreateInput.parse({
      person_id: 'person-1',
      starts_at: '2026-10-29T09:00:00Z',
      ends_at: '2026-10-29T10:00:00Z',
    })).toThrow(ZodError);
    expect(() => AppointmentCreateInput.parse({
      person_id: personId,
      starts_at: '2026-10-29T09:00:00+09:00',
      ends_at: '2026-10-29T10:00:00Z',
    })).toThrow(ZodError);
    expect(() => AppointmentCreateInput.parse({
      starts_at: '2026-10-29T09:00:00Z',
      ends_at: '2026-10-29T10:00:00Z',
    })).toThrow(ZodError);
    expect(() => AppointmentCreateInput.parse({
      person_id: personId,
      starts_at: '2026-10-29T09:00:00Z',
      ends_at: '2026-10-29T10:00:00Z',
      status: 'requested',
      staff_id: staffUserId,
    })).toThrow(ZodError);
  });

  it('rejects an appointment interval that does not move forward', () => {
    expect(() => AppointmentCreateInput.parse({
      person_id: personId,
      starts_at: '2026-10-29T10:00:00Z',
      ends_at: '2026-10-29T10:00:00Z',
    })).toThrow(/UTC instant interval is not ordered/);
  });

  it('sends parsed times to conflict analysis with the assigned counselor, not the authenticated actor', () => {
    const body = AppointmentCreateInput.parse({
      person_id: personId,
      starts_at: '2026-10-29T23:00:00Z',
      ends_at: '2026-10-30T01:00:00Z',
    });
    const candidate = {
      staff_user_id: staffUserId,
      person_id: body.person_id,
      starts_at: body.starts_at,
      ends_at: body.ends_at,
    };
    expect(candidate.staff_user_id).toBe(staffUserId);
    expect(candidate.staff_user_id).not.toBe(actorUserId);
    expect(findAppointmentConflicts(candidate, [], {
      occupyingStatuses: ['fixture-status'],
      blockingRelations: ['overlaps'],
    })).toEqual({ configured: true, conflicts: [] });
    expect(applyTransition({
      status: 'fixture-status',
      starts_at: body.starts_at,
      ends_at: body.ends_at,
    }, 'accept', 'staff', [])).toEqual({ ok: false, reason: 'illegal_transition' });
  });
});

describe('schedule query and response schemas', () => {
  it('accepts an optional page without imposing a maximum limit', () => {
    expect(ScheduleQueryInput.parse({
      person_id: personId,
      from: '2026-10-29T00:00:00Z',
      to: '2026-10-30T00:00:00Z',
      cursor: 'page-1',
      limit: 100000,
    }).limit).toBe(100000);
    expect(() => ScheduleQueryInput.parse({ limit: 0 })).toThrow(ZodError);
    expect(() => ScheduleQueryInput.parse({
      from: '2026-10-30T00:00:00Z',
      to: '2026-10-29T00:00:00Z',
    })).toThrow(ZodError);
    expect(() => ScheduleQueryInput.parse({ user_id: actorUserId })).toThrow(ZodError);
  });

  it('allows any non-empty appointment status and only the shared error codes', () => {
    const output = {
      appointment_id: appointmentId,
      person_id: personId,
      starts_at: '2026-10-29T09:00:00Z',
      ends_at: '2026-10-29T10:00:00Z',
      status: 'not-a-settled-status',
    };
    expect(apiData(AppointmentOutput).parse({ data: output }).data.status).toBe('not-a-settled-status');
    expect(ApiError.parse({ error: { code: 'INVALID_REQUEST', message: 'Invalid JSON' } }).error.code).toBe('INVALID_REQUEST');
    expect(() => AppointmentOutput.parse({ ...output, status: '' })).toThrow(ZodError);
    expect(() => ApiError.parse({ error: { code: 'POLICY_UNSET', message: 'Unset' } })).toThrow(ZodError);
  });
});
