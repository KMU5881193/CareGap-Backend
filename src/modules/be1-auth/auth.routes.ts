import { Router } from 'express';
import { authService } from './auth.service.js';

export function createAuthRouter(): Router {
  const router = Router();

  // 로그인 엔드포인트
  router.post('/login', async (req, res, next) => {
    try {
      const { role, identifier, secret } = req.body;
      const result = await authService.login(role, identifier, secret);
      return res.json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  // 회원가입 엔드포인트
  router.post('/register', async (req, res, next) => {
    try {
      const userData = req.body;
      const result = await authService.register(userData);
      return res.status(201).json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  // 승인 대기 중인 담당자 목록 조회 엔드포인트
  router.get('/staff/pending', async (_req, res, next) => {
    try {
      const pendingList = await authService.getPendingStaffs();
      return res.json({ data: pendingList });
    } catch (error) {
      next(error);
    }
  });

  // 담당자 승인 처리 엔드포인트
  router.post('/staff/approve', async (req, res, next) => {
    try {
      const { identifier } = req.body;
      const result = await authService.approveStaff(identifier);
      return res.json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  return router;
}