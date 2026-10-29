import { pathToFileURL } from 'node:url';
import { AnalysisWorkflow } from './analysis-workflow.js';
import { SyntheticAnalysisProvider } from './analysis-mock.js';
import { OpenAiAnalysisProvider, llmConfigurationFromEnv } from './analysis-llm-provider.js';
import { AnalysisProviderError, type WorkflowAnalysisProvider, type AnalysisProviderMetadata } from './analysis-provider-support.js';
import { syntheticAnalysisFixture } from './analysis-synthetic-fixture.js';

// Injectable runner for deterministic HTTP tests; the CLI accepts no files, text or custom URLs.
export async function runAnalysisDemo(mode: 'mock' | 'llm', env: NodeJS.ProcessEnv, options: { transport?: typeof fetch; signal?: AbortSignal } = {}) {
  const fixture = syntheticAnalysisFixture();
  let provider: WorkflowAnalysisProvider = new SyntheticAnalysisProvider();
  let metadata: AnalysisProviderMetadata | undefined;
  if (mode === 'llm') {
    const config = llmConfigurationFromEnv(env);
    const llm = new OpenAiAnalysisProvider(config.settings, config.secrets, options.transport);
    provider = llm; metadata = llm.metadata;
  }
  const workflow = new AnalysisWorkflow({
    authorization: { async canAccess(actor, person) { return actor.user_id === fixture.actor.user_id && actor.role === 'staff' && person === fixture.input.person_id; } },
    records: { async getVersion(c, v) { return fixture.records.find(r => r.consultation_id === c && r.record_version_id === v) ?? null; } },
    provider, provider_kind: mode, provider_metadata: metadata,
  });
  const analysis = await workflow.create(fixture.actor, fixture.input, 'synthetic-llm-demo', { signal: options.signal });
  if (analysis.status !== 'succeeded' || !analysis.edited) return {
    data: { id: analysis.id, status: analysis.status, error_code: analysis.error_code, provider_kind: analysis.provider_kind, provider_metadata: analysis.provider_metadata, review_state: analysis.review_state, version: analysis.version },
    demo: { mode, evidence_validation: 'failed', approval: 'not_attempted' },
  };
  // Simulated STAFF actions for a synthetic demo only. Live service never auto-approves LLM output.
  const draft = structuredClone(analysis.edited);
  draft.questions[0] = '담당자 시연 수정: 다음 상담에서 필요한 지원을 다시 확인할까요?';
  await workflow.review(fixture.actor, analysis.id, { action: 'edit', expected_version: 1, draft });
  await workflow.review(fixture.actor, analysis.id, { action: 'submit', expected_version: 2 });
  await workflow.review(fixture.actor, analysis.id, { action: 'approve', expected_version: 3 });
  return {
    data: await workflow.published(fixture.actor, analysis.id),
    demo: { mode, evidence_validation: 'passed', approval: 'simulated_staff_only', original: analysis.original, history: (await workflow.get(fixture.actor, analysis.id)).history },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !['mock', 'llm'].includes(args[0])) throw new AnalysisProviderError('LLM_CONFIG_INVALID');
    const result = await runAnalysisDemo(args[0] as 'mock' | 'llm', process.env, { signal: controller.signal });
    console.log(JSON.stringify(result, null, 2)); // Only fixed synthetic input/output, never config/headers/exception.
    if (result.demo.evidence_validation !== 'passed') process.exitCode = 1;
  } catch (caught) {
    console.error(JSON.stringify({ error: { code: caught instanceof AnalysisProviderError ? caught.code : 'DEMO_FAILED' } }));
    process.exitCode = 1;
  } finally { process.off('SIGINT', stop); }
}
