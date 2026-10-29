import { Router, json, type Request } from 'express';
import { ZodError } from 'zod';
import { Actor, Id } from '../../shared/contracts.js';
import { AnalysisError, AnalysisWorkflow } from './analysis-workflow.js';

export type AnalysisAuthentication = (request: Request) => Promise<unknown>;
// Standalone router only: BE1 must inject real authentication; no header-based fallback.
export function createAnalysisRouter(workflow: AnalysisWorkflow, authenticate: AnalysisAuthentication) {
  const router = Router();
  router.use(json({ limit: '128kb' }));
  router.use(async (req, res, next) => {
    try {
      const actor = Actor.safeParse(await authenticate(req));
      if (!actor.success) throw new AnalysisError('UNAUTHENTICATED', 401);
      res.locals.actor = actor.data;
      next();
    } catch { next(new AnalysisError('UNAUTHENTICATED', 401)); }
  });
  router.post('/api/analyses', async (req, res) => {
    res.status(200).json({ data: await workflow.create(res.locals.actor, req.body, req.get('Idempotency-Key') ?? '') });
  });
  router.get('/api/analyses/:id', async (req, res) => {
    res.json({ data: await workflow.get(res.locals.actor, Id.parse(req.params.id)) });
  });
  router.get('/api/analyses/:id/published', async (req, res) => {
    res.json({ data: await workflow.published(res.locals.actor, Id.parse(req.params.id)) });
  });
  router.post('/api/analysis-reviews/:id', async (req, res) => {
    res.json({ data: await workflow.review(res.locals.actor, Id.parse(req.params.id), req.body) });
  });
  router.use((error: unknown, _req: Request, res: import('express').Response, _next: import('express').NextFunction) => {
    const status = error instanceof AnalysisError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : (error as { type?: string })?.type === 'entity.too.large' ? 413 : 500;
    const code = error instanceof AnalysisError ? error.code : status === 400 || status === 413 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';
    res.status(status).json({ error: { code, message: code } });
  });
  return router;
}
