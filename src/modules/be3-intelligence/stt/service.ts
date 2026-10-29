import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Actor, Id, type AuthorizationPort } from '../../../shared/contracts.js';
import { SttError, TranscriptOutput, validateSegments, type TranscriptProvider, type TranscriptSegment } from './model.js';
import { validateWav, wavLimits, type WavInfo } from './wav.js';

export class MockSttProvider implements TranscriptProvider {
  async transcribe(_input: Uint8Array, _mimeType: string) { return '합성 테스트: 최근 식사는 하루 두 번 했습니다.'; }
}
type Revision = { version: number; text: string; segments: TranscriptSegment[]; edited_by: string; edited_at: string };
export interface TranscriptJob {
  id: string; person_id: string; created_by: string; created_at: string;
  provider_kind: 'mock' | 'injected'; audio: WavInfo;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  original?: TranscriptOutput;
  failure?: { code: string; retryable: boolean };
  version: number; revisions: Revision[];
  confirmed?: { version: number; confirmed_by: string; confirmed_at: string };
}
export interface TranscriptRepository {
  get(id: string): TranscriptJob | undefined;
  find(actorId: string, key: string): { id: string; hash: string } | undefined;
  insert(job: TranscriptJob, key: string, hash: string): void;
  save(next: TranscriptJob, expected: TranscriptJob): void;
}
export class InMemoryTranscriptRepository implements TranscriptRepository {
  private jobs = new Map<string, TranscriptJob>();
  private requests = new Map<string, { id: string; hash: string }>();
  get(id: string) { const job = this.jobs.get(id); return job && structuredClone(job); }
  find(actorId: string, key: string) { const item = this.requests.get(JSON.stringify([actorId, key])); return item && { ...item }; }
  insert(job: TranscriptJob, key: string, hash: string) {
    const request = JSON.stringify([job.created_by, key]);
    if (this.jobs.has(job.id) || this.requests.has(request)) throw new SttError('CONFLICT', 409);
    this.jobs.set(job.id, structuredClone(job)); this.requests.set(request, { id: job.id, hash });
  }
  save(next: TranscriptJob, expected: TranscriptJob) {
    if (JSON.stringify(this.jobs.get(next.id)) !== JSON.stringify(expected)) throw new SttError('CONFLICT', 409);
    this.jobs.set(next.id, structuredClone(next));
  }
}
const Create = z.object({ person_id: Id, request_key: z.string().trim().min(1).max(128) }).strict();
const Correction = z.object({ expected_version: z.number().int().nonnegative(), segments: z.unknown() }).strict();
const Confirmation = z.object({ expected_version: z.number().int().positive() }).strict();
export class TranscriptService {
  constructor(private repository: TranscriptRepository, private provider: TranscriptProvider,
    private authorization: AuthorizationPort, private timeoutMs = 10_000, private limits = wavLimits) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new SttError('INVALID_CONFIGURATION');
  }
  private actor(input: unknown): Actor {
    const parsed = Actor.safeParse(input);
    if (!parsed.success) throw new SttError('UNAUTHENTICATED', 401);
    return parsed.data;
  }
  private async authorize(actor: Actor, person: string, action: 'read' | 'write' | 'analyze') {
    let allowed = false;
    try { allowed = await this.authorization.canAccess(actor, person, action); } catch { /* fail closed */ }
    if (allowed !== true) throw new SttError('FORBIDDEN', 403);
  }
  private async load(input: unknown, id: string, action: 'read' | 'write' | 'analyze') {
    const actor = this.actor(input);
    if (!Id.safeParse(id).success) throw new SttError('INVALID_ID');
    const job = this.repository.get(id);
    if (!job) throw new SttError('NOT_FOUND', 404);
    await this.authorize(actor, job.person_id, action);
    return { actor, job };
  }
  async create(input: unknown, body: unknown, audio: unknown) {
    const actor = this.actor(input), parsed = Create.safeParse(body);
    if (!parsed.success) throw new SttError('INVALID_REQUEST');
    const { person_id, request_key } = parsed.data;
    await this.authorize(actor, person_id, 'write');
    const wav = validateWav(audio, this.limits);
    const hash = createHash('sha256').update(person_id).update(wav.bytes).digest('hex');
    const previous = this.repository.find(actor.user_id, request_key);
    if (previous) {
      if (hash !== previous.hash) throw new SttError('CONFLICT', 409);
      return (await this.load(actor, previous.id, 'write')).job;
    }
    const job: TranscriptJob = { id: randomUUID(), person_id, created_by: actor.user_id, created_at: new Date().toISOString(),
      provider_kind: this.provider instanceof MockSttProvider ? 'mock' : 'injected', audio: wav.info,
      status: 'pending', version: 0, revisions: [] };
    this.repository.insert(job, request_key, hash);
    void this.process(job.id, wav.bytes);
    return structuredClone(job);
  }
  private async process(id: string, bytes: Uint8Array) {
    const pending = this.repository.get(id)!;
    const running: TranscriptJob = { ...pending, status: 'processing' };
    this.repository.save(running, pending);
    const controller = new AbortController(), timeout = new Error('timeout');
    const invalid = new Error('invalid result');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = Promise.resolve().then(async () => {
        if (this.provider.transcribeSegments) return this.provider.transcribeSegments(bytes, 'audio/wav', controller.signal);
        const text = await this.provider.transcribe(bytes, 'audio/wav', controller.signal);
        return { text, segments: [{ start_ms: 0, end_ms: running.audio.duration_ms, speaker_id: 'unknown', text }], timing: 'whole_audio', diarization: 'none' };
      });
      const raw = await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(timeout); controller.abort(); }, this.timeoutMs);
      })]);
      const result = TranscriptOutput.safeParse(raw);
      if (!result.success) throw invalid;
      try { validateSegments(result.data.segments, running.audio.duration_ms); } catch { throw invalid; }
      if (result.data.text !== result.data.segments.map(segment => segment.text).join('')) throw invalid;
      if (result.data.timing === 'whole_audio' && (result.data.segments.length !== 1
        || result.data.segments[0].start_ms !== 0 || result.data.segments[0].end_ms !== running.audio.duration_ms)) throw invalid;
      // No acoustic diarizer is installed: a provider may not invent speaker identities.
      if (result.data.segments.some(segment => segment.speaker_id !== 'unknown')) throw invalid;
      this.repository.save({ ...running, status: 'succeeded', original: result.data }, running);
    } catch (error) {
      const code = error === timeout ? 'STT_TIMEOUT' : error === invalid ? 'INVALID_STT_RESULT' : 'STT_PROVIDER_FAILED';
      this.repository.save({ ...running, status: 'failed', failure: { code, retryable: error !== invalid } }, running);
    } finally { clearTimeout(timer); }
  }
  async get(actor: unknown, id: string) { return (await this.load(actor, id, 'read')).job; }
  async correct(input: unknown, id: string, body: unknown) {
    const { actor, job } = await this.load(input, id, 'write');
    const parsed = Correction.safeParse(body);
    if (!parsed.success) throw new SttError('INVALID_REQUEST');
    if (job.status !== 'succeeded' || job.confirmed || job.version !== parsed.data.expected_version) throw new SttError('CONFLICT', 409);
    const segments = validateSegments(parsed.data.segments, job.audio.duration_ms);
    const text = segments.map(segment => segment.text).join('\n');
    if (text.length > 100_000) throw new SttError('INVALID_SEGMENTS');
    const version = job.version + 1;
    const next = { ...job, version, revisions: [...job.revisions, { version, text, segments, edited_by: actor.user_id, edited_at: new Date().toISOString() }] };
    this.repository.save(next, job); return next;
  }
  async confirm(input: unknown, id: string, body: unknown) {
    const { actor, job } = await this.load(input, id, 'write');
    const parsed = Confirmation.safeParse(body);
    if (!parsed.success) throw new SttError('INVALID_REQUEST');
    if (job.status !== 'succeeded' || job.confirmed || job.version !== parsed.data.expected_version) throw new SttError('CONFLICT', 409);
    const next = { ...job, confirmed: { version: job.version, confirmed_by: actor.user_id, confirmed_at: new Date().toISOString() } };
    this.repository.save(next, job); return next;
  }
  async confirmedInput(actor: unknown, id: string) {
    const { job } = await this.load(actor, id, 'analyze');
    if (!job.confirmed) throw new SttError('NOT_CONFIRMED', 409);
    const revision = job.revisions[job.confirmed.version - 1];
    // BE2 handoff only; no official record_version_id or AI SourceVersion is fabricated.
    return { transcript_job_id: job.id, transcript_version: revision.version, person_id: job.person_id, text: revision.text, segments: revision.segments };
  }
}
