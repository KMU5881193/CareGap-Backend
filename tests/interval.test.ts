import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { compareClockTimes, compareUtcInstants } from '../src/modules/be2-consultations/availability.js';
import { relateSameDayClockIntervals, relateUtcIntervals, type IntervalRelation } from '../src/modules/be2-consultations/interval.js';

const relations: readonly {
  relation: IntervalRelation;
  inverse: IntervalRelation;
  left: readonly [string, string];
  right: readonly [string, string];
}[] = [
  { relation: 'before', inverse: 'after', left: ['09:00', '10:00'], right: ['11:00', '12:00'] },
  { relation: 'meets', inverse: 'met-by', left: ['09:00', '10:00'], right: ['10:00', '11:00'] },
  { relation: 'overlaps', inverse: 'overlapped-by', left: ['09:00', '11:00'], right: ['10:00', '12:00'] },
  { relation: 'starts', inverse: 'started-by', left: ['09:00', '10:00'], right: ['09:00', '12:00'] },
  { relation: 'during', inverse: 'contains', left: ['10:00', '11:00'], right: ['09:00', '12:00'] },
  { relation: 'finishes', inverse: 'finished-by', left: ['10:00', '12:00'], right: ['09:00', '12:00'] },
  { relation: 'equal', inverse: 'equal', left: ['09:00', '10:00'], right: ['09:00:00', '10:00:00'] },
  { relation: 'after', inverse: 'before', left: ['11:00', '12:00'], right: ['09:00', '10:00'] },
  { relation: 'met-by', inverse: 'meets', left: ['10:00', '11:00'], right: ['09:00', '10:00'] },
  { relation: 'overlapped-by', inverse: 'overlaps', left: ['10:00', '12:00'], right: ['09:00', '11:00'] },
  { relation: 'started-by', inverse: 'starts', left: ['09:00', '12:00'], right: ['09:00', '10:00'] },
  { relation: 'contains', inverse: 'during', left: ['09:00', '12:00'], right: ['10:00', '11:00'] },
  { relation: 'finished-by', inverse: 'finishes', left: ['09:00', '12:00'], right: ['10:00', '12:00'] },
];

function clock(pair: readonly [string, string]) {
  return { start: pair[0], end: pair[1] };
}

function utc(pair: readonly [string, string]) {
  return { starts_at: `2026-10-29T${pair[0]}Z`, ends_at: `2026-10-29T${pair[1]}Z` };
}

describe('time comparison', () => {
  it('treats equivalent clock spellings as the same instant', () => {
    expect(compareClockTimes('09:00', '09:00:00')).toBe(0);
    expect(compareClockTimes('09:00:00.5', '09:00:00.50')).toBe(0);
    expect(compareClockTimes('09:00:00.05', '09:00:00.5')).toBe(-1);
    expect(compareClockTimes('09:00:00.2', '09:00:00.15')).toBe(1);
  });

  it('orders UTC instants across a date boundary', () => {
    expect(compareUtcInstants('2026-10-29T23:00:00Z', '2026-10-30T01:00:00Z')).toBe(-1);
    expect(compareUtcInstants('2026-10-30T00:00:00.5Z', '2026-10-30T00:00:00.50Z')).toBe(0);
    expect(compareUtcInstants('2026-10-30T01:00:00Z', '2026-10-29T23:00:00Z')).toBe(1);
  });

  it('rejects values that are not the expected time form', () => {
    expect(() => compareClockTimes('24:00', '09:00')).toThrow(ZodError);
    expect(() => compareClockTimes('09:00', '2026-10-29T09:00:00Z')).toThrow(ZodError);
    expect(() => compareUtcInstants('2026-10-29T09:00:00+09:00', '2026-10-29T10:00:00Z')).toThrow(ZodError);
    expect(() => compareUtcInstants('09:00:00', '2026-10-29T10:00:00Z')).toThrow(ZodError);
  });
});

