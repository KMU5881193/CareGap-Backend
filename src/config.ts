import 'dotenv/config';
import { z } from 'zod';
export function parseConfig(input: NodeJS.ProcessEnv) {
 const config=z.object({ NODE_ENV:z.enum(['development','test','production']).default('development'), DATABASE_URL:z.string().url().optional(), DEV_AUTH_ENABLED:z.enum(['true','false']).default('false') }).parse(input);
 if(config.NODE_ENV==='production' && config.DEV_AUTH_ENABLED==='true') throw new Error('Development authentication is forbidden in production');
 return config;
}

// App tests do not bind a configured server port; the executable requires one.
export function parseServerConfig(input: NodeJS.ProcessEnv) {
 const config = parseConfig(input);
 const port = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(65535)).safeParse(input.PORT);
 if (!port.success) throw new Error('PORT 환경변수에 사용할 포트를 1~65535 범위의 정수로 지정하세요. 팀 표준 포트는 아직 미정입니다.');
 return { ...config, PORT: port.data };
}
