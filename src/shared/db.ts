import pg from 'pg';

/**
 * Narrow query port used by PostgreSQL repositories.
 * Prefer injecting this over Pool in domain code for testability.
 */
export interface Db {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<pg.QueryResult<Row>>;
}

export type CreatePoolOptions = {
  connectionString: string;
  /**
   * When true, allow non-loopback hosts. Default false — shared/ops DBs are forbidden
   * for agent-driven migrate/runtime wiring in this repository.
   */
  allowNonLoopback?: boolean;
};

/**
 * Creates a pg Pool only for loopback `caregap_local` unless explicitly overridden.
 * Does not run migrations and does not reset data.
 */
export function createAppPool(options: CreatePoolOptions): pg.Pool {
  const target = new URL(options.connectionString);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  if (!options.allowNonLoopback) {
    if (!loopback) {
      throw new Error('DATABASE_HOST_FORBIDDEN: only loopback hosts are permitted by default');
    }
    if (target.pathname !== '/caregap_local') {
      throw new Error('DATABASE_NAME_FORBIDDEN: only /caregap_local is permitted by default');
    }
  }
  return new pg.Pool({ connectionString: options.connectionString });
}

export async function withTransaction<T>(pool: pg.Pool, run: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await run(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function instant(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}
