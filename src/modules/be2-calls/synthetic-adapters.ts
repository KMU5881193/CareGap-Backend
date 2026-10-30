import type { CallAuthorizationPort, CallIdentityPort } from './ports.js';
import type { CallSession } from './types.js';

/** Demo-only synthetic participants. Never treat as real BE1 accounts. */
export const DEMO_STAFF_ID = 'demo-staff';
export const DEMO_PATIENT_ID = 'demo-patient';
export const DEMO_PARTICIPANTS = [DEMO_STAFF_ID, DEMO_PATIENT_ID] as const;

/**
 * Test/demo identity adapter. Production call path must use BE1 IdentityResolver.
 * Must not be wired into the production `src/app.ts` call surface (there is none yet).
 */
export class SyntheticCallIdentityAdapter implements CallIdentityPort {
  readonly #known: ReadonlySet<string>;

  constructor(known: readonly string[] = DEMO_PARTICIPANTS) {
    this.#known = new Set(known);
  }

  async resolveParticipant(participantId: string): Promise<{ participant_id: string; display_role: string } | null> {
    if (!this.#known.has(participantId)) return null;
    return {
      participant_id: participantId,
      display_role: participantId === DEMO_STAFF_ID ? 'staff' : 'patient',
    };
  }
}

/**
 * Test/demo authorization: only the two demo participants may call each other.
 * Explicitly fails closed for any other pair. Never use as production AuthorizationPort.
 */
export class SyntheticCallAuthorizationAdapter implements CallAuthorizationPort {
  readonly #allowed: ReadonlySet<string>;

  constructor(allowed: readonly string[] = DEMO_PARTICIPANTS) {
    this.#allowed = new Set(allowed);
  }

  #isDemoPair(a: string, b: string): boolean {
    return this.#allowed.has(a) && this.#allowed.has(b) && a !== b;
  }

  #isParticipant(actorId: string, session: CallSession): boolean {
    return actorId === session.caller.participant_id || actorId === session.callee.participant_id;
  }

  async canCreateCall(callerId: string, calleeId: string): Promise<boolean> {
    return this.#isDemoPair(callerId, calleeId);
  }

  async canAccept(calleeId: string, session: CallSession): Promise<boolean> {
    return calleeId === session.callee.participant_id && this.#allowed.has(calleeId);
  }

  async canDecline(calleeId: string, session: CallSession): Promise<boolean> {
    return calleeId === session.callee.participant_id && this.#allowed.has(calleeId);
  }

  async canEnd(actorId: string, session: CallSession): Promise<boolean> {
    return this.#isParticipant(actorId, session) && this.#allowed.has(actorId);
  }

  async canRequestJoinToken(actorId: string, session: CallSession): Promise<boolean> {
    return this.#isParticipant(actorId, session) && this.#allowed.has(actorId);
  }
}

/**
 * Production-shaped fail-closed authorization until BE1 relations exist.
 * Always denies — keeps operational call APIs closed.
 */
export class DenyAllCallAuthorizationAdapter implements CallAuthorizationPort {
  async canCreateCall(): Promise<boolean> {
    return false;
  }
  async canAccept(): Promise<boolean> {
    return false;
  }
  async canDecline(): Promise<boolean> {
    return false;
  }
  async canEnd(): Promise<boolean> {
    return false;
  }
  async canRequestJoinToken(): Promise<boolean> {
    return false;
  }
}
