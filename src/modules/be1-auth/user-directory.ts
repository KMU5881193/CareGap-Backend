import type { CanonicalUserRole } from './role.js';

export type UserAccountStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type DirectoryUser = {
  user_id: string;
  email: string;
  role: CanonicalUserRole;
  status: UserAccountStatus;
};

/**
 * Persistence port for CareGap users.
 * BE1 owns the model. No Prisma schema is present in this repository;
 * callers inject a real adapter or an in-memory test double.
 */
export interface UserDirectory {
  findByUserId(userId: string): Promise<DirectoryUser | null>;
}

export class InMemoryUserDirectory implements UserDirectory {
  readonly #users = new Map<string, DirectoryUser>();

  seed(user: DirectoryUser): void {
    this.#users.set(user.user_id.toLowerCase(), user);
  }

  async findByUserId(userId: string): Promise<DirectoryUser | null> {
    return this.#users.get(userId.toLowerCase()) ?? null;
  }
}
