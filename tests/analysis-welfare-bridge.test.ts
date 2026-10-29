import { describe, expect, it, vi } from 'vitest';
import { AnalysisWorkflow } from '../src/modules/be3-intelligence/analysis-workflow.js';
import { SyntheticAnalysisProvider } from '../src/modules/be3-intelligence/analysis-mock.js';
import { syntheticAnalysisFixture } from '../src/modules/be3-intelligence/analysis-synthetic-fixture.js';
import { AnalysisWelfareBridge } from '../src/modules/be3-intelligence/analysis-welfare-bridge.js';
import { syntheticWelfareCatalog } from '../src/modules/be3-intelligence/welfare-catalog.js';
import { WelfareRecommendationService } from '../src/modules/be3-intelligence/welfare-service.js';

async function setup(state: 'draft' | 'review' | 'approved' | 'rejected' = 'approved') {
  const f = syntheticAnalysisFixture();
  let allowed = true;
  const authorization = { async canAccess(a: typeof f.actor, person: string) { return allowed && a.user_id === f.actor.user_id && person === f.input.person_id; } };
  const workflow = new AnalysisWorkflow({ authorization, provider: new SyntheticAnalysisProvider(), provider_kind: 'mock',
    records: { async getVersion(c, v) { return f.records.find(r => r.consultation_id === c && r.record_version_id === v) ?? null; } },
  });
  const entry = await workflow.create(f.actor, f.input, 'bridge-test');
  if (state !== 'draft') await workflow.review(f.actor, entry.id, { action: 'submit', expected_version: 1 });
  if (state === 'approved' || state === 'rejected') await workflow.review(f.actor, entry.id, { action: state === 'approved' ? 'approve' : 'reject', expected_version: 2 });
  const catalog = syntheticWelfareCatalog();
  const list = vi.spyOn(catalog, 'list');
  const welfare = new WelfareRecommendationService({ authorization, catalog });
  const recommend = vi.spyOn(welfare, 'recommend');
  const bridge = new AnalysisWelfareBridge(workflow, welfare);
  const input = { analysis_id: entry.id, expected_analysis_version: 3,
    confirmations: [{ need: 'meal_support', finding_index: 0, evidence_index: 1, confirmed: true }] };
  return { ...f, bridge, input, list, recommend, revoke() { allowed = false; } };
}

describe('approved analysis to explicitly confirmed welfare needs', () => {
  it('passes only the staff-selected need, preserves provenance, and leaves demographics unknown', async () => {
    const s = await setup(); const result = await s.bridge.recommend(s.actor, s.input);
    expect(s.recommend).toHaveBeenCalledExactlyOnceWith(s.actor, { person_id: s.records[0].person_id,
      needs: ['meal_support'], region: null, age_group: null, income_status: 'unknown' });
    expect(result.data.candidates.map(c => c.program_id)).toEqual(['demo-meal']);
    expect(result.data.candidates[0]).toMatchObject({ eligibility_status: 'unverified', data_status: 'synthetic_demo' });
    expect(result.connection).toMatchObject({ analysis_version: 3, review_state: 'approved', confirmed_by: s.actor.user_id, needs_origin: 'explicit_staff_confirmation' });
    expect(result.connection.confirmations[0].evidence.quote).toBe('최근 일주일 동안 식사를 하루 두 번 했다고 함.');
  });
  it.each(['draft', 'review', 'rejected'] as const)('blocks %s analysis before invoking recommendations', async state => {
    const s = await setup(state);
    await expect(s.bridge.recommend(s.actor, s.input)).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    expect(s.recommend).not.toHaveBeenCalled();
  });
  it('rejects a stale approval version', async () => {
    const s = await setup();
    await expect(s.bridge.recommend(s.actor, { ...s.input, expected_analysis_version: 2 })).rejects.toMatchObject({ code: 'ANALYSIS_VERSION_CONFLICT' });
    expect(s.recommend).not.toHaveBeenCalled();
  });
  it.each([{ finding_index: 100 }, { evidence_index: 100 }])('rejects absent evidence %j', async change => {
    const s = await setup();
    await expect(s.bridge.recommend(s.actor, { ...s.input, confirmations: [{ ...s.input.confirmations[0], ...change }] })).rejects.toMatchObject({ code: 'NEED_EVIDENCE_MISSING' });
    expect(s.recommend).not.toHaveBeenCalled();
  });
  it.each(['empty', 'unconfirmed', 'unsupported', 'duplicate', 'inferred_income'] as const)('rejects invalid confirmation: %s', async kind => {
    const s = await setup(); const raw = structuredClone(s.input) as Record<string, any>;
    if (kind === 'empty') raw.confirmations = [];
    if (kind === 'unconfirmed') raw.confirmations[0].confirmed = false;
    if (kind === 'unsupported') raw.confirmations[0].need = 'diagnosis';
    if (kind === 'duplicate') raw.confirmations.push(raw.confirmations[0]);
    if (kind === 'inferred_income') raw.income_status = 'self_reported_low';
    await expect(s.bridge.recommend(s.actor, raw)).rejects.toThrow();
    expect(s.recommend).not.toHaveBeenCalled();
  });
  it('rejects non-staff and another staff owner', async () => {
    const s = await setup();
    await expect(s.bridge.recommend({ ...s.actor, role: 'family' }, s.input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(s.bridge.recommend({ ...s.actor, user_id: '00000000-0000-4000-8000-000000000099' }, s.input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(s.recommend).not.toHaveBeenCalled();
  });
  it('rejects changed BE2 source text after approval', async () => {
    const s = await setup(); s.records[1].text = 'changed synthetic record';
    await expect(s.bridge.recommend(s.actor, s.input)).rejects.toMatchObject({ code: 'SOURCE_MISMATCH' });
    expect(s.recommend).not.toHaveBeenCalled();
  });
  it('rejects revoked access', async () => {
    const s = await setup(); s.revoke();
    await expect(s.bridge.recommend(s.actor, s.input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(s.recommend).not.toHaveBeenCalled();
  });
  it('rejects source changes while the asynchronous catalog loads', async () => {
    const s = await setup(); const programs = await syntheticWelfareCatalog().list();
    s.list.mockImplementation(async () => { s.records[1].text = 'changed during catalog read'; return programs; });
    await expect(s.bridge.recommend(s.actor, s.input)).rejects.toMatchObject({ code: 'SOURCE_MISMATCH' });
  });
  it('rejects revocation while the asynchronous catalog loads', async () => {
    const s = await setup(); const programs = await syntheticWelfareCatalog().list();
    s.list.mockImplementation(async () => { s.revoke(); return programs; });
    await expect(s.bridge.recommend(s.actor, s.input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('does not accept a caller-provided approval or fabricated quote', async () => {
    const s = await setup();
    await expect(s.bridge.recommend(s.actor, { ...s.input, review_state: 'approved',
      confirmations: [{ ...s.input.confirmations[0], evidence: { quote: 'invented' } }] })).rejects.toThrow();
    expect(s.recommend).not.toHaveBeenCalled();
  });
});
