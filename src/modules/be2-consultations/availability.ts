import { z } from 'zod';
import { Id } from '../../shared/contracts.js';

export const ClockTime = z.iso.time();
export const CalendarDate = z.iso.date();
export const UtcInstant = z.iso.datetime();

export const AvailabilityWindowDraft = z.object({
  staff_id: Id,
  start_local: ClockTime,
  end_local: ClockTime,
}).strict();

export const UtcInstantIntervalDraft = z.object({
  starts_at: UtcInstant,
  ends_at: UtcInstant,
}).strict();

export type AvailabilityWindow = z.infer<typeof AvailabilityWindowDraft>;
export type UtcInstantInterval = z.infer<typeof UtcInstantIntervalDraft>;

export function parseClockTime(input: unknown): string {
  return ClockTime.parse(input);
}

export function parseCalendarDate(input: unknown): string {
  return CalendarDate.parse(input);
}

export function parseUtcInstant(input: unknown): string {
  return UtcInstant.parse(input);
}

// Same-day ordering only. A later clock time on the next civil day is outside
// this check. Overnight windows, weekdays, overlap, and time zones are undecided.
export function parseAvailabilityWindow(input: unknown): AvailabilityWindow {
  const window = AvailabilityWindowDraft.parse(input);
  if (compareClockTimes(window.start_local, window.end_local) >= 0) {
    throw new Error('Clock interval is not ordered within a single day');
  }
  return window;
}

// Absolute RFC3339 UTC instants already have a total order. This is not an
// exception-priority or exception-kind rule.
export function parseUtcInstantInterval(input: unknown): UtcInstantInterval {
  const interval = UtcInstantIntervalDraft.parse(input);
  if (compareUtcInstants(interval.starts_at, interval.ends_at) >= 0) {
    throw new Error('UTC instant interval is not ordered');
  }
  return interval;
}

export function compareClockTimes(left: string, right: string): -1 | 0 | 1 {
  const leftParts = clockParts(ClockTime.parse(left));
  const rightParts = clockParts(ClockTime.parse(right));
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return compareFraction(leftParts[3], rightParts[3]);
}

export function compareUtcInstants(left: string, right: string): -1 | 0 | 1 {
  const leftParts = instantParts(UtcInstant.parse(left));
  const rightParts = instantParts(UtcInstant.parse(right));
  for (let index = 0; index < 6; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return compareFraction(leftParts[6], rightParts[6]);
}

function clockParts(value: string): readonly [number, number, number, string] {
  const [hms, fraction = ''] = value.split('.');
  const [hour, minute, second = '0'] = hms.split(':');
  return [Number(hour), Number(minute), Number(second), fraction];
}

function instantParts(value: string): readonly [number, number, number, number, number, number, string] {
  const [date, timeWithZone] = value.split('T');
  if (!timeWithZone.endsWith('Z')) throw new Error('UTC instant requires a Z suffix');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second, fraction] = clockParts(timeWithZone.slice(0, -1));
  return [year, month, day, hour, minute, second, fraction];
}

function compareFraction(left: string, right: string): -1 | 0 | 1 {
  const width = Math.max(left.length, right.length);
  const a = left.padEnd(width, '0');
  const b = right.padEnd(width, '0');
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
