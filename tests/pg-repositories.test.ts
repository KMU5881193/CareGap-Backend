import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/shared/db.js';
import { PgAppointmentSnapshotRepository } from '../src/modules/be2-consultations/pg-appointment-snapshot.js';
import { PgNotificationOutboxRepository } from '../src/modules/be2-notifications/pg-outbox.js';
import { createNotificationWorkerLifecycle } from '../src/modules/be2-notifications/worker-lifecycle.js';
import { MemoryNotificationOutboxRepository } from '../src/modules/be2-notifications/outbox.js';
import { MemoryDeviceRegistrationRepository } from '../src/modules/be2-notifications/devices.js';
import { MemoryNotificationPreferenceRepository } from '../src/modules/be2-notifications/preferences.js';
import { InAppNotificationStore } from '../src/modules/be2-notifications/in-app-store.js';
import { MockPushProvider } from '../src/modules/be2-notifications/mock-push-provider.js';
import { systemClock } from '../src/modules/be2-notifications/clock.js';
import { createAppPool } from '../src/shared/db.js';

function mockDb(handler: (sql: string, params?: readonly unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>): Db {
  return {
    query: vi.fn(async (sql: string, params?: readonly unknown[]) => handler(sql, params)) as unknown as Db['query'],
  };
}

describe('PostgreSQL repository readiness (mocked Db)', () => {
  it('maps appointment rows without inventing consultation_type', async () => {
    const db = mockDb(async () => ({
      rows: [{
        appointment_id: '11111111-1111-4111-8111-111111111111',
        person_id: '22222222-2222-4222-8222-222222222222',
        staff_user_id: '33333333-3333-4333-8333-333333333333',
        starts_at: '2026-10-30T10:00:00.000Z',
        ends_at: '2026-10-30T10:30:00.000Z',
        status: 'fixture-open',
        consultation_type: null,
      }],
    }));
    const repo = new PgAppointmentSnapshotRepository(db, { consultationTypeColumnPresent: false });
    const snap = await repo.getById('11111111-1111-4111-8111-111111111111');
    expect(snap).toMatchObject({
      status: 'fixture-open',
      consultation_type: null,
    });
    expect(String((db.query as ReturnType<typeof vi.fn>).mock.calls[0]![0])).toContain('NULL::text AS consultation_type');
  });

  it('claims outbox with SKIP LOCKED SQL', async () => {
    const pool = {
      connect: async () => {
        const client = {
          query: vi.fn(async (sql: string) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
            expect(sql).toContain('FOR UPDATE SKIP LOCKED');
            return {
              rows: [{
                outbox_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                idempotency_key: 'k1',
                event_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                notification_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                recipient_user_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                channel: 'fcm',
                status: 'claimed',
                scheduled_at: '2026-10-30T00:00:00.000Z',
                attempt_count: 0,
                next_attempt_at: '2026-10-30T00:00:00.000Z',
                last_error_code: null,
                claim_owner: 'worker-1',
                claim_expires_at: '2026-10-30T00:00:30.000Z',
                created_at: '2026-10-30T00:00:00.000Z',
                updated_at: '2026-10-30T00:00:00.000Z',
              }],
            };
          }),
          release: () => undefined,
        };
        return client;
      },
    };
    const repo = new PgNotificationOutboxRepository(mockDb(async () => ({ rows: [] })), pool as never);
    const claimed = await repo.claimDue('2026-10-30T00:00:00.000Z', 10, 'worker-1', 30_000);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.status).toBe('claimed');
  });
});

describe('createAppPool safety', () => {
  it('rejects non-loopback and non-caregap_local by default', () => {
    expect(() => createAppPool({
      connectionString: 'postgres://caregap:x@10.0.0.5:5432/caregap_local',
    })).toThrow(/DATABASE_HOST_FORBIDDEN/);
    expect(() => createAppPool({
      connectionString: 'postgres://caregap:x@127.0.0.1:5432/postgres',
    })).toThrow(/DATABASE_NAME_FORBIDDEN/);
  });
});

describe('worker lifecycle fail-closed', () => {
  it('refuses start without explicit opt-in and forbids mock under FCM_ENABLED', () => {
    const lifecycle = createNotificationWorkerLifecycle({
      outbox: new MemoryNotificationOutboxRepository(),
      devices: new MemoryDeviceRegistrationRepository(),
      preferences: new MemoryNotificationPreferenceRepository(),
      store: new InAppNotificationStore(),
      push: new MockPushProvider(),
      clock: systemClock(),
      config: { enabled: false, env: { FCM_ENABLED: 'false' } },
    });
    expect(() => lifecycle.start()).toThrow(/NOTIFICATION_WORKER_DISABLED/);

    const fcmMock = createNotificationWorkerLifecycle({
      outbox: new MemoryNotificationOutboxRepository(),
      devices: new MemoryDeviceRegistrationRepository(),
      preferences: new MemoryNotificationPreferenceRepository(),
      store: new InAppNotificationStore(),
      push: new MockPushProvider(),
      clock: systemClock(),
      config: {
        enabled: true,
        env: { FCM_ENABLED: 'true', FIREBASE_PROJECT_ID: 'demo' },
      },
    });
    expect(() => fcmMock.start()).toThrow(/FCM_MOCK_FORBIDDEN/);
  });
});
