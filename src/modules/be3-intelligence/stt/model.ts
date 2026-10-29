import { z } from 'zod';
import type { SttProvider } from '../analysis.js';

export class SttError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export const TranscriptText = z.string().max(100_000).refine(value => value.trim().length > 0);
export const TranscriptSegment = z.object({
  start_ms: z.number().int().nonnegative(), end_ms: z.number().int().positive(),
  speaker_id: z.string().regex(/^(unknown|speaker_[1-9]\d{0,2})$/), text: TranscriptText,
}).strict();
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;
export const TranscriptOutput = z.object({
  text: TranscriptText, segments: z.array(TranscriptSegment).min(1).max(1000),
  timing: z.enum(['whole_audio', 'asr_timestamps']), diarization: z.literal('none'),
}).strict();
export type TranscriptOutput = z.infer<typeof TranscriptOutput>;
// Optional cancellation/timestamps extend the existing two-argument SttProvider.
export interface TranscriptProvider extends SttProvider {
  transcribe(input: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<string>;
  transcribeSegments?(input: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<TranscriptOutput>;
}
export function validateSegments(input: unknown, durationMs: number): TranscriptSegment[] {
  const segments = z.array(TranscriptSegment).min(1).max(1000).safeParse(input);
  if (!segments.success) throw new SttError('INVALID_SEGMENTS');
  let previousEnd = 0, textLength = 0;
  for (const segment of segments.data) {
    if (segment.start_ms < previousEnd || segment.end_ms <= segment.start_ms || segment.end_ms > durationMs) {
      throw new SttError('INVALID_SEGMENTS');
    }
    previousEnd = segment.end_ms; textLength += segment.text.length;
  }
  if (textLength > 100_000) throw new SttError('INVALID_SEGMENTS');
  return segments.data;
}
