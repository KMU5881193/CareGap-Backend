import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import type { Actor } from '../src/shared/contracts.js';
import { WelfareProgram, WelfareRecommendationInput } from '../src/modules/be3-intelligence/welfare-contracts.js';
import { syntheticWelfareCatalog, InMemoryWelfareCatalog } from '../src/modules/be3-intelligence/welfare-catalog.js';
import { WelfareRecommendationService } from '../src/modules/be3-intelligence/welfare-service.js';
import { runWelfareDemo, welfareDemoInput } from '../src/modules/be3-intelligence/welfare-demo.js';

const actor: Actor = { user_id: '00000000-0000-4000-8000-000000000001', role: 'staff' };
async function setup() {
  const rows = z.array(WelfareProgram).parse(await syntheticWelfareCatalog().list());
  const catalog = { list: vi.fn(async (): Promise<unknown> => rows) };
  const canAccess = vi.fn(async () => true);
  const now = () => new Date('2026-10-29T12:00:00Z');
  const service = new WelfareRecommendationService({ catalog, authorization: { canAccess }, now });
  return { rows, catalog, canAccess, service, input: welfareDemoInput() };
}
// Synthetic fixture for status-validation tests only, not a published/real welfare program.
function statusFixture(base: WelfareProgram): WelfareProgram {
  return { ...structuredClone(base), name: '출처 상태 검증용 가상 자료', data_status: 'verified_official',
    source_url: 'https://www.mohw.go.kr/example-test-only', checked_at: '2026-10-29T00:00:00Z',
    need_links: [{ need: 'meal_support', condition: '가상 조건 검증', source_excerpt: '가상 발췌' }] };
}
const network = vi.fn(() => { throw Error('NETWORK_FORBIDDEN'); });
beforeEach(() => { network.mockClear(); vi.stubGlobal('fetch', network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('welfare schema and catalog boundaries', () => {
  it('has every required field and explicit synthetic status', async () => {
    const s = await setup();
    for (const p of s.rows) {
      expect(Object.keys(p)).toEqual(expect.arrayContaining(['id', 'name', 'description', 'provider', 'target_group', 'region', 'eligibility_summary', 'required_conditions', 'support_summary', 'application_method', 'source_url', 'checked_at', 'data_status']));
      expect(p.name).toMatch(/^\[합성\]/); expect(p.source_url).toBeNull(); expect(p.checked_at).toBeNull();
    }
  });
  it('preserves unknown values without guessing income, region, age or health', () => {
    const input = WelfareRecommendationInput.parse(welfareDemoInput()); expect(input.region).toBeNull(); expect(input.age_group).toBeNull(); expect(input.income_status).toBe('unknown'); expect(input).not.toHaveProperty('diagnosis');
  });
  it.each(['region', 'age', 'income', 'duplicate', 'empty', 'private', 'id'])('rejects invalid personal input: %s', async kind => {
    const s = await setup(); const input: Record<string, unknown> = { ...s.input };
    if (kind === 'region') input.region = 'exact private address';
    if (kind === 'age') input.age_group = 'elderly_guess';
    if (kind === 'income') input.income_status = 'eligible';
    if (kind === 'duplicate') input.needs = ['meal_support', 'meal_support'];
    if (kind === 'empty') input.needs = [];
    if (kind === 'private') input.raw_consultation = 'not accepted';
    if (kind === 'id') input.person_id = 'not-uuid';
    await expect(s.service.recommend(actor, input)).rejects.toBeInstanceOf(z.ZodError); expect(s.canAccess).not.toHaveBeenCalled(); expect(s.catalog.list).not.toHaveBeenCalled();
  });
  it.each(['missing-url', 'missing-time', 'missing-excerpt', 'unofficial-host', 'unsafe-url', 'synthetic-name'])('rejects unsupported official assertions: %s', async kind => {
    const s = await setup(); const p = statusFixture(s.rows[0]);
    if (kind === 'missing-url') p.source_url = null;
    if (kind === 'missing-time') p.checked_at = null;
    if (kind === 'missing-excerpt') p.need_links[0].source_excerpt = null;
    if (kind === 'unofficial-host') p.source_url = 'https://example.com';
    if (kind === 'unsafe-url') p.source_url = 'javascript:alert(1)';
    if (kind === 'synthetic-name') p.name = '[합성] 잘못된 상태';
    s.catalog.list.mockResolvedValue([p]); await expect(s.service.list(actor)).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
  });
  it('rejects duplicate program IDs and malformed/oversized catalogs', async () => {
    const s = await setup();
    for (const raw of [[s.rows[0], s.rows[0]], {}, Array.from({ length: 251 }, () => s.rows[0]), [{ ...s.rows[0], id: undefined }]]) {
      s.catalog.list.mockResolvedValue(raw); await expect(s.service.list(actor)).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
    }
  });
  it.each(['not a URL', 'http://www.mohw.go.kr', 'https://user:password@www.mohw.go.kr', 'https://www.mohw.go.kr:8443'])('rejects malformed/unsafe source URLs without leaking parser errors: %s', async source_url => {
    const s = await setup(); const p = statusFixture(s.rows[0]); p.source_url = source_url; s.catalog.list.mockResolvedValue([p]);
    await expect(s.service.list(actor)).rejects.toMatchObject({ code: 'CATALOG_INVALID', status: 503 });
  });
  it('does not let a synthetic record borrow an official verification URL/time', async () => {
    const s = await setup(); expect(() => WelfareProgram.parse({ ...s.rows[0], source_url: 'https://www.mohw.go.kr', checked_at: '2026-10-29T00:00:00Z' })).toThrow();
  });
  it('clones stored and returned catalogs to prevent mutation', async () => {
    const s = await setup(); const repository = new InMemoryWelfareCatalog(s.rows); s.rows[0].name = '[합성] changed';
    const first = await repository.list(); expect(first[0].name).not.toBe(s.rows[0].name); first[0].name = '[합성] changed again';
    expect((await repository.list())[0].name).not.toBe(first[0].name);
  });
  it('sanitizes catalog exceptions', async () => {
    const s = await setup(); s.catalog.list.mockRejectedValue(Error('secret vendor failure'));
    const error = await s.service.list(actor).catch(e => e); expect(error.code).toBe('CATALOG_UNAVAILABLE'); expect(String(error)).not.toContain('secret'); expect(error.cause).toBeUndefined();
  });
  it('downgrades stale snapshots while preserving check time and URL', async () => {
    const s = await setup(); const p = statusFixture(s.rows[0]); p.checked_at = '2026-01-01T00:00:00Z'; s.catalog.list.mockResolvedValue([p]);
    const result = await s.service.recommend(actor, s.input); expect(result.candidates[0]).toMatchObject({ data_status: 'needs_verification', source_url: p.source_url, checked_at: p.checked_at, eligibility_status: 'unverified' });
    expect(result.candidates[0].missing_information).toContain('사업 정보와 출처 최신성 재확인 필요');
    expect((await s.service.list(actor, { data_status: 'verified_official' })).programs).toEqual([]);
  });
  it('rejects future check dates and invalid clock values', async () => {
    const s = await setup(); const p = statusFixture(s.rows[0]); p.checked_at = '2027-01-01T00:00:00Z'; s.catalog.list.mockResolvedValue([p]);
    await expect(s.service.list(actor)).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
    const bad = new WelfareRecommendationService({ catalog: syntheticWelfareCatalog(), authorization: { canAccess: s.canAccess }, now: () => new Date('invalid') });
    await expect(bad.list(actor)).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
  });
});

describe('program search', () => {
  it('lists, fetches and paginates stable results', async () => {
    const s = await setup(); const first = await s.service.list(actor, { limit: '1' }); expect(first.programs).toHaveLength(1); expect(first.total).toBe(3); expect(first.next_offset).toBe(1);
    const next = await s.service.list(actor, { limit: '1', offset: '1' }); expect(next.programs[0].id).not.toBe(first.programs[0].id);
    expect((await s.service.get(actor, first.programs[0].id)).program.id).toBe(first.programs[0].id);
    expect((await s.service.list(actor, { offset: '250' })).programs).toEqual([]);
  });
  it('filters by need, text, status, region and explicit age', async () => {
    const s = await setup(); s.rows[0].age_groups = ['age_65_plus'];
    expect((await s.service.list(actor, { need: 'meal_support', q: '식사', data_status: 'synthetic_demo' })).programs.map(p => p.id)).toEqual(['demo-meal']);
    expect((await s.service.list(actor, { region: 'busan' })).programs.map(p => p.id)).toEqual(['demo-meal']);
    expect((await s.service.list(actor, { region: 'seoul' })).programs.map(p => p.id)).toEqual(['demo-meal', 'demo-mobility']);
    expect((await s.service.list(actor, { age_group: 'age_65_plus' })).programs.map(p => p.id)).toEqual(['demo-meal']);
  });
  it('returns empty searches and 404 for nonexistent IDs', async () => {
    const s = await setup(); expect((await s.service.list(actor, { q: '존재하지않음' })).total).toBe(0);
    await expect(s.service.get(actor, 'missing-program')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
  it.each([{ limit: '101' }, { limit: '-1' }, { limit: ['1', '2'] }, { offset: '251' }, { q: ' ' }, { unknown: 'x' }, { region: 'unknown' }])('rejects malformed query %j', async query => {
    const s = await setup(); await expect(s.service.list(actor, query)).rejects.toBeInstanceOf(z.ZodError); expect(s.catalog.list).not.toHaveBeenCalled();
  });
});

describe('rules-only candidate recommendation', () => {
  it('matches all synthetic needs with grounds, missing information and no eligibility decision', async () => {
    const s = await setup(); const result = await s.service.recommend(actor, s.input);
    expect(result.candidates).toHaveLength(3); expect(result.unmatched_needs).toEqual([]); expect(result.algorithm).toBe('rules-v1');
    for (const candidate of result.candidates) {
      expect(candidate.eligibility_status).toBe('unverified'); expect(candidate.data_status).toBe('synthetic_demo'); expect(candidate.program_name).toMatch(/^\[합성\]/); expect(candidate.reason).toContain('미확인');
      expect(candidate.basis.map(b => b.need)).toEqual(candidate.matched_needs); expect(candidate.missing_information).toContain('거주지역 확인 필요');
      expect(candidate.warning).toContain('합성'); expect(candidate).not.toHaveProperty('score'); expect(candidate).not.toHaveProperty('probability'); expect(candidate).not.toHaveProperty('approved');
    }
    expect(result.disclaimer).toContain('판정하거나 보장하지 않습니다'); expect(s.input.income_status).toBe('unknown');
  });
  it('shows income uncertainty even when low income is self-reported', async () => {
    const s = await setup(); const unknown = await s.service.recommend(actor, s.input);
    expect(unknown.candidates.find(c => c.program_id === 'demo-meal')?.missing_information).toContain('소득·수급 관련 조건 확인 필요');
    for (const income_status of ['self_reported_low', 'self_reported_other'] as const) {
      const result = await s.service.recommend(actor, { ...s.input, income_status });
      const candidate = result.candidates.find(c => c.program_id === 'demo-meal')!; expect(candidate.eligibility_status).toBe('unverified'); expect(candidate.missing_information.some(s => s.includes('자가보고로 판정하지 않음'))).toBe(true);
    }
  });
  it('excludes known region mismatch without turning unknown region into nationwide', async () => {
    const s = await setup(); const result = await s.service.recommend(actor, { ...s.input, region: 'busan' });
    expect(result.candidates.map(c => c.program_id)).not.toContain('demo-mobility'); expect(result.unmatched_needs).toContain('mobility_support');
    expect(result.candidates.find(c => c.program_id === 'demo-medication')?.region_match).toBe('unknown');
    expect(result.candidates.find(c => c.program_id === 'demo-meal')?.region_match).toBe('national');
    expect((await s.service.recommend(actor, { ...s.input, region: 'seoul' })).candidates.find(c => c.program_id === 'demo-mobility')?.region_match).toBe('same_region');
  });
  it('excludes known age mismatch and keeps unknown age for follow-up', async () => {
    const s = await setup(); s.rows[0].age_groups = ['age_65_plus'];
    expect((await s.service.recommend(actor, { ...s.input, age_group: 'age_18_to64' })).candidates.map(c => c.program_id)).not.toContain('demo-meal');
    expect((await s.service.recommend(actor, s.input)).candidates.find(c => c.program_id === 'demo-meal')?.missing_information).toContain('연령대 확인 필요');
  });
  it('does not invent a program for unmatched needs', async () => {
    const s = await setup(); s.catalog.list.mockResolvedValue([s.rows[0]]);
    const result = await s.service.recommend(actor, { ...s.input, needs: ['medication_management'] }); expect(result.candidates).toEqual([]); expect(result.unmatched_needs).toEqual(['medication_management']);
  });
  it('marks missing sources unverified and never invents a URL', async () => {
    const s = await setup(); const p = { ...s.rows[0], name: '출처 미확인 가상 테스트 자료', data_status: 'needs_verification' as const }; s.catalog.list.mockResolvedValue([p]);
    const candidate = (await s.service.recommend(actor, s.input)).candidates[0]; expect(candidate.source_url).toBeNull(); expect(candidate.data_status).toBe('needs_verification'); expect(candidate.eligibility_status).toBe('unverified'); expect(candidate.missing_information).toContain('공식 출처 확인 필요'); expect(candidate.warning).toContain('미검증');
  });
  it('preserves catalog condition/excerpt in candidate grounds without fabrication', async () => {
    const s = await setup(); const result = await s.service.recommend(actor, s.input);
    for (const c of result.candidates) {
      const p = s.rows.find(p => p.id === c.program_id)!;
      for (const b of c.basis) { const link = p.need_links.find(l => l.need === b.need)!; expect(b.program_condition).toBe(link.condition); expect(b.source_excerpt).toBe(link.source_excerpt); }
    }
    expect(s.catalog.list).toHaveBeenCalledWith(); // No personal input is sent to the catalog.
  });
  it('returns deterministic ordering and deep copies', async () => {
    const s = await setup(); s.rows[0].need_links.push({ need: 'mobility_support', condition: '합성 이동 연계', source_excerpt: null });
    const result = await s.service.recommend(actor, s.input); expect(result.candidates[0].program_id).toBe('demo-meal');
    const saved = structuredClone(result); result.candidates[0].missing_information.length = 0;
    expect(await s.service.recommend(actor, s.input)).toEqual(saved);
  });
});

describe('personalized recommendation access', () => {
  it.each(['false', 'throws', 'truthy'])('fails closed before catalog access: %s', async mode => {
    const s = await setup(); s.canAccess.mockImplementation(async () => { if (mode === 'throws') throw Error('secret'); return mode === 'truthy' ? 'yes' as unknown as boolean : false; });
    await expect(s.service.recommend(actor, s.input)).rejects.toMatchObject({ code: 'FORBIDDEN' }); expect(s.catalog.list).not.toHaveBeenCalled();
  });
  it('rechecks revocation after asynchronous catalog access', async () => {
    const s = await setup(); s.catalog.list.mockImplementation(async () => { s.canAccess.mockResolvedValue(false); return s.rows; });
    await expect(s.service.recommend(actor, s.input)).rejects.toMatchObject({ code: 'FORBIDDEN' }); expect(s.canAccess).toHaveBeenCalledTimes(2);
  });
  it('checks each person and every request; role alone grants no access', async () => {
    const s = await setup(); await s.service.recommend(actor, s.input);
    expect(s.canAccess).toHaveBeenCalledWith(actor, s.input.person_id, 'analyze'); s.canAccess.mockResolvedValue(false);
    await expect(s.service.recommend({ ...actor, role: 'admin' }, s.input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(s.service.recommend(actor, { ...s.input, person_id: actor.user_id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rejects malformed actors at the service boundary', async () => {
    const s = await setup(); await expect(s.service.recommend({ user_id: 'bad', role: 'staff' }, s.input)).rejects.toBeInstanceOf(z.ZodError);
  });
  it('runs an offline synthetic demo without reading analysis records', async () => {
    const result = await runWelfareDemo(); expect(result.demo).toMatchObject({ mode: 'synthetic', input_origin: 'synthetic', analysis_integration: 'not_connected' }); expect(result.data.candidates).toHaveLength(3); expect(result.data.candidates.every(c => c.data_status === 'synthetic_demo')).toBe(true);
  });
});
