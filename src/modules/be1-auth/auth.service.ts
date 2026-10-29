// src/modules/be1-auth/auth.service.ts

export type UserRole = 'PATIENT' | 'FAMILY' | 'STAFF' | 'ADMIN';

export interface RegisterDto {
  role: UserRole;
  identifier: string;
  secret: string;
  name: string;
}

export class AuthService {
  // 메모리 기반 임시 스토리지 (추후 DB 연동 시 모델로 대체)
  private users: Array<RegisterDto & { status?: string }> = [
    { role: 'ADMIN', identifier: 'admin_user', secret: 'admin1234', name: '관리자', status: 'ACTIVE' },
    { role: 'STAFF', identifier: 'staff_user', secret: 'staff1234', name: '담당자', status: 'PENDING' },
  ];

  async login(role: string, identifier: string, secret: string) {
    const user = this.users.find(
      (u) => u.role === role && u.identifier === identifier && u.secret === secret
    );

    if (!user) {
      throw new Error('INVALID_CREDENTIALS');
    }

    // 담당자(STAFF)의 경우 승인 상태 체크 로직 예시
    if (user.role === 'STAFF' && user.status === 'PENDING') {
      return {
        success: false,
        message: 'Staff account is pending approval by admin.',
      };
    }

    return {
      success: true,
      role: user.role,
      identifier: user.identifier,
      name: user.name,
      message: 'Login successful',
    };
  }

  async register(userData: RegisterDto) {
    // 중복 아이디 체크
    const exists = this.users.some((u) => u.identifier === userData.identifier);
    if (exists) {
      throw new Error('DUPLICATE_IDENTIFIER');
    }

    // 담당자(STAFF)는 기본적으로 승인 대기(PENDING) 상태로 설정
    const initialStatus = userData.role === 'STAFF' ? 'PENDING' : 'ACTIVE';

    const newUser = {
      ...userData,
      status: initialStatus,
    };

    this.users.push(newUser);

    return {
      success: true,
      role: newUser.role,
      identifier: newUser.identifier,
      status: newUser.status,
      message: userData.role === 'STAFF' 
        ? 'Registration successful. Awaiting admin approval.' 
        : 'Registration successful.',
    };
  }

  // 승인 대기 중인 담당자 목록 조회 (관리자용)
  async getPendingStaffs() {
    return this.users.filter((u) => u.role === 'STAFF' && u.status === 'PENDING');
  }

  // 담당자 계정 승인 처리 (관리자용)
  async approveStaff(identifier: string) {
    const user = this.users.find((u) => u.role === 'STAFF' && u.identifier === identifier);
    if (!user) {
      throw new Error('STAFF_NOT_FOUND');
    }

    user.status = 'APPROVED';

    return {
      success: true,
      identifier: user.identifier,
      status: user.status,
      message: 'Staff account has been successfully approved.',
    };
  }
}

export const authService = new AuthService();