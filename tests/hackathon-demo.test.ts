import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runHackathonDemo } from '../src/modules/be3-intelligence/hackathon-demo.js';
import { SyntheticAnalysisProvider } from '../src/modules/be3-intelligence/analysis-mock.js';
import { syntheticAnalysisFixture } from '../src/modules/be3-intelligence/analysis-synthetic-fixture.js';
import { AnalysisWorkflow } from '../src/modules/be3-intelligence/analysis-workflow.js';
import { WelfareRecommendationService } from '../src/modules/be3-intelligence/welfare-service.js';

const network = vi.fn(() => { throw Error('NETWORK_FORBIDDEN'); });
beforeEach(() => { network.mockClear(); vi.stubGlobal('fetch', network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('fixed synthetic hackathon walkthrough', () => {
  it('preserves all three numeric/negative comparisons and exact paired version quotes', async () => {
    const { data } = await runHackathonDemo('synthetic');
    expect(data.analysis.findings.map(f => f.text)).toEqual(['식사 횟수: 하루 3회 → 하루 2회로 기록됨.', '외출: 주 1회 → 외출하지 못함으로 기록됨.', '약 복용: 매일 복용 → 2일 미복용으로 기록됨.']);
    const fixture = syntheticAnalysisFixture();
    for (const finding of data.analysis.findings) {
      expect(finding.evidence).toHaveLength(2);
      for (const evidence of finding.evidence) {
        const source = fixture.records.find(r => r.consultation_id === evidence.consultation_id && r.record_version_id === evidence.record_version_id);
        expect(source?.text).toContain(evidence.quote);
      }
    }
    expect(data.analysis.input_versions).toEqual([...fixture.input.past, fixture.input.current]);
    expect(data.analysis).toMatchObject({ evidence_validation: 'passed', original_preserved: true });
  });
  it('retains explicit edit/submit/approve actions, versions and reviewer identity', async () => {
    const { data } = await runHackathonDemo('synthetic');
    expect(data.analysis).toMatchObject({ status: 'succeeded', review_state: 'approved', version: 4 });
    expect(data.analysis.review_history.map(h => [h.action, h.version])).toEqual([['edit', 2], ['submit', 3], ['approve', 4]]);
    expect(data.analysis.review_history.every(h => h.actor_id === syntheticAnalysisFixture().actor.user_id && !!h.at)).toBe(true);
    expect(data.analysis.questions).toHaveLength(3);
  });
  it('associates each explicit simulated staff choice with an approved finding and version', async () => {
    const { data } = await runHackathonDemo('synthetic');
    expect(data.needs.map(n => n.need)).toEqual(['meal_support', 'mobility_support', 'medication_management']);
    for (const need of data.needs) {
      expect(need.status).toBe('simulated_staff_confirmed'); expect(need.analysis_id).toBe(data.analysis.id); expect(need.analysis_version).toBe(data.analysis.version);
      expect(data.analysis.findings.some(f => f.finding_id === need.finding_id)).toBe(true);
    }
    expect(data.unknown_information).toEqual({ region: null, age_group: null, income_status: 'unknown' });
  });
  it('is still Mock with LLM-looking environment values and never executes the LLM provider', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'FAKE_UNUSED'); vi.stubEnv('CAREGAP_LLM_APPROVED', 'synthetic-only-cost-approved');
    const { data } = await runHackathonDemo('synthetic'); expect(data.demo).toMatchObject({ provider_kind: 'mock', real_llm_called: false, synthetic_input: true, review_mode: 'simulated_staff' });
    expect(JSON.stringify(data)).not.toContain('FAKE_UNUSED'); expect(data.demo.warning).toContain('실제 LLM');
  });
  it('shows only fictional programs in synthetic mode with unverified eligibility', async () => {
    const { data } = await runHackathonDemo('synthetic'); expect(data.welfare.candidates).toHaveLength(3); expect(data.welfare.unmatched_needs).toEqual([]);
    for (const c of data.welfare.candidates) { expect(c.program_name).toMatch(/^\[합성\]/); expect(c.data_status).toBe('synthetic_demo'); expect(c.eligibility_status).toBe('unverified'); expect(c.source_url).toBeNull(); expect(c.warning).toContain('실제 제도·혜택이 아닙니다'); }
  });
  it.each(['bad-mode', 'llm', '', null, {}])('rejects unsupported mode %j rather than selecting a live provider', async mode => {
    await expect(runHackathonDemo(mode)).rejects.toThrow();
  });
  it.each(['missing', 'fabricated', 'version'])('does not recommend after an invalid analysis: %s', async mode => {
    const original = SyntheticAnalysisProvider.prototype.generate;
    vi.spyOn(SyntheticAnalysisProvider.prototype, 'generate').mockImplementation(async function (this: SyntheticAnalysisProvider, sources) {
      const draft = await original.call(this, sources);
      if (mode === 'missing') draft.findings[0].evidence = [];
      if (mode === 'fabricated') draft.findings[0].evidence[0].quote = '조작된 인용';
      if (mode === 'version') draft.findings[0].evidence[0].record_version_id = sources[1].record_version_id;
      return draft;
    });
    const recommend = vi.spyOn(WelfareRecommendationService.prototype, 'recommend');
    await expect(runHackathonDemo('synthetic')).rejects.toMatchObject({ code: 'DEMO_ANALYSIS_FAILED' }); expect(recommend).not.toHaveBeenCalled();
  });
  it('requires the existing approved-publication gate before any recommendation', async () => {
    vi.spyOn(AnalysisWorkflow.prototype, 'published').mockRejectedValue(Error('not approved'));
    const recommend = vi.spyOn(WelfareRecommendationService.prototype, 'recommend');
    await expect(runHackathonDemo('synthetic')).rejects.toThrow('not approved'); expect(recommend).not.toHaveBeenCalled();
  });
  it('refuses unapproved publication responses', async () => {
    const original = AnalysisWorkflow.prototype.published;
    vi.spyOn(AnalysisWorkflow.prototype, 'published').mockImplementation(async function (this: AnalysisWorkflow, actor, id) {
      return { ...await original.call(this, actor, id), review_state: 'review' };
    });
    await expect(runHackathonDemo('synthetic')).rejects.toMatchObject({ code: 'DEMO_REVIEW_FAILED' });
  });
  it('verifies candidate grounds against the catalog instead of inventing a connection', async () => {
    const original = WelfareRecommendationService.prototype.recommend;
    vi.spyOn(WelfareRecommendationService.prototype, 'recommend').mockImplementation(async function (this: WelfareRecommendationService, actor, input) {
      const result = await original.call(this, actor, input); result.candidates[0].basis[0].program_condition = '조작된 조건'; return result;
    });
    await expect(runHackathonDemo('synthetic')).rejects.toMatchObject({ code: 'DEMO_WELFARE_INVALID' });
  });
  it('keeps the FE result compact by omitting full sources, draft snapshots and provider configuration', async () => {
    const { data } = await runHackathonDemo('synthetic');
    expect(data.analysis).not.toHaveProperty('sources'); expect(data.analysis).not.toHaveProperty('original'); expect(data.analysis).not.toHaveProperty('edited');
    expect(data.analysis.review_history.every(h => !('draft' in h))).toBe(true); expect(data).not.toHaveProperty('config');
  });
});
