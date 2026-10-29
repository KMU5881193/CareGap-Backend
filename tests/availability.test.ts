import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  parseAvailabilityWindow,
  parseCalendarDate,
  parseClockTime,
  parseUtcInstant,
  parseUtcInstantInterval,
} from '../src/modules/be2-consultations/availability.js';

const staffId = '11111111-1111-4111-8111-111111111111';

describe('availability format checks', () => {
  it('accepts a clock time and rejects a date or UTC instant in that position', () => {
    expect(parseClockTime('09:00')).toBe('09:00');
    expect(parseClockTime('09:00:01')).toBe('09:00:01');
    expect(() => parseClockTime('2026-10-29')).toThrow(ZodError);
    expect(() => parseClockTime('2026-10-29T09:00:00Z')).toThrow(ZodError);
    expect(() => parseClockTime('09:00:00+09:00')).toThrow(ZodError);
  });

  it('rejects clock times outside 00:00:00–23:59:59', () => {
    expect(() => parseClockTime('24:00')).toThrow(ZodError);
    expect(() => parseClockTime('09:60')).toThrow(ZodError);
    expect(() => parseClockTime('9:00')).toThrow(ZodError);
  });

  it('accepts a real calendar date and rejects values that are not dates', () => {
    expect(parseCalendarDate('2026-10-29')).toBe('2026-10-29');
    expect(parseCalendarDate('2024-02-29')).toBe('2024-02-29');
    expect(() => parseCalendarDate('2026-02-29')).toThrow(ZodError);
    expect(() => parseCalendarDate('2026-02-31')).toThrow(ZodError);
    expect(() => parseCalendarDate('09:00')).toThrow(ZodError);
    expect(() => parseCalendarDate('2026-10-29T09:00:00Z')).toThrow(ZodError);
  });

  it('accepts a UTC instant and rejects a date, a clock time, or an offset instant', () => {
    expect(parseUtcInstant('2026-10-29T09:00:00Z')).toBe('2026-10-29T09:00:00Z');
    expect(() => parseUtcInstant('2026-10-29')).toThrow(ZodError);
    expect(() => parseUtcInstant('09:00:00')).toThrow(ZodError);
    expect(() => parseUtcInstant('2026-10-29T09:00:00+09:00')).toThrow(ZodError);
    expect(() => parseUtcInstant('2026-02-31T00:00:00Z')).toThrow(ZodError);
  });
});

describe('availability interval checks', () => {
  it('accepts an ordered same-day window for a synthetic staff id', () => {
    expect(parseAvailabilityWindow({
      staff_id: staffId,
      start_local: '09:00',
      end_local: '09:00:01',
    })).toEqual({
      staff_id: staffId,
      start_local: '09:00',
      end_local: '09:00:01',
    });
  });

  it('rejects a staff id that is not a UUID', () => {
    expect(() => parseAvailabilityWindow({
      staff_id: 'staff-1',
      start_local: '09:00',
      end_local: '10:00',
    })).toThrow(ZodError);
  });

  it('rejects a weekday until its numbering scheme is agreed', () => {
    expect(() => parseAvailabilityWindow({
      staff_id: staffId,
      weekday: 1,
      start_local: '09:00',
      end_local: '10:00',
    })).toThrow(ZodError);
  });

  it('rejects a same-day clock window that is empty or reversed', () => {
    expect(() => parseAvailabilityWindow({
      staff_id: staffId,
      start_local: '09:00',
      end_local: '09:00:00',
    })).toThrow(/not ordered within a single day/);
    expect(() => parseAvailabilityWindow({
      staff_id: staffId,
      start_local: '10:00',
      end_local: '09:00',
    })).toThrow(/not ordered within a single day/);
  });

  it('does not represent an overnight pair as a same-day window', () => {
    expect(() => parseAvailabilityWindow({
      staff_id: staffId,
      start_local: '22:00',
      end_local: '02:00',
    })).toThrow(/not ordered within a single day/);
  });

  it('orders a UTC instant interval that crosses midnight', () => {
    expect(parseUtcInstantInterval({
      starts_at: '2026-10-29T23:00:00Z',
      ends_at: '2026-10-30T01:00:00Z',
    })).toEqual({
      starts_at: '2026-10-29T23:00:00Z',
      ends_at: '2026-10-30T01:00:00Z',
    });
  });

  it('accepts an ordered UTC instant interval and rejects an empty or reversed one', () => {
    expect(parseUtcInstantInterval({
      starts_at: '2026-10-29T09:00:00.5Z',
      ends_at: '2026-10-29T09:00:00.6Z',
    })).toEqual({
      starts_at: '2026-10-29T09:00:00.5Z',
      ends_at: '2026-10-29T09:00:00.6Z',
    });
    expect(() => parseUtcInstantInterval({
      starts_at: '2026-10-29T09:00:00.5Z',
      ends_at: '2026-10-29T09:00:00.50Z',
    })).toThrow(/UTC instant interval is not ordered/);
    expect(() => parseUtcInstantInterval({
      starts_at: '2026-10-29T10:00:00Z',
      ends_at: '2026-10-29T09:00:00Z',
    })).toThrow(/UTC instant interval is not ordered/);
  });

  it('rejects an exception kind until that policy is agreed', () => {
    expect(() => parseUtcInstantInterval({
      starts_at: '2026-10-29T09:00:00Z',
      ends_at: '2026-10-29T10:00:00Z',
      kind: 'unavailable',
    })).toThrow(ZodError);
  });
});
