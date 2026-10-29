import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Actor, Id, type AuthorizationPort, type RecordReader, type RecordVersion } from '../../shared/contracts.js';
import { AnalysisDraft, validateDraft, type AnalysisProvider } from './analysis.js';

const Ref = z.object({ consultation_id: Id, record_version_id: Id }).strict();
export const AnalysisRequest = z.object({ person_id: Id, past: z.array(Ref).min(1).max(20), current: Ref }).strict();
export const ReviewRequest = z.object({ expected_version: z.number().int().positive(), action: z.enum(['edit', 'submit', 'approve', 'reject']), draft: AnalysisDraft.optional() }).strict();
type Draft = z.infer<typeof AnalysisDraft>;
type Input = z.infer<typeof AnalysisRequest>;
type ReviewState = 'draft' | 'review' | 'approved' | 'rejected';
interface History { actor_id: string; at: string; action: string; version: number; draft: Draft }
interface Entry {
  id: string; owner: string; input: Input; sources: RecordVersion[]; provider_kind: 'mock' | 'llm';
  status: 'running' | 'succeeded' | 'failed'; error_code?: string;
  original?: Draft; edited?: Draft; review_state: ReviewState; version: number; history: History[];
}
export class AnalysisError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
const fail = (code: string, status: number): never => { throw new AnalysisError(code, status); };
const clone = <T>(value: T): T => structuredClone(value);

// Process-local prototype storage only. No durability, distributed locking or retention guarantees.
export class AnalysisWorkflow {
  private entries = new Map<string, Entry>();
  private keys = new Map<string, { fingerprint: string; id: string }>();
  private completed = new Map<string, string>();
  constructor(private deps: { authorization: AuthorizationPort; records: RecordReader; provider: AnalysisProvider; provider_kind: 'mock' | 'llm' }) {}

