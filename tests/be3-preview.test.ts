import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPreviewApp, startPreviewServer } from '../scripts/be3-preview-server.js';
import { capturePreviewFixtures } from '../scripts/be3-preview-fixtures.js';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { readFile } from 'node:fs/promises';

describe('fixed synthetic preview API', () => {
  it('ships captured JSON for all FE screens with synthetic labels and unverified candidates', async () => {
    const fixture = JSON.parse(await readFile(new URL('../examples/preview/screens.synthetic.json', import.meta.url), 'utf8'));
    expect(Object.keys(fixture.screens)).toHaveLength(14);
    for (const screen of Object.values(fixture.screens)) expect(screen).toMatchObject({ demo_mode: true, data_origin: 'synthetic' });
    expect(fixture.screens.welfare_cards.data.candidates.every((c: any) => c.eligibility_status === 'unverified' && c.source_url === null)).toBe(true);
  });
  it.each([undefined, '', '0', 'true', 1])('refuses server startup without exact opt-in: %s', flag => {
    expect(() => startPreviewServer(flag)).toThrow('PREVIEW_OPT_IN_REQUIRED');
  });
  it('executes real services across correction, approval and need confirmation for every screen', async () => {
    const output = await capturePreviewFixtures();
    const screens = output.screens as Record<string, any>;
    for (const r of Object.values(screens)) expect(r).toMatchObject({ demo_mode: true, data_origin: 'synthetic', authentication: 'fixed_synthetic_actor_only' });
    expect(screens.ocr_original.data).toMatchObject({ provider_kind: 'mock', version: 0 });
    expect(screens.ocr_confirmed.data.confirmed.version).toBe(1);
    expect(screens.stt_original.data.original).toMatchObject({ diarization: 'none', segments: [{ speaker_id: 'unknown' }] });
    expect(screens.stt_corrected.data.revisions[0].segments[0].speaker_id).toBe('speaker_1');
    expect(screens.analysis_draft.data.review_state).toBe('draft');
    expect(screens.analysis_approved.data.review_state).toBe('approved');
    expect(screens.needs_confirmed.data.needs).toHaveLength(3);
    expect(screens.welfare_cards.data.candidates).toHaveLength(3);
    expect(screens.welfare_cards.data.candidates.every((c: any) => c.eligibility_status === 'unverified' && c.data_status === 'synthetic_demo')).toBe(true);
    expect(screens.welfare_cards.connection.confirmations).toHaveLength(3);
  });
  it.each(['ocr', 'stt'])('blocks automatic analysis from unconfirmed %s', async kind => {
    const app = createPreviewApp('1');
    await request(app).post(`/preview/${kind}/jobs`).send({});
    const r = await request(app).post('/preview/analyses').send({ source: kind });
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('NOT_CONFIRMED');
    expect((await request(app).get('/preview/scenario')).body.data.analysis).toBeNull();
  });
  it.each([
    ['/preview/ocr/jobs', { filename: 'private.png', base64: 'AAAA' }],
    ['/preview/stt/jobs', { person_id: 'external-id', text: 'PRIVATE_SENTINEL' }],
    ['/preview/ocr/corrections', { expected_version: 0, text: 'PRIVATE_SENTINEL' }],
    ['/preview/stt/corrections', { expected_version: 0, segments: [] }],
    ['/preview/analyses', { source: 'ocr', records: ['PRIVATE_SENTINEL'] }],
    ['/preview/needs/confirmation', { needs: ['diagnosis'], confirmed: true }],
    ['/preview/needs/confirmation', { needs: ['meal_support'], confirmed: false }],
    ['/preview/welfare-recommendations', { person_id: 'PRIVATE_SENTINEL' }],
  ])('rejects arbitrary input at %s without echo', async (path, body) => {
    const r = await request(createPreviewApp('1')).post(path).send(body);
    expect(r.status).toBe(400); expect(r.body).toMatchObject({ demo_mode: true, data_origin: 'synthetic' });
    expect(JSON.stringify(r.body)).not.toContain('PRIVATE_SENTINEL');
  });
  it('blocks unapproved analysis and unconfirmed needs', async () => {
    const app = createPreviewApp('1');
    await request(app).post('/preview/stt/jobs').send({});
    await new Promise(resolve => setTimeout(resolve, 5));
    await request(app).post('/preview/stt/corrections').send({ expected_version: 0 });
    await request(app).post('/preview/stt/confirmation').send({ expected_version: 1 });
    await request(app).post('/preview/analyses').send({ source: 'stt' });
    expect((await request(app).post('/preview/welfare-recommendations').send({})).body.error.code).toBe('NOT_APPROVED');
    expect((await request(app).post('/preview/needs/confirmation').send({ needs: ['meal_support'], confirmed: true })).status).toBe(409);
    await request(app).post('/preview/analysis/reviews').send({ action: 'submit', expected_version: 1 });
    await request(app).post('/preview/analysis/reviews').send({ action: 'approve', expected_version: 2 });
    expect((await request(app).post('/preview/welfare-recommendations').send({})).body.error.code).toBe('NEEDS_NOT_CONFIRMED');
    await request(app).post('/preview/needs/confirmation').send({ needs: ['meal_support'], confirmed: true });
    const r = await request(app).post('/preview/welfare-recommendations').send({});
    expect(r.body.data.candidates.map((c: any) => c.program_id)).toEqual(['demo-meal']);
  });
  it('restricts origins, hosts, body size, types, query and paths', async () => {
    const app = createPreviewApp('1');
    expect((await request(app).get('/preview/scenario').set('Origin', 'https://external.example')).status).toBe(403);
    expect((await request(app).get('/preview/scenario').set('Host', 'external.example')).status).toBe(403);
    const cors = await request(app).options('/preview/ocr/jobs').set('Origin', 'http://localhost:5173');
    expect(cors.status).toBe(204); expect(cors.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect((await request(app).post('/preview/ocr/jobs').send({ oversized: 'x'.repeat(3000) })).status).toBe(413);
    expect((await request(app).post('/preview/ocr/jobs').type('text').send('PRIVATE_SENTINEL')).status).toBe(415);
    expect((await request(app).get('/preview/scenario?person=PRIVATE_SENTINEL')).status).toBe(400);
    expect((await request(app).post('/preview/ocr/jobs').type('json').send('{')).status).toBe(400);
    expect((await request(app).get('/api/analyses')).status).toBe(404);
    expect((await request(app).get('/preview/missing')).status).toBe(404);
  });
  it('leaves production app without preview routes', async () => {
    const app = createApp(parseConfig({ NODE_ENV: 'production' }));
    expect((await request(app).get('/preview/scenario')).status).toBe(404);
    expect((await request(app).post('/preview/analyses').send({ source: 'ocr' })).status).toBe(404);
  });
});
