import { Router } from 'express';
import { relationshipService } from './relationship.service.js';

export function createRelationshipRouter(): Router {
  const router = Router();

  // 환자와 보호자/담당자 연결(링크) 생성
  router.post('/link', async (req, res, next) => {
    try {
      const { patientIdentifier, linkedIdentifier, relationType } = req.body;
      const result = await relationshipService.linkUser(
        patientIdentifier,
        linkedIdentifier,
        relationType
      );
      return res.status(201).json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  // 특정 환자에 연결된 관계 목록 조회
  router.get('/:patientIdentifier', async (req, res, next) => {
    try {
      const { patientIdentifier } = req.params;
      const relations = await relationshipService.getRelationsByPatient(patientIdentifier);
      return res.json({ data: relations });
    } catch (error) {
      next(error);
    }
  });

  return router;
}