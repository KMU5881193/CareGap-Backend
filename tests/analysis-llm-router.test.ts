import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAnalysisRouter } from '../src/modules/be3-intelligence/analysis-router.js';
import { AnalysisWorkflow } from '../src/modules/be3-intelligence/analysis-workflow.js';
import { OpenAiAnalysisProvider, llmConfigurationFromEnv } from '../src/modules/be3-intelligence/analysis-llm-provider.js';
import { syntheticAnalysisFixture } from '../src/modules/be3-intelligence/analysis-synthetic-fixture.js';

function setup(http: typeof fetch) {
  const f = syntheticAnalysisFixture();
  const config = llmConfigurationFromEnv({ OPENAI_API_KEY: 'FAKE_KEY', CAREGAP_LLM_MODEL: 'gpt-4o-mini-2024-07-18', CAREGAP_LLM_APPROVED: 'synthetic-only-cost-approved' });
  const llm = new OpenAiAnalysisProvider(config.settings, config.secrets, http);
  const workflow = new AnalysisWorkflow({ provider: llm, provider_kind: 'llm', provider_metadata: llm.metadata,
    authorization: { async canAccess() { return true; } }, records: { async getVersion(c, v) { return f.records.find(r => r.consultation_id === c && r.record_version_id === v) ?? null; } } });
  return { ...f, workflow, app: express().use(createAnalysisRouter(workflow, async () => f.actor)) };
}

describe('LLM integration on the standalone router (local Supertest only)', () => {
  it('returns a failed job with sanitized error, never an approvable result', async () => {
    const http = vi.fn(async () => new Response('FAKE_KEY and raw error', { status: 429 })); const s = setup(http);
    const res = await request(s.app).post('/api/analyses').set('Idempotency-Key', 'http').send(s.input);
    expect(res.status).toBe(200); expect(res.body.data).toMatchObject({ status: 'failed', error_code: 'LLM_HTTP_ERROR', provider_kind: 'llm', provider_metadata: { model: 'gpt-4o-mini-2024-07-18' } }); expect(JSON.stringify(res.body)).not.toContain('FAKE_KEY');
    const id = res.body.data.id;
    expect((await request(s.app).post(`/api/analysis-reviews/${id}`).send({ action: 'approve', expected_version: 1 })).status).toBe(409);
    expect((await request(s.app).get(`/api/analyses/${id}/published`)).status).toBe(409);
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('requires authentication before invoking the provider', async () => {
    const http = vi.fn(); const s = setup(http);
    const app = express().use(createAnalysisRouter(s.workflow, async () => null));
    expect((await request(app).post('/api/analyses').set('Idempotency-Key', 'http').send(s.input)).status).toBe(401); expect(http).not.toHaveBeenCalled();
  });
  it('propagates client disconnection to the in-flight LLM and stores failure', async () => {
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const http = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      started();
      return new Promise<Response>((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(new Error('private aborted request')), { once: true }); });
    });
    const s = setup(http); const create = vi.spyOn(s.workflow, 'create');
    const server = s.app.listen(0, '127.0.0.1');
    try {
      const pending = request(server).post('/api/analyses').set('Idempotency-Key', 'disconnect').send(s.input);
      pending.end(() => {});
      await ready; pending.abort();
      const result = await create.mock.results[0].value;
      expect(result.status).toBe('failed'); expect(result.error_code).toBe('LLM_CANCELLED');
      await expect(s.workflow.published(s.actor, result.id)).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
