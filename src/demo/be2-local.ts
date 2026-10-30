import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import express, { Router, type Request, type Response } from 'express';
import { Pool } from 'pg';
import type { Actor } from '../shared/contracts.js';
import { createBe2Router } from '../modules/be2-consultations/http.js';

// Local demonstration only. These tokens are not BE1 sessions, and the allow-list is not a relationship check.
export const demoPersonId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const demoPastConsultationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const demoPastVersionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const demoPastText = '합성 기록: 지난 상담에서 서류 목록을 안내했습니다.';
export const demoAppointmentId = '50505050-5050-4505-8505-505050505050';
export const demoNotificationId = '22222222-2222-4222-8222-222222222222';
export const demoNotice = '후속 업무가 등록되었습니다.';

type DemoStatus = 'APPROVED' | 'PENDING' | 'REJECTED';

type DemoAccount = {
  token: string;
  user_id: string;
  role: Actor['role'];
  status: DemoStatus;
  email: string;
  name: string;
};

export const demoAccounts = {
  staff: account('demo-staff', '33333333-3333-4333-8333-333333333333', 'staff', 'APPROVED', 'be2-demo-staff@example.test', 'synthetic staff'),
  otherStaff: account('demo-other-staff', '44444444-4444-4444-8444-444444444444', 'staff', 'APPROVED', 'be2-demo-other@example.test', 'synthetic other staff'),
  family: account('demo-family', '55555555-5555-4555-8555-555555555555', 'family', 'APPROVED', 'be2-demo-family@example.test', 'synthetic family'),
  admin: account('demo-admin', '66666666-6666-4666-8666-666666666666', 'admin', 'APPROVED', 'be2-demo-admin@example.test', 'synthetic admin'),
  pending: account('demo-pending', '77777777-7777-4777-8777-777777777777', 'staff', 'PENDING', 'be2-demo-pending@example.test', 'synthetic pending'),
} as const;

const accounts = Object.values(demoAccounts);

function account(
  token: string,
  userId: string,
  role: Actor['role'],
  status: DemoStatus,
  email: string,
  name: string,
): DemoAccount {
  return { token, user_id: userId, role, status, email, name };
}

export function assertLocalDemo(env: NodeJS.ProcessEnv): { databaseUrl: string; port: number } {
  if (env.NODE_ENV === 'production') throw new Error('Local demo is forbidden in production');
  const databaseUrl = env.BE2_DEMO_DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) throw new Error('BE2_DEMO_DATABASE_URL is required');
  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new Error('BE2_DEMO_DATABASE_URL is invalid');
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
    throw new Error('Local demo database must use loopback');
  }
  if (target.pathname === '/caregap_local') throw new Error('Local demo must not use caregap_local');
  const portText = env.BE2_DEMO_PORT ?? '4010';
  if (!/^\d+$/.test(portText)) throw new Error('BE2_DEMO_PORT must be an integer from 1 to 65535');
  const port = Number(portText);
  if (port < 1 || port > 65535) throw new Error('BE2_DEMO_PORT must be an integer from 1 to 65535');
  return { databaseUrl, port };
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, token, extra] = header.split(' ');
  if (scheme !== 'Bearer' || token === undefined || token.length === 0 || extra !== undefined) return null;
  return token;
}

function lookup(req: Request): DemoAccount | null {
  const token = bearer(req);
  if (token === null) return null;
  return accounts.find((item) => item.token === token) ?? null;
}

function sendError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

function demoAuth(req: Request, res: Response, next: () => void) {
  if (req.headers.authorization === undefined) {
    sendError(res, 401, 'UNAUTHENTICATED', 'Authentication required');
    return;
  }
  const found = lookup(req);
  if (found === null) {
    sendError(res, 401, 'UNAUTHENTICATED', 'Invalid demo token');
    return;
  }
  if (found.status !== 'APPROVED') {
    sendError(res, 403, 'FORBIDDEN', 'Demo account is not approved');
    return;
  }
  next();
}