describe('same-day clock interval relations', () => {
  it('names each of the 13 relations once', () => {
    expect(new Set(relations.map((row) => row.relation)).size).toBe(13);
  });

  it.each(relations)('$relation and its inverse $inverse', ({ relation, inverse, left, right }) => {
    expect(relateSameDayClockIntervals(clock(left), clock(right))).toBe(relation);
    expect(relateSameDayClockIntervals(clock(right), clock(left))).toBe(inverse);
  });

  it('keeps a shared fractional endpoint as meets', () => {
    expect(relateSameDayClockIntervals(
      { start: '09:00', end: '10:00:00.50' },
      { start: '10:00:00.5', end: '11:00' },
    )).toBe('meets');
    expect(relateSameDayClockIntervals(
      { start: '09:00', end: '10:00:00' },
      { start: '10:00:01', end: '11:00' },
    )).toBe('before');
  });

  it('rejects an unordered clock interval', () => {
    expect(() => relateSameDayClockIntervals(
      { start: '09:00', end: '09:00:00' },
      { start: '10:00', end: '11:00' },
    )).toThrow('Clock interval is not ordered within a single day');
    expect(() => relateSameDayClockIntervals(
      { start: '10:00', end: '09:00' },
      { start: '12:00', end: '13:00' },
    )).toThrow('Clock interval is not ordered within a single day');
  });

  it('rejects an overnight clock pair instead of splitting or converting it', () => {
    expect(() => relateSameDayClockIntervals(
      { start: '22:00', end: '02:00' },
      { start: '09:00', end: '10:00' },
    )).toThrow('Clock interval is not ordered within a single day');
  });

  it('rejects a clock interval that is not a pair of clock times', () => {
    expect(() => relateSameDayClockIntervals(
      { start: '2026-10-29', end: '10:00' },
      { start: '11:00', end: '12:00' },
    )).toThrow(ZodError);
  });
});

describe('UTC instant interval relations', () => {
  it.each(relations)('$relation and its inverse $inverse', ({ relation, inverse, left, right }) => {
    expect(relateUtcIntervals(utc(left), utc(right))).toBe(relation);
    expect(relateUtcIntervals(utc(right), utc(left))).toBe(inverse);
  });

  it('overlaps when one UTC interval crosses midnight into the other', () => {
    expect(relateUtcIntervals(
      { starts_at: '2026-10-29T23:00:00Z', ends_at: '2026-10-30T01:00:00Z' },
      { starts_at: '2026-10-30T00:30:00Z', ends_at: '2026-10-30T02:00:00Z' },
    )).toBe('overlaps');
    expect(relateUtcIntervals(
      { starts_at: '2026-10-30T00:30:00Z', ends_at: '2026-10-30T02:00:00Z' },
      { starts_at: '2026-10-29T23:00:00Z', ends_at: '2026-10-30T01:00:00Z' },
    )).toBe('overlapped-by');
  });

  it('meets when two UTC intervals touch on a date boundary', () => {
    expect(relateUtcIntervals(
      { starts_at: '2026-10-29T23:00:00Z', ends_at: '2026-10-30T00:00:00Z' },
      { starts_at: '2026-10-30T00:00:00Z', ends_at: '2026-10-30T01:00:00Z' },
    )).toBe('meets');
    expect(relateUtcIntervals(
      { starts_at: '2026-10-29T09:00:00Z', ends_at: '2026-10-29T10:00:00Z' },
      { starts_at: '2026-10-30T09:00:00Z', ends_at: '2026-10-30T10:00:00Z' },
    )).toBe('before');
  });

  it('rejects an unordered UTC interval', () => {
    expect(() => relateUtcIntervals(
      { starts_at: '2026-10-30T01:00:00Z', ends_at: '2026-10-29T23:00:00Z' },
      { starts_at: '2026-10-29T09:00:00Z', ends_at: '2026-10-29T10:00:00Z' },
    )).toThrow('UTC instant interval is not ordered');
    expect(() => relateUtcIntervals(
      { starts_at: '2026-10-29T09:00:00.5Z', ends_at: '2026-10-29T09:00:00.50Z' },
      { starts_at: '2026-10-29T10:00:00Z', ends_at: '2026-10-29T11:00:00Z' },
    )).toThrow('UTC instant interval is not ordered');
  });

  it('rejects a UTC interval that is not a pair of UTC instants', () => {
    expect(() => relateUtcIntervals(
      { starts_at: '09:00:00', ends_at: '2026-10-29T10:00:00Z' },
      { starts_at: '2026-10-29T11:00:00Z', ends_at: '2026-10-29T12:00:00Z' },
    )).toThrow(ZodError);
  });
});
