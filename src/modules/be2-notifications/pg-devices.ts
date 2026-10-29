import type { Db } from '../../shared/db.js';
import { instant } from '../../shared/db.js';
import { Id } from '../../shared/contracts.js';
import {
  DeviceRegistrationInput,
  type DeviceRegistration,
  type DeviceRegistrationRepository,
} from './devices.js';
import type { DevicePlatform } from './types.js';

type DeviceRow = {
  device_registration_id: string;
  user_id: string;
  platform: string;
  installation_id: string;
  registration_token: string;
  active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  last_active_at: Date | string;
};

function fromRow(row: DeviceRow): DeviceRegistration {
  const created = instant(row.created_at);
  const updated = instant(row.updated_at);
  const last = instant(row.last_active_at);
  if (!created || !updated || !last) throw new Error('DEVICE_ROW_INVALID_TIMESTAMP');
  return {
    device_registration_id: row.device_registration_id,
    user_id: row.user_id,
    platform: row.platform as DevicePlatform,
    installation_id: row.installation_id,
    registration_token: row.registration_token,
    active: row.active,
    created_at: created,
    updated_at: updated,
    last_active_at: last,
  };
}

/** Requires draft `0005` device_registrations. Never logs registration_token. */
export class PgDeviceRegistrationRepository implements DeviceRegistrationRepository {
  constructor(private readonly db: Db) {}

  async upsert(actorUserId: string, input: DeviceRegistrationInput, nowIso: string, newId: () => string) {
    const parsed = DeviceRegistrationInput.parse(input);
    const owner = Id.parse(actorUserId);

    await this.db.query(
      `UPDATE device_registrations
       SET active = false, updated_at = $2::timestamptz
       WHERE registration_token = $1 AND active = true
         AND NOT (user_id = $3 AND installation_id = $4)`,
      [parsed.registration_token, nowIso, owner, parsed.installation_id],
    );

    const existing = await this.db.query<DeviceRow>(
      `SELECT * FROM device_registrations
       WHERE user_id = $1 AND installation_id = $2`,
      [owner, parsed.installation_id],
    );
    if (existing.rows[0]) {
      const updated = await this.db.query<DeviceRow>(
        `UPDATE device_registrations
         SET registration_token = $2, platform = $3, active = true,
             updated_at = $4::timestamptz, last_active_at = $4::timestamptz
         WHERE device_registration_id = $1
         RETURNING *`,
        [existing.rows[0].device_registration_id, parsed.registration_token, parsed.platform, nowIso],
      );
      return fromRow(updated.rows[0]!);
    }

    const inserted = await this.db.query<DeviceRow>(
      `INSERT INTO device_registrations (
         device_registration_id, user_id, platform, installation_id, registration_token,
         active, created_at, updated_at, last_active_at
       ) VALUES ($1,$2,$3,$4,$5,true,$6::timestamptz,$6::timestamptz,$6::timestamptz)
       RETURNING *`,
      [newId(), owner, parsed.platform, parsed.installation_id, parsed.registration_token, nowIso],
    );
    return fromRow(inserted.rows[0]!);
  }

  async listActiveByUser(userId: string) {
    const found = await this.db.query<DeviceRow>(
      `SELECT * FROM device_registrations WHERE user_id = $1 AND active = true`,
      [userId],
    );
    return found.rows.map(fromRow);
  }

  async deactivate(actorUserId: string, deviceRegistrationId: string, nowIso: string) {
    const found = await this.db.query<DeviceRow>(
      `SELECT * FROM device_registrations WHERE device_registration_id = $1`,
      [deviceRegistrationId],
    );
    const row = found.rows[0];
    if (!row) return { outcome: 'rejected' as const, reason: 'not_found' as const };
    if (row.user_id.toLowerCase() !== actorUserId.toLowerCase()) {
      return { outcome: 'rejected' as const, reason: 'owner_mismatch' as const };
    }
    const updated = await this.db.query<DeviceRow>(
      `UPDATE device_registrations
       SET active = false, updated_at = $2::timestamptz
       WHERE device_registration_id = $1
       RETURNING *`,
      [deviceRegistrationId, nowIso],
    );
    return { outcome: 'deactivated' as const, device: fromRow(updated.rows[0]!) };
  }

  async deactivateByToken(registrationToken: string, nowIso: string) {
    const result = await this.db.query(
      `UPDATE device_registrations
       SET active = false, updated_at = $2::timestamptz
       WHERE registration_token = $1 AND active = true`,
      [registrationToken, nowIso],
    );
    return result.rowCount ?? 0;
  }

  async deactivateAllForUser(actorUserId: string, nowIso: string) {
    const result = await this.db.query(
      `UPDATE device_registrations
       SET active = false, updated_at = $2::timestamptz
       WHERE user_id = $1 AND active = true`,
      [actorUserId, nowIso],
    );
    return result.rowCount ?? 0;
  }
}
