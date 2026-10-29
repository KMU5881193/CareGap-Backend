import type { CallAppointmentSnapshot } from './call-eligibility.js';

/**
 * Read port for call eligibility. BE2 owns appointments persistence.
 * This repository has no applied SQL table in the current tree
 * (`0002_be2_consultations.sql` is referenced in docs but not present under migrations/).
 */
export interface AppointmentSnapshotRepository {
  getById(appointmentId: string): Promise<CallAppointmentSnapshot | null>;
}

export class InMemoryAppointmentSnapshotRepository implements AppointmentSnapshotRepository {
  readonly #rows = new Map<string, CallAppointmentSnapshot>();

  seed(snapshot: CallAppointmentSnapshot): void {
    this.#rows.set(snapshot.appointment_id.toLowerCase(), snapshot);
  }

  async getById(appointmentId: string): Promise<CallAppointmentSnapshot | null> {
    return this.#rows.get(appointmentId.toLowerCase()) ?? null;
  }
}

/** Fail-closed when appointments DB is not wired. */
export class UnavailableAppointmentSnapshotRepository implements AppointmentSnapshotRepository {
  readonly reason = 'BE2_APPOINTMENTS_PERSISTENCE_UNAVAILABLE' as const;

  async getById(_appointmentId: string): Promise<CallAppointmentSnapshot | null> {
    return null;
  }
}

export { PgAppointmentSnapshotRepository } from './pg-appointment-snapshot.js';
