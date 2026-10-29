import type { Db } from '../../shared/db.js';
import { instant } from '../../shared/db.js';
import {
  defaultPreferences,
  mergePreferences,
  NotificationPreferences,
  type NotificationPreferenceRepository,
  type NotificationPreferencesPatch,
} from './preferences.js';

type PrefRow = {
  user_id: string;
  push_enabled: boolean;
  in_app_enabled: boolean;
  category_appointment: boolean;
  category_consultation: boolean;
  category_message: boolean;
  category_analysis: boolean;
  category_welfare_review: boolean;
  category_reminder: boolean;
  category_admin: boolean;
  category_system: boolean;
  lock_screen_rich_preview: boolean;
  updated_at: Date | string | null;
};

function fromRow(row: PrefRow): NotificationPreferences {
  return NotificationPreferences.parse({
    user_id: row.user_id,
    push_enabled: row.push_enabled,
    in_app_enabled: row.in_app_enabled,
    categories: {
      appointment: row.category_appointment,
      consultation: row.category_consultation,
      message: row.category_message,
      analysis: row.category_analysis,
      welfare_review: row.category_welfare_review,
      reminder: row.category_reminder,
      admin: row.category_admin,
      system: row.category_system,
    },
    lock_screen_rich_preview: row.lock_screen_rich_preview,
    ...(instant(row.updated_at) != null ? { updated_at: instant(row.updated_at)! } : {}),
  });
}

/** Requires draft `0005` notification_preferences. */
export class PgNotificationPreferenceRepository implements NotificationPreferenceRepository {
  constructor(private readonly db: Db) {}

  async get(userId: string): Promise<NotificationPreferences> {
    const found = await this.db.query<PrefRow>(
      `SELECT * FROM notification_preferences WHERE user_id = $1`,
      [userId],
    );
    if (found.rows[0]) return fromRow(found.rows[0]);
    const created = defaultPreferences(userId);
    await this.db.query(
      `INSERT INTO notification_preferences (
         user_id, push_enabled, in_app_enabled,
         category_appointment, category_consultation, category_message, category_analysis,
         category_welfare_review, category_reminder, category_admin, category_system,
         lock_screen_rich_preview, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz)
       ON CONFLICT (user_id) DO NOTHING`,
      [
        created.user_id,
        created.push_enabled,
        created.in_app_enabled,
        created.categories.appointment,
        created.categories.consultation,
        created.categories.message,
        created.categories.analysis,
        created.categories.welfare_review,
        created.categories.reminder,
        created.categories.admin,
        created.categories.system,
        created.lock_screen_rich_preview,
        created.updated_at ?? null,
      ],
    );
    const again = await this.db.query<PrefRow>(
      `SELECT * FROM notification_preferences WHERE user_id = $1`,
      [userId],
    );
    return again.rows[0] ? fromRow(again.rows[0]) : created;
  }

  async update(
    actorUserId: string,
    targetUserId: string,
    patch: NotificationPreferencesPatch,
    updatedAt: string,
  ) {
    if (actorUserId.toLowerCase() !== targetUserId.toLowerCase()) {
      return { outcome: 'rejected' as const, reason: 'actor_mismatch' as const };
    }
    const current = await this.get(targetUserId);
    const next = mergePreferences(current, patch, updatedAt);
    await this.db.query(
      `INSERT INTO notification_preferences (
         user_id, push_enabled, in_app_enabled,
         category_appointment, category_consultation, category_message, category_analysis,
         category_welfare_review, category_reminder, category_admin, category_system,
         lock_screen_rich_preview, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz)
       ON CONFLICT (user_id) DO UPDATE SET
         push_enabled = EXCLUDED.push_enabled,
         in_app_enabled = EXCLUDED.in_app_enabled,
         category_appointment = EXCLUDED.category_appointment,
         category_consultation = EXCLUDED.category_consultation,
         category_message = EXCLUDED.category_message,
         category_analysis = EXCLUDED.category_analysis,
         category_welfare_review = EXCLUDED.category_welfare_review,
         category_reminder = EXCLUDED.category_reminder,
         category_admin = EXCLUDED.category_admin,
         category_system = EXCLUDED.category_system,
         lock_screen_rich_preview = EXCLUDED.lock_screen_rich_preview,
         updated_at = EXCLUDED.updated_at`,
      [
        next.user_id,
        next.push_enabled,
        next.in_app_enabled,
        next.categories.appointment,
        next.categories.consultation,
        next.categories.message,
        next.categories.analysis,
        next.categories.welfare_review,
        next.categories.reminder,
        next.categories.admin,
        next.categories.system,
        next.lock_screen_rich_preview,
        updatedAt,
      ],
    );
    return { outcome: 'updated' as const, preferences: next };
  }
}
