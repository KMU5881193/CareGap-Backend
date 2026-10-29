import { z } from 'zod';
import { Id } from '../../shared/contracts.js';
import { ClockTime, UtcInstant, compareClockTimes, compareUtcInstants } from './availability.js';

const apiErrorCodes = [
  'INVALID_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const;

function rejectUnorderedClock<T extends z.ZodObject<{ start_local: typeof ClockTime; end_local: typeof ClockTime }>>(schema: T) {
  return schema.superRefine((value, ctx) => {
    if (compareClockTimes(value.start_local, value.end_local) >= 0) {
      ctx.addIssue('Clock interval is not ordered within a single day');
    }
  });
}

function rejectUnorderedUtc<T extends z.ZodObject<{ starts_at: typeof UtcInstant; ends_at: typeof UtcInstant }>>(schema: T) {
  return schema.superRefine((value, ctx) => {
    if (compareUtcInstants(value.starts_at, value.ends_at) >= 0) {
      ctx.addIssue('UTC instant interval is not ordered');
    }
  });
}

// Client time data only. The authenticated user_id is not a field of this body.
export const AvailabilityWindowInput = rejectUnorderedClock(z.object({
  start_local: ClockTime,
  end_local: ClockTime,
}).strict());

export const AvailabilityExceptionInput = rejectUnorderedUtc(z.object({
  starts_at: UtcInstant,
  ends_at: UtcInstant,
}).strict());

export const AvailabilityWriteInput = z.object({
  windows: z.array(AvailabilityWindowInput).optional(),
  exceptions: z.array(AvailabilityExceptionInput).optional(),
}).strict();

export const AvailabilityOutput = z.object({
  windows: z.array(AvailabilityWindowInput),
  exceptions: z.array(AvailabilityExceptionInput),
}).strict();

// person_id is the care subject. Actor user_id and role come from BE1, not this body.
export const AppointmentCreateInput = rejectUnorderedUtc(z.object({
  person_id: Id,
  starts_at: UtcInstant,
  ends_at: UtcInstant,
}).strict());

export const AppointmentIdInput = z.object({
  appointment_id: Id,
}).strict();

export const ScheduleQueryInput = z.object({
  person_id: Id.optional(),
  from: UtcInstant.optional(),
  to: UtcInstant.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().positive().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.from !== undefined && value.to !== undefined && compareUtcInstants(value.from, value.to) >= 0) {
    ctx.addIssue('UTC instant interval is not ordered');
  }
});

// status stays an open string. Allowed appointment states are not settled.
export const AppointmentOutput = z.object({
  appointment_id: Id,
  person_id: Id,
  starts_at: UtcInstant,
  ends_at: UtcInstant,
  status: z.string().min(1),
}).strict();

export const ApiError = z.object({
  error: z.object({
    code: z.enum(apiErrorCodes),
    message: z.string().min(1),
  }).strict(),
}).strict();

export function apiData<T extends z.ZodType>(data: T) {
  return z.object({ data }).strict();
}

export type AvailabilityWindowInput = z.infer<typeof AvailabilityWindowInput>;
export type AvailabilityWriteInput = z.infer<typeof AvailabilityWriteInput>;
export type AppointmentCreateInput = z.infer<typeof AppointmentCreateInput>;
export type ScheduleQueryInput = z.infer<typeof ScheduleQueryInput>;
export type AppointmentOutput = z.infer<typeof AppointmentOutput>;
