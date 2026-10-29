-- 0001_be1_create_users_table.sql
-- BE1 사용자(Users) 및 역할/상태 관리 기본 테이블 생성

CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('patient', 'family', 'staff', 'admin')),
    status VARCHAR(50) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 💡 [BE2와의 FK 연결 약속]
-- 추후 BE2에서 상담 가능 시간 테이블 등을 만들 때 아래와 같이 참조하게 됩니다:
-- REFERENCES users(user_id)