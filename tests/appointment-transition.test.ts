import { describe, expect, it } from 'vitest';
import { applyTransition, type TransitionRule } from '../src/modules/be2-consultations/appointment-transition.js';

const startsAt = '2026-10-29T09:00:00Z';
const endsAt = '2026-10-29T10:00:00Z';

const acceptByStaff: TransitionRule = {
  from: 'requested',
  action: 'accept',
  to: 'confirmed',
  actors: ['staff'],
};

describe('appointment transition interpreter', () => {
  it('applies a transition allowed for the supplied role', () => {
    expect(applyTransition(
      { status: 'requested', starts_at: startsAt, ends_at: endsAt },
      'accept',
      'staff',
      [acceptByStaff],
    )).toEqual({ ok: true, status: 'confirmed' });
  });

  it('rejects an action that has no rule from the current status', () => {
    expect(applyTransition(
      { status: 'confirmed', starts_at: startsAt, ends_at: endsAt },
      'accept',
      'staff',
      [acceptByStaff],
    )).toEqual({ ok: false, reason: 'illegal_transition' });
  });

  it('rejects a role that the matching rule does not list', () => {
    expect(applyTransition(
      { status: 'requested', starts_at: startsAt, ends_at: endsAt },
      'accept',
      'person',
      [acceptByStaff],
    )).toEqual({ ok: false, reason: 'actor_not_allowed' });
  });

  it('can stay on the same status when the injected rule says so', () => {
    expect(applyTransition(
      { status: 'confirmed', starts_at: startsAt, ends_at: endsAt },
      'annotate',
      'family',
      [{ from: 'confirmed', action: 'annotate', to: 'confirmed', actors: ['family'] }],
    )).toEqual({ ok: true, status: 'confirmed' });
  });

  it('does not change the appointment times', () => {
    const appointment = { status: 'requested', starts_at: startsAt, ends_at: endsAt };
    const result = applyTransition(appointment, 'accept', 'staff', [acceptByStaff]);
    expect(result).toEqual({ ok: true, status: 'confirmed' });
    expect(result).not.toHaveProperty('starts_at');
    expect(result).not.toHaveProperty('ends_at');
    expect(appointment).toEqual({ status: 'requested', starts_at: startsAt, ends_at: endsAt });
  });

  it('does not reserve completion for staff unless the caller rule says so', () => {
    const rules: TransitionRule[] = [
      { from: 'confirmed', action: 'complete', to: 'completed', actors: ['person'] },
    ];
    expect(applyTransition(
      { status: 'confirmed', starts_at: startsAt, ends_at: endsAt },
      'complete',
      'person',
      rules,
    )).toEqual({ ok: true, status: 'completed' });
    expect(applyTransition(
      { status: 'confirmed', starts_at: startsAt, ends_at: endsAt },
      'complete',
      'staff',
      rules,
    )).toEqual({ ok: false, reason: 'actor_not_allowed' });
  });

  it('rejects two matching rules that disagree on the next status', () => {
    expect(applyTransition(
      { status: 'requested', starts_at: startsAt, ends_at: endsAt },
      'accept',
      'staff',
      [
        acceptByStaff,
        { from: 'requested', action: 'accept', to: 'cancelled', actors: ['staff'] },
      ],
    )).toEqual({ ok: false, reason: 'illegal_transition' });
  });
});
