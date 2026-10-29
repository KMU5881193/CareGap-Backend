import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { acceptAnalysisEvent, type AnalysisEvent } from '../src/modules/be2-consultations/analysis-event.js';
import type { RecordVersion } from '../src/shared/contracts.js';

const consultationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherConsultationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const versionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherVersionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const personId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherPersonId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const eventId = '11111111-1111-4111-8111-111111111111';
const otherEventId = '22222222-2222-4222-8222-222222222222';
const analysisId = '33333333-3333-4333-8333-333333333333';
const otherAnalysisId = '44444444-4444-4444-8444-444444444444';
const sourceText = '합성 기록: 이번 주에는 산책을 두 번 했습니다.';
const unset = { configured: false, reason: 'policy_unset' } as const;

function version(overrides: Partial<RecordVersion> = {}): RecordVersion {
  return {
    consultation_id: consultationId,
    record_version_id: versionId,
    person_id: personId,
    text: sourceText,
    ...overrides,
  };
}

function event(overrides: Partial<AnalysisEvent> = {}): AnalysisEvent {
  return {
    type: 'analysis.succeeded',
    event_id: eventId,
    occurred_at: '2026-10-29T01:00:00Z',
    analysis_id: analysisId,
    consultation_id: consultationId,
    record_version_id: versionId,
    person_id: personId,
    ...overrides,
  };
}

function withoutText(value: unknown) {
  expect(JSON.stringify(value)).not.toContain(sourceText);
}

