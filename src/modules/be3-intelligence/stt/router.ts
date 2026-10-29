import express, { type Request } from 'express';
import { z, ZodError } from 'zod';
import { Actor } from '../../../shared/contracts.js';
import { SttError } from './model.js';
import type { TranscriptService } from './service.js';

function base64(value: string) {
  if (!value.length || value.length % 4) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  for (let i = 0; i < value.length - padding; i++) {
    const c = value.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47)) return false;
  }
  return true;
}
const Upload = z.object({ person_id: z.string(), request_key: z.string(), filename: z.string(),
  mimeType: z.string(), base64: z.string().refine(base64) }).strict();
// Proposal only: not mounted in src/app.ts. No development authentication headers.
export function createTranscriptRouter(service: TranscriptService, resolveActor: (request: Request) => Promise<unknown>) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    try { res.locals.transcriptActor = Actor.parse(await resolveActor(req)); next(); }
    catch { next(new SttError('UNAUTHENTICATED', 401)); }
  });
  router.use(express.json({ limit: '14mb' }));
  router.post('/jobs', async (req, res) => {
    const body = Upload.parse(req.body);
    const job = await service.create(res.locals.transcriptActor, { person_id: body.person_id, request_key: body.request_key },
      { filename: body.filename, mimeType: body.mimeType, bytes: Buffer.from(body.base64, 'base64') });
    res.status(202).json({ data: job });
  });
  router.get('/jobs/:id', async (req, res) => res.json({ data: await service.get(res.locals.transcriptActor, req.params.id) }));
  router.get('/jobs/:id/result', async (req, res) => {
    const job = await service.get(res.locals.transcriptActor, req.params.id);
    if (job.status !== 'succeeded') throw new SttError('RESULT_NOT_READY', 409);
    res.json({ data: job });
  });
  router.post('/jobs/:id/corrections', async (req, res) => res.json({ data: await service.correct(res.locals.transcriptActor, req.params.id, req.body) }));
  router.post('/jobs/:id/confirmation', async (req, res) => res.json({ data: await service.confirm(res.locals.transcriptActor, req.params.id, req.body) }));
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const large = typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large';
    const status = error instanceof SttError ? error.status : large ? 413 : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
    const code = error instanceof SttError ? error.code : large ? 'AUDIO_TOO_LARGE' : status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';
    res.status(status).json({ error: { code, message: code } });
  });
  return router;
}
