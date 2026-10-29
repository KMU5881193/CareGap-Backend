import type { Actor } from '../../shared/contracts.js';

/** BE1 wire/DB may use UPPERCASE; shared Actor uses lowercase. */
const ROLE_ALIASES: Record<string, Actor['role']> = {
  patient: 'patient',
  family: 'family',
  staff: 'staff',
  admin: 'admin',
  PATIENT: 'patient',
  FAMILY: 'family',
  STAFF: 'staff',
  ADMIN: 'admin',
};

export type CanonicalUserRole = Actor['role'];

export function normalizeUserRole(raw: unknown): CanonicalUserRole | null {
  if (typeof raw !== 'string') return null;
  return ROLE_ALIASES[raw] ?? null;
}