async function authenticate(req: Request): Promise<Actor | null> {
  const found = lookup(req);
  if (found === null || found.status !== 'APPROVED') return null;
  return { user_id: found.user_id, role: found.role };
}

export function createBe2DemoApp(pool: Pool) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.get('/health', (_req, res) => {
    res.json({ data: { status: 'ok', mode: 'local-demo' } });
  });
  const api = Router();
  api.use(demoAuth);
  api.use(createBe2Router({
    pool,
    authenticate,
    authorize: {
      async canAccess(actor, personId) {
        return actor.user_id.toLowerCase() === demoAccounts.staff.user_id
          && personId.toLowerCase() === demoPersonId;
      },
    },
    followUpPolicy: { source: 'optional', assignee: 'optional', due: 'optional' },
    followUpRules: [],
    appointmentRules: [],
    appointmentConflict: { occupyingStatuses: [], blockingRelations: [] },
    notificationPolicy: { event: 'optional', subject: 'optional', event_repeat: 'unset' },
  }));
  app.use('/api/be2', api);
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });
  app.use((error: unknown, _req: Request, res: Response, _next: () => void) => {
    const bad = error instanceof SyntaxError;
    res.status(bad ? 400 : 500).json({
      error: { code: bad ? 'INVALID_REQUEST' : 'INTERNAL_ERROR', message: bad ? 'Invalid JSON' : 'Internal error' },
    });
  });
  return app;
}

export async function ensureDemoSchema(pool: Pool): Promise<void> {
  const ready = await pool.query<{ name: string | null }>(`SELECT to_regclass('public.consultations') AS name`);
  if (ready.rows[0]?.name != null) return;
  const usersSql = execFileSync('git', ['show', 'main:migrations/0001_be1_create_users_table.sql'], { encoding: 'utf8' });
  const draftSql = readFileSync(new URL('../../migrations/drafts/0002_be2_consultations.sql', import.meta.url), 'utf8');
  await pool.query(usersSql);
  await pool.query(draftSql);
}

export async function resetDemoData(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE notifications, follow_up_tasks, consultation_record_versions, consultations, appointments`);
  for (const item of accounts) {
    await pool.query(
      `INSERT INTO users (user_id, email, password_hash, name, role, status)
       VALUES ($1, $2, 'not-a-secret', $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status`,
      [item.user_id, item.email, item.name, item.role, item.status],
    );
  }
  await pool.query(
    `INSERT INTO consultations (consultation_id, person_id) VALUES ($1, $2)`,
    [demoPastConsultationId, demoPersonId],
  );
  await pool.query(
    `INSERT INTO consultation_record_versions (record_version_id, consultation_id, person_id, text)
     VALUES ($1, $2, $3, $4)`,
    [demoPastVersionId, demoPastConsultationId, demoPersonId, demoPastText],
  );
  await pool.query(
    `INSERT INTO appointments (appointment_id, person_id, staff_user_id, requester_user_id, starts_at, ends_at, status)
     VALUES ($1, $2, $3, $4, '2026-11-02T01:00:00Z', '2026-11-02T02:00:00Z', 'fixture-held')`,
    [demoAppointmentId, demoPersonId, demoAccounts.staff.user_id, demoAccounts.otherStaff.user_id],
  );
  await pool.query(
    `INSERT INTO notifications (notification_id, recipient_user_id, kind, title, body)
     VALUES ($1, $2, 'follow_up', '후속 업무', $3)`,
    [demoNotificationId, demoAccounts.staff.user_id, demoNotice],
  );
}

export async function startLocalDemo(env: NodeJS.ProcessEnv): Promise<{ port: number; close(): Promise<void> }> {
  const settings = assertLocalDemo(env);
  const pool = new Pool({ connectionString: settings.databaseUrl });
  try {
    await ensureDemoSchema(pool);
    await resetDemoData(pool);
    const server: Server = createBe2DemoApp(pool).listen(settings.port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
    return {
      port: settings.port,
      async close() {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
