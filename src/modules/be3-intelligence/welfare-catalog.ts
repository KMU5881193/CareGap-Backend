import { WelfareProgram, type WelfareCatalogPort } from './welfare-contracts.js';

// Manually checked public snapshot, NOT live synchronization or an eligibility decision.
const officialSnapshot: WelfareProgram[] = [WelfareProgram.parse({
  id: 'mohw-tailored-elderly-care', name: '노인맞춤돌봄서비스', provider: '보건복지부 / 관할 시·군·구 및 수행기관',
  description: '돌봄이 필요한 노인의 일상생활 지원과 관련하여 확인할 수 있는 사업 안내입니다.',
  target_group: '만 65세 이상이며 수급·연금 등 안내된 대상 조건과 돌봄 필요성의 확인이 필요한 노인',
  region: { scope: 'national' },
  eligibility_summary: '수급·차상위·기초연금 관련 조건과 돌봄 필요성 등을 관할 기관이 확인하고 선정합니다.',
  required_conditions: ['만 65세 이상 여부 확인', '수급·차상위·기초연금 관련 대상 조건 확인', '돌봄 필요성·선정조사와 제공계획 확인', '관할 수행기관의 실제 제공 범위 확인'],
  support_summary: '식사관리와 외출동행 등이 안내되어 있으며 구체적 내용은 선정 및 제공계획 확인이 필요합니다.',
  application_method: '주민등록지 관할 읍·면·동 행정복지센터에 신청 절차와 서류를 확인합니다.',
  source_url: 'https://www.mohw.go.kr/menu.es?mid=a10712010400', checked_at: '2026-10-29T11:26:22Z', data_status: 'verified_official',
  age_groups: ['age_65_plus'], income_review_required: true,
  need_links: [
    { need: 'meal_support', condition: '제공계획에 따른 식사관리 지원 범위 확인', source_excerpt: '식사관리' },
    { need: 'mobility_support', condition: '제공계획에 따른 외출동행 지원 범위 확인', source_excerpt: '외출동행' },
  ],
})];

// All names and conditions below are deliberately fictional test data. No grants/amounts are promised.
const syntheticPrograms: WelfareProgram[] = [
  {
    id: 'demo-meal', name: '[합성] 식사 지원 연결 테스트', provider: '[합성] 테스트 기관',
    description: '실재하지 않는 식사 필요 매칭 시연 자료입니다.', target_group: '합성 시연 대상', region: { scope: 'national' },
    eligibility_summary: '실제 자격 기준이 없는 합성 자료입니다.', required_conditions: ['합성 식사 필요 확인', '실제 사업 탐색 및 관할 기관 확인'],
    support_summary: '식사 관련 후보 매칭만 시연하며 실제 지원은 제공하지 않습니다.', application_method: '신청 불가: 합성 시연 전용',
    source_url: null, checked_at: null, data_status: 'synthetic_demo', age_groups: null, income_review_required: true,
    need_links: [{ need: 'meal_support', condition: '합성 식사 지원 필요와 연관', source_excerpt: null }],
  },
  {
    id: 'demo-mobility', name: '[합성] 지역 이동 지원 연결 테스트', provider: '[합성] 테스트 기관',
    description: '실재하지 않는 지역별 이동 필요 매칭 시연 자료입니다.', target_group: '합성 시연 대상', region: { scope: 'regional', code: 'seoul' },
    eligibility_summary: '실제 자격 기준이 없는 합성 자료입니다.', required_conditions: ['합성 지역 범위 확인', '이동 지원 방식 확인'],
    support_summary: '이동 관련 후보 매칭만 시연하며 실제 지원은 제공하지 않습니다.', application_method: '신청 불가: 합성 시연 전용',
    source_url: null, checked_at: null, data_status: 'synthetic_demo', age_groups: null, income_review_required: false,
    need_links: [{ need: 'mobility_support', condition: '합성 이동 지원 필요와 연관', source_excerpt: null }],
  },
  {
    id: 'demo-medication', name: '[합성] 복약 확인 연결 테스트', provider: '[합성] 테스트 기관',
    description: '실재하지 않는 복약 관련 필요 매칭 시연 자료입니다.', target_group: '합성 시연 대상', region: { scope: 'unknown' },
    eligibility_summary: '실제 자격 기준이나 의료 판단이 없는 합성 자료입니다.', required_conditions: ['실제 서비스 존재 여부 및 지역 확인', '복약 관련 상담 필요를 담당자에게 확인'],
    support_summary: '복약 관련 후보 매칭만 시연하며 의료 서비스나 진단을 제공하지 않습니다.', application_method: '신청 불가: 합성 시연 전용',
    source_url: null, checked_at: null, data_status: 'synthetic_demo', age_groups: null, income_review_required: false,
    need_links: [{ need: 'medication_management', condition: '합성 복약 확인 필요와 연관', source_excerpt: null }],
  },
].map(program => WelfareProgram.parse(program));

export class InMemoryWelfareCatalog implements WelfareCatalogPort {
  #programs: WelfareProgram[];
  constructor(programs: readonly WelfareProgram[]) { this.#programs = programs.map(program => WelfareProgram.parse(program)); }
  async list() { return structuredClone(this.#programs); }
}
export function officialWelfareCatalog() { return new InMemoryWelfareCatalog(officialSnapshot); }
export function syntheticWelfareCatalog() { return new InMemoryWelfareCatalog(syntheticPrograms); }
