import type { Db } from '../../shared/db.js';
import { instant } from '../../shared/db.js';
import type { AppointmentSnapshotRepository } from './appointment-snapshot.js';
import type { CallAppointmentSnapshot } from './call-eligibility.js';

type AppointmentRow = {
  appointment_id: string;
  person_id: string;
  staff_user_id: string;
  starts_at: Date | string;
  ends_at: Date | string;
  status: string;
  consultation_type: string | null;
};

/**
 * Reads appointment snapshots for Call Eligibility.
 * Requires draft `0002` appointments table. `consultation_type` is optional
 * (Wave A draft 0003); missing column is handled by selecting NULL::text alias
 * when the additive migration is not applied — callers should use the dual query
 * helper below or apply 0003.
 *
 * Does not invent status vocabulary or PHONE defaults.
 */
export class PgAppointmentSnapshotRepository implements AppointmentSnapshotRepository {
  constructor(
    private readonly db: Db,
    private readonly options: { consultationTypeColumnPresent: boolean } = {
      consultationTypeColumnPresent: false,
    },
  ) {}

  async getById(appointmentId: string): Promise<CallAppointmentSnapshot | null> {
    const sql = this.options.consultationTypeColumnPresent
      ? `SELECT appointment_id, person_id, staff_user_id, starts_at, ends_at, status, consultation_type
         FROM appointments WHERE appointment_id = $1`
      : `SELECT appointment_id, person_id, staff_user_id, starts_at, ends_at, status,
                NULL::text AS consultation_type
         FROM appointments WHERE appointment_id = $1`;

    const found = await this.db.query<AppointmentRow>(sql, [appointmentId]);
    const row = found.rows[0];
    if (!row) return null;
    const starts_at = instant(row.starts_at);
    const ends_at = instant(row.ends_at);
    if (starts_at === null || ends_at === null) return null;
    return {
      appointment_id: row.appointment_id,
      person_id: row.person_id,
      staff_user_id: row.staff_user_id,
      starts_at,
      ends_at,
      status: row.status,
      consultation_type: row.consultation_type,
    };
  }
}
