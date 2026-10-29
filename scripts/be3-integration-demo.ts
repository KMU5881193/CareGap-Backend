import sharp from 'sharp';
import type { Actor, AuthorizationPort } from '../src/shared/contracts.js';
import { InMemoryOcrRepository, MockOcrProvider, OcrService } from '../src/modules/be3-intelligence/ocr.js';
import { InMemoryTranscriptRepository, MockSttProvider, TranscriptService } from '../src/modules/be3-intelligence/stt/service.js';
import { runAnalysisDemo } from '../src/modules/be3-intelligence/analysis-llm-demo.js';
import { runWelfareDemo } from '../src/modules/be3-intelligence/welfare-demo.js';

const personId = '00000000-0000-4000-8000-000000000002';
const actor: Actor = { user_id: '00000000-0000-4000-8000-000000000001', role: 'staff' };
const authorization: AuthorizationPort = {
  async canAccess(candidate, requestedPerson) {
    return candidate.user_id === actor.user_id && candidate.role === 'staff' && requestedPerson === personId;
  },
};

async function waitFor<T extends { status: string }>(read: () => Promise<T>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read();
    if (!['pending', 'processing'].includes(value.status)) return value;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error('DEMO_JOB_TIMEOUT');
}

function syntheticWav() {
  const rate = 8_000;
  const frames = rate;
  const data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36);
  data.writeUInt32LE(data.length - 44, 40);
  return data;
}

async function runOcr() {
  const service = new OcrService(new InMemoryOcrRepository(), new MockOcrProvider(), authorization);
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'white' } }).png().toBuffer();
  const created = await service.create(actor, { person_id: personId, request_key: 'be3-integration-ocr' },
    { filename: 'synthetic.png', mimeType: 'image/png', bytes });
  const completed = await waitFor(() => service.get(actor, created.id));
  if (completed.status !== 'succeeded') throw new Error('OCR_DEMO_FAILED');
  await service.correct(actor, created.id, { expected_version: 0, text: '최근 식사를 자주 거르고 외출과 복약 확인에 도움이 필요합니다.' });
  await service.confirm(actor, created.id, { expected_version: 1 });
  const handoff = await service.confirmedInput(actor, created.id);
  return { provider_kind: completed.provider_kind, status: completed.status, confirmed_version: handoff.ocr_version,
    handoff_fields: Object.keys(handoff), text_origin: 'synthetic_staff_correction' };
}

async function runStt() {
  const service = new TranscriptService(new InMemoryTranscriptRepository(), new MockSttProvider(), authorization);
  const created = await service.create(actor, { person_id: personId, request_key: 'be3-integration-stt' },
    { filename: 'synthetic.wav', mimeType: 'audio/wav', bytes: syntheticWav() });
  const completed = await waitFor(() => service.get(actor, created.id));
  if (completed.status !== 'succeeded') throw new Error('STT_DEMO_FAILED');
  await service.correct(actor, created.id, { expected_version: 0, segments: [
    { start_ms: 0, end_ms: 1_000, speaker_id: 'unknown', text: '최근 식사와 외출, 복약 관련 지원 필요를 확인했습니다.' },
  ] });
  await service.confirm(actor, created.id, { expected_version: 1 });
  const handoff = await service.confirmedInput(actor, created.id);
  return { provider_kind: completed.provider_kind, status: completed.status, diarization: completed.original?.diarization,
    confirmed_version: handoff.transcript_version, handoff_fields: Object.keys(handoff), text_origin: 'synthetic_staff_correction' };
}

async function main() {
  const [ocr, stt, analysis, welfare] = await Promise.all([
    runOcr(), runStt(), runAnalysisDemo('mock', {}), runWelfareDemo('synthetic'),
  ]);
  console.log(JSON.stringify({
    demo: { synthetic_only: true, external_calls: false, persistence: 'in_memory_only' },
    stages: {
      ocr_correction_confirmation: ocr,
      stt_correction_confirmation: stt,
      analysis_source_evidence_review: {
        provider_kind: analysis.data.provider_kind,
        review_state: 'review_state' in analysis.data ? analysis.data.review_state : undefined,
        evidence_validation: analysis.demo.evidence_validation,
        approval: analysis.demo.approval,
        source_origin: 'code_owned_synthetic_be2_record_fixture',
      },
      welfare_candidates: {
        mode: welfare.demo.mode,
        data_statuses: [...new Set(welfare.data.candidates.map(candidate => candidate.data_status))],
        eligibility_statuses: [...new Set(welfare.data.candidates.map(candidate => candidate.eligibility_status))],
        candidate_count: welfare.data.candidates.length,
      },
    },
    connections: {
      ocr_or_stt_to_be2_record_version: 'not_connected_requires_be2',
      be2_record_version_to_analysis: 'fixture_only',
      analysis_to_welfare_input: 'not_connected_manual_synthetic_fixture',
      analysis_review_and_approval: 'connected_with_simulated_staff_for_demo_only',
    },
  }, null, 2));
}

await main();
