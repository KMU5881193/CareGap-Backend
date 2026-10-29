import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  acceptNotification,
  listNotifications,
  markNotificationRead,
  removeNotification,
  revertNotificationRead,
  type Notification,
  type NotificationAcceptPolicy,
} from '../src/modules/be2-consultations/notification.js';

const notificationId = '11111111-1111-4111-8111-111111111111';
const otherNotificationId = '22222222-2222-4222-8222-222222222222';
const thirdNotificationId = '55555555-5555-4555-8555-555555555555';
const recipientId = '33333333-3333-4333-8333-333333333333';
const otherRecipientId = '44444444-4444-4444-8444-444444444444';
const personId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const appointmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const followUpId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const analysisId = 'abababab-abab-4aba-8aba-abababababab';
const consultationId = 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd';
const versionId = 'efefefef-efef-4efe-8efe-efefefefefef';
const sourceText = '합성 기록: 대상자가 서류 준비를 아직 마치지 못했습니다.';
const title = '서류 준비 확인';
const body = '다음 상담 전에 준비 상태만 확인합니다.';
const allowed = { verified: true, allowed: true } as const;
const open: NotificationAcceptPolicy = { event: 'optional', subject: 'optional', event_repeat: 'unset' };
const linked: NotificationAcceptPolicy = { event: 'optional', subject: 'optional', event_repeat: 'allow' };
const statedUnset: NotificationAcceptPolicy = { event: 'unset', subject: 'unset', event_repeat: 'unset' };

function draft(overrides: Record<string, string> = {}) {
  return {
    notification_id: notificationId,
    recipient_user_id: recipientId,
    kind: 'fixture-notice',
    title,
    body,
    ...overrides,
  };
}

