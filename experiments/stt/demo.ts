import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { LocalWhisperProvider } from '../../src/modules/be3-intelligence/stt/local-provider.js';
import { InMemoryTranscriptRepository, MockSttProvider, TranscriptService } from '../../src/modules/be3-intelligence/stt/service.js';

const real = process.argv[2] === 'real';
const audioPath = resolve(process.argv[3] ?? 'experiments/stt/samples/synthetic-ko.wav');
let bytes: Buffer;
if (!real && !process.argv[3]) {
  bytes = Buffer.alloc(44 + 16000 * 2); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
} else bytes = await readFile(audioPath);
const provider = real ? new LocalWhisperProvider({ pythonPath: process.env.STT_PYTHON ?? '', modelPath: resolve('experiments/stt/models/base') }) : new MockSttProvider();
const actor = { user_id: randomUUID(), role: 'staff' as const }, personId = randomUUID();
const service = new TranscriptService(new InMemoryTranscriptRepository(), provider,
  { canAccess: async (who, person) => who.user_id === actor.user_id && person === personId }, 95_000);
const created = await service.create(actor, { person_id: personId, request_key: randomUUID() },
  { filename: 'synthetic.wav', mimeType: 'audio/wav', bytes });
let job = await service.get(actor, created.id);
while (job.status === 'pending' || job.status === 'processing') {
  await new Promise(resolve => setTimeout(resolve, 100)); job = await service.get(actor, job.id);
}
if (job.status !== 'succeeded') throw new Error(job.failure?.code);
console.log(JSON.stringify({ mode: real ? 'actual_local_asr' : 'mock', original: job.original }));
await service.correct(actor, job.id, { expected_version: 0,
  segments: [{ start_ms: 0, end_ms: job.audio.duration_ms, speaker_id: 'speaker_1', text: '최근 식사는 하루 두 번 했습니다. 어제는 통증이 없었습니다.' }] });
await service.confirm(actor, job.id, { expected_version: 1 });
console.log(JSON.stringify({ confirmed: await service.confirmedInput(actor, job.id) }));
