import { randomUUID } from 'node:crypto';
import type { Db } from '../../shared/db.js';
import { instant, withTransaction } from '../../shared/db.js';
import type { Pool } from 'pg';
import type {
  NotificationOutboxRepository,
  OutboxInsert,
  OutboxJob,
} from './outbox.js';
import type { OutboxStatus, PushChannel } from './types.js';

type OutboxRow = {
  outbox_id: string;
  idempotency_key: string;
  event_id: string;
  notification_id: string;
  recipient_user_id: string;
  channel: string;
  status: string;
  scheduled_at: Date | string;
  attempt_count: number;
  next_attempt_at: Date | string;
  last_error_code: string | null;
  claim_owner: string | null;
  claim_expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function fromRow(row: OutboxRow): OutboxJob {
  const scheduled = instant(row.scheduled_at);
  const next = instant(row.next_attempt_at);
  const created = instant(row.created_at);
  const updated = instant(row.updated_at);
  if (!scheduled || !next || !created || !updated) {
    throw new Error('OUTBOX_ROW_INVALID_TIMESTAMP');
  }
  return {
    outbox_id: row.outbox_id,
    idempotency_key: row.idempotency_key,
    event_id: row.event_id,
    notification_id: row.notification_id,
    recipient_user_id: row.recipient_user_id,
    channel: row.channel as PushChannel,
    status: row.status as OutboxStatus,
    scheduled_at: scheduled,
    attempt_count: row.attempt_count,
    next_attempt_at: next,
    ...(row.last_error_code != null ? { last_error_code: row.last_error_code } : {}),
    ...(row.claim_owner != null ? { claim_owner: row.claim_owner } : {}),
    ...(instant(row.claim_expires_at) != null
      ? { claim_expires_at: instant(row.claim_expires_at)! }
      : {}),
    created_at: created,
    updated_at: updated,
  };
}

/**
 * PostgreSQL outbox with FOR UPDATE SKIP LOCKED claim semantics.
 * Requires draft `0005` notification_outbox (+ `0002` notifications FK target).
 * Does not send FCM.
 */
export class PgNotificationOutboxRepository implements NotificationOutboxRepository {
  constructor(
    private readonly db: Db,
    /** Pool required for claim transactions with SKIP LOCKED. */
    private readonly pool: Pool,
  ) {}

  async enqueue(input: OutboxInsert, newId: () => string = randomUUID) {
    const existing = await this.db.query<OutboxRow>(
      `SELECT * FROM notification_outbox WHERE idempotency_key = $1`,
      [input.idempotency_key],
    );
    const prior = existing.rows[0];
    if (prior) {
      if (prior.status === 'cancelled') {
        const updated = await this.db.query<OutboxRow>(
          `UPDATE notification_outbox SET
             event_id = $2, notification_id = $3, recipient_user_id = $4, channel = $5,
             status = 'pending', scheduled_at = $6, next_attempt_at = $6, attempt_count = 0,
             last_error_code = NULL, claim_owner = NULL, claim_expires_at = NULL, updated_at = $7
           WHERE outbox_id = $1
           RETURNING *`,
          [
            prior.outbox_id,
            input.event_id,
            input.notification_id,
            input.recipient_user_id,
            input.channel,
            input.scheduled_at,
            input.created_at,
          ],
        );
        return { outcome: 'enqueued' as const, job: fromRow(updated.rows[0]!) };
      }
      return { outcome: 'duplicate' as const, job: fromRow(prior) };
    }

    const outboxId = newId();
    const inserted = await this.db.query<OutboxRow>(
      `INSERT INTO notification_outbox (
         outbox_id, idempotency_key, event_id, notification_id, recipient_user_id, channel,
         status, scheduled_at, attempt_count, next_attempt_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,0,$7,$8,$8)
       RETURNING *`,
      [
        outboxId,
        input.idempotency_key,
        input.event_id,
        input.notification_id,
        input.recipient_user_id,
        input.channel,
        input.scheduled_at,
        input.created_at,
      ],
    );
    return { outcome: 'enqueued' as const, job: fromRow(inserted.rows[0]!) };
  }

  async claimDue(nowIso: string, limit: number, claimOwner: string, claimTtlMs: number) {
    const claimExpires = new Date(Date.parse(nowIso) + claimTtlMs).toISOString();
    return withTransaction(this.pool, async (tx) => {
      const claimed = await tx.query<OutboxRow>(
        `WITH due AS (
           SELECT outbox_id
           FROM notification_outbox
           WHERE next_attempt_at <= $1::timestamptz
             AND (
               status IN ('pending', 'failed_transient')
               OR (status = 'claimed' AND claim_expires_at IS NOT NULL AND claim_expires_at <= $1::timestamptz)
             )
           ORDER BY next_attempt_at ASC, outbox_id ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE notification_outbox AS o
         SET status = 'claimed',
             claim_owner = $3,
             claim_expires_at = $4::timestamptz,
             updated_at = $1::timestamptz
         FROM due
         WHERE o.outbox_id = due.outbox_id
         RETURNING o.*`,
        [nowIso, limit, claimOwner, claimExpires],
      );
      return claimed.rows.map(fromRow);
    });
  }

  async markSent(outboxId: string, nowIso: string) {
    await this.db.query(
      `UPDATE notification_outbox
       SET status = 'sent', claim_owner = NULL, claim_expires_at = NULL, updated_at = $2::timestamptz
       WHERE outbox_id = $1`,
      [outboxId, nowIso],
    );
  }

  async markRetry(outboxId: string, nowIso: string, nextAttemptAt: string, errorCode: string) {
    await this.db.query(
      `UPDATE notification_outbox
       SET status = 'failed_transient',
           attempt_count = attempt_count + 1,
           next_attempt_at = $3::timestamptz,
           last_error_code = $4,
           claim_owner = NULL,
           claim_expires_at = NULL,
           updated_at = $2::timestamptz
       WHERE outbox_id = $1`,
      [outboxId, nowIso, nextAttemptAt, errorCode],
    );
  }

  async markPermanentFailure(outboxId: string, nowIso: string, errorCode: string) {
    await this.db.query(
      `UPDATE notification_outbox
       SET status = 'failed_permanent',
           attempt_count = attempt_count + 1,
           last_error_code = $3,
           claim_owner = NULL,
           claim_expires_at = NULL,
           updated_at = $2::timestamptz
       WHERE outbox_id = $1`,
      [outboxId, nowIso, errorCode],
    );
  }

  async cancelByEvent(eventId: string, nowIso: string) {
    return this.cancelWhere(`event_id = $1`, [eventId], nowIso);
  }

  async cancelByNotification(notificationId: string, nowIso: string) {
    return this.cancelWhere(`notification_id = $1`, [notificationId], nowIso);
  }

  async cancelByIdempotencyPrefix(prefix: string, nowIso: string) {
    return this.cancelWhere(`idempotency_key LIKE $1`, [`${prefix}%`], nowIso);
  }

  async listByRecipient(recipientUserId: string) {
    const found = await this.db.query<OutboxRow>(
      `SELECT * FROM notification_outbox WHERE recipient_user_id = $1 ORDER BY created_at`,
      [recipientUserId],
    );
    return found.rows.map(fromRow);
  }

  private async cancelWhere(predicateSql: string, params: unknown[], nowIso: string) {
    const result = await this.db.query(
      `UPDATE notification_outbox
       SET status = 'cancelled', claim_owner = NULL, claim_expires_at = NULL, updated_at = $2::timestamptz
       WHERE ${predicateSql}
         AND status NOT IN ('sent', 'cancelled', 'failed_permanent')`,
      [...params, nowIso],
    );
    return result.rowCount ?? 0;
  }
}
