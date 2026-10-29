import { describe, it, expect } from 'vitest';
import { validateDraft } from '../src/modules/be3-intelligence/analysis.js';

const consultation_id = '11111111-1111-4111-8111-111111111111';
const record_version_id = '22222222-2222-4222-8222-222222222222';
const source = { consultation_id, record_version_id, text: '합성 기록: 이번 주에는 산책을 두 번 했습니다.' };
function draft(quote = '산책을 두 번') {
  return { status: 'draft', findings: [{ text: '주간 산책 기록', change: 'unknown', evidence: [{ consultation_id, record_version_id, quote }] }], questions: [] };
}
describe('BE3 draft evidence boundary', () => {
  it('keeps unknown distinct from unchanged', () => {
    expect(validateDraft(draft(), [source]).findings[0].change).toBe('unknown');
  });
  it('rejects fabricated quotes', () => {
    expect(() => validateDraft(draft('매일 운동'), [source])).toThrow();
  });
  it('rejects missing source versions', () => {
    expect(() => validateDraft(draft(), [{ ...source, record_version_id: consultation_id }])).toThrow();
  });
  it('rejects findings without evidence', () => {
    const input = draft(); input.findings[0].evidence = [];
    expect(() => validateDraft(input, [source])).toThrow();
  });
  it('rejects ambiguous duplicate versions', () => {
    expect(() => validateDraft(draft(), [source, { ...source, text: '다른 원문' }])).toThrow();
  });
  it('never accepts a published result as a draft', () => {
    expect(() => validateDraft({ ...draft(), status: 'published' }, [source])).toThrow();
  });
});
