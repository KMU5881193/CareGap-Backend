import type { AnalysisProvider, SourceVersion } from './analysis.js';

export type ProviderErrorCode = 'LLM_CONFIG_INVALID' | 'LLM_API_KEY_MISSING' | 'LLM_APPROVAL_REQUIRED'
  | 'LLM_SYNTHETIC_ONLY' | 'LLM_INPUT_TOO_LARGE' | 'LLM_OUTPUT_TOO_LARGE' | 'LLM_HTTP_ERROR'
  | 'LLM_NETWORK_ERROR' | 'LLM_TIMEOUT' | 'LLM_CANCELLED' | 'LLM_INVALID_RESPONSE'
  | 'LLM_REFUSED' | 'LLM_INCOMPLETE' | 'LLM_MODEL_MISMATCH' | 'INVALID_ANALYSIS';

// Fixed public codes only. Never retain a transport exception, response body or key as cause.
export class AnalysisProviderError extends Error {
  constructor(public readonly code: ProviderErrorCode) { super(code); this.name = 'AnalysisProviderError'; }
}
export interface AnalysisRunOptions { signal?: AbortSignal }
export interface WorkflowAnalysisProvider extends AnalysisProvider {
  generate(sources: readonly SourceVersion[], options?: AnalysisRunOptions): Promise<unknown>;
}
export interface AnalysisProviderMetadata { provider: 'openai'; model: string; prompt_version: string }
