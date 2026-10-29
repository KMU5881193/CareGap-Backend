import { randomBytes, randomUUID } from 'node:crypto';

/** Opaque call id — not derived from user data. */
export function createCallId(): string {
  return randomUUID();
}

/** Unpredictable LiveKit room name — no PII. */
export function createRoomName(): string {
  return `cg_${randomBytes(18).toString('base64url')}`;
}

/** Opaque LiveKit participant identity — no email/phone/name. */
export function createMediaIdentity(role: 'caller' | 'callee'): string {
  return `${role}_${randomBytes(12).toString('base64url')}`;
}

export function createEventId(): string {
  return randomUUID();
}
