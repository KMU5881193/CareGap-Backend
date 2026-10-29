import { z } from 'zod';
import { Id } from '../../shared/contracts.js';

export const Evidence = z.object({
  consultation_id: Id,
  record_version_id: Id,
  quote: z.string().trim().min(1),
}).strict();

export const AnalysisDraft = z.object({
  status: z.literal('draft'),
  findings: z.array(z.object({
    text: z.string().trim().min(1),
    change: z.enum(['improved', 'worsened', 'unchanged', 'unknown']),
    evidence: z.array(Evidence).min(1),
  }).strict()),
  questions: z.array(z.string().trim().min(1)),
}).strict();

export interface SourceVersion {
  consultation_id: string;
  record_version_id: string;
  text: string;
}

// Caller must first obtain authorized immutable source versions from BE1/BE2.
// Exact quote validation establishes provenance, not factual/clinical correctness.
export function validateDraft(input: unknown, sources: readonly SourceVersion[]) {
  const draft = AnalysisDraft.parse(input);
  const versions = new Map<string, string>();
  for (const source of sources) {
    const key = `${source.consultation_id}:${source.record_version_id}`;
    if (versions.has(key)) throw new Error('Duplicate source version');
    versions.set(key, source.text);
  }
  for (const finding of draft.findings) {
    for (const evidence of finding.evidence) {
      const text = versions.get(`${evidence.consultation_id}:${evidence.record_version_id}`);
      if (text === undefined || !text.includes(evidence.quote)) {
        throw new Error('Evidence does not match the referenced source version');
      }
    }
  }
  return draft;
}

// Provider adapters are intentionally unbound; no external AI/OCR/STT calls.
export interface OcrProvider { extract(input: Uint8Array, mimeType: string): Promise<string> }
export interface SttProvider { transcribe(input: Uint8Array, mimeType: string): Promise<string> }
export interface AnalysisProvider { generate(sources: readonly SourceVersion[]): Promise<unknown> }
