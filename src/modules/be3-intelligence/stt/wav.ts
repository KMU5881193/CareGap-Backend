import { z } from 'zod';
import { SttError } from './model.js';

export interface WavLimits { maxBytes: number; maxDurationMs: number }
export const wavLimits: Readonly<WavLimits> = Object.freeze({ maxBytes: 10 * 1024 * 1024, maxDurationMs: 300_000 });
const Input = z.object({
  filename: z.string().min(1).max(120).regex(/\.wav$/i).refine(value => !/[\\/\x00:]/.test(value)),
  mimeType: z.literal('audio/wav'), bytes: z.instanceof(Uint8Array),
}).strict();
export interface WavInfo { sample_rate: number; channels: number; bits_per_sample: 16; duration_ms: number; frames: number }
export function validateWav(input: unknown, limits = wavLimits): { bytes: Buffer; info: WavInfo } {
  const parsed = Input.safeParse(input);
  if (!parsed.success) throw new SttError('INVALID_AUDIO');
  if (!parsed.data.bytes.length) throw new SttError('EMPTY_AUDIO');
  if (parsed.data.bytes.length > limits.maxBytes) throw new SttError('AUDIO_TOO_LARGE', 413);
  const bytes = Buffer.from(parsed.data.bytes);
  const corrupt = () => { throw new SttError('CORRUPT_WAV'); };
  if (bytes.length < 44 || !bytes.subarray(0, 4).equals(Buffer.from('RIFF')) || !bytes.subarray(8, 12).equals(Buffer.from('WAVE'))
    || bytes.readUInt32LE(4) + 8 !== bytes.length) corrupt();
  let offset = 12, fmt: Buffer | undefined, pcm: Buffer | undefined;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) corrupt();
    const name = bytes.toString('latin1', offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + size;
    if (end + size % 2 > bytes.length) corrupt();
    if (name === 'fmt ') { if (fmt) corrupt(); fmt = bytes.subarray(start, end); }
    if (name === 'data') { if (pcm) corrupt(); pcm = bytes.subarray(start, end); }
    offset = end + size % 2;
  }
  if (!fmt || !pcm || !pcm.length || ![16, 18].includes(fmt.length)) return corrupt();
  if (fmt.length === 18 && fmt.readUInt16LE(16) !== 0) return corrupt();
  const channels = fmt.readUInt16LE(2), sampleRate = fmt.readUInt32LE(4);
  const blockAlign = channels * 2;
  if (fmt.readUInt16LE(0) !== 1 || fmt.readUInt16LE(14) !== 16) throw new SttError('UNSUPPORTED_WAV_ENCODING');
  if (![1, 2].includes(channels) || ![8000, 16000, 22050, 24000, 32000, 44100, 48000].includes(sampleRate)) {
    throw new SttError('UNSUPPORTED_AUDIO_FORMAT');
  }
  if (fmt.readUInt16LE(12) !== blockAlign || fmt.readUInt32LE(8) !== sampleRate * blockAlign || pcm.length % blockAlign) return corrupt();
  const frames = pcm.length / blockAlign, durationMs = Math.ceil(frames * 1000 / sampleRate);
  if (durationMs > limits.maxDurationMs) throw new SttError('AUDIO_TOO_LONG', 413);
  // Canonical PCM WAV discards ancillary metadata. User filenames are never storage paths.
  const clean = Buffer.alloc(44 + pcm.length);
  clean.write('RIFF'); clean.writeUInt32LE(clean.length - 8, 4); clean.write('WAVEfmt ', 8);
  clean.writeUInt32LE(16, 16); fmt.copy(clean, 20, 0, 16); clean.write('data', 36);
  clean.writeUInt32LE(pcm.length, 40); pcm.copy(clean, 44);
  return { bytes: clean, info: { sample_rate: sampleRate, channels, bits_per_sample: 16, duration_ms: durationMs, frames } };
}
