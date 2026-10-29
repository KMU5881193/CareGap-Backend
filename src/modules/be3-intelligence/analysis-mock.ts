import type { AnalysisProvider, SourceVersion } from './analysis.js';

export const syntheticPast = '지난주에는 하루 세 끼 식사를 했다고 함. 무릎 통증으로 외출은 주 1회였다고 함. 약은 매일 복용했다고 함.';
export const syntheticCurrent = '최근 일주일 동안 식사를 하루 두 번 했다고 함. 무릎 통증으로 외출하지 못했다고 함. 약을 복용하지 않은 날이 2일 있었다고 함.';

// Fixture recognizer, NOT an AI model or a general Korean clinical text parser.
export class SyntheticAnalysisProvider implements AnalysisProvider {
  readonly provider_kind = 'mock';
  async generate(sources: readonly SourceVersion[]) {
    const current = sources.at(-1)!;
    const past = sources.slice(0, -1).find(s => s.text === syntheticPast);
    const evidence = (source: SourceVersion, quote: string) => ({ consultation_id: source.consultation_id, record_version_id: source.record_version_id, quote });
    if (!past || current.text !== syntheticCurrent) {
      return { status: 'draft', findings: sources.filter(s => s.text.trim()).map(s => ({ text: '이 기록에 대한 변화 판단은 unknown입니다. 합성 Mock의 지원 범위 밖입니다.', change: 'unknown', evidence: [evidence(s, s.text)] })), questions: ['이전 상담 이후 달라진 점이 있나요?', '다음 상담에서 추가로 확인할 사항이 있나요?'] };
    }
    const pairs = [
      ['식사 횟수: 하루 3회 → 하루 2회로 기록됨.', '지난주에는 하루 세 끼 식사를 했다고 함.', '최근 일주일 동안 식사를 하루 두 번 했다고 함.'],
      ['외출: 주 1회 → 외출하지 못함으로 기록됨.', '무릎 통증으로 외출은 주 1회였다고 함.', '무릎 통증으로 외출하지 못했다고 함.'],
      ['약 복용: 매일 복용 → 2일 미복용으로 기록됨.', '약은 매일 복용했다고 함.', '약을 복용하지 않은 날이 2일 있었다고 함.'],
    ];
    return { status: 'draft', findings: pairs.map(([text, before, after]) => ({ text, change: 'worsened', evidence: [evidence(past, before), evidence(current, after)] })), questions: ['식사가 하루 두 번으로 줄어든 이유는 무엇인가요?', '외출하지 못한 상황과 필요한 도움은 무엇인가요?', '약을 복용하지 못한 이틀의 이유는 무엇인가요?'] };
  }
}
