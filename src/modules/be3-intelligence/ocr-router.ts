import express, { type Request } from 'express';
import { z, ZodError } from 'zod';
import { Actor } from '../../shared/contracts.js';
import { OcrService } from './ocr.js';
import { OcrError } from './ocr-image.js';

// Avoid repeated regex groups: V8 can exhaust its stack on valid multi-MiB input.
function isBase64(value: string) {
  if (value.length % 4 !== 0) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const end = value.length - padding;
  for (let i = 0; i < end; i++) {
    const c = value.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47)) return false;
  }
  return true;
}

const Upload = z.object({
  person_id: z.string(), request_key: z.string(), filename: z.string(), mimeType: z.string(),
  base64: z.string().min(4).refine(isBase64),
}).strict();
// Unmounted proposal. BE1 supplies a trusted session resolver, never a test-header parser.
export function createOcrRouter(service: OcrService, resolveActor: (req: Request) => Promise<unknown>) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    try {
      const actor = await resolveActor(req);
      if (!Actor.safeParse(actor).success) throw new OcrError('UNAUTHENTICATED', 401);
      res.locals.ocrActor = actor; next();
    } catch { next(new OcrError('UNAUTHENTICATED', 401)); }
  });
  // Local 5 MiB fixture cap plus JSON/base64 overhead. Production transport TBD.
  router.use(express.json({ limit: '7mb' }));
  router.post('/jobs', async (req, res) => {
    const body = Upload.parse(req.body);
    const data = await service.create(res.locals.ocrActor,
      { person_id: body.person_id, request_key: body.request_key },
      { filename: body.filename, mimeType: body.mimeType, bytes: Buffer.from(body.base64, 'base64') });
    res.status(202).json({ data });
  });
  router.get('/jobs/:id', async (req, res) => res.json({ data: await service.get(res.locals.ocrActor, req.params.id) }));
  router.get('/jobs/:id/result', async (req, res) => {
    const job = await service.get(res.locals.ocrActor, req.params.id);
    if (job.status !== 'succeeded') throw new OcrError('RESULT_NOT_READY', 409);
    res.json({ data: job });
  });
  router.post('/jobs/:id/corrections', async (req, res) => res.json({ data: await service.correct(res.locals.ocrActor, req.params.id, req.body) }));
  router.post('/jobs/:id/confirmation', async (req, res) => res.json({ data: await service.confirm(res.locals.ocrActor, req.params.id, req.body) }));
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const tooLarge = typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large';
    const status = error instanceof OcrError ? error.status : tooLarge ? 413 : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
    const code = error instanceof OcrError ? error.code : tooLarge ? 'IMAGE_TOO_LARGE' : status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';
    res.status(status).json({ error: { code, message: code } });
  });
  return router;
}
