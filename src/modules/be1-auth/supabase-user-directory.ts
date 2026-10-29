import { directoryRoleFromRaw } from './supabase-jwt-auth.js';
import type { DirectoryUser, UserAccountStatus, UserDirectory } from './user-directory.js';

/**
 * Narrow query port. Implementations may wrap Supabase PostgREST;
 * we avoid coupling to generated Database generics.
 */
export type UsersTableQuery = {
  findUserRow(userId: string): Promise<{
    user_id: string;
    email: string;
    role: string;
    status: string;
  } | null>;
};

const STATUSES = new Set<UserAccountStatus>(['PENDING', 'APPROVED', 'REJECTED']);

export class SupabaseUserDirectory implements UserDirectory {
  constructor(private readonly query: UsersTableQuery) {}

  async findByUserId(userId: string): Promise<DirectoryUser | null> {
    const data = await this.query.findUserRow(userId);
    if (!data) return null;

    const role = directoryRoleFromRaw(data.role);
    if (role === null) return null;
    if (!STATUSES.has(data.status as UserAccountStatus)) return null;

    return {
      user_id: data.user_id,
      email: data.email,
      role,
      status: data.status as UserAccountStatus,
    };
  }
}

/** Production helper around the shared Supabase JS client. */
export function createSupabaseUsersTableQuery(client: {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        single: () => PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
}): UsersTableQuery {
  return {
    async findUserRow(userId: string) {
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
}
