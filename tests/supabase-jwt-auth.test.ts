import { describe, expect, it, vi } from 'vitest';
import {
  authenticateAccessToken,
  authenticateAuthorizationHeader,
  type SupabaseAuthClient,
} from '../src/modules/be1-auth/supabase-jwt-auth.js';
import { InMemoryUserDirectory, type DirectoryUser } from '../src/modules/be1-auth/user-directory.js';
import { normalizeUserRole } from '../src/modules/be1-auth/role.js';

const userId = '11111111-1111-4111-8111-111111111111';

function directory(overrides: Partial<DirectoryUser> = {}) {
  const users = new InMemoryUserDirectory();
  users.seed({
    user_id: userId,
    email: 'staff@example.com',
    role: 'staff',
    status: 'APPROVED',
    ...overrides,
  });
  return users;
}

function authOk(id = userId): SupabaseAuthClient & { getUser: ReturnType<typeof vi.fn> } {
  return {
    getUser: vi.fn(async () => ({ data: { user: { id } }, error: null })),
  };
}

describe('normalizeUserRole', () => {
  it('accepts BE1 uppercase and SQL lowercase', () => {
    expect(normalizeUserRole('PATIENT')).toBe('patient');
    expect(normalizeUserRole('staff')).toBe('staff');
    expect(normalizeUserRole('person')).toBeNull();
  });
});

describe('authenticateAccessToken', () => {
  it('rejects missing and invalid tokens', async () => {
    const auth = authOk();
    expect(await authenticateAccessToken(undefined, { auth, users: directory() })).toMatchObject({
      ok: false,
      httpStatus: 401,
      body: { error: { code: 'UNAUTHENTICATED' } },
    });
    auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'bad' },
    });
    expect(await authenticateAccessToken('expired', { auth, users: directory() })).toMatchObject({
      ok: false,
      httpStatus: 401,
      body: { error: { code: 'UNAUTHENTICATED' } },
    });
  });

  it('rejects unknown directory users', async () => {
    const result = await authenticateAccessToken('tok', {
      auth: authOk(),
      users: new InMemoryUserDirectory(),
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 404, body: { error: { code: 'NOT_FOUND' } } });
  });

  it('rejects PENDING and REJECTED accounts', async () => {
    for (const status of ['PENDING', 'REJECTED'] as const) {
      const result = await authenticateAccessToken('tok', {
        auth: authOk(),
        users: directory({ status }),
      });
      expect(result).toMatchObject({ ok: false, httpStatus: 403, body: { error: { code: 'FORBIDDEN' } } });
    }
  });

  it('returns approved actor with normalized role from UPPERCASE directory seed', async () => {
    const users = new InMemoryUserDirectory();
    users.seed({
      user_id: userId,
      email: 'p@example.com',
      role: normalizeUserRole('PATIENT')!,
      status: 'APPROVED',
    });
    const result = await authenticateAccessToken('tok', { auth: authOk(), users });
    expect(result).toEqual({
      ok: true,
      principal: {
        actor: { user_id: userId, role: 'patient' },
        status: 'APPROVED',
        email: 'p@example.com',
        auth_user_id: userId,
      },
    });
  });

  it('parses Bearer authorization headers', async () => {
    const result = await authenticateAuthorizationHeader('Bearer good-token', {
      auth: authOk(),
      users: directory(),
    });
    expect(result.ok).toBe(true);
    expect(await authenticateAuthorizationHeader('Token x', { auth: authOk(), users: directory() }))
      .toMatchObject({ ok: false, httpStatus: 401 });
  });

  it('treats auth.getUser exceptions as unauthenticated', async () => {
    const result = await authenticateAccessToken('tok', {
      auth: { getUser: async () => { throw new Error('network'); } },
      users: directory(),
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 401, body: { error: { code: 'UNAUTHENTICATED' } } });
  });
});
