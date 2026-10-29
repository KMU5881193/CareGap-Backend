import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { AnalysisWorkflow } from '../src/modules/be3-intelligence/analysis-workflow.js';
import { SyntheticAnalysisProvider, syntheticPast, syntheticCurrent } from '../src/modules/be3-intelligence/analysis-mock.js';
import { createAnalysisRouter } from '../src/modules/be3-intelligence/analysis-router.js';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import type { Actor, RecordVersion } from '../src/shared/contracts.js';
import type { AnalysisProvider } from '../src/modules/be3-intelligence/analysis.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor: Actor = { user_id: id(1), role: 'staff' };
function setup(provider: AnalysisProvider = new SyntheticAnalysisProvider()) {
  const rows: RecordVersion[] = [
    { consultation_id: id(3), record_version_id: id(4), person_id: id(2), text: syntheticPast },
    { consultation_id: id(5), record_version_id: id(6), person_id: id(2), text: syntheticCurrent },
  ];
  const canAccess = vi.fn(async () => true);
  const getVersion = vi.fn(async (c: string, v: string) => rows.find(r => r.consultation_id === c && r.record_version_id === v) ?? null);
  const generate = vi.spyOn(provider, 'generate');
  const workflow = new AnalysisWorkflow({ authorization: { canAccess }, records: { getVersion }, provider, provider_kind: 'mock' });
  const input = { person_id: id(2), past: [{ consultation_id: id(3), record_version_id: id(4) }], current: { consultation_id: id(5), record_version_id: id(6) } };
  const app = express().use(createAnalysisRouter(workflow, async () => actor));
  const create = () => workflow.create(actor, input, 'test');
  return { rows, canAccess, getVersion, generate, workflow, input, app, create };
}

