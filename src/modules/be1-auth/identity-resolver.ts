import type { PersonAccountBinding } from '../be2-consultations/call-eligibility.js';

/**
 * BE1-owned person ↔ user account link.
 * person_id is the care subject; user_id is the login account. They must differ.
 *
 * No Prisma / SQL persistence for this model exists in the current repository.
 * Production must inject a BE1-backed store. Until then use fail-closed or test doubles.
 */
export type PersonAccountLinkRecord = {
  person_id: string;
  user_id: string;
  /** Server-side verification flag from BE1; never inferred from UUID equality. */
  verified: boolean;
  status: 'ACTIVE' | 'REVOKED';
};

export type IdentityResolveDenial =
  | 'NO_BINDING'
  | 'UNVERIFIED'
  | 'REVOKED'
  | 'PERSON_USER_COLLISION'
  | 'PERSON_MISMATCH'
  | 'USER_MISMATCH';

export type IdentityResolveResult =
  | { ok: true; binding: PersonAccountBinding }
  | { ok: false; reason: IdentityResolveDenial };

export interface PersonAccountBindingStore {
  /**
   * Returns the link for this person+user pair if present.
   * Implementations must not invent a binding from equal UUIDs.
   */
  findLink(personId: string, userId: string): Promise<PersonAccountLinkRecord | null>;
  /**
   * Active verified links for a care subject. Empty / multiple → caller fail-closes
   * until BE1 plural-account policy is decided.
   */
  listActiveVerifiedByPerson(personId: string): Promise<PersonAccountLinkRecord[]>;
}

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function toVerifiedBinding(link: PersonAccountLinkRecord): PersonAccountBinding | null {
  if (!link.verified) return null;
  if (link.status !== 'ACTIVE') return null;
  if (sameUuid(link.person_id, link.user_id)) return null;
  return {
    person_id: link.person_id,
    user_id: link.user_id,
    verified: true,
  };
}

/**
 * Resolves a verified person_id → user_id binding for the authenticated user.
 * Missing, unverified, revoked, or person_id===user_id links DENY.
 */
export async function resolvePersonAccountBinding(
  personId: string,
  userId: string,
  store: PersonAccountBindingStore,
): Promise<IdentityResolveResult> {
  if (sameUuid(personId, userId)) {
    return { ok: false, reason: 'PERSON_USER_COLLISION' };
  }

  let link: PersonAccountLinkRecord | null;
  try {
    link = await store.findLink(personId, userId);
  } catch {
    return { ok: false, reason: 'NO_BINDING' };
  }

  if (!link) return { ok: false, reason: 'NO_BINDING' };
  if (!sameUuid(link.person_id, personId)) return { ok: false, reason: 'PERSON_MISMATCH' };
  if (!sameUuid(link.user_id, userId)) return { ok: false, reason: 'USER_MISMATCH' };
  if (sameUuid(link.person_id, link.user_id)) return { ok: false, reason: 'PERSON_USER_COLLISION' };
  if (link.status === 'REVOKED') return { ok: false, reason: 'REVOKED' };
  if (!link.verified || link.status !== 'ACTIVE') return { ok: false, reason: 'UNVERIFIED' };

  const binding = toVerifiedBinding(link);
  if (!binding) return { ok: false, reason: 'UNVERIFIED' };
  return { ok: true, binding };
}

/** Test / provisional store. Not a production BE1 persistence model. */
export class InMemoryPersonAccountBindingStore implements PersonAccountBindingStore {
  readonly #links = new Map<string, PersonAccountLinkRecord>();

  static key(personId: string, userId: string): string {
    return `${personId.toLowerCase()}::${userId.toLowerCase()}`;
  }

  seed(link: PersonAccountLinkRecord): void {
    this.#links.set(InMemoryPersonAccountBindingStore.key(link.person_id, link.user_id), link);
  }

  async findLink(personId: string, userId: string): Promise<PersonAccountLinkRecord | null> {
    return this.#links.get(InMemoryPersonAccountBindingStore.key(personId, userId)) ?? null;
  }

  async listActiveVerifiedByPerson(personId: string): Promise<PersonAccountLinkRecord[]> {
    return [...this.#links.values()].filter(
      (link) => sameUuid(link.person_id, personId)
        && link.verified
        && link.status === 'ACTIVE'
        && !sameUuid(link.person_id, link.user_id),
    );
  }
}

/**
 * Fail-closed store used when BE1 person↔user persistence is not available.
 * Always returns null → Identity Resolver DENY.
 */
export class BlockedPersonAccountBindingStore implements PersonAccountBindingStore {
  readonly reason = 'BE1_PERSON_ACCOUNT_BINDING_UNAVAILABLE' as const;

  async findLink(_personId: string, _userId: string): Promise<PersonAccountLinkRecord | null> {
    return null;
  }

  async listActiveVerifiedByPerson(_personId: string): Promise<PersonAccountLinkRecord[]> {
    return [];
  }
}

/**
 * person_id → single verified user_id for notification recipients.
 * Zero or multiple ACTIVE verified links DENY (plural policy unset).
 */
export async function resolveVerifiedUserForPerson(
  personId: string,
  store: PersonAccountBindingStore,
): Promise<IdentityResolveResult> {
  let links: PersonAccountLinkRecord[];
  try {
    links = await store.listActiveVerifiedByPerson(personId);
  } catch {
    return { ok: false, reason: 'NO_BINDING' };
  }
  if (links.length === 0) return { ok: false, reason: 'NO_BINDING' };
  if (links.length > 1) return { ok: false, reason: 'NO_BINDING' };
  const link = links[0]!;
  return resolvePersonAccountBinding(link.person_id, link.user_id, store);
}
