import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Actor, Id, type AuthorizationPort } from '../../shared/contracts.js';
import type { OcrProvider } from './analysis.js';
import { OcrError, validateImage, localLimits } from './ocr-image.js';

const Text = z.string().trim().min(1).max(100_000);
const ProviderText = z.string().max(100_000).refine(value => value.trim().length > 0);
const Create = z.object({ person_id: Id, request_key: z.string().min(1).max(128) }).strict();
const Revision = z.object({ expected_version: z.number().int().nonnegative(), text: Text }).strict();
const Confirm = z.object({ expected_version: z.number().int().positive() }).strict();
export type Correction = { version: number; text: string; edited_by: string; edited_at: string };
export type OcrJob = {
  id: string; person_id: string; created_by: string; created_at: string;
  provider_kind: 'mock' | 'injected';
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  original?: string; failure?: { code: string; retryable: boolean };
  version: number; corrections: Correction[];
  confirmed?: { version: number; confirmed_by: string; confirmed_at: string };
};
export interface OcrRepository {
  get(id: string): OcrJob | undefined;
  findRequest(actorId: string, key: string): { id: string; fingerprint: string } | undefined;
  insert(job: OcrJob, key: string, fingerprint: string): void;
  save(job: OcrJob, expected: OcrJob): void;
}
// Instance-local, synchronous compare-and-swap. A DB adapter needs atomic equivalents.
export class InMemoryOcrRepository implements OcrRepository {
  private jobs = new Map<string, OcrJob>();
  private requests = new Map<string, { id: string; fingerprint: string }>();
  get(id: string) { const job = this.jobs.get(id); return job && structuredClone(job); }
  findRequest(actorId: string, key: string) { const value = this.requests.get(JSON.stringify([actorId, key])); return value && { ...value }; }
  insert(job: OcrJob, key: string, fingerprint: string) {
    const request = JSON.stringify([job.created_by, key]);
    if (this.jobs.has(job.id) || this.requests.has(request)) throw new OcrError('CONFLICT', 409);
    this.jobs.set(job.id, structuredClone(job)); this.requests.set(request, { id: job.id, fingerprint });
  }
  save(job: OcrJob, expected: OcrJob) {
    if (JSON.stringify(this.jobs.get(job.id)) !== JSON.stringify(expected)) throw new OcrError('CONFLICT', 409);
    this.jobs.set(job.id, structuredClone(job));
  }
}
export class MockOcrProvider implements OcrProvider {
  async extract(_input: Uint8Array, _mimeType: string) {
    return '최근 식사를 자주 거르고 있다고 말씀하심. 다리가 불편하여 장보기가 어렵다고 함.';
  }
}
export class OcrService {
  constructor(private repository: OcrRepository, private provider: OcrProvider,
    private authorization: AuthorizationPort, private limits = localLimits, private timeoutMs = 5000) {}
  private actor(input: unknown) {
    const actor = Actor.safeParse(input);
    if (!actor.success) throw new OcrError('UNAUTHENTICATED', 401);
    return actor.data;
  }
  private async authorize(actor: Actor, personId: string, action: 'read' | 'write' | 'analyze') {
    let allowed = false;
    try { allowed = await this.authorization.canAccess(actor, personId, action); } catch { /* fail closed */ }
    if (allowed !== true) throw new OcrError('FORBIDDEN', 403);
  }
  private async load(input: unknown, id: string, action: 'read' | 'write' | 'analyze') {
    const actor = this.actor(input);
    if (!Id.safeParse(id).success) throw new OcrError('INVALID_ID');
    const job = this.repository.get(id);
    if (!job) throw new OcrError('NOT_FOUND', 404);
    await this.authorize(actor, job.person_id, action);
    return { actor, job };
  }
  async create(input: unknown, body: unknown, image: unknown) {
    const actor = this.actor(input);
    const parsed = Create.safeParse(body);
    if (!parsed.success) throw new OcrError('INVALID_REQUEST');
    const { person_id, request_key } = parsed.data;
    await this.authorize(actor, person_id, 'write');
    const clean = await validateImage(image, this.limits);
    const fingerprint = createHash('sha256').update(person_id).update(clean.mimeType).update(clean.bytes).digest('hex');
    const previous = this.repository.findRequest(actor.user_id, request_key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new OcrError('CONFLICT', 409);
      return this.get(actor, previous.id);
    }
    const job: OcrJob = { id: randomUUID(), person_id, created_by: actor.user_id, created_at: new Date().toISOString(), provider_kind: this.provider instanceof MockOcrProvider ? 'mock' : 'injected', status: 'pending', version: 0, corrections: [] };
    this.repository.insert(job, request_key, fingerprint);
    // Only validated bytes captured by this request; image bytes are never persisted.
    void this.process(job.id, clean.bytes, clean.mimeType);
    return structuredClone(job);
  }
  private async process(id: string, bytes: Uint8Array, mimeType: string) {
    const pending = this.repository.get(id)!;
    const processing: OcrJob = { ...pending, status: 'processing' };
    this.repository.save(processing, pending);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Error('Provider timed out');
    try {
      const output = await Promise.race([
        Promise.resolve().then(() => this.provider.extract(bytes, mimeType)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timeout), this.timeoutMs); }),
      ]);
      const text = ProviderText.safeParse(output);
      if (!text.success) {
        this.repository.save({ ...processing, status: 'failed', failure: { code: 'INVALID_PROVIDER_RESULT', retryable: false } }, processing);
        return;
      }
      this.repository.save({ ...processing, original: text.data, status: 'succeeded' }, processing);
    } catch (error) {
      const code = error === timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_FAILED';
      this.repository.save({ ...processing, status: 'failed', failure: { code, retryable: true } }, processing);
    } finally { clearTimeout(timer); }
  }
  async get(actor: unknown, id: string) { return (await this.load(actor, id, 'read')).job; }
  async correct(input: unknown, id: string, body: unknown) {
    const { actor, job } = await this.load(input, id, 'write');
    const parsed = Revision.safeParse(body);
    if (!parsed.success) throw new OcrError('INVALID_REQUEST');
    if (job.status !== 'succeeded' || job.confirmed || parsed.data.expected_version !== job.version) throw new OcrError('CONFLICT', 409);
    const next = { ...job, version: job.version + 1, corrections: [...job.corrections, { version: job.version + 1, text: parsed.data.text, edited_by: actor.user_id, edited_at: new Date().toISOString() }] };
    this.repository.save(next, job); return next;
  }
  async confirm(input: unknown, id: string, body: unknown) {
    const { actor, job } = await this.load(input, id, 'write');
    const parsed = Confirm.safeParse(body);
    if (!parsed.success) throw new OcrError('INVALID_REQUEST');
    if (job.status !== 'succeeded' || job.confirmed || parsed.data.expected_version !== job.version) throw new OcrError('CONFLICT', 409);
    const next = { ...job, confirmed: { version: job.version, confirmed_by: actor.user_id, confirmed_at: new Date().toISOString() } };
    this.repository.save(next, job); return next;
  }
  // BE2 handoff only: this is NOT a BE2 RecordVersion or Analysis SourceVersion.
  async confirmedInput(actor: unknown, id: string) {
    const { job } = await this.load(actor, id, 'analyze');
    if (!job.confirmed) throw new OcrError('NOT_CONFIRMED', 409);
    return { ocr_job_id: job.id, ocr_version: job.confirmed.version, person_id: job.person_id, text: job.corrections[job.confirmed.version - 1].text };
  }
}
