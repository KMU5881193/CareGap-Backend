import { randomUUID } from 'node:crypto';
import type { Db } from '../../shared/db.js';
import { instant } from '../../shared/db.js';
import {
  acceptNotification,
  listNotifications,
  markNotificationRead,
  type Notification,
  type NotificationAcceptPolicy,
} from '../be2-consultations/notification.js';
import type {
  InAppCreateInput,
  InAppCreateResult,
  InAppListResult,
  InAppNotificationRecord,
  InAppNotificationStorePort,
} from './in-app-store.js';

const DEFAULT_POLICY: NotificationAcceptPolicy = {
  event: 'optional',
  subject: 'optional',
  event_repeat: 'allow',
};

type NotificationRow = {
  notification_id: string;
  recipient_user_id: string;
  kind: string;
  title: string;
  body: string;
  event_id: string | null;
  appointment_id: string | null;
  follow_up_id: string | null;
  person_id: string | null;
  created_at: Date | string | null;
  read_at: Date | string | null;
  category: string | null;
  destination_type: string | null;
  destination_resource_id: string | null;
};

/**
 * Durable in-app notifications using existing BE2 `notifications` table.
 * Phase 2 navigation columns require draft `0005`. When `phase2Columns` is false,
 * category/destination are omitted (0002-only).
 *
 * Reuses pure accept/list/markRead from notification.ts — does not duplicate domain rules.
 * Does not call FCM.
 */
export class PgInAppNotificationStore implements InAppNotificationStorePort {
  constructor(
    private readonly db: Db,
    private readonly options: { phase2Columns: boolean } = { phase2Columns: false },
  ) {}

  async create(input: InAppCreateInput): Promise<InAppCreateResult> {
    const notificationId = input.notification_id ?? randomUUID();
    const existing = await this.loadById(notificationId);
    const result = acceptNotification(
      existing ? [existing.base] : [],
      {
        notification_id: notificationId,
        recipient_user_id: input.recipient_user_id,
        kind: input.kind,
        title: input.title,
        body: input.body,
        ...(input.event_id ? { event_id: input.event_id } : {}),
        ...(input.appointment_id ? { appointment_id: input.appointment_id } : {}),
        ...(input.follow_up_id ? { follow_up_id: input.follow_up_id } : {}),
        ...(input.person_id ? { person_id: input.person_id } : {}),
        created_at: input.created_at,
      },
      DEFAULT_POLICY,
      { verified: true, allowed: true },
    );

    if (result.outcome === 'accepted') {
      if (this.options.phase2Columns) {
        await this.db.query(
          `INSERT INTO notifications (
             notification_id, recipient_user_id, kind, title, body, event_id, appointment_id,
             follow_up_id, person_id, created_at, read_at, category, destination_type, destination_resource_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,NULL,$11,$12,$13)`,
          [
            result.notification.notification_id,
            result.notification.recipient_user_id,
            result.notification.kind,
            result.notification.title,
            result.notification.body,
            result.notification.event_id ?? null,
            result.notification.appointment_id ?? null,
            result.notification.follow_up_id ?? null,
            result.notification.person_id ?? null,
            result.notification.created_at ?? null,
            input.category ?? null,
            input.destination?.type ?? null,
            input.destination?.resource_id ?? null,
          ],
        );
      } else {
        await this.db.query(
          `INSERT INTO notifications (
             notification_id, recipient_user_id, kind, title, body, event_id, appointment_id,
             follow_up_id, person_id, created_at, read_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,NULL)`,
          [
            result.notification.notification_id,
            result.notification.recipient_user_id,
            result.notification.kind,
            result.notification.title,
            result.notification.body,
            result.notification.event_id ?? null,
            result.notification.appointment_id ?? null,
            result.notification.follow_up_id ?? null,
            result.notification.person_id ?? null,
            result.notification.created_at ?? null,
          ],
        );
      }
      return {
        outcome: 'accepted',
        notification: this.enrich(result.notification, {
          category: input.category,
          destination_type: input.destination?.type,
          destination_resource_id: input.destination?.resource_id,
        }),
      };
    }
    if (result.outcome === 'duplicate') {
      return { outcome: 'duplicate', notification: existing?.record ?? this.enrich(result.notification) };
    }
    if (result.outcome === 'conflict') {
      return { outcome: 'conflict', reason: result.reason };
    }
    return { outcome: 'rejected', reason: result.reason };
  }

