import { Router, json, type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';
import { Actor } from '../../shared/contracts.js';
import { WelfareError } from './welfare-contracts.js';
import type { WelfareRecommendationService } from './welfare-service.js';

export function createWelfareRouter(service: WelfareRecommendationService, authenticate: (request: Request) => Promise<unknown>) {
  const router = Router();
  router.use(json({ limit: '16kb' }));
  router.use(async (req, res, next) => {
    try {
      const actor = Actor.safeParse(await authenticate(req));
      if (!actor.success) { res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'UNAUTHENTICATED' } }); return; }
      res.locals.welfareActor = actor.data; next();
    } catch { res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'UNAUTHENTICATED' } }); }
  });
  router.get('/api/welfare-programs', async (req, res) => { res.json({ data: await service.list(res.locals.welfareActor, req.query) }); });
  router.get('/api/welfare-programs/:id', async (req, res) => { res.json({ data: await service.get(res.locals.welfareActor, req.params.id) }); });
  router.post('/api/welfare-recommendations', async (req, res) => { res.json({ data: await service.recommend(res.locals.welfareActor, req.body) }); });
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const tooLarge = (error as { type?: string })?.type === 'entity.too.large';
    const status = error instanceof WelfareError ? error.status : tooLarge ? 413 : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
    const code = error instanceof WelfareError ? error.code : status === 400 || status === 413 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';
    res.status(status).json({ error: { code, message: code } });
  });
  return router;
}
