import type { Actor, RecordVersion } from '../../shared/contracts.js';
import { syntheticPast, syntheticCurrent } from './analysis-mock.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Code-owned synthetic allowlist, not a caller-supplied "synthetic" flag or a PII detector.
export function syntheticAnalysisFixture() {
  const actor: Actor = { user_id: id(1), role: 'staff' };
  const records: RecordVersion[] = [
    { consultation_id: id(3), record_version_id: id(4), person_id: id(2), text: syntheticPast },
    { consultation_id: id(5), record_version_id: id(6), person_id: id(2), text: syntheticCurrent },
  ];
  return { actor, records, input: { person_id: id(2), past: [{ consultation_id: id(3), record_version_id: id(4) }], current: { consultation_id: id(5), record_version_id: id(6) } } };
}
