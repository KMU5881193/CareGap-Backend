import { CallError, TERMINAL_CALL_STATES, type CallState } from './types.js';

/**
 * Allowed transitions for the Phase 3 call prototype.
 * ACTIVE is only reachable via CONNECTING after media readiness is confirmed by the service.
 */
const ALLOWED: Readonly<Record<CallState, readonly CallState[]>> = {
  IDLE: ['RINGING', 'FAILED'],
  RINGING: ['ACCEPTED', 'DECLINED', 'MISSED', 'ENDED', 'FAILED'],
  ACCEPTED: ['CONNECTING', 'ENDED', 'FAILED'],
  CONNECTING: ['ACTIVE', 'ENDED', 'FAILED'],
  ACTIVE: ['ENDED', 'FAILED'],
  DECLINED: [],
  MISSED: [],
  ENDED: [],
  FAILED: [],
};

export function isTerminalCallState(state: CallState): boolean {
  return (TERMINAL_CALL_STATES as readonly string[]).includes(state);
}

export function canTransition(from: CallState, to: CallState): boolean {
  if (from === to && isTerminalCallState(from)) return true; // idempotent terminal no-op
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: CallState, to: CallState): void {
  if (from === to && isTerminalCallState(from)) return;
  if (!canTransition(from, to)) {
    throw new CallError(
      'INVALID_TRANSITION',
      `Invalid call state transition: ${from} → ${to}`,
      409,
    );
  }
}

export function allowedNextStates(from: CallState): readonly CallState[] {
  return ALLOWED[from];
}
