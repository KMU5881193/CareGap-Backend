import type { Pool } from 'pg';
import type { Db } from '../../shared/db.js';
import { BlockedPersonAccountBindingStore } from '../be1-auth/identity-resolver.js';
import { createBlockedAuthorizationPort } from '../be1-auth/authorization.js';
import { PgAppointmentSnapshotRepository } from '../be2-consultations/pg-appointment-snapshot.js';
import { UnavailableAppointmentSnapshotRepository } from '../be2-consultations/appointment-snapshot.js';
import { PgDeviceRegistrationRepository } from './pg-devices.js';
import { PgInAppNotificationStore } from './pg-in-app-store.js';
import { PgNotificationOutboxRepository } from './pg-outbox.js';
import { PgNotificationPreferenceRepository } from './pg-preferences.js';

export type PersistenceMode =
  | { mode: 'memory_fail_closed'; reason: string }
  | {
    mode: 'postgres_draft';
    /** Wave A consultation_type column present (draft 0003 applied to this DB). */
    consultationTypeColumnPresent: boolean;
    /** Phase 2 additive columns / delivery tables present (draft 0005). */
    phase2Columns: boolean;
  };

/**
 * Factory for durable repositories. Does not start workers or enable FCM.
 * BE1 person/relation stores stay fail-closed until BE1 owns persistence.
 */
export function createPostgresNotificationPersistence(deps: {
  db: Db;
  pool: Pool;
  mode: Extract<PersistenceMode, { mode: 'postgres_draft' }>;
}) {
  return {
    appointments: new PgAppointmentSnapshotRepository(deps.db, {
      consultationTypeColumnPresent: deps.mode.consultationTypeColumnPresent,
    }),
    notifications: new PgInAppNotificationStore(deps.db, {
      phase2Columns: deps.mode.phase2Columns,
    }),
    outbox: deps.mode.phase2Columns
      ? new PgNotificationOutboxRepository(deps.db, deps.pool)
      : null,
    devices: deps.mode.phase2Columns
      ? new PgDeviceRegistrationRepository(deps.db)
      : null,
    preferences: deps.mode.phase2Columns
      ? new PgNotificationPreferenceRepository(deps.db)
      : null,
    /** BE1-owned — not invented here. */
    personAccounts: new BlockedPersonAccountBindingStore(),
    authorization: createBlockedAuthorizationPort(),
  };
}

export function createUnavailableAppointmentPersistence() {
  return new UnavailableAppointmentSnapshotRepository();
}
