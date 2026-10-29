import type { Actor } from '../../shared/contracts.js';

export type TransitionRule = {
  from: string;
  action: string;
  to: string;
  actors: readonly Actor['role'][];
};

export type AppointmentSnapshot = {
  status: string;
  starts_at: string;
  ends_at: string;
};

export type TransitionResult =
  | { ok: true; status: string }
  | { ok: false; reason: 'illegal_transition' | 'actor_not_allowed' };

// Interprets caller-supplied rules only. A matching role is not proof of ownership,
// family linkage, staff approval, or assignment. This function does not change times.
export function applyTransition(
  appointment: AppointmentSnapshot,
  action: string,
  actorRole: Actor['role'],
  rules: readonly TransitionRule[],
): TransitionResult {
  const applicable = rules.filter((rule) => rule.from === appointment.status && rule.action === action);
  if (applicable.length === 0) return { ok: false, reason: 'illegal_transition' };
  const allowed = applicable.filter((rule) => rule.actors.includes(actorRole));
  if (allowed.length === 0) return { ok: false, reason: 'actor_not_allowed' };
  const status = allowed[0].to;
  if (allowed.some((rule) => rule.to !== status)) return { ok: false, reason: 'illegal_transition' };
  return { ok: true, status };
}
