import { describe, expect, it } from 'vitest';
import {
  BlockedPersonAccountBindingStore,
  InMemoryPersonAccountBindingStore,
  resolvePersonAccountBinding,
} from '../src/modules/be1-auth/identity-resolver.js';

const personId = '22222222-2222-4222-8222-222222222222';
const userId = '44444444-4444-4444-8444-444444444444';

describe('resolvePersonAccountBinding', () => {
  it('denies when person_id equals user_id', async () => {
    const store = new InMemoryPersonAccountBindingStore();
    expect(await resolvePersonAccountBinding(personId, personId, store)).toEqual({
      ok: false,
      reason: 'PERSON_USER_COLLISION',
    });
  });

  it('denies missing bindings and blocked production store', async () => {
    const empty = new InMemoryPersonAccountBindingStore();
    expect(await resolvePersonAccountBinding(personId, userId, empty)).toEqual({
      ok: false,
      reason: 'NO_BINDING',
    });
    expect(await resolvePersonAccountBinding(personId, userId, new BlockedPersonAccountBindingStore()))
      .toEqual({ ok: false, reason: 'NO_BINDING' });
  });

  it('denies unverified and revoked links', async () => {
    const store = new InMemoryPersonAccountBindingStore();
    store.seed({ person_id: personId, user_id: userId, verified: false, status: 'ACTIVE' });
    expect(await resolvePersonAccountBinding(personId, userId, store)).toEqual({
      ok: false,
      reason: 'UNVERIFIED',
    });
    store.seed({ person_id: personId, user_id: userId, verified: true, status: 'REVOKED' });
    expect(await resolvePersonAccountBinding(personId, userId, store)).toEqual({
      ok: false,
      reason: 'REVOKED',
    });
  });

  it('returns verified binding when ACTIVE and ids differ', async () => {
    const store = new InMemoryPersonAccountBindingStore();
    store.seed({ person_id: personId, user_id: userId, verified: true, status: 'ACTIVE' });
    expect(await resolvePersonAccountBinding(personId, userId, store)).toEqual({
      ok: true,
      binding: { person_id: personId, user_id: userId, verified: true },
    });
  });
});
