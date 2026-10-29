import { Router } from 'express';
import { welfareService } from './welfare.service.js';

export function createWelfareRouter(): Router {
  const router = Router();

  // 복지 서비스 목록 조회 API
  router.get('/services', async (_req, res, next) => {
    try {
      const data = await welfareService.getWelfareServices();
      return res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  return router;
}