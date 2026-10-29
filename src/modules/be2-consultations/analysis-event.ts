import { z } from 'zod';
import { Id, type RecordVersion } from '../../shared/contracts.js';
import { UtcInstant, compareUtcInstants } from './availability.js';
import { readRecordVersion } from './consultation-record.js';

// Event names come from the shared draft. The payload list there has no type field.
export const AnalysisEvent = z.object({
  type: z.enum(['analysis.succeeded', 'analysis.failed']),
  event_id: Id,
  occurred_at: UtcInstant,
  analysis_id: Id,
  consultation_id: Id,
  record_version_id: Id,
  person_id: Id,
}).strict();

export type AnalysisEvent = z.infer<typeof AnalysisEvent>;

export type AnalysisEventEffects = { configured: false; reason: 'policy_unset' };

function unsetEffects(): AnalysisEventEffects {
  return { configured: false, reason: 'policy_unset' };
}

export type AnalysisEventDecision =
  | { outcome: 'accepted'; receipt: AnalysisEvent; effects: AnalysisEventEffects; receipts: AnalysisEvent[] }
  | { outcome: 'duplicate'; receipt: AnalysisEvent; effects: AnalysisEventEffects }
  | { outcome: 'conflict'; reason: 'event_id_conflict' }
  | { outcome: 'rejected'; reason: 'not_found' | 'consultation_mismatch' | 'person_mismatch' | 'ambiguous_version' };

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function copyEvent(input: unknown): AnalysisEvent {
  const parsed = AnalysisEvent.parse(input);
  return {
    type: parsed.type,
    event_id: parsed.event_id,
    occurred_at: parsed.occurred_at,
    analysis_id: parsed.analysis_id,
    consultation_id: parsed.consultation_id,
    record_version_id: parsed.record_version_id,
    person_id: parsed.person_id,
  };
}

function sameContent(left: AnalysisEvent, right: AnalysisEvent): boolean {
  return left.type === right.type
    && compareUtcInstants(left.occurred_at, right.occurred_at) === 0
    && sameUuid(left.analysis_id, right.analysis_id)
    && sameUuid(left.consultation_id, right.consultation_id)
    && sameUuid(left.record_version_id, right.record_version_id)
    && sameUuid(left.person_id, right.person_id);
}

// Receipt order is not an analysis timeline. Accepted events do not send notifications or create work.
export function acceptAnalysisEvent(
  receipts: readonly AnalysisEvent[],
  versions: readonly RecordVersion[],
  event: unknown,
): AnalysisEventDecision {
  const incoming = copyEvent(event);
  const stored = receipts.map((receipt) => copyEvent(receipt));
  const prior = stored.find((receipt) => sameUuid(receipt.event_id, incoming.event_id));
  if (prior) {
    if (!sameContent(prior, incoming)) return { outcome: 'conflict', reason: 'event_id_conflict' };
    return { outcome: 'duplicate', receipt: { ...prior }, effects: unsetEffects() };
  }
  const version = readRecordVersion(versions, incoming.consultation_id, incoming.record_version_id);
  if (!version.found) return { outcome: 'rejected', reason: version.reason };
  if (!sameUuid(version.version.person_id, incoming.person_id)) {
    return { outcome: 'rejected', reason: 'person_mismatch' };
  }
  return {
    outcome: 'accepted',
    receipt: { ...incoming },
    effects: unsetEffects(),
    receipts: [...stored, incoming],
  };
}
