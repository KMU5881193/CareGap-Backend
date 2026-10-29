import { Router } from 'express';
import { consultationService } from './consultation.service.js';

export function createConsultationRouter(): Router {
  const router = Router();

  // 상담 일정 조회 API
  router.get('/appointments', async (_req, res, next) => {
    try {
      const data = await consultationService.getAppointments();
      return res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  // 상담 기록 조회 API
  router.get('/records', async (_req, res, next) => {
    try {
      const data = await consultationService.getRecords();
      return res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  return router;
}