  private async authorize(actor: Actor, person: string, action: 'read' | 'write' | 'analyze') {
    let allowed = false;
    try { allowed = await this.deps.authorization.canAccess(actor, person, action) === true; } catch { /* fail closed */ }
    if (!allowed) fail('FORBIDDEN', 403);
  }
  private async sources(actor: Actor, input: Input, action: 'read' | 'write' | 'analyze') {
    await this.authorize(actor, input.person_id, action);
    const refs = [...input.past, input.current];
    if (new Set(refs.map(r => r.consultation_id)).size !== refs.length) fail('INVALID_REQUEST', 400);
    const result: RecordVersion[] = [];
    for (const ref of refs) {
      const record = await this.deps.records.getVersion(ref.consultation_id, ref.record_version_id);
      if (!record || record.consultation_id !== ref.consultation_id || record.record_version_id !== ref.record_version_id) return fail('SOURCE_MISMATCH', 409);
      if (record.person_id !== input.person_id) fail('SOURCE_MISMATCH', 409);
      if (typeof record.text !== 'string' || !record.text.trim()) fail('SOURCE_MISMATCH', 409);
      result.push(clone(record));
    }
    await this.authorize(actor, input.person_id, action);
    return result;
  }
  private async accessible(actor: Actor, id: string, action: 'read' | 'write') {
    const entry = this.entries.get(id);
    if (!entry || entry.owner !== actor.user_id) return fail('NOT_FOUND', 404);
    await this.authorize(actor, entry.input.person_id, action);
    return entry;
  }
  private async unchanged(actor: Actor, entry: Entry, action: 'read' | 'write' | 'analyze') {
    const current = await this.sources(actor, entry.input, action);
    if (JSON.stringify(current) !== JSON.stringify(entry.sources)) fail('SOURCE_MISMATCH', 409);
  }
  async create(actor: Actor, raw: unknown, key: string) {
    if (actor.role !== 'staff') fail('FORBIDDEN', 403);
    const input = AnalysisRequest.parse(raw);
    if (!key || key.length > 128) fail('INVALID_REQUEST', 400);
    const sources = await this.sources(actor, input, 'analyze');
    const fingerprint = JSON.stringify(input);
    const scope = `${actor.user_id}:analysis:${key}`;
    const prior = this.keys.get(scope);
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail('CONFLICT', 409);
      if (JSON.stringify(sources) !== JSON.stringify(this.entries.get(prior.id)?.sources)) fail('SOURCE_MISMATCH', 409);
      return this.get(actor, prior.id);
    }
    const signature = `${actor.user_id}:${fingerprint}`;
    const completed = this.completed.get(signature);
    if (completed) {
      if (JSON.stringify(sources) !== JSON.stringify(this.entries.get(completed)?.sources)) fail('SOURCE_MISMATCH', 409);
      this.keys.set(scope, { fingerprint, id: completed });
      return this.get(actor, completed);
    }
    const entry: Entry = { id: randomUUID(), owner: actor.user_id, input: clone(input), sources, provider_kind: this.deps.provider_kind, status: 'running', review_state: 'draft', version: 1, history: [] };
    this.entries.set(entry.id, entry);
    this.keys.set(scope, { fingerprint, id: entry.id });
    try {
      // Never pass person/account identifiers to the provider. Input order is past then current.
      await this.authorize(actor, input.person_id, 'analyze');
      const generated = await this.deps.provider.generate(sources.map(({ consultation_id, record_version_id, text }) => ({ consultation_id, record_version_id, text })));
      let draft: Draft;
      try { draft = validateDraft(generated, sources); } catch { return fail('INVALID_ANALYSIS', 422); }
      await this.unchanged(actor, entry, 'analyze');
      entry.original = clone(draft); entry.edited = clone(draft); entry.status = 'succeeded';
      this.completed.set(signature, entry.id);
    } catch (error) {
      entry.status = 'failed'; entry.error_code = error instanceof AnalysisError ? error.code : 'PROVIDER_ERROR';
    }
    return this.get(actor, entry.id);
  }
  async get(actor: Actor, id: string) {
    const e = await this.accessible(actor, id, 'read');
    if (actor.role !== 'staff') fail('FORBIDDEN', 403);
    return clone(e);
  }
  async review(actor: Actor, id: string, raw: unknown) {
    const body = ReviewRequest.parse(raw);
    const e = await this.accessible(actor, id, 'write');
    if (actor.role !== 'staff') fail('FORBIDDEN', 403);
    await this.unchanged(actor, e, 'write');
    if (e.version !== body.expected_version) fail('CONFLICT', 409);
    if (e.status !== 'succeeded' || !e.original || !e.edited || e.review_state === 'approved' || e.review_state === 'rejected') return fail('CONFLICT', 409);
    if (body.action !== 'edit' && body.draft) fail('INVALID_REQUEST', 400);
    if (body.action === 'edit') {
      if (e.review_state !== 'draft' || !body.draft) fail('CONFLICT', 409);
      let edited: Draft;
      try { edited = validateDraft(body.draft, e.sources); } catch { return fail('INVALID_ANALYSIS', 422); }
      // Changes to evidence require a new analysis; staff may only edit wording/questions/change labels.
      if (JSON.stringify(edited.findings.map(f => f.evidence)) !== JSON.stringify(e.original.findings.map(f => f.evidence))) fail('EVIDENCE_CHANGED', 409);
      e.edited = clone(edited);
    } else if (body.action === 'submit') {
      if (e.review_state !== 'draft') fail('CONFLICT', 409);
      e.review_state = 'review';
    } else {
      if (e.review_state !== 'review') fail('CONFLICT', 409);
      validateDraft(e.edited, e.sources);
      e.review_state = body.action === 'approve' ? 'approved' : 'rejected';
    }
    e.version++;
    e.history.push({ actor_id: actor.user_id, at: new Date().toISOString(), action: body.action, version: e.version, draft: clone(e.edited) });
    return clone(e);
  }
  async published(actor: Actor, id: string) {
    const e = await this.accessible(actor, id, 'read');
    await this.unchanged(actor, e, 'read');
    if (e.review_state !== 'approved') fail('NOT_APPROVED', 409);
    return clone({ id: e.id, input: e.input, provider_kind: e.provider_kind, review_state: e.review_state, draft: e.edited, version: e.version });
  }
}
