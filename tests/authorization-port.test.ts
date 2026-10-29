import { describe, expect, it } from 'vitest';
import {
  createBlockedAuthorizationPort,
  createRelationAuthorizationPort,
  InMemorySubjectRelationStore,
  isAppointmentAssignedStaff,
} from '../src/modules/be1-auth/authorization.js';
import type { Actor } from '../src/shared/contracts.js';

const personId = '22222222-2222-4222-8222-222222222222';
const staffId = '33333333-3333-4333-8333-333333333333';
const patientId = '44444444-4444-4444-8444-444444444444';
const familyId = '55555555-5555-4555-8555-555555555555';

const staff: Actor = { user_id: staffId, role: 'staff' };
const patient: Actor = { user_id: patientId, role: 'patient' };
const family: Actor = { user_id: familyId, role: 'family' };
const admin: Actor = { user_id: '66666666-6666-4666-8666-666666666666', role: 'admin' };

describe('createRelationAuthorizationPort', () => {
  it('never grants by role alone and blocked port stays false', async () => {
    const empty = createRelationAuthorizationPort(new InMemorySubjectRelationStore());
    expect(await empty.canAccess(staff, personId, 'read')).toBe(false);
    expect(await empty.canAccess(admin, personId, 'analyze')).toBe(false);
    expect(await createBlockedAuthorizationPort().canAccess(staff, personId, 'read')).toBe(false);
  });

  it('rejects PENDING and REVOKED staff assignments', async () => {
    const store = new InMemorySubjectRelationStore();
    store.seed({ person_id: personId, user_id: staffId, kind: 'STAFF_ASSIGNMENT', status: 'PENDING' });
    const port = createRelationAuthorizationPort(store);
    expect(await port.canAccess(staff, personId, 'write')).toBe(false);
    store.seed({ person_id: personId, user_id: staffId, kind: 'STAFF_ASSIGNMENT', status: 'REVOKED' });
    expect(await port.canAccess(staff, personId, 'write')).toBe(false);
  });

  it('allows APPROVED staff assignment for write/analyze', async () => {
    const store = new InMemorySubjectRelationStore();
    store.seed({ person_id: personId, user_id: staffId, kind: 'STAFF_ASSIGNMENT', status: 'APPROVED' });
    const port = createRelationAuthorizationPort(store);
    expect(await port.canAccess(staff, personId, 'write')).toBe(true);
    expect(await port.canAccess(staff, personId, 'analyze')).toBe(true);
  });

  it('allows APPROVED self and family for read only', async () => {
    const store = new InMemorySubjectRelationStore();
    store.seed({ person_id: personId, user_id: patientId, kind: 'SELF_ACCOUNT', status: 'APPROVED' });
    store.seed({ person_id: personId, user_id: familyId, kind: 'FAMILY_LINK', status: 'APPROVED' });
    const port = createRelationAuthorizationPort(store);
    expect(await port.canAccess(patient, personId, 'read')).toBe(true);
    expect(await port.canAccess(patient, personId, 'write')).toBe(false);
    expect(await port.canAccess(family, personId, 'read')).toBe(true);
    expect(await port.canAccess(family, personId, 'analyze')).toBe(false);
  });

  it('rejects unverified family (no APPROVED FAMILY_LINK)', async () => {
    const store = new InMemorySubjectRelationStore();
    store.seed({ person_id: personId, user_id: familyId, kind: 'FAMILY_LINK', status: 'PENDING' });
    expect(await createRelationAuthorizationPort(store).canAccess(family, personId, 'read')).toBe(false);
  });
});

describe('isAppointmentAssignedStaff', () => {
  it('requires staff_user_id match and rejects person_id confusion', () => {
    expect(isAppointmentAssignedStaff(staff, { staff_user_id: staffId, person_id: personId })).toBe(true);
    expect(isAppointmentAssignedStaff(staff, { staff_user_id: patientId, person_id: personId })).toBe(false);
    expect(isAppointmentAssignedStaff(staff, { staff_user_id: staffId, person_id: staffId })).toBe(false);
    expect(isAppointmentAssignedStaff(patient, { staff_user_id: patientId, person_id: personId })).toBe(false);
  });
});
