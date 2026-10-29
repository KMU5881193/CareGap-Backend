import { AnalysisWorkflow } from '../src/modules/be3-intelligence/analysis-workflow.js';
import { SyntheticAnalysisProvider } from '../src/modules/be3-intelligence/analysis-mock.js';
import { syntheticAnalysisFixture } from '../src/modules/be3-intelligence/analysis-synthetic-fixture.js';
import { AnalysisWelfareBridge } from '../src/modules/be3-intelligence/analysis-welfare-bridge.js';
import { syntheticWelfareCatalog } from '../src/modules/be3-intelligence/welfare-catalog.js';
import { WelfareRecommendationService } from '../src/modules/be3-intelligence/welfare-service.js';
import type { AuthorizationPort } from '../src/shared/contracts.js';

const fixture = syntheticAnalysisFixture();
const authorization: AuthorizationPort = { async canAccess(actor, person) {
  return actor.user_id === fixture.actor.user_id && actor.role === 'staff' && person === fixture.input.person_id;
} };
const workflow = new AnalysisWorkflow({ authorization, provider: new SyntheticAnalysisProvider(), provider_kind: 'mock',
  records: { async getVersion(c, v) { return fixture.records.find(record => record.consultation_id === c && record.record_version_id === v) ?? null; } },
});
const welfare = new WelfareRecommendationService({ authorization, catalog: syntheticWelfareCatalog() });
const draft = await workflow.create(fixture.actor, fixture.input, 'synthetic-analysis-welfare-e2e');
if (draft.status !== 'succeeded') throw new Error('DEMO_ANALYSIS_FAILED');
// These actions simulate a staff member only in this code-owned synthetic CLI.
await workflow.review(fixture.actor, draft.id, { action: 'submit', expected_version: 1 });
const approved = await workflow.review(fixture.actor, draft.id, { action: 'approve', expected_version: 2 });
const result = await new AnalysisWelfareBridge(workflow, welfare).recommend(fixture.actor, {
  analysis_id: approved.id, expected_analysis_version: approved.version,
  confirmations: [
    { need: 'meal_support', finding_index: 0, evidence_index: 1, confirmed: true },
    { need: 'mobility_support', finding_index: 1, evidence_index: 1, confirmed: true },
    { need: 'medication_management', finding_index: 2, evidence_index: 1, confirmed: true },
  ],
});
console.log(JSON.stringify({
  demo: {
    input_origin: 'code_owned_synthetic_records', analysis_provider: 'mock', catalog: 'synthetic_demo',
    evidence_validation: 'passed', staff_approval: 'simulated', need_confirmation: 'simulated_explicit_staff_selection',
    automatic_connection: 'approved_analysis_and_confirmed_needs_to_existing_welfare_service',
    be1_authentication: 'fixture_only', be2_record_storage: 'fixture_only', external_calls: false,
    steps: ['synthetic_records', 'analysis_draft', 'exact_evidence_validation', 'staff_approval', 'explicit_need_confirmation', 'welfare_candidates'],
  },
  ...result,
}, null, 2));
