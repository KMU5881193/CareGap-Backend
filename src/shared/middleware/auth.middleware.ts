import { Request, Response, NextFunction } from 'express';
import { supabase } from '../supabase.js';

// Express Request 인터페이스 확장 (사용자 정보 첨부용)
export interface AuthenticatedRequest extends Request {
  user?: {
    user_id: string;
    email: string;
    role: 'patient' | 'family' | 'staff' | 'admin';
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
  };
}

/**
 * 1. 인증 미들웨어 (사용자 식별)
 */
export const authenticateUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: '인증 토큰이 필요합니다.' });
      return;
    }

    const token = authHeader.split(' ')[1];

    // Supabase Auth 토큰 검증
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authUser) {
      res.status(401).json({ error: '유효하지 않거나 만료된 토큰입니다.' });
      return;
    }

    // DB에서 사용자 정보 및 승인 상태 조회
    const { data: dbUser, error: dbError } = await supabase
      .from('users')
      .select('user_id, email, role, status')
      .eq('user_id', authUser.id)
      .single();

    if (dbError || !dbUser) {
      res.status(404).json({ error: '사용자 정보를 찾을 수 없습니다.' });
      return;
    }

    // Request 객체에 사용자 정보 저장
    req.user = dbUser as AuthenticatedRequest['user'];
    next();
  } catch (error) {
    res.status(500).json({ error: '인증 처리 중 오류가 발생했습니다.' });
  }
};

/**
 * 2. 승인 상태 검증 미들웨어 (APPROVED 상태만 통과)
 */
export const requireApprovedUser = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({ error: '인증 정보가 없습니다.' });
    return;
  }

  if (req.user.status !== 'APPROVED') {
    res.status(403).json({
      error: '승인 대기 중이거나 거절된 계정입니다. 관리자 승인 후 이용 가능합니다.',
      status: req.user.status,
    });
    return;
  }

  next();
};

/**
 * 3. 역할(Role) 기반 권한 검증 미들웨어
 */
export const requireRole = (allowedRoles: Array<'patient' | 'family' | 'staff' | 'admin'>) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: '인증 정보가 없습니다.' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: '해당 요청에 대한 접근 권한이 없습니다.' });
      return;
    }

    next();
  };
};