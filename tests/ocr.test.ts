import { beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import express from 'express';
import request from 'supertest';
import { validateImage } from '../src/modules/be3-intelligence/ocr-image.js';
import { InMemoryOcrRepository, MockOcrProvider, OcrService } from '../src/modules/be3-intelligence/ocr.js';
import { createOcrRouter } from '../src/modules/be3-intelligence/ocr-router.js';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import type { OcrProvider } from '../src/modules/be3-intelligence/analysis.js';
import type { AuthorizationPort } from '../src/shared/contracts.js';

const person_id = '11111111-1111-4111-8111-111111111111';
const actor = { user_id: '22222222-2222-4222-8222-222222222222', role: 'staff' as const };
const outsider = { user_id: '33333333-3333-4333-8333-333333333333', role: 'staff' as const };
const permission: AuthorizationPort = { canAccess: async (who, id) => who.user_id === actor.user_id && id === person_id };
let png: Buffer, jpeg: Buffer;
beforeAll(async () => {
  const image = () => sharp({ create: { width: 8, height: 8, channels: 3, background: 'white' } });
  png = await image().png().toBuffer(); jpeg = await image().jpeg().toBuffer();
});
const image = () => ({ filename: 'synthetic.png', mimeType: 'image/png', bytes: png });
const body = (request_key = 'one') => ({ person_id, request_key });
function setup(provider: OcrProvider = new MockOcrProvider(), auth = permission, timeout = 1000) {
  const repository = new InMemoryOcrRepository();
  return { repository, service: new OcrService(repository, provider, auth, undefined, timeout) };
}
async function ready(service: OcrService, id: string) {
  let job = await service.get(actor, id);
  for (let i = 0; i < 100 && ['pending', 'processing'].includes(job.status); i++) {
    await new Promise(resolve => setTimeout(resolve, 2)); job = await service.get(actor, id);
  }
  expect(['succeeded', 'failed']).toContain(job.status); return job;
}
async function successful(service: OcrService) {
  const job = await service.create(actor, body(), image());
  expect((await ready(service, job.id)).status).toBe('succeeded'); return job.id;
}

describe('OCR image validation', () => {
  it('decodes PNG', async () => expect((await validateImage(image())).mimeType).toBe('image/png'));
  it('decodes JPEG', async () => expect((await validateImage({ filename: 'synthetic.jpg', mimeType: 'image/jpeg', bytes: jpeg })).mimeType).toBe('image/jpeg'));
  it.each([
    ['empty', () => ({ ...image(), bytes: new Uint8Array() }), 'EMPTY_IMAGE'],
    ['missing', () => ({ filename: 'x.png', mimeType: 'image/png' }), 'INVALID_IMAGE'],
    ['MIME', () => ({ ...image(), mimeType: 'text/plain' }), 'INVALID_IMAGE'],
    ['MIME mismatch', () => ({ ...image(), mimeType: 'image/jpeg' }), 'MIME_MISMATCH'],
    ['extension', () => ({ ...image(), filename: 'x.jpg' }), 'EXTENSION_MISMATCH'],
    ['signature', () => ({ ...image(), bytes: Buffer.from('not image') }), 'INVALID_SIGNATURE'],
    ['truncated', () => ({ ...image(), bytes: png.subarray(0, 30) }), 'CORRUPT_IMAGE'],
    ['path traversal', () => ({ ...image(), filename: '../x.png' }), 'INVALID_IMAGE'],
  ])('rejects %s', async (_name, input, code) => expect(validateImage(input())).rejects.toMatchObject({ code }));
  it('bounds compressed bytes', async () => expect(validateImage(image(), { maxBytes: 1, maxPixels: 100 })).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' }));
  it('bounds decompressed pixels', async () => expect(validateImage(image(), { maxBytes: 10000, maxPixels: 1 })).rejects.toMatchObject({ code: 'CORRUPT_IMAGE' }));
  it('rejects damaged JPEG', async () => expect(validateImage({ filename: 'x.jpg', mimeType: 'image/jpeg', bytes: jpeg.subarray(0, 30) })).rejects.toMatchObject({ code: 'CORRUPT_IMAGE' }));
  it('strips metadata before provider input', async () => {
    const bytes = await sharp(png).withMetadata({ exif: { IFD0: { Artist: 'synthetic-only' } } }).png().toBuffer();
    const clean = await validateImage({ ...image(), bytes });
    expect((await sharp(clean.bytes).metadata()).exif).toBeUndefined();
  });
});

describe('OCR jobs and provenance', () => {
  it('tracks pending, processing and succeeded and protects snapshots', async () => {
    let release!: (text: string) => void;
    const { service } = setup({ extract: () => new Promise(resolve => { release = resolve; }) });
    const job = await service.create(actor, body(), image()); expect(job.status).toBe('pending');
    expect((await service.get(actor, job.id)).status).toBe('processing');
    release('합성 원문'); const result = await ready(service, job.id);
    expect(result.original).toBe('합성 원문'); result.original = 'tampered';
    expect((await service.get(actor, job.id)).original).toBe('합성 원문');
  });
  it('returns deterministic Korean mock output', async () => {
    const { service } = setup(); const id = await successful(service);
    expect((await service.get(actor, id)).original).toContain('장보기가 어렵다고 함');
  });
  it('deduplicates simultaneous requests without calling provider twice', async () => {
    const extract = vi.fn(async () => '합성'); const { service } = setup({ extract });
    const [a, b] = await Promise.all([service.create(actor, body(), image()), service.create(actor, body(), image())]);
    expect(a.id).toBe(b.id); await ready(service, a.id); expect(extract).toHaveBeenCalledTimes(1);
  });
  it('rejects reuse of a key for changed input', async () => {
    const { service } = setup(); await successful(service);
    await expect(service.create(actor, body(), { filename: 'x.jpg', mimeType: 'image/jpeg', bytes: jpeg })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it.each([
    ['exception', { extract: async () => { throw new Error('private provider details'); } }, 'PROVIDER_FAILED', true],
    ['empty output', { extract: async () => '   ' }, 'INVALID_PROVIDER_RESULT', false],
    ['oversized output', { extract: async () => 'x'.repeat(100001) }, 'INVALID_PROVIDER_RESULT', false],
    ['timeout', { extract: () => new Promise<string>(() => {}) }, 'PROVIDER_TIMEOUT', true],
  ])('records safe failure on %s', async (_name, provider, code, retryable) => {
    const { service } = setup(provider, permission, 10); const job = await service.create(actor, body(), image());
    const result = await ready(service, job.id); expect(result.status).toBe('failed');
    expect(result.failure).toEqual({ code, retryable }); expect(result.original).toBeUndefined();
    await expect(service.correct(actor, job.id, { expected_version: 0, text: '합성' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('rejects malformed and unknown IDs', async () => {
    const { service } = setup(); await expect(service.get(actor, 'bad')).rejects.toMatchObject({ code: 'INVALID_ID' });
    await expect(service.get(actor, person_id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('preserves original and correction history, then exports only confirmed input', async () => {
    const { service } = setup(); const id = await successful(service); const original = (await service.get(actor, id)).original;
    await expect(service.confirmedInput(actor, id)).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });
    await service.correct(actor, id, { expected_version: 0, text: '첫 교정' });
    const result = await service.correct(actor, id, { expected_version: 1, text: '둘째 교정' });
    expect(result.original).toBe(original); expect(result.corrections.map(x => x.text)).toEqual(['첫 교정', '둘째 교정']);
    expect(result.corrections[1]).toMatchObject({ edited_by: actor.user_id, version: 2 });
    expect(Number.isFinite(Date.parse(result.corrections[1].edited_at))).toBe(true);
    await service.confirm(actor, id, { expected_version: 2 });
    expect(await service.confirmedInput(actor, id)).toEqual({ ocr_job_id: id, ocr_version: 2, person_id, text: '둘째 교정' });
    await expect(service.correct(actor, id, { expected_version: 2, text: '재교정' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.confirm(actor, id, { expected_version: 2 })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('rejects empty, invalid and stale corrections and confirmation versions', async () => {
    const { service } = setup(); const id = await successful(service);
    for (const input of [{ expected_version: 0, text: '' }, { expected_version: -1, text: '합성' }, { expected_version: 0.5, text: '합성' }]) {
      await expect(service.correct(actor, id, input)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    await expect(service.confirm(actor, id, { expected_version: 0 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(service.correct(actor, id, { expected_version: 1, text: '합성' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await service.correct(actor, id, { expected_version: 0, text: '합성' });
    await expect(service.confirm(actor, id, { expected_version: 2 })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('allows only one concurrent correction of the same version', async () => {
    const { service } = setup(); const id = await successful(service);
    const results = await Promise.allSettled([1, 2].map(n => service.correct(actor, id, { expected_version: 0, text: `교정 ${n}` })));
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect((await service.get(actor, id)).corrections).toHaveLength(1);
  });
  it('does not share repository state across instances', async () => {
    const a = setup(), b = setup(); const id = await successful(a.service);
    await expect(b.service.get(actor, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('authorization boundary', () => {
  it('rejects missing actors before validating input', async () => {
    await expect(setup().service.create(null, body(), image())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('rejects another staff member and person', async () => {
    const { service } = setup(); const id = await successful(service);
    await expect(service.get(outsider, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.correct(outsider, id, { expected_version: 0, text: '합성' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.confirm(outsider, id, { expected_version: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.create(actor, { ...body('other'), person_id: outsider.user_id }, image())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('fails closed when authorization throws', async () => {
    const { service } = setup(undefined, { canAccess: async () => { throw new Error('private'); } });
    await expect(service.create(actor, body(), image())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rechecks current permission after revocation including duplicate request and analysis export', async () => {
    let allowed = true; const { service } = setup(undefined, { canAccess: async () => allowed });
    const id = await successful(service); allowed = false;
    await expect(service.get(actor, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.create(actor, body(), image())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.confirmedInput(actor, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

function api(service: OcrService, who: unknown = actor) {
  const app = express(); app.use('/api/ocr', createOcrRouter(service, async () => who)); return app;
}
const upload = () => ({ ...body(), filename: 'synthetic.png', mimeType: 'image/png', base64: png.toString('base64') });
describe('isolated OCR HTTP router', () => {
  it('runs create, poll, result, correct, confirm with envelopes', async () => {
    const { service } = setup(); const app = api(service);
    const created = await request(app).post('/api/ocr/jobs').send(upload()); expect(created.status).toBe(202);
    const id = created.body.data.id; await ready(service, id);
    expect((await request(app).get(`/api/ocr/jobs/${id}`)).body.data.status).toBe('succeeded');
    expect((await request(app).get(`/api/ocr/jobs/${id}/result`)).body.data.original).toContain('식사');
    expect((await request(app).post(`/api/ocr/jobs/${id}/corrections`).send({ expected_version: 0, text: '합성 교정' })).body.data.version).toBe(1);
    expect((await request(app).post(`/api/ocr/jobs/${id}/confirmation`).send({ expected_version: 1 })).body.data.confirmed.version).toBe(1);
  });
  it('ignores forged headers when resolver has no authenticated session', async () => {
    const res = await request(api(setup().service, null)).post('/api/ocr/jobs').set('X-Test-Actor', JSON.stringify(actor)).send(upload());
    expect(res.status).toBe(401); expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
  it('maps invalid base64, malformed JSON and denied access safely', async () => {
    const app = api(setup().service);
    expect((await request(app).post('/api/ocr/jobs').send({ ...upload(), base64: '!!!!' })).status).toBe(400);
    expect((await request(app).post('/api/ocr/jobs').set('Content-Type', 'application/json').send('{')).body.error.code).toBe('INVALID_REQUEST');
    expect((await request(api(setup().service, outsider)).post('/api/ocr/jobs').send(upload())).status).toBe(403);
  });
  it('reports processing result as not ready', async () => {
    const { service } = setup({ extract: () => new Promise<string>(() => {}) }, permission, 10);
    const job = await service.create(actor, body(), image());
    const res = await request(api(service)).get(`/api/ocr/jobs/${job.id}/result`); expect(res.status).toBe(409);
    await ready(service, job.id);
  });
  it('keeps production OCR routes unmounted even with forged headers', async () => {
    const app = createApp(parseConfig({ NODE_ENV: 'production' }));
    expect((await request(app).post('/api/ocr/jobs').set('X-Test-Actor', JSON.stringify(actor)).send(upload())).status).toBe(404);
  });
});

describe('remaining OCR state guards', () => {
  it('marks synthetic mock results explicitly', async () => {
    const { service } = setup(); const id = await successful(service);
    expect((await service.get(actor, id)).provider_kind).toBe('mock');
  });
  it('rejects corrections and confirmation while processing', async () => {
    const { service } = setup({ extract: () => new Promise<string>(() => {}) }, permission, 20);
    const job = await service.create(actor, body(), image());
    await expect(service.correct(actor, job.id, { expected_version: 0, text: '합성' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.confirm(actor, job.id, { expected_version: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await ready(service, job.id);
  });
  it('rejects oversized HTTP payloads with the shared error envelope', async () => {
    const response = await request(api(setup().service)).post('/api/ocr/jobs').send({ ...upload(), base64: 'A'.repeat(7 * 1024 * 1024) });
    expect(response.status).toBe(413); expect(response.body.error.code).toBe('IMAGE_TOO_LARGE');
  });
  it('rejects concurrent confirmation and correction after the same version', async () => {
    const { service } = setup(); const id = await successful(service);
    await service.correct(actor, id, { expected_version: 0, text: '교정' });
    const outcomes = await Promise.allSettled([
      service.confirm(actor, id, { expected_version: 1 }),
      service.correct(actor, id, { expected_version: 1, text: '경합' }),
    ]);
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('final review regressions', () => {
  it.each([
    [1, 3, 2, [1, 2, 3, 4, 5, 6]],
    [2, 3, 2, [3, 2, 1, 6, 5, 4]],
    [3, 3, 2, [6, 5, 4, 3, 2, 1]],
    [4, 3, 2, [4, 5, 6, 1, 2, 3]],
    [5, 2, 3, [1, 4, 2, 5, 3, 6]],
    [6, 2, 3, [4, 1, 5, 2, 6, 3]],
    [7, 2, 3, [6, 3, 5, 2, 4, 1]],
    [8, 2, 3, [3, 6, 2, 5, 1, 4]],
  ])('applies EXIF orientation %i before stripping metadata', async (orientation, width, height, pixels) => {
    const raw = Buffer.from([1, 2, 3, 4, 5, 6].flatMap(value => [value * 30, value * 30, value * 30]));
    const bytes = await sharp(raw, { raw: { width: 3, height: 2, channels: 3 } }).png().withMetadata({ orientation }).toBuffer();
    const clean = await validateImage({ ...image(), bytes });
    const metadata = await sharp(clean.bytes).metadata();
    expect(metadata).toMatchObject({ width, height });
    expect(metadata.orientation).toBeUndefined(); expect(metadata.exif).toBeUndefined();
    const decoded = await sharp(clean.bytes).removeAlpha().raw().toBuffer();
    expect(decoded).toEqual(Buffer.from(pixels.flatMap(value => [value * 30, value * 30, value * 30])));
  });
  it('preserves the provider original including boundary whitespace', async () => {
    const original = '  합성 원문\n'; const { service } = setup({ extract: async () => original });
    const id = await successful(service);
    await service.correct(actor, id, { expected_version: 0, text: '교정' });
    expect((await service.get(actor, id)).original).toBe(original);
  });
  it('does not let a provider choose a public failure code', async () => {
    const { OcrError } = await import('../src/modules/be3-intelligence/ocr-image.js');
    const { service } = setup({ extract: async () => { throw new OcrError('private-provider-detail'); } });
    const job = await service.create(actor, body(), image());
    expect((await ready(service, job.id)).failure).toEqual({ code: 'PROVIDER_FAILED', retryable: true });
  });
  it.each(['resolve', 'reject'])('retains timeout failure after a late provider %s', async settlement => {
    let resolve!: (value: string) => void, reject!: (reason: Error) => void;
    const { service } = setup({ extract: () => new Promise<string>((yes, no) => { resolve = yes; reject = no; }) }, permission, 10);
    const job = await service.create(actor, body(), image());
    const failed = await ready(service, job.id); expect(failed.failure?.code).toBe('PROVIDER_TIMEOUT');
    if (settlement === 'resolve') resolve('늦은 합성 결과'); else reject(new Error('late private error'));
    await new Promise<void>(done => setImmediate(done));
    expect(await service.get(actor, job.id)).toEqual(failed);
  });
  it('keeps independent concurrent OCR completions separate', async () => {
    const releases: ((value: string) => void)[] = [];
    const { service } = setup({ extract: () => new Promise<string>(resolve => releases.push(resolve)) });
    const first = await service.create(actor, body('first'), image());
    const second = await service.create(actor, body('second'), image());
    releases[1]('두 번째'); const secondResult = await ready(service, second.id);
    const firstStatus = (await service.get(actor, first.id)).status;
    releases[0]('첫 번째'); const firstResult = await ready(service, first.id);
    expect(firstStatus).toBe('processing'); expect(firstResult.original).toBe('첫 번째'); expect(secondResult.original).toBe('두 번째');
  });
  it('requires an explicit boolean authorization grant', async () => {
    const { service } = setup(undefined, { canAccess: async () => 'yes' as unknown as boolean });
    await expect(service.create(actor, body(), image())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('accepts multi-MiB valid base64 without overflowing the regex stack', async () => {
    const { randomBytes } = await import('node:crypto');
    const bytes = await sharp(randomBytes(768 * 768 * 3), { raw: { width: 768, height: 768, channels: 3 } }).png().toBuffer();
    const { service } = setup();
    const res = await request(api(service)).post('/api/ocr/jobs').send({ ...upload(), base64: bytes.toString('base64') });
    expect(res.status).toBe(202); await ready(service, res.body.data.id);
  });
  it.each(['A===', '====', 'AA=A', 'AAA', 'AAA\n', 'data:image/png;base64,AAAA'])('rejects malformed base64 %s', async base64 => {
    const res = await request(api(setup().service)).post('/api/ocr/jobs').send({ ...upload(), base64 });
    expect(res.status).toBe(400); expect(res.body.error.code).toBe('INVALID_REQUEST');
  });
});

describe('upload limits and decoder payload guards', () => {
  it('enforces decoded file size below the JSON transport limit', async () => {
    const base64 = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64');
    const response = await request(api(setup().service)).post('/api/ocr/jobs').send({ ...upload(), base64 });
    expect(response.status).toBe(413); expect(response.body.error.code).toBe('IMAGE_TOO_LARGE');
  });
  it('applies JPEG EXIF rotation and strips metadata', async () => {
    const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'white' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const clean = await validateImage({ filename: 'synthetic.jpg', mimeType: 'image/jpeg', bytes });
    const metadata = await sharp(clean.bytes).metadata();
    expect(metadata).toMatchObject({ width: 2, height: 3 });
    expect(metadata.exif).toBeUndefined(); expect(metadata.orientation).toBeUndefined();
  });
  it.each(['png', 'jpeg'])('rejects truncated %s pixel payloads', async format => {
    const source = format === 'png' ? png : jpeg;
    await expect(validateImage({ filename: `synthetic.${format}`, mimeType: `image/${format}`, bytes: source.subarray(0, source.length - 20) })).rejects.toMatchObject({ code: 'CORRUPT_IMAGE' });
  });
});