describe('notification intake', () => {
  it('accepts a notification and preserves identifier case', () => {
    const accepted = acceptNotification([], draft({
      notification_id: notificationId.toUpperCase(),
      recipient_user_id: recipientId.toUpperCase(),
      created_at: '2026-10-30T00:00:00Z',
    }), open, allowed);
    expect(accepted.outcome).toBe('accepted');
    if (accepted.outcome !== 'accepted') return;
    expect(accepted.notification).toMatchObject({
      notification_id: notificationId.toUpperCase(),
      recipient_user_id: recipientId.toUpperCase(),
      kind: 'fixture-notice',
      title,
      body,
      created_at: '2026-10-30T00:00:00Z',
    });
    expect(accepted.notification).not.toHaveProperty('read_at');
    expect(accepted.notification).not.toHaveProperty('sent_at');
    expect(accepted.notification).not.toHaveProperty('delivered');
    expect(accepted.notification).not.toHaveProperty('text');
    expect(accepted.notifications).toHaveLength(1);
    expect(accepted.notification).not.toBe(accepted.notifications[0]);
  });

  it('rejects a bad id, a bad instant, a missing field, and an unknown field', () => {
    expect(() => acceptNotification([], draft({ notification_id: 'notification-1' }), open, allowed)).toThrow(ZodError);
    expect(() => acceptNotification([], draft({ recipient_user_id: 'user-1' }), open, allowed)).toThrow(ZodError);
    expect(() => acceptNotification([], draft({ created_at: '2026-10-30T00:00:00+09:00' }), open, allowed)).toThrow(ZodError);
    expect(() => acceptNotification([], draft({ created_at: '2026-10-30' }), open, allowed)).toThrow(ZodError);
    expect(() => acceptNotification([], {
      notification_id: notificationId,
      recipient_user_id: recipientId,
      kind: 'fixture-notice',
      body,
    }, open, allowed)).toThrow(ZodError);
    expect(() => acceptNotification([], { ...draft(), delivered: true }, open, allowed)).toThrow(ZodError);
    expect(() => acceptNotification([], { ...draft(), read_at: '2026-10-30T00:00:00Z' }, open, allowed)).toThrow(ZodError);
    try {
      acceptNotification([], { ...draft(), text: sourceText, quote: sourceText }, open, allowed);
      expect.fail('unknown record text should be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect(JSON.stringify(error)).not.toContain(sourceText);
    }
  });

  it('replays the same notification and conflicts when the content differs', () => {
    const first = acceptNotification([], draft({ created_at: '2026-10-30T00:00:00Z' }), open, allowed);
    expect(first.outcome).toBe('accepted');
    if (first.outcome !== 'accepted') return;
    const replay = acceptNotification(first.notifications, draft({
      notification_id: notificationId.toUpperCase(),
      recipient_user_id: recipientId.toUpperCase(),
      created_at: '2026-10-30T00:00:00.000Z',
    }), statedUnset, allowed);
    expect(replay.outcome).toBe('duplicate');
    if (replay.outcome !== 'duplicate') return;
    expect(replay.notification.notification_id).toBe(notificationId);
    expect(replay.notification.created_at).toBe('2026-10-30T00:00:00Z');
    expect(first.notifications).toHaveLength(1);
    const conflict = acceptNotification(first.notifications, draft({
      title: '다른 제목',
    }), open, allowed);
    expect(conflict).toEqual({ outcome: 'conflict', reason: 'notification_id_conflict' });
    expect(JSON.stringify(conflict)).not.toContain('다른 제목');
    expect(JSON.stringify(conflict)).not.toContain(title);
    expect(first.notifications[0]?.title).toBe(title);
    const retargeted = acceptNotification(first.notifications, draft({
      recipient_user_id: otherRecipientId,
      created_at: '2026-10-30T00:00:00Z',
    }), open, allowed);
    expect(retargeted).toEqual({ outcome: 'conflict', reason: 'notification_id_conflict' });
    expect(first.notifications).toHaveLength(1);
  });

  it('does not create a notification when a link policy is unset', () => {
    const missing = acceptNotification([], draft(), statedUnset, allowed);
    expect(missing).toEqual({ outcome: 'rejected', reason: 'policy_unset' });
    const eventWithoutRepeat = acceptNotification([], draft({ event_id: eventId }), open, allowed);
    expect(eventWithoutRepeat).toEqual({ outcome: 'rejected', reason: 'policy_unset' });
    const subjectRequired = acceptNotification([], draft(), {
      event: 'optional',
      subject: 'required',
      event_repeat: 'unset',
    }, allowed);
    expect(subjectRequired).toEqual({ outcome: 'rejected', reason: 'subject_required' });
    const linkedAppointment = acceptNotification([], draft({ appointment_id: appointmentId }), {
      event: 'optional',
      subject: 'required',
      event_repeat: 'unset',
    }, allowed);
    expect(linkedAppointment.outcome).toBe('accepted');
    if (linkedAppointment.outcome !== 'accepted') return;
    const sameAppointment = acceptNotification(linkedAppointment.notifications, draft({
      notification_id: otherNotificationId,
      appointment_id: appointmentId,
    }), {
      event: 'optional',
      subject: 'required',
      event_repeat: 'unset',
    }, allowed);
    expect(sameAppointment.outcome).toBe('accepted');
    if (sameAppointment.outcome !== 'accepted') return;
    expect(sameAppointment.notifications.map((notification) => notification.notification_id)).toEqual([
      notificationId,
      otherNotificationId,
    ]);
    expect(sameAppointment.notifications.every((notification) => notification.appointment_id === appointmentId)).toBe(true);
  });

  it('does not treat an event id as the notification key', () => {
    const first = acceptNotification([], draft({ event_id: eventId, person_id: personId }), linked, allowed);
    expect(first.outcome).toBe('accepted');
    if (first.outcome !== 'accepted') return;
    const replay = acceptNotification(first.notifications, draft({
      notification_id: notificationId.toUpperCase(),
      event_id: eventId.toUpperCase(),
      person_id: personId.toUpperCase(),
    }), statedUnset, allowed);
    expect(replay.outcome).toBe('duplicate');
    expect(first.notifications).toHaveLength(1);
    const blocked = acceptNotification(first.notifications, draft({
      notification_id: otherNotificationId,
      recipient_user_id: otherRecipientId,
      event_id: eventId,
    }), open, allowed);
    expect(blocked).toEqual({ outcome: 'rejected', reason: 'policy_unset' });
    expect(first.notifications).toHaveLength(1);
    const second = acceptNotification(first.notifications, draft({
      notification_id: otherNotificationId,
      recipient_user_id: otherRecipientId,
      kind: 'fixture-other',
      event_id: eventId,
    }), linked, allowed);
    expect(second.outcome).toBe('accepted');
    if (second.outcome !== 'accepted') return;
    expect(second.notifications).toHaveLength(2);
    const rejected = acceptNotification(second.notifications, draft({
      notification_id: thirdNotificationId,
      event_id: eventId.toUpperCase(),
    }), { event: 'optional', subject: 'optional', event_repeat: 'reject' }, allowed);
    expect(rejected).toEqual({ outcome: 'rejected', reason: 'event_repeat_rejected' });
    expect(JSON.stringify(rejected)).not.toContain(title);
    expect(second.notifications).toHaveLength(2);
    expect(() => acceptNotification(second.notifications, {
      type: 'analysis.succeeded',
      event_id: eventId,
      occurred_at: '2026-10-30T00:00:00Z',
      analysis_id: analysisId,
      consultation_id: consultationId,
      record_version_id: versionId,
      person_id: personId,
      text: sourceText,
    }, linked, allowed)).toThrow(ZodError);
    expect(second.notifications).toHaveLength(2);
    expect(JSON.stringify(second.notifications)).not.toContain(sourceText);
  });
});

describe('notification read state', () => {
  it('marks an unread notification once and keeps the first read time', () => {
    const accepted = acceptNotification([], draft(), open, allowed);
    expect(accepted.outcome).toBe('accepted');
    if (accepted.outcome !== 'accepted') return;
    const read = markNotificationRead(
      accepted.notifications,
      notificationId.toUpperCase(),
      '2026-10-30T01:00:00Z',
      recipientId.toUpperCase(),
      allowed,
    );
    expect(read.outcome).toBe('read');
    if (read.outcome !== 'read') return;
    expect(read.notification.read_at).toBe('2026-10-30T01:00:00Z');
    expect(read.notification).not.toHaveProperty('sent_at');
    expect(read.notification).not.toHaveProperty('delivered');
    expect(read.notification).not.toBe(read.notifications[0]);
    expect(accepted.notifications[0]).not.toHaveProperty('read_at');
    const again = markNotificationRead(
      read.notifications,
      notificationId,
      '2026-10-30T02:00:00Z',
      recipientId,
      allowed,
    );
    expect(again.outcome).toBe('already_read');
    if (again.outcome !== 'already_read') return;
    expect(again.notification.read_at).toBe('2026-10-30T01:00:00Z');
    expect(again.notification).not.toHaveProperty('sent_at');
    expect(read.notifications[0]?.read_at).toBe('2026-10-30T01:00:00Z');
    const replay = acceptNotification(read.notifications, draft(), open, allowed);
    expect(replay.outcome).toBe('duplicate');
    if (replay.outcome !== 'duplicate') return;
    expect(replay.notification.read_at).toBe('2026-10-30T01:00:00Z');
    expect(replay.notification).not.toHaveProperty('delivered');
    expect(read.notifications).toHaveLength(1);
  });

  it('rejects a missing notification, a bad read time, and an unverified decision', () => {
    const accepted = acceptNotification([], draft(), open, allowed);
    expect(accepted.outcome).toBe('accepted');
    if (accepted.outcome !== 'accepted') return;
    expect(markNotificationRead(
      [],
      otherNotificationId,
      '2026-10-30T01:00:00Z',
      recipientId,
      allowed,
    )).toEqual({ outcome: 'rejected', reason: 'notification_not_found' });
    expect(() => markNotificationRead(
      accepted.notifications,
      'notification-1',
      '2026-10-30T01:00:00Z',
      recipientId,
      allowed,
    )).toThrow(ZodError);
    expect(() => markNotificationRead(
      accepted.notifications,
      notificationId,
      '2026-10-30T01:00:00+09:00',
      recipientId,
      allowed,
    )).toThrow(ZodError);
    expect(() => markNotificationRead(
      accepted.notifications,
      notificationId,
      '2026-10-30T01:00:00Z',
      recipientId,
      { role: 'admin' },
    )).toThrow(ZodError);
    expect(() => acceptNotification([], draft(), open, { role: 'staff' })).toThrow(ZodError);
    expect(() => acceptNotification([], draft(), open, { verified: true, allowed: true, role: 'staff' })).toThrow(ZodError);
    const hidden = markNotificationRead(
      accepted.notifications,
      notificationId,
      '2026-10-30T01:00:00Z',
      recipientId,
      { verified: false },
    );
    expect(hidden).toEqual({ outcome: 'rejected', reason: 'access_not_verified' });
    expect(JSON.stringify(hidden)).not.toContain(title);
    expect(accepted.notifications[0]).not.toHaveProperty('read_at');
    expect(markNotificationRead(
      accepted.notifications,
      notificationId,
      '2026-10-30T01:00:00Z',
      recipientId,
      { verified: true, allowed: false },
    )).toEqual({ outcome: 'rejected', reason: 'access_denied' });
    const hiddenList = listNotifications(accepted.notifications, recipientId, { verified: false });
    expect(hiddenList).toEqual({ outcome: 'rejected', reason: 'access_not_verified' });
    expect(JSON.stringify(hiddenList)).not.toContain(title);
  });

  it('does not return a notification to a different user', () => {
    const mine = acceptNotification([], draft({ event_id: eventId, title: '내 알림 제목' }), linked, allowed);
    expect(mine.outcome).toBe('accepted');
    if (mine.outcome !== 'accepted') return;
    const both = acceptNotification(mine.notifications, draft({
      notification_id: otherNotificationId,
      recipient_user_id: otherRecipientId,
      person_id: personId,
      event_id: eventId,
      title: '다른 사용자 알림 제목',
    }), linked, allowed);
    expect(both.outcome).toBe('accepted');
    if (both.outcome !== 'accepted') return;
    const own = listNotifications(both.notifications, recipientId.toUpperCase(), allowed, eventId.toUpperCase());
    expect(own.outcome).toBe('listed');
    if (own.outcome !== 'listed') return;
    expect(own.notifications.map((notification) => notification.notification_id)).toEqual([notificationId]);
    expect(JSON.stringify(own)).not.toContain('다른 사용자 알림 제목');
    const asSubject = listNotifications(both.notifications, personId, allowed);
    expect(asSubject.outcome).toBe('listed');
    if (asSubject.outcome !== 'listed') return;
    expect(asSubject.notifications).toEqual([]);
    const mismatch = markNotificationRead(
      both.notifications,
      notificationId,
      '2026-10-30T01:00:00Z',
      otherRecipientId,
      allowed,
    );
    expect(mismatch).toEqual({ outcome: 'rejected', reason: 'recipient_mismatch' });
    expect(JSON.stringify(mismatch)).not.toContain('내 알림 제목');
    expect(JSON.stringify(mismatch)).not.toContain(sourceText);
    expect(both.notifications[0]).not.toHaveProperty('read_at');
    expect(both.notifications[1]?.follow_up_id).toBeUndefined();
  });

  it('leaves deletion and unread reversal unset', () => {
    const accepted = acceptNotification([], draft({ follow_up_id: followUpId }), open, allowed);
    expect(accepted.outcome).toBe('accepted');
    if (accepted.outcome !== 'accepted') return;
    const read = markNotificationRead(
      accepted.notifications,
      notificationId,
      '2026-10-30T01:00:00Z',
      recipientId,
      allowed,
    );
    expect(read.outcome).toBe('read');
    if (read.outcome !== 'read') return;
    expect(revertNotificationRead(allowed)).toEqual({ outcome: 'rejected', reason: 'policy_unset' });
    expect(removeNotification(allowed)).toEqual({ outcome: 'rejected', reason: 'policy_unset' });
    expect(read.notifications).toHaveLength(1);
    expect(read.notifications[0]?.read_at).toBe('2026-10-30T01:00:00Z');
    expect(read.notification).not.toHaveProperty('status');
    expect(revertNotificationRead({ verified: false })).toEqual({ outcome: 'rejected', reason: 'access_not_verified' });
    expect(removeNotification({ verified: true, allowed: false })).toEqual({ outcome: 'rejected', reason: 'access_denied' });
  });

  it('does not mutate inputs or share result objects', () => {
    const mutable = draft();
    const created = acceptNotification([], mutable, open, allowed);
    mutable.title = '입력에서 바꾼 문장';
    expect(created.outcome).toBe('accepted');
    if (created.outcome !== 'accepted') return;
    expect(created.notification.title).toBe(title);
    expect(created.notifications[0]?.title).toBe(title);
    const input = Object.freeze(draft());
    const existing = Object.freeze<Notification[]>([]);
    const accepted = acceptNotification(existing, input, open, allowed);
    expect(existing).toHaveLength(0);
    expect(accepted.outcome).toBe('accepted');
    if (accepted.outcome !== 'accepted') return;
    accepted.notification.title = '반환 알림에서 바꾼 문장';
    expect(accepted.notifications[0]?.title).toBe(title);
    const listed = accepted.notifications[0] as Notification;
    listed.body = '목록에서 바꾼 문장';
    expect(accepted.notification.body).toBe(body);
    const frozenRow = Object.freeze({ ...created.notifications[0] });
    const frozen = Object.freeze([frozenRow]);
    const next = acceptNotification(frozen, draft({ notification_id: otherNotificationId }), open, allowed);
    expect(frozen).toHaveLength(1);
    expect(frozenRow.title).toBe(title);
    expect(next.outcome).toBe('accepted');
    if (next.outcome !== 'accepted') return;
    expect(next.notifications).toHaveLength(2);
    expect(next.notifications[0]).not.toBe(frozenRow);
    const denied = acceptNotification(existing, input, open, { verified: false });
    const deniedAgain = acceptNotification(existing, input, open, { verified: false });
    expect(denied).not.toBe(deniedAgain);
    if (denied.outcome === 'rejected') {
      (denied as { reason: string }).reason = 'changed';
    }
    expect(deniedAgain).toEqual({ outcome: 'rejected', reason: 'access_not_verified' });
  });
});