  async list(actorUserId: string, filters?: {
    unread_only?: boolean;
    kind?: string;
    category?: string;
    limit?: number;
    offset?: number;
  }): Promise<InAppListResult> {
    const rows = await this.loadForRecipient(actorUserId);
    const listed = listNotifications(rows.map((r) => r.base), actorUserId, {
      verified: true,
      allowed: true,
    });
    if (listed.outcome !== 'listed') return listed;
    let records = rows.map((r) => r.record);
    if (filters?.unread_only) records = records.filter((row) => row.read_at === undefined);
    if (filters?.kind) records = records.filter((row) => row.kind === filters.kind);
    if (filters?.category) {
      records = records.filter((row) => row.category === filters.category);
    }
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;
    const unread_count = records.filter((row) => row.read_at === undefined).length;
    return {
      outcome: 'listed' as const,
      notifications: records.slice(offset, offset + limit),
      unread_count,
    };
  }

  unreadCount(actorUserId: string): Promise<number> {
    return this.list(actorUserId, { unread_only: true, limit: 10_000 }).then((listed) =>
      listed.outcome === 'listed' ? listed.unread_count : 0);
  }

  async markRead(actorUserId: string, notificationId: string, readAt: string) {
    const rows = await this.loadForRecipient(actorUserId);
    const result = markNotificationRead(
      rows.map((r) => r.base),
      notificationId,
      readAt,
      actorUserId,
      { verified: true, allowed: true },
    );
    if (result.outcome === 'rejected') return result;
    if (result.outcome === 'read') {
      await this.db.query(
        `UPDATE notifications SET read_at = $2::timestamptz
         WHERE notification_id = $1 AND recipient_user_id = $3`,
        [result.notification.notification_id, result.notification.read_at, actorUserId],
      );
    }
    const extras = rows.find(
      (r) => r.base.notification_id.toLowerCase() === notificationId.toLowerCase(),
    )?.record;
    return {
      outcome: result.outcome,
      notification: this.enrich(result.notification, extras),
    };
  }

  private enrich(
    notification: Notification,
    extras?: {
      category?: string;
      destination_type?: string;
      destination_resource_id?: string;
    },
  ): InAppNotificationRecord {
    return {
      ...notification,
      ...(extras?.category ? { category: extras.category } : {}),
      ...(extras?.destination_type ? { destination_type: extras.destination_type } : {}),
      ...(extras?.destination_resource_id
        ? { destination_resource_id: extras.destination_resource_id }
        : {}),
    };
  }

  private async loadById(notificationId: string) {
    const rows = await this.queryRows(
      `WHERE notification_id = $1`,
      [notificationId],
    );
    return rows[0];
  }

  private async loadForRecipient(recipientUserId: string) {
    return this.queryRows(`WHERE recipient_user_id = $1`, [recipientUserId]);
  }

  private async queryRows(whereSql: string, params: unknown[]) {
    const sql = this.options.phase2Columns
      ? `SELECT notification_id, recipient_user_id, kind, title, body, event_id, appointment_id,
                follow_up_id, person_id, created_at, read_at, category, destination_type, destination_resource_id
         FROM notifications ${whereSql}`
      : `SELECT notification_id, recipient_user_id, kind, title, body, event_id, appointment_id,
                follow_up_id, person_id, created_at, read_at,
                NULL::text AS category, NULL::text AS destination_type, NULL::uuid AS destination_resource_id
         FROM notifications ${whereSql}`;
    const found = await this.db.query<NotificationRow>(sql, params);
    return found.rows.map((row) => {
      const created = instant(row.created_at) ?? undefined;
      const read = instant(row.read_at) ?? undefined;
      const base: Notification = {
        notification_id: row.notification_id,
        recipient_user_id: row.recipient_user_id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        ...(row.event_id != null ? { event_id: row.event_id } : {}),
        ...(row.appointment_id != null ? { appointment_id: row.appointment_id } : {}),
        ...(row.follow_up_id != null ? { follow_up_id: row.follow_up_id } : {}),
        ...(row.person_id != null ? { person_id: row.person_id } : {}),
        ...(created !== undefined ? { created_at: created } : {}),
        ...(read !== undefined ? { read_at: read } : {}),
      };
      return {
        base,
        record: this.enrich(base, {
          ...(row.category ? { category: row.category } : {}),
          ...(row.destination_type ? { destination_type: row.destination_type } : {}),
          ...(row.destination_resource_id
            ? { destination_resource_id: row.destination_resource_id }
            : {}),
        }),
      };
    });
  }
}
