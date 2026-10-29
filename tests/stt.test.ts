import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { validateWav, wavLimits } from '../src/modules/be3-intelligence/stt/wav.js';
import { SttError, validateSegments, type TranscriptProvider } from '../src/modules/be3-intelligence/stt/model.js';
import { InMemoryTranscriptRepository, MockSttProvider, TranscriptService } from '../src/modules/be3-intelligence/stt/service.js';
import { createTranscriptRouter } from '../src/modules/be3-intelligence/stt/router.js';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import type { AuthorizationPort } from '../src/shared/contracts.js';

const person_id = '11111111-1111-4111-8111-111111111111';
const actor = { user_id: '22222222-2222-4222-8222-222222222222', role: 'staff' as const };
const outsider = { user_id: '33333333-3333-4333-8333-333333333333', role: 'staff' as const };
function wav(rate = 16000, channels = 1, frames = rate) {
  const data = Buffer.alloc(44 + frames * channels * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(channels, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * channels * 2, 28);
  data.writeUInt16LE(channels * 2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
  return data;
}
const audio = (bytes = wav()) => ({ filename: 'synthetic.wav', mimeType: 'audio/wav', bytes });
const body = (request_key = 'one') => ({ person_id, request_key });
const segment = (text = '합성 발화', speaker_id = 'unknown', start_ms = 0, end_ms = 1000) => ({ start_ms, end_ms, speaker_id, text });
const result = (text = '  합성 발화\n') => ({ text, segments: [segment(text)], timing: 'asr_timestamps' as const, diarization: 'none' as const });
const authorization: AuthorizationPort = { canAccess: async (who, person) => who.user_id === actor.user_id && person === person_id };
function setup(provider: TranscriptProvider = new MockSttProvider(), auth = authorization, timeout = 1000) {
  return new TranscriptService(new InMemoryTranscriptRepository(), provider, auth, timeout);
}
async function complete(service: TranscriptService, id: string) {
  let job = await service.get(actor, id);
  for (let i = 0; i < 150 && ['pending', 'processing'].includes(job.status); i++) {
    await new Promise(resolve => setTimeout(resolve, 2)); job = await service.get(actor, id);
  }
  expect(['succeeded', 'failed']).toContain(job.status); return job;
}
async function success(service: TranscriptService) {
  const job = await service.create(actor, body(), audio());
  expect((await complete(service, job.id)).status).toBe('succeeded'); return job.id;
}

describe('WAV structural validation', () => {
  it.each([[16000, 1], [48000, 2], [8000, 1], [44100, 2]])('reads actual %i Hz / %i channels', (rate, channels) => {
    expect(validateWav(audio(wav(rate, channels))).info).toEqual({ sample_rate: rate, channels, bits_per_sample: 16, duration_ms: 1000, frames: rate });
  });
  it.each([
    ['empty', () => audio(Buffer.alloc(0)), 'EMPTY_AUDIO'],
    ['missing bytes', () => ({ filename: 'x.wav', mimeType: 'audio/wav' }), 'INVALID_AUDIO'],
    ['MIME spoof', () => ({ ...audio(), mimeType: 'audio/mp3' }), 'INVALID_AUDIO'],
    ['wrong extension', () => ({ ...audio(), filename: 'x.mp3' }), 'INVALID_AUDIO'],
    ['path traversal', () => ({ ...audio(), filename: '../x.wav' }), 'INVALID_AUDIO'],
    ['Windows path', () => ({ ...audio(), filename: 'C:\\x.wav' }), 'INVALID_AUDIO'],
    ['bad magic', () => { const b = wav(); b.write('fake'); return audio(b); }, 'CORRUPT_WAV'],
    ['high-bit signature spoof', () => { const b = wav(); for (let i = 0; i < 4; i++) b[i] |= 0x80; return audio(b); }, 'CORRUPT_WAV'],
    ['truncated', () => audio(wav().subarray(0, 60)), 'CORRUPT_WAV'],
    ['empty PCM', () => audio(wav(16000, 1, 0)), 'CORRUPT_WAV'],
    ['encoding', () => { const b = wav(); b.writeUInt16LE(3, 20); return audio(b); }, 'UNSUPPORTED_WAV_ENCODING'],
    ['bit depth', () => { const b = wav(); b.writeUInt16LE(32, 34); return audio(b); }, 'UNSUPPORTED_WAV_ENCODING'],
    ['channel count', () => audio(wav(16000, 3)), 'UNSUPPORTED_AUDIO_FORMAT'],
    ['sample rate', () => audio(wav(12345)), 'UNSUPPORTED_AUDIO_FORMAT'],
    ['byte rate', () => { const b = wav(); b.writeUInt32LE(1, 28); return audio(b); }, 'CORRUPT_WAV'],
    ['alignment', () => { const b = wav(); b.writeUInt16LE(1, 32); return audio(b); }, 'CORRUPT_WAV'],
    ['chunk overflow', () => { const b = wav(); b.writeUInt32LE(0xffffffff, 40); return audio(b); }, 'CORRUPT_WAV'],
  ])('rejects %s', (_name, input, code) => expect(() => validateWav(input())).toThrow(expect.objectContaining({ code })));
  it('enforces bytes and duration bounds', () => {
    expect(() => validateWav(audio(), { ...wavLimits, maxBytes: 1 })).toThrow(expect.objectContaining({ code: 'AUDIO_TOO_LARGE' }));
    expect(() => validateWav(audio(), { ...wavLimits, maxDurationMs: 500 })).toThrow(expect.objectContaining({ code: 'AUDIO_TOO_LONG' }));
  });
  it('rejects RIFF trailing bytes and duplicate data chunks', () => {
    const bad = Buffer.concat([wav(), Buffer.from([0])]);
    expect(() => validateWav(audio(bad))).toThrow();
    const duplicate = Buffer.concat([wav(), Buffer.from('data\0\0\0\0')]); duplicate.writeUInt32LE(duplicate.length - 8, 4);
    expect(() => validateWav(audio(duplicate))).toThrow();
  });
  it('strips ancillary chunks and supports zero-extension PCM fmt', () => {
    const original = wav();
    const metadata = Buffer.concat([original.subarray(0, 12), Buffer.from('JUNK\x02\0\0\0ab'), original.subarray(12)]);
    metadata.writeUInt32LE(metadata.length - 8, 4);
    expect(validateWav(audio(metadata)).bytes).toEqual(original);
    const extended = Buffer.concat([original.subarray(0, 36), Buffer.alloc(2), original.subarray(36)]);
    extended.writeUInt32LE(18, 16); extended.writeUInt32LE(extended.length - 8, 4);
    expect(validateWav(audio(extended)).bytes).toEqual(original);
  });
  it('returns independent canonical bytes', () => {
    const bytes = wav(), clean = validateWav(audio(bytes)); bytes.fill(0);
    expect(clean.bytes.toString('ascii', 0, 4)).toBe('RIFF');
  });
});

describe('segment timing and anonymous speaker labels', () => {
  it('allows ordered unknown and human anonymous labels', () => {
    expect(validateSegments([segment('가', 'unknown', 0, 400), segment('나', 'speaker_2', 500, 1000)], 1000)).toHaveLength(2);
  });
  it.each([
    [segment('가', 'staff')], [segment('가', 'person')], [segment('', 'unknown')], [segment('가', 'unknown', -1)],
    [segment('가', 'unknown', 0, 1001)], [segment('가', 'unknown', 500, 500)], [segment('가', 'unknown', 0.1)],
    [segment('가', 'unknown', 0, 600), segment('나', 'unknown', 500, 1000)], [],
  ])('rejects invalid segment list %#', (...segments) => expect(() => validateSegments(segments, 1000)).toThrow());
});

describe('STT service and revision lifecycle', () => {
  it('keeps Mock explicit and does not pretend whole-audio segmentation is diarization', async () => {
    const service = setup(); const id = await success(service), job = await service.get(actor, id);
    expect(job.provider_kind).toBe('mock'); expect(job.original?.diarization).toBe('none');
    expect(job.original?.timing).toBe('whole_audio'); expect(job.original?.segments[0].speaker_id).toBe('unknown');
  });
  it('tracks pending, processing, succeeded and preserves exact provider originals', async () => {
    let release!: (value: ReturnType<typeof result>) => void;
    const service = setup({ transcribe: async () => '', transcribeSegments: () => new Promise(resolve => { release = resolve; }) });
    const job = await service.create(actor, body(), audio()); expect(job.status).toBe('pending');
    expect((await service.get(actor, job.id)).status).toBe('processing'); release(result());
    const original = (await complete(service, job.id)).original; expect(original?.text).toBe('  합성 발화\n');
    expect(original?.segments[0].text).toBe(original?.text);
  });
  it('supports the original two-argument SttProvider', async () => {
    const service = setup({ transcribe: async () => '  원문\n' }); const id = await success(service);
    expect((await service.get(actor, id)).original?.text).toBe('  원문\n');
  });
  it('deduplicates concurrent requests and conflicts on changed audio', async () => {
    const transcribe = vi.fn(async () => '합성'); const service = setup({ transcribe });
    const [a, b] = await Promise.all([service.create(actor, body(), audio()), service.create(actor, body(), audio())]);
    expect(a.id).toBe(b.id); await complete(service, a.id); expect(transcribe).toHaveBeenCalledTimes(1);
    const changed = wav(); changed[44] = 1;
    await expect(service.create(actor, body(), audio(changed))).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('keeps independent jobs correct when providers finish in reverse order', async () => {
    const releases: ((text: string) => void)[] = [];
    const service = setup({ transcribe: () => new Promise(resolve => releases.push(resolve)) });
    const first = await service.create(actor, body('first'), audio());
    const second = await service.create(actor, body('second'), audio());
    releases[1]('둘째 합성'); const secondResult = await complete(service, second.id);
    const firstStatus = (await service.get(actor, first.id)).status;
    releases[0]('첫째 합성'); const firstResult = await complete(service, first.id);
    expect(firstStatus).toBe('processing'); expect(secondResult.original?.text).toBe('둘째 합성');
    expect(firstResult.original?.text).toBe('첫째 합성');
  });
  it('rejects corrections and confirmation while processing', async () => {
    let release!: (text: string) => void;
    const service = setup({ transcribe: () => new Promise(resolve => { release = resolve; }) });
    const job = await service.create(actor, body(), audio());
    await expect(service.correct(actor, job.id, { expected_version: 0, segments: [segment()] })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.confirm(actor, job.id, { expected_version: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    release('합성'); await complete(service, job.id);
  });
  it.each([
    ['provider exception', { transcribe: async () => { throw new SttError('private-provider-detail'); } }, 'STT_PROVIDER_FAILED', true],
    ['blank text', { transcribe: async () => ' ' }, 'INVALID_STT_RESULT', false],
    ['large text', { transcribe: async () => '가'.repeat(100001) }, 'INVALID_STT_RESULT', false],
    ['invalid timestamps', { transcribe: async () => '', transcribeSegments: async () => ({ ...result(), segments: [segment('가', 'unknown', 0, 2000)] }) }, 'INVALID_STT_RESULT', false],
    ['invented speaker role', { transcribe: async () => '', transcribeSegments: async () => ({ ...result(), segments: [segment('가', 'speaker_1')] }) }, 'INVALID_STT_RESULT', false],
    ['mismatching source text', { transcribe: async () => '', transcribeSegments: async () => ({ ...result(), text: '다른 합성 원문' }) }, 'INVALID_STT_RESULT', false],
    ['false whole-audio span', { transcribe: async () => '', transcribeSegments: async () => ({ ...result(), timing: 'whole_audio', segments: [segment('  합성 발화\n', 'unknown', 200, 900)] }) }, 'INVALID_STT_RESULT', false],
  ])('records safe failure for %s', async (_name, provider, code, retryable) => {
    const service = setup(provider as TranscriptProvider); const job = await service.create(actor, body(), audio());
    expect((await complete(service, job.id)).failure).toEqual({ code, retryable });
    await expect(service.correct(actor, job.id, { expected_version: 0, segments: [segment()] })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it.each(['success', 'failure'])('retains timeout after late provider %s and sends cancellation', async settlement => {
    let yes!: (text: string) => void, no!: (error: Error) => void, signal: AbortSignal | undefined;
    const service = setup({ transcribe: (_bytes, _mime, abort) => { signal = abort; return new Promise((resolve, reject) => { yes = resolve; no = reject; }); } }, authorization, 10);
    const created = await service.create(actor, body(), audio()); const failed = await complete(service, created.id);
    expect(failed.failure).toEqual({ code: 'STT_TIMEOUT', retryable: true }); expect(signal?.aborted).toBe(true);
    if (settlement === 'success') yes('늦은 합성'); else no(new Error('private'));
    await new Promise<void>(resolve => setImmediate(resolve)); expect(await service.get(actor, created.id)).toEqual(failed);
  });
  it('preserves originals, speaker corrections and every revision until explicit confirmation', async () => {
    const service = setup(); const id = await success(service), original = (await service.get(actor, id)).original;
    await expect(service.confirmedInput(actor, id)).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });
    await service.correct(actor, id, { expected_version: 0, segments: [segment('첫 교정', 'speaker_1')] });
    const second = await service.correct(actor, id, { expected_version: 1, segments: [segment('둘째 교정', 'speaker_2')] });
    expect(second.original).toEqual(original); expect(second.revisions.map(r => r.text)).toEqual(['첫 교정', '둘째 교정']);
    expect(second.revisions[1].edited_by).toBe(actor.user_id); expect(Date.parse(second.revisions[1].edited_at)).toBeGreaterThan(0);
    second.revisions[0].text = 'tamper'; expect((await service.get(actor, id)).revisions[0].text).toBe('첫 교정');
    await service.confirm(actor, id, { expected_version: 2 });
    const confirmed = await service.confirmedInput(actor, id); expect(confirmed.text).toBe('둘째 교정');
    expect(confirmed.segments[0].speaker_id).toBe('speaker_2'); expect(confirmed).not.toHaveProperty('record_version_id');
    await expect(service.correct(actor, id, { expected_version: 2, segments: [segment()] })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.confirm(actor, id, { expected_version: 2 })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('rejects empty corrections and stale or invalid versions', async () => {
    const service = setup(); const id = await success(service);
    await expect(service.correct(actor, id, { expected_version: 0, segments: [segment(' ')] })).rejects.toMatchObject({ code: 'INVALID_SEGMENTS' });
    await expect(service.correct(actor, id, { expected_version: 1, segments: [segment()] })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.correct(actor, id, { expected_version: -1, segments: [segment()] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(service.confirm(actor, id, { expected_version: 0 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
  it('allows one writer per version and rejects competing correction/confirmation', async () => {
    const service = setup(); const id = await success(service);
    const outcomes = await Promise.allSettled([1, 2].map(n => service.correct(actor, id, { expected_version: 0, segments: [segment(`합성 ${n}`)] })));
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    const competing = await Promise.allSettled([service.confirm(actor, id, { expected_version: 1 }), service.correct(actor, id, { expected_version: 1, segments: [segment()] })]);
    expect(competing.filter(o => o.status === 'fulfilled')).toHaveLength(1);
  });
  it('keeps storage instance-local and validates IDs', async () => {
    const a = setup(), b = setup(); const id = await success(a);
    await expect(b.get(actor, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(a.get(actor, 'bad')).rejects.toMatchObject({ code: 'INVALID_ID' });
  });
});

describe('authorization and isolated HTTP API', () => {
  function app(service: TranscriptService, who: unknown = actor) { const api = express(); api.use('/api/transcripts', createTranscriptRouter(service, async () => who)); return api; }
  const upload = () => ({ ...body(), filename: 'synthetic.wav', mimeType: 'audio/wav', base64: wav().toString('base64') });
  it('rejects missing actors, other staff and other people', async () => {
    const service = setup(); await expect(service.create(null, body(), audio())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const id = await success(service);
    for (const call of [service.get(outsider, id), service.correct(outsider, id, { expected_version: 0, segments: [segment()] }), service.confirm(outsider, id, { expected_version: 1 }), service.create(actor, { ...body('other'), person_id: outsider.user_id }, audio())]) {
      await expect(call).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
  it('fails closed for exceptions and non-boolean permission responses', async () => {
    for (const auth of [{ canAccess: async () => { throw new Error('private'); } }, { canAccess: async () => 'yes' as unknown as boolean }]) {
      await expect(setup(undefined, auth).create(actor, body(), audio())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
  it('rechecks permissions after revocation including duplicate creation and analyze', async () => {
    let allowed = true; const service = setup(undefined, { canAccess: async () => allowed }); const id = await success(service); allowed = false;
    for (const call of [service.get(actor, id), service.create(actor, body(), audio()), service.confirmedInput(actor, id)]) await expect(call).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('runs create, poll, result, correction and confirmation with envelopes', async () => {
    const service = setup(), api = app(service);
    const response = await request(api).post('/api/transcripts/jobs').send(upload()); expect(response.status).toBe(202);
    const id = response.body.data.id; await complete(service, id);
    expect((await request(api).get(`/api/transcripts/jobs/${id}`)).body.data.status).toBe('succeeded');
    expect((await request(api).get(`/api/transcripts/jobs/${id}/result`)).body.data.original.segments[0].speaker_id).toBe('unknown');
    expect((await request(api).post(`/api/transcripts/jobs/${id}/corrections`).send({ expected_version: 0, segments: [segment('교정', 'speaker_1')] })).body.data.version).toBe(1);
    expect((await request(api).post(`/api/transcripts/jobs/${id}/confirmation`).send({ expected_version: 1 })).body.data.confirmed.version).toBe(1);
  });
  it('rejects forged headers, malformed JSON and invalid base64', async () => {
    expect((await request(app(setup(), null)).post('/api/transcripts/jobs').set('X-Test-Actor', JSON.stringify(actor)).send(upload())).status).toBe(401);
    expect((await request(app(setup())).post('/api/transcripts/jobs').set('Content-Type', 'application/json').send('{')).body.error.code).toBe('INVALID_REQUEST');
    expect((await request(app(setup())).post('/api/transcripts/jobs').send({ ...upload(), base64: 'A===' })).status).toBe(400);
  });
  it('bounds HTTP and decoded audio sizes without regex stack overflow', async () => {
    const api = app(setup());
    expect((await request(api).post('/api/transcripts/jobs').send({ ...upload(), base64: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') })).body.error.code).toBe('AUDIO_TOO_LARGE');
    expect((await request(api).post('/api/transcripts/jobs').send({ ...upload(), base64: 'A'.repeat(14 * 1024 * 1024) })).status).toBe(413);
  });
  it('does not mount business routes on the production server', async () => {
    const api = createApp(parseConfig({ NODE_ENV: 'production' }));
    expect((await request(api).post('/api/transcripts/jobs').set('X-Test-Actor', JSON.stringify(actor)).send(upload())).status).toBe(404);
  });
});