describe('analysis event acceptance', () => {
  it('accepts a succeeded event and a failed event without choosing a follow-up', () => {
    const succeeded = acceptAnalysisEvent([], [version()], event({
      event_id: eventId.toUpperCase(),
    }));
    expect(succeeded).toMatchObject({
      outcome: 'accepted',
      effects: unset,
      receipt: { type: 'analysis.succeeded', event_id: eventId.toUpperCase() },
    });
    expect(succeeded).not.toHaveProperty('follow_up');
    expect(succeeded).not.toHaveProperty('notification');
    expect(succeeded).not.toHaveProperty('welfare');
    if (succeeded.outcome !== 'accepted') return;
    const failed = acceptAnalysisEvent(succeeded.receipts, [version()], event({
      type: 'analysis.failed',
      event_id: otherEventId,
      occurred_at: '2026-10-29T02:00:00Z',
    }));
    expect(failed).toMatchObject({
      outcome: 'accepted',
      effects: unset,
      receipt: { type: 'analysis.failed', event_id: otherEventId },
    });
    withoutText(failed);
  });

  it('rejects a bad event id, a non-UTC time, and an unknown source field', () => {
    expect(() => acceptAnalysisEvent([], [version()], event({ event_id: 'event-1' }))).toThrow(ZodError);
    expect(() => acceptAnalysisEvent([], [version()], event({ occurred_at: '2026-10-29T01:00:00+09:00' }))).toThrow(ZodError);
    expect(() => acceptAnalysisEvent([], [version()], { ...event(), text: sourceText })).toThrow(ZodError);
    try {
      acceptAnalysisEvent([], [version()], event({ analysis_id: 'analysis-1' }));
    } catch (error) {
      withoutText(error);
    }
  });

  it('treats the same event id and content as one receipt', () => {
    const input = Object.freeze(event());
    const versions = Object.freeze([Object.freeze(version())]);
    const existing = Object.freeze<AnalysisEvent[]>([]);
    const first = acceptAnalysisEvent(existing, versions, input);
    expect(existing).toHaveLength(0);
    expect(input.occurred_at).toBe('2026-10-29T01:00:00Z');
    expect(first.outcome).toBe('accepted');
    if (first.outcome !== 'accepted') return;
    first.receipt.occurred_at = 'changed-after-return';
    expect(input.occurred_at).toBe('2026-10-29T01:00:00Z');
    const stored = acceptAnalysisEvent([], versions, event());
    expect(stored.outcome).toBe('accepted');
    if (stored.outcome !== 'accepted') return;
    const replay = acceptAnalysisEvent(stored.receipts, [], {
      ...event(),
      event_id: eventId.toUpperCase(),
      analysis_id: analysisId.toUpperCase(),
      occurred_at: '2026-10-29T01:00:00.000Z',
    });
    expect(replay).toEqual({ outcome: 'duplicate', receipt: stored.receipt, effects: unset });
    expect(stored.receipts).toHaveLength(1);
    const again = acceptAnalysisEvent(stored.receipts, [], event());
    expect(again.outcome).toBe('duplicate');
  });

  it('keeps prior receipts unchanged when a caller edits a returned object', () => {
    const input = event();
    const accepted = acceptAnalysisEvent([], [version()], input);
    expect(accepted.outcome).toBe('accepted');
    if (accepted.outcome !== 'accepted') return;
    input.occurred_at = '2026-10-29T09:00:00Z';
    const returnedEffects: { configured: boolean } = accepted.effects;
    returnedEffects.configured = true;
    accepted.receipt.analysis_id = otherAnalysisId;
    expect(accepted.receipts[0].analysis_id).toBe(analysisId);
    expect(accepted.receipts[0].occurred_at).toBe('2026-10-29T01:00:00Z');
    const replay = acceptAnalysisEvent(accepted.receipts, [], event());
    expect(replay).toEqual({ outcome: 'duplicate', receipt: accepted.receipts[0], effects: unset });
    const next = acceptAnalysisEvent(accepted.receipts, [version()], event({
      event_id: otherEventId,
      occurred_at: '2026-10-29T02:00:00Z',
    }));
    expect(next.outcome).toBe('accepted');
    if (next.outcome !== 'accepted') return;
    accepted.receipts[0].type = 'analysis.failed';
    expect(next.receipts[0].type).toBe('analysis.succeeded');
    expect(next.effects).toEqual(unset);
  });

  it('detects a different payload for an event id that was already accepted', () => {
    const first = acceptAnalysisEvent([], [version()], event());
    expect(first.outcome).toBe('accepted');
    if (first.outcome !== 'accepted') return;
    const changedAnalysis = acceptAnalysisEvent(first.receipts, [version()], event({ analysis_id: otherAnalysisId }));
    expect(changedAnalysis).toEqual({ outcome: 'conflict', reason: 'event_id_conflict' });
    withoutText(changedAnalysis);
    const changedType = acceptAnalysisEvent(first.receipts, [version()], event({ type: 'analysis.failed' }));
    expect(changedType).toEqual({ outcome: 'conflict', reason: 'event_id_conflict' });
    expect(first.receipts).toHaveLength(1);
    expect(first.receipts[0].type).toBe('analysis.succeeded');
  });

  it('rejects an event whose consultation version or person does not match', () => {
    const versions = [version()];
    const missing = acceptAnalysisEvent([], versions, event({ record_version_id: otherVersionId }));
    expect(missing).toEqual({ outcome: 'rejected', reason: 'not_found' });
    withoutText(missing);
    const otherConsultation = acceptAnalysisEvent([], versions, event({ consultation_id: otherConsultationId }));
    expect(otherConsultation).toEqual({ outcome: 'rejected', reason: 'consultation_mismatch' });
    withoutText(otherConsultation);
    const otherPerson = acceptAnalysisEvent([], versions, event({ person_id: otherPersonId }));
    expect(otherPerson).toEqual({ outcome: 'rejected', reason: 'person_mismatch' });
    withoutText(otherPerson);
    const ambiguous = acceptAnalysisEvent([], [
      version({ text: sourceText }),
      version({ consultation_id: otherConsultationId, text: '다른 상담의 합성 문장입니다.' }),
    ], event());
    expect(ambiguous).toEqual({ outcome: 'rejected', reason: 'ambiguous_version' });
    withoutText(ambiguous);
  });

  it('keeps an earlier event when a later event arrives first', () => {
    const laterFailure = acceptAnalysisEvent([], [version()], event({
      type: 'analysis.failed',
      event_id: otherEventId,
      occurred_at: '2026-10-29T03:00:00Z',
    }));
    expect(laterFailure.outcome).toBe('accepted');
    if (laterFailure.outcome !== 'accepted') return;
    const earlierSuccess = acceptAnalysisEvent(laterFailure.receipts, [version()], event({
      occurred_at: '2026-10-29T01:00:00Z',
    }));
    expect(earlierSuccess.outcome).toBe('accepted');
    if (earlierSuccess.outcome !== 'accepted') return;
    expect(earlierSuccess.receipts.map((receipt) => receipt.occurred_at)).toEqual([
      '2026-10-29T03:00:00Z',
      '2026-10-29T01:00:00Z',
    ]);
    expect(earlierSuccess.receipts.map((receipt) => receipt.type)).toEqual([
      'analysis.failed',
      'analysis.succeeded',
    ]);
    expect(earlierSuccess).not.toHaveProperty('latest');
    expect(earlierSuccess.effects).toEqual(unset);
  });
});
