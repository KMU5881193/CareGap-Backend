import type { Actor } from '../../shared/contracts.js';
import { errorEnvelope, type ErrorEnvelope } from '../../shared/error-envelope.js';
import { normalizeUserRole } from './role.js';
import type { DirectoryUser, UserDirectory } from './user-directory.js';

export type AuthenticatedPrincipal = {
  actor: Actor;
  status: 'APPROVED';
  email: string;
  /** Supabase Auth subject; equals CareGap user_id when directories are linked 1:1. */
  auth_user_id: string;
};

export type AuthFailure = {
  ok: false;
  httpStatus: 401 | 403 | 404 | 500;
  body: ErrorEnvelope;
};

export type AuthSuccess = {
  ok: true;
  principal: AuthenticatedPrincipal;
};

export type AuthResult = AuthSuccess | AuthFailure;

/**
 * Minimal surface of supabase.auth used by the adapter.
 * Injected so tests do not need a live Supabase project.
 */
export interface SupabaseAuthClient {
  getUser(accessToken: string): Promise<{
    data: { user: { id: string } | null };
    error: { message?: string } | null | undefined;
  }>;
}

function fail(httpStatus: AuthFailure['httpStatus'], code: string, message: string): AuthFailure {
  return { ok: false, httpStatus, body: errorEnvelope(code, message) };
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (authorizationHeader === undefined || authorizationHeader.length === 0) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim());
  return match?.[1] ?? null;
}

/**
 * Verifies a Supabase access token via auth.getUser(accessToken),
 * loads the CareGap user row, normalizes role, and requires APPROVED status.
 * Synthetic session tokens must not be passed here for production auth.
 */
export async function authenticateAccessToken(
  accessToken: string | undefined | null,
  deps: { auth: SupabaseAuthClient; users: UserDirectory },
): Promise<AuthResult> {
  if (accessToken === undefined || accessToken === null || accessToken.length === 0) {
    return fail(401, 'UNAUTHENTICATED', 'Authentication token is required');
  }

  let authUserId: string;
  try {
    const { data, error } = await deps.auth.getUser(accessToken);
    if (error || !data.user?.id) {
      return fail(401, 'UNAUTHENTICATED', 'Invalid or expired token');
    }
    authUserId = data.user.id;
  } catch {
    return fail(401, 'UNAUTHENTICATED', 'Invalid or expired token');
  }

  let directoryUser: DirectoryUser | null;
  try {
    directoryUser = await deps.users.findByUserId(authUserId);
  } catch {
    return fail(500, 'INTERNAL_ERROR', 'Failed to load user account');
  }

  if (!directoryUser) {
    return fail(404, 'NOT_FOUND', 'User account was not found');
  }

  // Defense in depth if a directory returns unnormalized role strings.
  const role = normalizeUserRole(directoryUser.role);
  if (role === null) {
    return fail(403, 'FORBIDDEN', 'User role is not recognized');
  }

  if (directoryUser.status !== 'APPROVED') {
    return fail(403, 'FORBIDDEN', 'Account is not approved');
  }

  if (directoryUser.user_id.toLowerCase() !== authUserId.toLowerCase()) {
    return fail(403, 'FORBIDDEN', 'Auth subject does not match directory user');
  }

  return {
    ok: true,
    principal: {
      actor: { user_id: directoryUser.user_id, role },
      status: 'APPROVED',
      email: directoryUser.email,
      auth_user_id: authUserId,
    },
  };
}

export async function authenticateAuthorizationHeader(
  authorizationHeader: string | undefined,
  deps: { auth: SupabaseAuthClient; users: UserDirectory },
): Promise<AuthResult> {
  const token = extractBearerToken(authorizationHeader);
  if (token === null) {
    return fail(401, 'UNAUTHENTICATED', 'Authentication token is required');
  }
  return authenticateAccessToken(token, deps);
}

/** Maps a raw DB role string into DirectoryUser.role or null (reject). */
export function directoryRoleFromRaw(raw: unknown): DirectoryUser['role'] | null {
  return normalizeUserRole(raw);
}
