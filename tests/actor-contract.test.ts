import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  Actor,
  type AuthorizationPort,
  type RecordReader,
  type RecordVersion,
} from '../src/shared/contracts.js';

const userId = '11111111-1111-4111-8111-111111111111';
const consultationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const versionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const subjectId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('shared actor role contract', () => {
  it('parses a patient actor', () => {
    expect(Actor.parse({ user_id: userId, role: 'patient' })).toEqual({
      user_id: userId,
      role: 'patient',
    });
  });

  it('parses a family actor', () => {
    expect(Actor.parse({ user_id: userId, role: 'family' })).toEqual({
      user_id: userId,
      role: 'family',
    });
  });

  it('parses a staff actor', () => {
    expect(Actor.parse({ user_id: userId, role: 'staff' })).toEqual({
      user_id: userId,
      role: 'staff',
    });
  });

  it('parses an admin actor', () => {
    expect(Actor.parse({ user_id: userId, role: 'admin' })).toEqual({
      user_id: userId,
      role: 'admin',
    });
  });

  it('rejects the retired person role', () => {
    expect(() => Actor.parse({ user_id: userId, role: 'person' })).toThrow(ZodError);
  });

  it('rejects an unknown role', () => {
    expect(() => Actor.parse({ user_id: userId, role: 'counselor' })).toThrow(ZodError);
    expect(() => Actor.parse({ user_id: userId, role: 'Patient' })).toThrow(ZodError);
  });

  it('rejects a user id that is not a uuid', () => {
    expect(() => Actor.parse({ user_id: 'user-1', role: 'patient' })).toThrow(ZodError);
  });

  it('preserves the actor user id spelling', () => {
    const parsed = Actor.parse({ user_id: userId.toUpperCase(), role: 'patient' });
    expect(parsed.user_id).toBe(userId.toUpperCase());
    expect(parsed.role).toBe('patient');
    expect(parsed).not.toHaveProperty('person_id');
    expect(parsed).not.toHaveProperty('allowed');
  });

  it('keeps AuthorizationPort from treating a role as access', async () => {
    const seen: Array<Actor['role']> = [];
    const port: AuthorizationPort = {
      async canAccess(actor, personId, action) {
        seen.push(actor.role);
        expect(actor.user_id).toBe(userId);
        expect(personId).toBe(subjectId);
        expect(action).toBe('read');
        return false;
      },
    };
    const patient = Actor.parse({ user_id: userId, role: 'patient' });
    const staff = Actor.parse({ user_id: userId, role: 'staff' });
    const admin = Actor.parse({ user_id: userId, role: 'admin' });
    expect(await port.canAccess(patient, subjectId, 'read')).toBe(false);
    expect(await port.canAccess(staff, subjectId, 'read')).toBe(false);
    expect(await port.canAccess(admin, subjectId, 'read')).toBe(false);
    expect(seen).toEqual(['patient', 'staff', 'admin']);
  });

  it('keeps person_id on a consultation record', async () => {
    const version: RecordVersion = {
      consultation_id: consultationId,
      record_version_id: versionId,
      person_id: subjectId,
      text: '합성 기록',
    };
    const reader: RecordReader = {
      async getVersion(consultation, recordVersion) {
        expect(consultation).toBe(consultationId);
        expect(recordVersion).toBe(versionId);
        return version;
      },
    };
    const found = await reader.getVersion(consultationId, versionId);
    expect(found?.person_id).toBe(subjectId);
    expect(found).not.toHaveProperty('role');
  });
});
