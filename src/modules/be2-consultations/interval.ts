import { z } from 'zod';
import { ClockTime, UtcInstant, compareClockTimes, compareUtcInstants } from './availability.js';

export type IntervalRelation =
  | 'before'
  | 'meets'
  | 'overlaps'
  | 'starts'
  | 'during'
  | 'finishes'
  | 'equal'
  | 'after'
  | 'met-by'
  | 'overlapped-by'
  | 'started-by'
  | 'contains'
  | 'finished-by';

const ClockInterval = z.object({
  start: ClockTime,
  end: ClockTime,
}).strict();

const UtcInterval = z.object({
  starts_at: UtcInstant,
  ends_at: UtcInstant,
}).strict();

type Compare = (left: string, right: string) => -1 | 0 | 1;

// Endpoint order only. starts: same start and the left end is earlier.
// finishes: same end and the left start is later.
// during: left is strictly inside right. contains: right is strictly inside left.
function relate(compare: Compare, aStart: string, aEnd: string, bStart: string, bEnd: string): IntervalRelation {
  const starts = compare(aStart, bStart);
  const ends = compare(aEnd, bEnd);
  if (starts < 0) {
    const endToStart = compare(aEnd, bStart);
    if (endToStart < 0) return 'before';
    if (endToStart === 0) return 'meets';
    if (ends < 0) return 'overlaps';
    if (ends === 0) return 'finished-by';
    return 'contains';
  }
  if (starts === 0) {
    if (ends < 0) return 'starts';
    if (ends === 0) return 'equal';
    return 'started-by';
  }
  const startToEnd = compare(aStart, bEnd);
  if (startToEnd > 0) return 'after';
  if (startToEnd === 0) return 'met-by';
  if (ends < 0) return 'during';
  if (ends === 0) return 'finishes';
  return 'overlapped-by';
}

function assertOrdered(compare: Compare, start: string, end: string, message: string) {
  if (compare(start, end) >= 0) throw new Error(message);
}

export function relateSameDayClockIntervals(
  left: { start: string; end: string },
  right: { start: string; end: string },
): IntervalRelation {
  const leftInterval = ClockInterval.parse(left);
  const rightInterval = ClockInterval.parse(right);
  assertOrdered(compareClockTimes, leftInterval.start, leftInterval.end, 'Clock interval is not ordered within a single day');
  assertOrdered(compareClockTimes, rightInterval.start, rightInterval.end, 'Clock interval is not ordered within a single day');
  return relate(compareClockTimes, leftInterval.start, leftInterval.end, rightInterval.start, rightInterval.end);
}

export function relateUtcIntervals(
  left: { starts_at: string; ends_at: string },
  right: { starts_at: string; ends_at: string },
): IntervalRelation {
  const leftInterval = UtcInterval.parse(left);
  const rightInterval = UtcInterval.parse(right);
  assertOrdered(compareUtcInstants, leftInterval.starts_at, leftInterval.ends_at, 'UTC instant interval is not ordered');
  assertOrdered(compareUtcInstants, rightInterval.starts_at, rightInterval.ends_at, 'UTC instant interval is not ordered');
  return relate(compareUtcInstants, leftInterval.starts_at, leftInterval.ends_at, rightInterval.starts_at, rightInterval.ends_at);
}
