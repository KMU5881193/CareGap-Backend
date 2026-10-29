import { z } from 'zod';
import { Id } from '../../shared/contracts.js';

export const WelfareNeed = z.enum(['meal_support', 'mobility_support', 'medication_management']);
// BE3 draft codes for coarse regions only. No address, diagnosis or income amount is accepted.
export const WelfareRegion = z.enum(['seoul', 'busan', 'daegu', 'incheon', 'gwangju', 'daejeon', 'ulsan', 'sejong', 'gyeonggi', 'gangwon', 'chungbuk', 'chungnam', 'jeonbuk', 'jeonnam', 'gyeongbuk', 'gyeongnam', 'jeju']);
export const WelfareAgeGroup = z.enum(['under_18', 'age_18_to64', 'age_65_plus']);
export const WelfareDataStatus = z.enum(['verified_official', 'needs_verification', 'synthetic_demo']);
export const WelfareProgramId = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const Text = z.string().trim().min(1).max(1500);
const SourceUrl = z.url().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port;
  } catch { return false; }
}, 'HTTPS source without credentials required');
const unique = <T>(items: T[]) => new Set(items).size === items.length;

export const WelfareProgram = z.object({
  id: WelfareProgramId, name: Text, description: Text, provider: Text, target_group: Text,
  region: z.discriminatedUnion('scope', [
    z.object({ scope: z.literal('national') }).strict(),
    z.object({ scope: z.literal('regional'), code: WelfareRegion }).strict(),
    z.object({ scope: z.literal('unknown') }).strict(),
  ]),
  eligibility_summary: Text, required_conditions: z.array(Text).min(1).max(20),
  support_summary: Text, application_method: Text,
  source_url: SourceUrl.nullable(), checked_at: z.iso.datetime().nullable(), data_status: WelfareDataStatus,
  age_groups: z.array(WelfareAgeGroup).min(1).max(3).refine(unique).nullable(),
  income_review_required: z.boolean(),
  need_links: z.array(z.object({ need: WelfareNeed, condition: Text, source_excerpt: Text.nullable() }).strict()).min(1).max(3)
    .refine(links => unique(links.map(link => link.need)), 'Duplicate need link'),
}).strict().superRefine((program, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (program.data_status === 'synthetic_demo') {
    if (!program.name.startsWith('[합성]') || program.source_url !== null || program.checked_at !== null) invalid('Synthetic programs need an explicit name marker and no official verification claim');
  } else if (program.name.startsWith('[합성]')) invalid('Synthetic name cannot claim real program status');
  if (program.data_status === 'verified_official') {
    let host = '';
    try { host = program.source_url ? new URL(program.source_url).hostname : ''; } catch { /* invalid source is rejected below */ }
    if (!host.endsWith('.go.kr') || !program.checked_at || program.need_links.some(link => !link.source_excerpt)) invalid('Official snapshot requires government source, check time and support excerpts');
  }
});
export type WelfareProgram = z.infer<typeof WelfareProgram>;

export const WelfareRecommendationInput = z.object({
  person_id: Id,
  needs: z.array(WelfareNeed).min(1).max(3).refine(unique, 'Duplicate needs'),
  region: WelfareRegion.nullable(), age_group: WelfareAgeGroup.nullable(),
  income_status: z.enum(['unknown', 'self_reported_low', 'self_reported_other']),
}).strict();
export type WelfareRecommendationInput = z.infer<typeof WelfareRecommendationInput>;
const IntegerQuery = z.string().regex(/^\d{1,3}$/).transform(Number);
export const WelfareProgramQuery = z.object({
  q: z.string().trim().min(1).max(80).optional(), need: WelfareNeed.optional(), region: WelfareRegion.optional(),
  age_group: WelfareAgeGroup.optional(), data_status: WelfareDataStatus.optional(),
  limit: IntegerQuery.pipe(z.number().int().min(1).max(100)).optional(),
  offset: IntegerQuery.pipe(z.number().int().min(0).max(250)).optional(),
}).strict();

export const WELFARE_DISCLAIMER = '확인해 볼 후보 정보이며 실제 수급 자격·지원 제공·금액을 판정하거나 보장하지 않습니다. 관할 기관 확인이 필요합니다.';
export interface WelfareCatalogPort { list(): Promise<unknown> }
export class WelfareError extends Error {
  constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CATALOG_UNAVAILABLE' | 'CATALOG_INVALID', public readonly status: number) { super(code); }
}
