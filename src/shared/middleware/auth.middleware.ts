import { Request, Response, NextFunction } from 'express';
import { supabase } from '../supabase.js';
import {
  authenticateAuthorizationHeader,
  type AuthenticatedPrincipal,
  type SupabaseAuthClient,
} from '../../modules/be1-auth/supabase-jwt-auth.js';
import {
  SupabaseUserDirectory,
  type UsersTableQuery,
} from '../../modules/be1-auth/supabase-user-directory.js';

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedPrincipal;
}

const usersQuery: UsersTableQuery = {
  async findUserRow(userId) {
    // Cast at the boundary to avoid Supabase generic instantiation depth errors.
    const client = supabase as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          eq: (column: string, value: string) => {
            single: () => PromiseLike<{ data: unknown; error: unknown }>;
          };
        };
      };
    };
    const { data, error } = await client
      .from('users')
      .select('user_id, email, role, status')
      .eq('user_id', userId)
      .single();
    if (error || !data || typeof data !== 'object') return null;
    const row = data as Record<string, unknown>;
    if (
      typeof row.user_id !== 'string'
      || typeof row.email !== 'string'
      || typeof row.role !== 'string'
      || typeof row.status !== 'string'
    ) {
      return null;
    }
    return {
      user_id: row.user_id,
      email: row.email,
      role: row.role,
      status: row.status,
    };
  },
};

const users = new SupabaseUserDirectory(usersQuery);
const authClient: SupabaseAuthClient = {
  async getUser(accessToken) {
    const result = await supabase.auth.getUser(accessToken);
    return {
      data: { user: result.data.user ? { id: result.data.user.id } : null },
      error: result.error,
    };
  },
};

/**
 * Supabase JWT authentication middleware.
 * Uses auth.getUser(accessToken), directory lookup, role normalize, APPROVED gate.
 * Error body is always `{ error: { code, message } }`.
 *
 * Do not treat this as AuthorizationPort. Do not mount protected operational
 * call APIs until BE1 relation/identity persistence is available.
 */
export const authenticateUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const result = await authenticateAuthorizationHeader(req.headers.authorization, {
    auth: authClient,
    users,
  });
  if (!result.ok) {
    res.status(result.httpStatus).json(result.body);
    return;
  }
  req.user = result.principal;
  next();
};

export const requireApprovedUser = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.user) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    return;
  }
  if (req.user.status !== 'APPROVED') {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Account is not approved' } });
    return;
  }
  next();
};

export const requireRole = (allowedRoles: Array<'patient' | 'family' | 'staff' | 'admin'>) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      return;
    }
    if (!allowedRoles.includes(req.user.actor.role)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient role' } });
      return;
    }
    next();
  };
};
