import { pathToFileURL } from 'node:url';
import type { Actor } from '../../shared/contracts.js';
import { officialWelfareCatalog, syntheticWelfareCatalog } from './welfare-catalog.js';
import { WelfareRecommendationService } from './welfare-service.js';
import { WelfareRecommendationInput } from './welfare-contracts.js';

export function welfareDemoInput() {
  return WelfareRecommendationInput.parse({ person_id: '00000000-0000-4000-8000-000000000002',
    needs: ['meal_support', 'mobility_support', 'medication_management'], region: null, age_group: null, income_status: 'unknown' });
}
export async function runWelfareDemo(mode: 'synthetic' | 'official_snapshot' = 'synthetic') {
  const input = welfareDemoInput();
  const actor: Actor = { user_id: '00000000-0000-4000-8000-000000000001', role: 'staff' };
  const service = new WelfareRecommendationService({ catalog: mode === 'synthetic' ? syntheticWelfareCatalog() : officialWelfareCatalog(),
    authorization: { async canAccess(a, person, action) { return a.user_id === actor.user_id && a.role === 'staff' && person === input.person_id && action === 'analyze'; } } });
  return { demo: { mode, input_origin: 'synthetic', scenario: '식사·외출·복약 관련 필요를 구조화한 합성 사례', input, analysis_integration: 'not_connected' }, data: await service.recommend(actor, input) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] ?? 'synthetic';
  if (process.argv.length > 3 || !['synthetic', 'official_snapshot'].includes(mode)) { console.error(JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'INVALID_REQUEST' } })); process.exitCode = 1; }
  else {
    try { console.log(JSON.stringify(await runWelfareDemo(mode as 'synthetic' | 'official_snapshot'), null, 2)); }
    catch { console.error(JSON.stringify({ error: { code: 'DEMO_FAILED', message: 'DEMO_FAILED' } })); process.exitCode = 1; }
  }
}
