import { describe, expect, it, vi } from 'vitest';
import {
  createBe1NotificationAuthPort,
  createBe1NotificationRecipientResolver,
} from '../../src/modules/be2-notifications/be1-bridge.js';
import { InMemoryUserDirectory } from '../../src/modules/be1-auth/user-directory.js';
import { InMemoryPersonAccountBindingStore } from '../../src/modules/be1-auth/identity-resolver.js';
import { InMemorySubjectRelationStore } from '../../src/modules/be1-auth/authorization.js';

const personId = '22222222-2222-4222-8222-222222222222';
const patientId = '44444444-4444-4444-8444-444444444444';
const staffId = '33333333-3333-4333-8333-333333333333';
const familyId = '55555555-5555-4555-8555-555555555555';

describe('Phase 2 ↔ Wave B BE1 bridges', () => {
  it('NotificationAuthPort uses Supabase JWT adapter outcomes', async () => {
    const users = new InMemoryUserDirectory();
    users.seed({
      user_id: patientId,
      email: 'p@example.com',
      role: 'patient',
      status: 'APPROVED',
    });
    const auth = createBe1NotificationAuthPort({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: patientId } }, error: null })),
      },
      users,
    });
    expect(await auth.authenticate(undefined)).toEqual({
      authenticated: false,
      reason: 'UNAUTHENTICATED',
    });
    const ok = await auth.authenticate('Bearer good');
    expect(ok).toEqual({
      authenticated: true,
      actor: { user_id: patientId, role: 'patient' },
    });
  });

  it('RecipientResolver uses Identity Resolver and AuthorizationPort-backed relations', async () => {
    const personAccounts = new InMemoryPersonAccountBindingStore();
    personAccounts.seed({
      person_id: personId,
      user_id: patientId,
      verified: true,
      status: 'ACTIVE',
    });
    const relations = new InMemorySubjectRelationStore();
    relations.seed({
      person_id: personId,
      user_id: staffId,
      kind: 'STAFF_ASSIGNMENT',
      status: 'APPROVED',
    });
    relations.seed({
      person_id: personId,
      user_id: familyId,
      kind: 'FAMILY_LINK',
      status: 'PENDING',
    });
    const users = new InMemoryUserDirectory();
    const resolver = createBe1NotificationRecipientResolver({
      personAccounts,
      relations,
      users,
    });

    const blockedFamily = await resolver.resolve(
      {
        event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        event_type: 'APPOINTMENT_REQUESTED',
        occurred_at: '2026-10-30T00:00:00.000Z',
        person_id: personId,
        resource_type: 'APPOINTMENT',
        resource_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        event_version: 1,
        metadata: {},
      },
      'appointment',
      { staff_user_id: staffId, family_user_ids: [familyId] },
    );
    expect(blockedFamily.outcome).toBe('resolved');
    if (blockedFamily.outcome !== 'resolved') return;
    expect(blockedFamily.recipients.map((r) => r.user_id).sort()).toEqual(
      [patientId, staffId].sort(),
    );
    expect(blockedFamily.recipients.some((r) => r.user_id === familyId)).toBe(false);
  });

  it('rejects forged patient_user_id that does not match Identity Resolver', async () => {
    const personAccounts = new InMemoryPersonAccountBindingStore();
    personAccounts.seed({
      person_id: personId,
      user_id: patientId,
      verified: true,
      status: 'ACTIVE',
    });
    const resolver = createBe1NotificationRecipientResolver({
      personAccounts,
      relations: new InMemorySubjectRelationStore(),
      users: new InMemoryUserDirectory(),
    });
    const forged = await resolver.resolve(
      {
        event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        event_type: 'APPOINTMENT_ACCEPTED',
        occurred_at: '2026-10-30T00:00:00.000Z',
        person_id: personId,
        resource_type: 'APPOINTMENT',
        resource_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        event_version: 1,
        metadata: {},
      },
      'appointment',
      { patient_user_id: staffId },
    );
    expect(forged).toEqual({
      outcome: 'blocked',
      reason: 'no_verified_recipients',
      recipients: [],
    });
  });
});
