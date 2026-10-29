import type { Actor, AuthorizationPort } from '../../shared/contracts.js';

/**
 * Relationship kinds owned conceptually by BE1.
 * Distinct from appointment staff_user_id assignment (BE2 snapshot).
 */
export type RelationKind = 'STAFF_ASSIGNMENT' | 'FAMILY_LINK' | 'SELF_ACCOUNT';

export type RelationStatus = 'PENDING' | 'APPROVED' | 'REVOKED';

export type SubjectRelation = {
  person_id: string;
  user_id: string;
  kind: RelationKind;
  status: RelationStatus;
};

export interface SubjectRelationStore {
  listForActorPerson(actorUserId: string, personId: string): Promise<SubjectRelation[]>;
}

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Real AuthorizationPort: role alone never grants access.
 * - APPROVED STAFF_ASSIGNMENT → read | write | analyze
 * - APPROVED SELF_ACCOUNT → read only (patient subject account)
 * - APPROVED FAMILY_LINK → read only (write/analyze denied until product policy)
 * - PENDING / REVOKED → deny
 * - admin without an approved relation → deny
 * - Exceptions and non-true returns → deny (caller treats !== true as deny)
 */
export function createRelationAuthorizationPort(store: SubjectRelationStore): AuthorizationPort {
  return {
    async canAccess(actor: Actor, personId: string, action: 'read' | 'write' | 'analyze'): Promise<boolean> {
      try {
        const relations = await store.listForActorPerson(actor.user_id, personId);
        const approved = relations.filter(
          (r) => r.status === 'APPROVED'
            && sameUuid(r.user_id, actor.user_id)
            && sameUuid(r.person_id, personId),
        );
        if (approved.length === 0) return false;

        if (approved.some((r) => r.kind === 'STAFF_ASSIGNMENT')) {
          return actor.role === 'staff' || actor.role === 'admin';
        }

        if (action !== 'read') return false;

        if (approved.some((r) => r.kind === 'SELF_ACCOUNT')) {
          return actor.role === 'patient';
        }

        if (approved.some((r) => r.kind === 'FAMILY_LINK')) {
          return actor.role === 'family';
        }

        return false;
      } catch {
        return false;
      }
    },
  };
}

/** Appointment staff match — separate from subject relations. */
export function isAppointmentAssignedStaff(
  actor: Actor,
  appointment: { staff_user_id: string; person_id: string },
): boolean {
  if (actor.role !== 'staff' && actor.role !== 'admin') return false;
  if (!sameUuid(actor.user_id, appointment.staff_user_id)) return false;
  // person_id must never be treated as the staff user id.
  if (sameUuid(actor.user_id, appointment.person_id)) return false;
  return true;
}

export class InMemorySubjectRelationStore implements SubjectRelationStore {
  readonly #rows: SubjectRelation[] = [];

  seed(relation: SubjectRelation): void {
    this.#rows.push(relation);
  }

  async listForActorPerson(actorUserId: string, personId: string): Promise<SubjectRelation[]> {
    return this.#rows.filter(
      (r) => sameUuid(r.user_id, actorUserId) && sameUuid(r.person_id, personId),
    );
  }
}

/**
 * Fail-closed port when BE1 relation persistence is unavailable.
 * Never returns true. Do not use synthetic always-true adapters in production.
 */
export function createBlockedAuthorizationPort(): AuthorizationPort {
  return {
    async canAccess(): Promise<boolean> {
      return false;
    },
  };
}
