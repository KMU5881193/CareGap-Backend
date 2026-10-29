// Synthetic service demo only. No HTTP listener, credentials, model or external data.
import { AnalysisWorkflow } from './analysis-workflow.js';
import { SyntheticAnalysisProvider, syntheticPast, syntheticCurrent } from './analysis-mock.js';
import type { Actor, RecordVersion } from '../../shared/contracts.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor: Actor = { user_id: id(1), role: 'staff' };
const rows: RecordVersion[] = [
  { consultation_id: id(3), record_version_id: id(4), person_id: id(2), text: syntheticPast },
  { consultation_id: id(5), record_version_id: id(6), person_id: id(2), text: syntheticCurrent },
];
const workflow = new AnalysisWorkflow({
  authorization: { async canAccess(a, person) { return a.user_id === actor.user_id && a.role === 'staff' && person === id(2); } },
  records: { async getVersion(c, v) { return rows.find(r => r.consultation_id === c && r.record_version_id === v) ?? null; } },
  provider: new SyntheticAnalysisProvider(), provider_kind: 'mock',
});
const analysis = await workflow.create(actor, { person_id: id(2), past: [{ consultation_id: id(3), record_version_id: id(4) }], current: { consultation_id: id(5), record_version_id: id(6) } }, 'synthetic-demo');
await workflow.review(actor, analysis.id, { action: 'submit', expected_version: 1 });
await workflow.review(actor, analysis.id, { action: 'approve', expected_version: 2 });
console.log(JSON.stringify({ data: await workflow.published(actor, analysis.id) }, null, 2));
