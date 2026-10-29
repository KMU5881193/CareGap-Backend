import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { validateDraft } from './analysis.js';
import { AnalysisWorkflow } from './analysis-workflow.js';
import { SyntheticAnalysisProvider } from './analysis-mock.js';
import { syntheticAnalysisFixture } from './analysis-synthetic-fixture.js';
import { officialWelfareCatalog, syntheticWelfareCatalog } from './welfare-catalog.js';
import { WelfareRecommendationService } from './welfare-service.js';

const Mode = z.enum(['official_snapshot', 'synthetic']);
// Explicit staff checklist for this fixed synthetic scenario, NOT a general analysis-to-needs classifier.
const checklist = [
  { need: 'meal_support', label: '식사', finding_index: 0 },
  { need: 'mobility_support', label: '이동', finding_index: 1 },
  { need: 'medication_management', label: '복약', finding_index: 2 },
] as const;
export class HackathonDemoError extends Error {
  constructor(public readonly code: 'DEMO_ANALYSIS_FAILED' | 'DEMO_EVIDENCE_INVALID' | 'DEMO_REVIEW_FAILED' | 'DEMO_WELFARE_INVALID') { super(code); }
}

export async function runHackathonDemo(rawMode: unknown = 'official_snapshot') {
  const mode = Mode.parse(rawMode);
  const fixture = syntheticAnalysisFixture();
  const authorization = { async canAccess(actor: typeof fixture.actor, person: string) {
    return actor.user_id === fixture.actor.user_id && actor.role === 'staff' && person === fixture.input.person_id;
  } };
  const workflow = new AnalysisWorkflow({ authorization,
    records: { async getVersion(c, v) { return fixture.records.find(r => r.consultation_id === c && r.record_version_id === v) ?? null; } },
    provider: new SyntheticAnalysisProvider(), provider_kind: 'mock',
  });
  const created = await workflow.create(fixture.actor, fixture.input, 'hackathon-synthetic-v1');
  if (created.status !== 'succeeded' || !created.original || !created.edited) throw new HackathonDemoError('DEMO_ANALYSIS_FAILED');

  // Simulated staff actions only. Never use this CLI sequence to auto-approve live user records.
  const editedDraft = structuredClone(created.edited);
  editedDraft.questions[0] = '식사가 하루 두 번으로 줄어든 이유와 필요한 도움을 확인할까요?';
  const edited = await workflow.review(fixture.actor, created.id, { action: 'edit', expected_version: created.version, draft: editedDraft });
  const submitted = await workflow.review(fixture.actor, created.id, { action: 'submit', expected_version: edited.version });
  await workflow.review(fixture.actor, created.id, { action: 'approve', expected_version: submitted.version });
  const published = await workflow.published(fixture.actor, created.id);
  const stored = await workflow.get(fixture.actor, created.id);
  if (published.provider_kind !== 'mock' || published.review_state !== 'approved' || stored.status !== 'succeeded' || !published.draft
    || JSON.stringify(stored.original) !== JSON.stringify(created.original)) throw new HackathonDemoError('DEMO_REVIEW_FAILED');
  let draft;
  try { draft = validateDraft(published.draft, fixture.records); } catch { throw new HackathonDemoError('DEMO_EVIDENCE_INVALID'); }
  if (draft.findings.length !== checklist.length || draft.findings.some(finding =>
    !fixture.records.every(record => finding.evidence.some(e => e.consultation_id === record.consultation_id && e.record_version_id === record.record_version_id)))) {
    throw new HackathonDemoError('DEMO_EVIDENCE_INVALID');
  }
  const findings = draft.findings.map((finding, index) => ({ finding_id: `demo-finding-${index + 1}`, ...finding }));
  const needs = checklist.map(item => ({ need: item.need, label: item.label, status: 'simulated_staff_confirmed' as const,
    finding_id: findings[item.finding_index].finding_id, analysis_id: published.id, analysis_version: published.version }));
  const recommendationInput = { person_id: fixture.input.person_id, needs: needs.map(n => n.need), region: null, age_group: null, income_status: 'unknown' };
  const welfareService = new WelfareRecommendationService({ authorization, catalog: mode === 'official_snapshot' ? officialWelfareCatalog() : syntheticWelfareCatalog() });
  const welfare = await welfareService.recommend(fixture.actor, recommendationInput);
  if (welfare.person_id !== fixture.input.person_id) throw new HackathonDemoError('DEMO_WELFARE_INVALID');
  for (const candidate of welfare.candidates) {
    const { program } = await welfareService.get(fixture.actor, candidate.program_id);
    if (candidate.eligibility_status !== 'unverified' || candidate.source_url !== program.source_url || candidate.checked_at !== program.checked_at
      || candidate.data_status !== program.data_status || candidate.program_name !== program.name
      || !candidate.missing_information.length || !candidate.matched_needs.length || candidate.basis.length !== candidate.matched_needs.length
      || candidate.matched_needs.some(need => !needs.some(n => n.need === need))
      || candidate.basis.some((basis, index) => !program.need_links.some(link => link.need === candidate.matched_needs[index] && link.need === basis.need
        && link.condition === basis.program_condition && link.source_excerpt === basis.source_excerpt))) throw new HackathonDemoError('DEMO_WELFARE_INVALID');
  }
  return { data: {
    demo: { synthetic_input: true, provider_kind: 'mock' as const, real_llm_called: false, review_mode: 'simulated_staff' as const,
      need_confirmation_mode: 'fixed_synthetic_checklist' as const, catalog_mode: mode,
      warning: '합성 Mock 시연입니다. 실제 LLM·의료 판단·실제 담당자의 승인·수급 자격 확정이 아닙니다.' },
    person_id: fixture.input.person_id,
    analysis: { id: published.id, status: stored.status, review_state: published.review_state, version: published.version,
      evidence_validation: 'passed' as const, original_preserved: true, input_versions: [...fixture.input.past, fixture.input.current], findings,
      questions: draft.questions, review_history: stored.history.map(({ action, actor_id, at, version }) => ({ action, actor_id, at, version })),
      warning: '인용 일치는 출처 확인이며 사실 해석·진단의 정확성을 보증하지 않습니다. 변화 라벨을 건강 악화로 표시하지 마세요.' },
    needs, unknown_information: { region: null, age_group: null, income_status: 'unknown' as const },
    welfare: { algorithm: welfare.algorithm, candidates: welfare.candidates, unmatched_needs: welfare.unmatched_needs, disclaimer: welfare.disclaimer },
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length > 3) throw new z.ZodError([]);
    console.log(JSON.stringify(await runHackathonDemo(process.argv[2]), null, 2));
  } catch (error) {
    const code = error instanceof HackathonDemoError ? error.code : error instanceof z.ZodError ? 'INVALID_REQUEST' : 'DEMO_FAILED';
    console.error(JSON.stringify({ error: { code, message: code } })); process.exitCode = 1;
  }
}
