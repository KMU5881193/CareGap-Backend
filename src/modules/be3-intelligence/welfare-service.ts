import { z } from 'zod';
import { Actor, type AuthorizationPort } from '../../shared/contracts.js';
import { WelfareProgram, WelfareProgramId, WelfareProgramQuery, WelfareRecommendationInput, WelfareError, WELFARE_DISCLAIMER, type WelfareCatalogPort } from './welfare-contracts.js';

const Catalog = z.array(WelfareProgram).max(250).refine(programs => new Set(programs.map(p => p.id)).size === programs.length, 'Duplicate program ID');
const labels = { meal_support: '식사 지원', mobility_support: '이동 지원', medication_management: '복약 확인' };
// Internal snapshot freshness policy, not an official update or eligibility period.
export const WELFARE_SOURCE_MAX_AGE_DAYS = 30;
export class WelfareRecommendationService {
  constructor(private deps: { catalog: WelfareCatalogPort; authorization: AuthorizationPort; now?: () => Date }) {}
  private async programs() {
    let raw: unknown;
    try { raw = await this.deps.catalog.list(); } catch { throw new WelfareError('CATALOG_UNAVAILABLE', 503); }
    const parsed = Catalog.safeParse(raw);
    if (!parsed.success) throw new WelfareError('CATALOG_INVALID', 503);
    const now = (this.deps.now?.() ?? new Date()).getTime();
    if (!Number.isFinite(now)) throw new WelfareError('CATALOG_INVALID', 503);
    return parsed.data.map(program => {
      if (program.checked_at && Date.parse(program.checked_at) > now) throw new WelfareError('CATALOG_INVALID', 503);
      if (program.data_status === 'verified_official' && now - Date.parse(program.checked_at!) > WELFARE_SOURCE_MAX_AGE_DAYS * 86_400_000) return { ...program, data_status: 'needs_verification' as const };
      return program;
    });
  }
  private async authorize(actor: Actor, personId: string) {
    let allowed = false;
    try { allowed = await this.deps.authorization.canAccess(actor, personId, 'analyze') === true; } catch { /* fail closed */ }
    if (!allowed) throw new WelfareError('FORBIDDEN', 403);
  }
  async list(actor: Actor, rawQuery: unknown = {}) {
    Actor.parse(actor);
    const query = WelfareProgramQuery.parse(rawQuery);
    let programs = await this.programs();
    if (query.q) { const q = query.q.toLocaleLowerCase('ko-KR'); programs = programs.filter(p => `${p.name} ${p.description}`.toLocaleLowerCase('ko-KR').includes(q)); }
    if (query.need) programs = programs.filter(p => p.need_links.some(link => link.need === query.need));
    if (query.region) programs = programs.filter(p => p.region.scope === 'national' || p.region.scope === 'regional' && p.region.code === query.region);
    if (query.age_group) programs = programs.filter(p => p.age_groups?.includes(query.age_group!) === true);
    if (query.data_status) programs = programs.filter(p => p.data_status === query.data_status);
    programs.sort((a, b) => a.id.localeCompare(b.id, 'en'));
    const offset = query.offset ?? 0, limit = query.limit ?? 20;
    return { programs: programs.slice(offset, offset + limit), total: programs.length, next_offset: offset + limit < programs.length ? offset + limit : null, disclaimer: WELFARE_DISCLAIMER };
  }
  async get(actor: Actor, rawId: unknown) {
    Actor.parse(actor); const id = WelfareProgramId.parse(rawId);
    const program = (await this.programs()).find(p => p.id === id);
    if (!program) throw new WelfareError('NOT_FOUND', 404);
    return { program, disclaimer: WELFARE_DISCLAIMER };
  }
  async recommend(actor: Actor, rawInput: unknown) {
    Actor.parse(actor); const input = WelfareRecommendationInput.parse(rawInput);
    await this.authorize(actor, input.person_id);
    const programs = await this.programs(); // Catalog never receives any person/needs/region data.
    await this.authorize(actor, input.person_id); // Recheck revocation after the asynchronous catalog read.
    const candidates = programs.flatMap(program => {
      const links = program.need_links.filter(link => input.needs.includes(link.need));
      if (!links.length) return [];
      if (input.region && program.region.scope === 'regional' && input.region !== program.region.code) return [];
      if (input.age_group && program.age_groups && !program.age_groups.includes(input.age_group)) return [];
      const missing = new Set<string>(program.required_conditions);
      if (!input.region) missing.add('거주지역 확인 필요');
      if (program.region.scope === 'unknown') missing.add('사업 제공지역 확인 필요');
      if (!input.age_group) missing.add('연령대 확인 필요');
      if (!program.age_groups) missing.add('사업의 연령 조건 확인 필요');
      if (program.income_review_required) missing.add(input.income_status === 'unknown' ? '소득·수급 관련 조건 확인 필요' : '소득·수급 관련 조건의 공식 확인 필요: 자가보고로 판정하지 않음');
      if (!program.source_url) missing.add('공식 출처 확인 필요');
      if (program.data_status === 'needs_verification') missing.add('사업 정보와 출처 최신성 재확인 필요');
      if (program.data_status === 'synthetic_demo') missing.add('실재하지 않는 합성 데이터: 실제 사업 별도 탐색 필요');
      return [{
        program_id: program.id, program_name: program.name,
        reason: `${links.map(link => labels[link.need]).join('·')} 필요와 관련하여 확인해 볼 후보입니다. 자격·지원 제공은 미확인입니다.`,
        eligibility_status: 'unverified' as const, matched_needs: links.map(link => link.need),
        basis: links.map(link => ({ need: link.need, program_condition: link.condition, source_excerpt: link.source_excerpt })),
        region_match: !input.region || program.region.scope === 'unknown' ? 'unknown' as const : program.region.scope === 'national' ? 'national' as const : 'same_region' as const,
        missing_information: [...missing], source_url: program.source_url, checked_at: program.checked_at, data_status: program.data_status,
        application_method: program.application_method,
        warning: program.data_status === 'synthetic_demo' ? '합성 시연 전용이며 실제 제도·혜택이 아닙니다.' : program.data_status === 'needs_verification' ? '출처 또는 최신성 미검증 정보이며 지원 제공을 보장하지 않습니다.' : '공식 안내 확인은 개인의 자격 확인을 뜻하지 않습니다.',
      }];
    }).sort((a, b) => b.matched_needs.length - a.matched_needs.length || a.program_id.localeCompare(b.program_id, 'en'));
    return { person_id: input.person_id, algorithm: 'rules-v1' as const, candidates,
      unmatched_needs: input.needs.filter(need => !candidates.some(candidate => candidate.matched_needs.includes(need))),
      disclaimer: WELFARE_DISCLAIMER };
  }
}
