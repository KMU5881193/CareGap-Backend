import {
  authenticateAuthorizationHeader,
  type SupabaseAuthClient,
} from '../be1-auth/supabase-jwt-auth.js';
import type { UserDirectory } from '../be1-auth/user-directory.js';
import {
  resolvePersonAccountBinding,
  resolveVerifiedUserForPerson,
  type PersonAccountBindingStore,
} from '../be1-auth/identity-resolver.js';
import {
  createRelationAuthorizationPort,
  type SubjectRelationStore,
} from '../be1-auth/authorization.js';
import type { NotificationAuthPort } from './auth-adapter.js';
import {
  NotificationRecipientResolver,
  type AdminRolePort,
  type FamilySharePort,
  type PersonUserLinkPort,
  type StaffAssignmentPort,
} from './recipient-resolver.js';
import type { NotificationCategory } from './types.js';

/**
 * Wires Phase 2 NotificationAuthPort to Wave B Supabase JWT auth adapter.
 * Does not invent synthetic sessions. Invalid/expired/unapproved → unauthenticated/forbidden mapped to auth failure.
 */
export function createBe1NotificationAuthPort(deps: {
  auth: SupabaseAuthClient;
  users: UserDirectory;
}): NotificationAuthPort {
  return {
    async authenticate(authorizationHeader) {
      const result = await authenticateAuthorizationHeader(authorizationHeader, deps);
      if (!result.ok) {
        return { authenticated: false, reason: result.body.error.code };
      }
      return { authenticated: true, actor: result.principal.actor };
    },
  };
}

/** Identity Resolver → PersonUserLinkPort. person_id is never treated as user_id. */
export function createBe1PersonUserLinkPort(store: PersonAccountBindingStore): PersonUserLinkPort {
  return {
    async resolveUserForPerson(personId) {
      const resolved = await resolveVerifiedUserForPerson(personId, store);
      if (!resolved.ok) {
        return { verified: false, reason: resolved.reason };
      }
      return { verified: true, user_id: resolved.binding.user_id };
    },
  };
}

/** AuthorizationPort / subject relations → staff assignment checks. */
export function createBe1StaffAssignmentPort(relations: SubjectRelationStore): StaffAssignmentPort {
  const authorization = createRelationAuthorizationPort(relations);
  return {
    async isAssignedStaff(staffUserId, personId) {
      try {
        const rows = await relations.listForActorPerson(staffUserId, personId);
        const approved = rows.some(
          (row) => row.kind === 'STAFF_ASSIGNMENT' && row.status === 'APPROVED',
        );
        if (!approved) {
          return { verified: false, reason: 'STAFF_ASSIGNMENT_NOT_APPROVED' };
        }
        const allowed = await authorization.canAccess(
          { user_id: staffUserId, role: 'staff' },
          personId,
          'read',
        );
        if (allowed !== true) {
          return { verified: true, allowed: false, reason: 'STAFF_ACCESS_DENIED' };
        }
        return { verified: true, allowed: true };
      } catch {
        return { verified: false, reason: 'STAFF_ASSIGNMENT_LOOKUP_FAILED' };
      }
    },
  };
}

/**
 * Family notifications require APPROVED FAMILY_LINK + AuthorizationPort read.
 * Category-specific share consent remains product-unset → still requires approved link;
 * write/analyze are never implied.
 */
export function createBe1FamilySharePort(relations: SubjectRelationStore): FamilySharePort {
  const authorization = createRelationAuthorizationPort(relations);
  return {
    async canReceiveFamilyNotification(input: {
      familyUserId: string;
      personId: string;
      category: NotificationCategory;
    }) {
      void input.category; // category allow-list is PROVISIONAL / unset — link gate only
      try {
        const rows = await relations.listForActorPerson(input.familyUserId, input.personId);
        const approved = rows.some(
          (row) => row.kind === 'FAMILY_LINK' && row.status === 'APPROVED',
        );
        if (!approved) {
          return { verified: false, reason: 'FAMILY_LINK_NOT_APPROVED' };
        }
        const allowed = await authorization.canAccess(
          { user_id: input.familyUserId, role: 'family' },
          input.personId,
          'read',
        );
        if (allowed !== true) {
          return { verified: true, allowed: false, reason: 'FAMILY_ACCESS_DENIED' };
        }
        return { verified: true, allowed: true };
      } catch {
        return { verified: false, reason: 'FAMILY_LINK_LOOKUP_FAILED' };
      }
    },
  };
}

/** Admin recipients: directory role admin + APPROVED only. Role alone is not record access. */
export function createBe1AdminRolePort(users: UserDirectory): AdminRolePort {
  return {
    async isApprovedAdmin(userId) {
      try {
        const user = await users.findByUserId(userId);
        if (!user) return { verified: false, reason: 'ADMIN_NOT_FOUND' };
        if (user.role !== 'admin' || user.status !== 'APPROVED') {
          return { verified: true, allowed: false, reason: 'ADMIN_NOT_APPROVED' };
        }
        return { verified: true, allowed: true };
      } catch {
        return { verified: false, reason: 'ADMIN_LOOKUP_FAILED' };
      }
    },
  };
}

export function createBe1NotificationRecipientResolver(deps: {
  personAccounts: PersonAccountBindingStore;
  relations: SubjectRelationStore;
  users: UserDirectory;
}): NotificationRecipientResolver {
  return new NotificationRecipientResolver(
    createBe1PersonUserLinkPort(deps.personAccounts),
    createBe1StaffAssignmentPort(deps.relations),
    createBe1FamilySharePort(deps.relations),
    createBe1AdminRolePort(deps.users),
  );
}

/** Re-validate an explicit patient_user_id against Identity Resolver. */
export async function assertPatientUserBinding(
  personId: string,
  patientUserId: string,
  store: PersonAccountBindingStore,
): Promise<boolean> {
  const resolved = await resolvePersonAccountBinding(personId, patientUserId, store);
  return resolved.ok;
}