describe('AI workflow', () => {
  it('summarizes synthetic facts with paired exact evidence and 3 questions', async () => {
    const s = setup(); const e = await s.create();
    expect(e.status).toBe('succeeded'); expect(e.provider_kind).toBe('mock');
    expect(e.original?.findings.map(f => f.text)).toEqual(['식사 횟수: 하루 3회 → 하루 2회로 기록됨.', '외출: 주 1회 → 외출하지 못함으로 기록됨.', '약 복용: 매일 복용 → 2일 미복용으로 기록됨.']);
    for (const f of e.original!.findings) { expect(f.change).toBe('worsened'); expect(f.evidence).toHaveLength(2); for (const ev of f.evidence) expect(s.rows.find(r => r.record_version_id === ev.record_version_id)?.text).toContain(ev.quote); }
    expect(e.original?.questions).toHaveLength(3);
    expect(s.generate.mock.calls[0][0][0]).not.toHaveProperty('person_id');
  });
  it.each(['missing', 'fabricated', 'wrong-version', 'schema'])('fails invalid provider output: %s', async kind => {
    const provider = { async generate(sources: Parameters<AnalysisProvider['generate']>[0]) {
      const output = await new SyntheticAnalysisProvider().generate(sources);
      if (kind === 'missing') output.findings[0].evidence = [];
      if (kind === 'fabricated') output.findings[0].evidence[0].quote = '진단 조작';
      if (kind === 'wrong-version') output.findings[0].evidence[0].record_version_id = id(99);
      return kind === 'schema' ? { status: 'succeeded' } : output;
    } };
    const e = await setup(provider).create(); expect(e.status).toBe('failed'); expect(e.error_code).toBe('INVALID_ANALYSIS'); expect(e.original).toBeUndefined();
  });
  it('sanitizes provider errors', async () => {
    const e = await setup({ async generate() { throw new Error('secret'); } }).create();
    expect(e.status).toBe('failed'); expect(e.error_code).toBe('PROVIDER_ERROR'); expect(JSON.stringify(e)).not.toContain('secret');
  });
  it('returns unknown for unsupported records without invented facts', async () => {
    const s = setup(); s.rows[1].text = '수면에 관한 기록은 없음.';
    const e = await s.create(); expect(e.original!.findings.every(f => f.change === 'unknown')).toBe(true);
  });
  it('preserves all four change labels without treating unknown as unchanged', async () => {
    const s = setup({ async generate(sources) {
      return { status: 'draft', findings: ['improved', 'worsened', 'unchanged', 'unknown'].map(change => ({ text: '합성 분류 검증', change, evidence: [{ consultation_id: sources[0].consultation_id, record_version_id: sources[0].record_version_id, quote: sources[0].text }] })), questions: [] };
    } });
    expect((await s.create()).original?.findings.map(f => f.change)).toEqual(['improved', 'worsened', 'unchanged', 'unknown']);
  });
  it('passes every past version then current, with exact input binding', async () => {
    const s = setup(); s.rows.push({ ...s.rows[0], consultation_id: id(7), record_version_id: id(8) });
    s.input.past.push({ consultation_id: id(7), record_version_id: id(8) });
    const e = await s.create(); expect(e.input).toEqual(s.input);
    expect(s.generate.mock.calls[0][0].map(r => r.record_version_id)).toEqual([id(4), id(8), id(6)]);
  });
  it('rejects empty source and missing current/past schema', async () => {
    const s = setup(); s.rows[0].text = ' ';
    await expect(s.create()).rejects.toMatchObject({ code: 'SOURCE_MISMATCH' }); expect(s.generate).not.toHaveBeenCalled();
    await expect(s.workflow.create(actor, { ...s.input, past: [] }, 'k')).rejects.toThrow();
    await expect(s.workflow.create(actor, { person_id: id(2), past: s.input.past }, 'k')).rejects.toThrow();
  });
  it.each(['denied', 'throws', 'truthy'])('rejects authorization %s before reading/provider', async kind => {
    const s = setup(); s.canAccess.mockImplementation(async () => { if (kind === 'throws') throw Error(); return kind === 'truthy' ? 'yes' as unknown as boolean : false; });
    await expect(s.create()).rejects.toMatchObject({ code: 'FORBIDDEN' }); expect(s.getVersion).not.toHaveBeenCalled(); expect(s.generate).not.toHaveBeenCalled();
  });
  it('rejects revocation just before provider', async () => {
    const s = setup(); s.canAccess.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
    await expect(s.create()).rejects.toMatchObject({ code: 'FORBIDDEN' }); expect(s.generate).not.toHaveBeenCalled();
  });
  it('does not succeed after revocation during generation', async () => {
    const s = setup(); s.generate.mockImplementation(async sources => { s.canAccess.mockResolvedValue(false); return new SyntheticAnalysisProvider().generate(sources); });
    await expect(s.create()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    s.canAccess.mockResolvedValue(true); const e = await s.create(); expect(e.status).toBe('failed');
  });
  it.each(['person', 'version', 'missing'])('rejects mixed or mismatched source: %s', async kind => {
    const s = setup(); if (kind === 'person') s.rows[0].person_id = id(99);
    if (kind === 'version') s.getVersion.mockResolvedValue({ ...s.rows[0], record_version_id: id(99) });
    if (kind === 'missing') s.rows.pop();
    await expect(s.create()).rejects.toMatchObject({ code: 'SOURCE_MISMATCH' }); expect(s.generate).not.toHaveBeenCalled();
  });
  it('rejects repeated consultation input', async () => {
    const s = setup(); s.input.current = s.input.past[0]; await expect(s.create()).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
  it('keeps provider from mutating stored source snapshots', async () => {
    const s = setup(); s.generate.mockImplementation(async sources => { const result = await new SyntheticAnalysisProvider().generate(sources); sources[0].text = 'changed'; return result; });
    expect((await s.create()).sources[0].text).toBe(syntheticPast);
  });
  it('fails source changes during generation', async () => {
    const s = setup(); s.generate.mockImplementation(async sources => { s.rows[0].text = 'changed'; return new SyntheticAnalysisProvider().generate(sources); });
    expect((await s.create()).error_code).toBe('SOURCE_MISMATCH');
  });
  it('deduplicates keys, completed input, and concurrent requests', async () => {
    const s = setup(); const [a, b] = await Promise.all([s.create(), s.create()]); expect(a.id).toBe(b.id);
    expect((await s.workflow.create(actor, s.input, 'other')).id).toBe(a.id); expect(s.generate).toHaveBeenCalledTimes(1);
    await expect(s.workflow.create(actor, { ...s.input, past: [...s.input.past, { consultation_id: id(7), record_version_id: id(8) }] }, 'test')).rejects.toMatchObject({ code: 'SOURCE_MISMATCH' });
    s.rows.push({ ...s.rows[0], consultation_id: id(7), record_version_id: id(8) });
    await expect(s.workflow.create(actor, { ...s.input, past: [...s.input.past, { consultation_id: id(7), record_version_id: id(8) }] }, 'test')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('preserves original and edit history; blocks publication before approval; CAS approves once', async () => {
    const s = setup(); const e = await s.create();
    await expect(s.workflow.published(actor, e.id)).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    const draft = structuredClone(e.original!); draft.findings[0].text = '담당자가 확인할 식사 횟수 감소';
    const edited = await s.workflow.review(actor, e.id, { action: 'edit', expected_version: 1, draft });
    expect(edited.original).toEqual(e.original); expect(edited.history[0].actor_id).toBe(actor.user_id);
    draft.findings[0].text = '외부 변조'; expect((await s.workflow.get(actor, e.id)).edited?.findings[0].text).not.toBe('외부 변조');
    await s.workflow.review(actor, e.id, { action: 'submit', expected_version: 2 });
    const results = await Promise.allSettled([s.workflow.review(actor, e.id, { action: 'approve', expected_version: 3 }), s.workflow.review(actor, e.id, { action: 'approve', expected_version: 3 })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } });
    expect((await s.workflow.published(actor, e.id)).draft?.findings[0].text).toBe('담당자가 확인할 식사 횟수 감소');
    expect((await s.workflow.get(actor, e.id)).history).toHaveLength(3);
  });
  it('blocks changed evidence and changed source approval/publication', async () => {
    const s = setup(); const e = await s.create(); const draft = structuredClone(e.original!); draft.findings[0].evidence[0].quote = '하루 세 끼';
    await expect(s.workflow.review(actor, e.id, { action: 'edit', expected_version: 1, draft })).rejects.toMatchObject({ code: 'EVIDENCE_CHANGED' });
    await s.workflow.review(actor, e.id, { action: 'submit', expected_version: 1 }); s.rows[0].text = 'changed';
    await expect(s.workflow.review(actor, e.id, { action: 'approve', expected_version: 2 })).rejects.toMatchObject({ code: 'SOURCE_MISMATCH' });
    await expect(s.workflow.published(actor, e.id)).rejects.toMatchObject({ code: 'SOURCE_MISMATCH' });
  });
  it('rejects reuse of a completed analysis when immutable source content changes', async () => {
    const s = setup(); await s.create(); s.rows[0].text = 'changed';
    await expect(s.create()).rejects.toMatchObject({ code: 'SOURCE_MISMATCH' });
    await expect(s.workflow.create(actor, s.input, 'other')).rejects.toMatchObject({ code: 'SOURCE_MISMATCH' });
  });
  it('blocks direct approval, stale edits, and editing a submitted review', async () => {
    const s = setup(); const e = await s.create();
    await expect(s.workflow.review(actor, e.id, { action: 'approve', expected_version: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(s.workflow.review(actor, e.id, { action: 'edit', expected_version: 99, draft: e.original })).rejects.toMatchObject({ code: 'CONFLICT' });
    await s.workflow.review(actor, e.id, { action: 'submit', expected_version: 1 });
    await expect(s.workflow.review(actor, e.id, { action: 'edit', expected_version: 2, draft: e.original })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('rejects review and prevents later edits or publication', async () => {
    const s = setup(); const e = await s.create(); await s.workflow.review(actor, e.id, { action: 'submit', expected_version: 1 });
    expect((await s.workflow.review(actor, e.id, { action: 'reject', expected_version: 2 })).review_state).toBe('rejected');
    await expect(s.workflow.published(actor, e.id)).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    await expect(s.workflow.review(actor, e.id, { action: 'approve', expected_version: 3 })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('checks current authorization on reads, review and publication', async () => {
    const s = setup(); const e = await s.create(); s.canAccess.mockResolvedValue(false);
    for (const op of [s.workflow.get(actor, e.id), s.workflow.review(actor, e.id, { action: 'submit', expected_version: 1 }), s.workflow.published(actor, e.id)]) await expect(op).rejects.toMatchObject({ code: 'FORBIDDEN' });
    s.canAccess.mockResolvedValue(true); await expect(s.workflow.get({ ...actor, user_id: id(9) }, e.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(s.workflow.get({ ...actor, role: 'family' }, e.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('standalone analysis HTTP contract', () => {
  it('creates, reads, submits, approves and returns published result', async () => {
    const s = setup(); const created = await request(s.app).post('/api/analyses').set('Idempotency-Key', 'http').send(s.input);
    expect(created.status).toBe(200); const eid = created.body.data.id;
    expect((await request(s.app).get(`/api/analyses/${eid}`)).body.data.original).toBeDefined();
    expect((await request(s.app).get(`/api/analyses/${eid}/published`)).status).toBe(409);
    expect((await request(s.app).post(`/api/analysis-reviews/${eid}`).send({ action: 'submit', expected_version: 1 })).status).toBe(200);
    expect((await request(s.app).post(`/api/analysis-reviews/${eid}`).send({ action: 'approve', expected_version: 2 })).status).toBe(200);
    expect((await request(s.app).get(`/api/analyses/${eid}/published`)).status).toBe(200);
  });
  it('validates schema, key, UUID and returns error envelopes', async () => {
    const s = setup(); for (const response of [await request(s.app).post('/api/analyses').send(s.input), await request(s.app).post('/api/analyses').set('Idempotency-Key', 'k').send({}), await request(s.app).get('/api/analyses/bad')]) { expect(response.status).toBe(400); expect(response.body).toEqual({ error: { code: 'INVALID_REQUEST', message: 'INVALID_REQUEST' } }); }
  });
  it('denies forbidden HTTP access and never lets a failed analysis enter review', async () => {
    const s = setup({ async generate() { return {}; } });
    const e = await s.create();
    expect((await request(s.app).post(`/api/analysis-reviews/${e.id}`).send({ action: 'submit', expected_version: 1 })).status).toBe(409);
    s.canAccess.mockResolvedValue(false);
    expect((await request(s.app).post('/api/analyses').set('Idempotency-Key', 'k').send(s.input)).status).toBe(403);
    expect((await request(s.app).get(`/api/analyses/${e.id}`)).status).toBe(403);
  });
  it('fails closed on missing/throwing authentication and ignores forged headers', async () => {
    for (const authenticate of [async () => null, async () => { throw Error('secret'); }]) {
      const app = express().use(createAnalysisRouter(setup().workflow, authenticate));
      const response = await request(app).get(`/api/analyses/${id(1)}`).set('X-Test-Actor', JSON.stringify(actor)); expect(response.status).toBe(401);
    }
  });
  it('is not mounted on the production application', async () => {
    const app = createApp(parseConfig({ NODE_ENV: 'production' })); expect((await request(app).post('/api/analyses').send({})).status).toBe(404);
  });
});
