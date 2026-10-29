import { describe, expect, it } from 'vitest';
import {
  allowedNextStates,
  assertTransition,
  canTransition,
  isTerminalCallState,
} from '../src/modules/be2-calls/state-machine.js';
import { CallError } from '../src/modules/be2-calls/types.js';

describe('CallStateMachine', () => {
  it('allows RINGING → ACCEPTED / DECLINED / MISSED', () => {
    expect(canTransition('RINGING', 'ACCEPTED')).toBe(true);
    expect(canTransition('RINGING', 'DECLINED')).toBe(true);
    expect(canTransition('RINGING', 'MISSED')).toBe(true);
  });

  it('allows ACCEPTED → CONNECTING and CONNECTING → ACTIVE', () => {
    expect(canTransition('ACCEPTED', 'CONNECTING')).toBe(true);
    expect(canTransition('CONNECTING', 'ACTIVE')).toBe(true);
  });

  it('rejects DECLINED → ACTIVE and ENDED → ACTIVE', () => {
    expect(canTransition('DECLINED', 'ACTIVE')).toBe(false);
    expect(canTransition('ENDED', 'ACTIVE')).toBe(false);
    expect(() => assertTransition('DECLINED', 'ACTIVE')).toThrow(CallError);
    expect(() => assertTransition('ENDED', 'ACTIVE')).toThrow(CallError);
  });

  it('marks terminal states', () => {
    for (const state of ['DECLINED', 'MISSED', 'ENDED', 'FAILED'] as const) {
      expect(isTerminalCallState(state)).toBe(true);
      expect(allowedNextStates(state)).toEqual([]);
    }
  });
});
