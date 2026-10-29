import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import type { Actor } from '../src/shared/contracts.js';
import { syntheticWelfareCatalog } from '../src/modules/be3-intelligence/welfare-catalog.js';
import { WelfareRecommendationService } from '../src/modules/be3-intelligence/welfare-service.js';
import { createWelfareRouter } from '../src/modules/be3-intelligence/welfare-router.js';
import { welfareDemoInput } from '../src/modules/be3-intelligence/welfare-demo.js';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';

const actor: Actor = { user_id: '00000000-0000-4000-8000-000000000001', role: 'staff' };
function setup(authenticate: (req: express.Request) => Promise<unknown> = async () => actor) {
  const source = syntheticWelfareCatalog();
  const list = vi.fn(() => source.list());
  const canAccess = vi.fn(async () => true);
  const service = new WelfareRecommendationService({ catalog: { list }, authorization: { canAccess } });
  return { app: express().use(createWelfareRouter(service, authenticate)), list, canAccess, input: welfareDemoInput() };
}

describe('standalone welfare HTTP contract', () => {
  it('lists and searches conditions using data envelopes', async () => {
    const s = setup(); const all = await request(s.app).get('/api/welfare-programs');
    expect(all.status).toBe(200); expect(all.body.data.total).toBe(3); expect(all.body).not.toHaveProperty('error');
    const search = await request(s.app).get('/api/welfare-programs').query({ need: 'meal_support', q: '식사', data_status: 'synthetic_demo', region: 'busan', limit: '1' });
    expect(search.status).toBe(200); expect(search.body.data.programs.map((p: { id: string }) => p.id)).toEqual(['demo-meal']);
    expect((await request(s.app).get('/api/welfare-programs/demo-meal')).body.data.program.id).toBe('demo-meal');
    expect(s.canAccess).not.toHaveBeenCalled(); // General catalog contains no personal information.
  });
  it('returns structured unverified candidates, basis and missing conditions', async () => {
    const s = setup(); const res = await request(s.app).post('/api/welfare-recommendations').send(s.input);
    expect(res.status).toBe(200); expect(res.body.data.candidates).toHaveLength(3);
    for (const candidate of res.body.data.candidates) {
      expect(candidate.eligibility_status).toBe('unverified'); expect(candidate.data_status).toBe('synthetic_demo'); expect(candidate.source_url).toBeNull();
      expect(candidate.basis.length).toBeGreaterThan(0); expect(candidate.missing_information.length).toBeGreaterThan(0); expect(candidate).not.toHaveProperty('score');
    }
    expect(s.canAccess).toHaveBeenCalledTimes(2); expect(s.list).toHaveBeenCalledWith();
  });
  it('excludes incompatible region and preserves missing income information', async () => {
    const s = setup(); const res = await request(s.app).post('/api/welfare-recommendations').send({ ...s.input, region: 'busan' });
    expect(res.body.data.unmatched_needs).toContain('mobility_support'); expect(res.body.data.candidates.map((c: { program_id: string }) => c.program_id)).not.toContain('demo-mobility');
    expect(res.body.data.candidates.find((c: { program_id: string }) => c.program_id === 'demo-meal').missing_information).toContain('소득·수급 관련 조건 확인 필요');
  });
  it('returns empty search and 404 for an unknown valid program ID', async () => {
    const s = setup(); expect((await request(s.app).get('/api/welfare-programs').query({ q: '아무것도없음' })).body.data.programs).toEqual([]);
    const res = await request(s.app).get('/api/welfare-programs/not-present'); expect(res.status).toBe(404); expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'NOT_FOUND' } });
  });
  it.each([{}, { ...welfareDemoInput(), person_id: 'bad' }, { ...welfareDemoInput(), needs: ['invented'] }, { ...welfareDemoInput(), phone: 'unaccepted-field' }])('rejects invalid recommendation input', async input => {
    const s = setup(); const res = await request(s.app).post('/api/welfare-recommendations').send(input);
    expect(res.status).toBe(400); expect(res.body).toEqual({ error: { code: 'INVALID_REQUEST', message: 'INVALID_REQUEST' } }); expect(s.list).not.toHaveBeenCalled();
  });
  it('rejects repeated/unknown query keys without exposing parser errors', async () => {
    const s = setup();
    for (const url of ['/api/welfare-programs?limit=1&limit=2', '/api/welfare-programs?private=secret', '/api/welfare-programs?limit=999']) {
      const res = await request(s.app).get(url); expect(res.status).toBe(400); expect(res.body).toEqual({ error: { code: 'INVALID_REQUEST', message: 'INVALID_REQUEST' } });
    }
    expect(s.list).not.toHaveBeenCalled();
  });
  it('handles malformed and oversized JSON with safe error envelopes', async () => {
    const s = setup(); const broken = await request(s.app).post('/api/welfare-recommendations').set('Content-Type', 'application/json').send('{broken'); expect(broken.status).toBe(400);
    const large = await request(s.app).post('/api/welfare-recommendations').send({ blob: 'x'.repeat(20_000) }); expect(large.status).toBe(413); expect(large.body).toEqual({ error: { code: 'INVALID_REQUEST', message: 'INVALID_REQUEST' } }); expect(s.list).not.toHaveBeenCalled();
  });
  it.each(['none', 'throw', 'invalid'])('fails authentication closed and ignores forged test actor: %s', async kind => {
    const s = setup(async () => { if (kind === 'throw') throw Error('secret auth'); return kind === 'none' ? null : { user_id: 'bad', role: 'admin' }; });
    const res = await request(s.app).post('/api/welfare-recommendations').set('X-Test-Actor', JSON.stringify(actor)).send(s.input);
    expect(res.status).toBe(401); expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'UNAUTHENTICATED' } }); expect(s.list).not.toHaveBeenCalled(); expect(s.canAccess).not.toHaveBeenCalled();
    expect((await request(s.app).get('/api/welfare-programs')).status).toBe(401);
  });
  it('denies unauthorized and revoked requests each time', async () => {
    const s = setup(); expect((await request(s.app).post('/api/welfare-recommendations').send(s.input)).status).toBe(200);
    s.canAccess.mockResolvedValue(false); const res = await request(s.app).post('/api/welfare-recommendations').send(s.input);
    expect(res.status).toBe(403); expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'FORBIDDEN' } }); expect(s.list).toHaveBeenCalledTimes(1);
  });
  it('denies revocation during catalog read', async () => {
    const s = setup(); s.list.mockImplementation(async () => { s.canAccess.mockResolvedValue(false); return syntheticWelfareCatalog().list(); });
    const res = await request(s.app).post('/api/welfare-recommendations').send(s.input); expect(res.status).toBe(403); expect(res.body).not.toHaveProperty('data');
  });
  it('sanitizes external data failures and invalid catalogs', async () => {
    const s = setup(); s.list.mockRejectedValue(Error('private vendor token and text'));
    const unavailable = await request(s.app).get('/api/welfare-programs'); expect(unavailable.status).toBe(503); expect(unavailable.body).toEqual({ error: { code: 'CATALOG_UNAVAILABLE', message: 'CATALOG_UNAVAILABLE' } });
    s.list.mockResolvedValue([{ id: 'broken' }] as never); const invalid = await request(s.app).post('/api/welfare-recommendations').send(s.input);
    expect(invalid.status).toBe(503); expect(invalid.body).toEqual({ error: { code: 'CATALOG_INVALID', message: 'CATALOG_INVALID' } });
  });
  it('does not expose welfare routes on the production app', async () => {
    const app = createApp(parseConfig({ NODE_ENV: 'production' }));
    expect((await request(app).get('/api/welfare-programs')).status).toBe(404);
    expect((await request(app).post('/api/welfare-recommendations').send(welfareDemoInput())).status).toBe(404);
  });
});
