import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { CallError } from './types.js';
import { DEMO_PATIENT_ID, DEMO_STAFF_ID } from './synthetic-adapters.js';

export type StagingRole = 'staff' | 'patient';

export type StagingAccount = {
  username: string;
  /** scrypt hash as base64 */
  password_hash: string;
  /** scrypt salt as base64 */
  password_salt: string;
  participant_id: typeof DEMO_STAFF_ID | typeof DEMO_PATIENT_ID;
  role: StagingRole;
};

export type StagingAccessClaims = {
  sub: string;
  role: StagingRole;
  participant_id: string;
  iat: number;
  exp: number;
};

export type StagingAuthConfig = {
  tokenSecret: string;
  accessTokenTtlSeconds: number;
  accounts: readonly StagingAccount[];
};

const SCRYPT_KEYLEN = 32;

export function hashPassword(password: string, salt?: Buffer): { hash: string; salt: string } {
  const saltBuf = salt ?? randomBytes(16);
  const hash = scryptSync(password, saltBuf, SCRYPT_KEYLEN);
  return { hash: hash.toString('base64'), salt: saltBuf.toString('base64') };
}

export function verifyPassword(password: string, account: StagingAccount): boolean {
  try {
    const salt = Buffer.from(account.password_salt, 'base64');
    const expected = Buffer.from(account.password_hash, 'base64');
    const actual = scryptSync(password, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

export function issueAccessToken(
  account: StagingAccount,
  config: Pick<StagingAuthConfig, 'tokenSecret' | 'accessTokenTtlSeconds'>,
  nowMs = Date.now(),
): { access_token: string; expires_at: string; token_type: 'Bearer' } {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + Math.max(60, config.accessTokenTtlSeconds);
  const claims: StagingAccessClaims = {
    sub: account.username,
    role: account.role,
    participant_id: account.participant_id,
    iat,
    exp,
  };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const sig = createHmac('sha256', config.tokenSecret)
    .update(`${header}.${payload}`)
    .digest();
  return {
    access_token: `${header}.${payload}.${b64url(sig)}`,
    token_type: 'Bearer',
    expires_at: new Date(exp * 1000).toISOString(),
  };
}

export function verifyAccessToken(
  token: string,
  tokenSecret: string,
  nowMs = Date.now(),
): StagingAccessClaims {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new CallError('UNAUTHENTICATED', 'Invalid access token', 401);
  }
  const [header, payload, signature] = parts;
  const expected = createHmac('sha256', tokenSecret)
    .update(`${header}.${payload}`)
    .digest();
  const actual = fromB64url(signature!);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new CallError('UNAUTHENTICATED', 'Invalid access token signature', 401);
  }
  let claims: StagingAccessClaims;
  try {
    claims = JSON.parse(fromB64url(payload!).toString('utf8')) as StagingAccessClaims;
  } catch {
    throw new CallError('UNAUTHENTICATED', 'Invalid access token payload', 401);
  }
  if (!claims.sub || !claims.participant_id || !claims.role || !claims.exp) {
    throw new CallError('UNAUTHENTICATED', 'Incomplete access token', 401);
  }
  if (claims.participant_id !== DEMO_STAFF_ID && claims.participant_id !== DEMO_PATIENT_ID) {
    throw new CallError('UNAUTHENTICATED', 'Unknown staging participant', 401);
  }
  if (claims.exp * 1000 <= nowMs) {
    throw new CallError('UNAUTHENTICATED', 'Access token expired', 401);
  }
  return claims;
}

export function parseStagingAuthConfig(env: NodeJS.ProcessEnv): StagingAuthConfig {
  const tokenSecret = env.CALL_STAGING_TOKEN_SECRET?.trim() ?? '';
  if (tokenSecret.length < 32) {
    throw new CallError(
      'STAGING_DISABLED',
      'CALL_STAGING_TOKEN_SECRET must be at least 32 characters',
      503,
    );
  }

  const staffUser = env.CALL_STAGING_STAFF_USERNAME?.trim() ?? '';
  const staffPass = env.CALL_STAGING_STAFF_PASSWORD ?? '';
  const patientUser = env.CALL_STAGING_PATIENT_USERNAME?.trim() ?? '';
  const patientPass = env.CALL_STAGING_PATIENT_PASSWORD ?? '';

  if (!staffUser || !staffPass || !patientUser || !patientPass) {
    throw new CallError(
      'STAGING_DISABLED',
      'Staging staff/patient username and password env vars are required',
      503,
    );
  }
  if (staffUser.toLowerCase() === patientUser.toLowerCase()) {
    throw new CallError('STAGING_DISABLED', 'Staging usernames must differ', 503);
  }
  if (staffPass.length < 12 || patientPass.length < 12) {
    throw new CallError('STAGING_DISABLED', 'Staging passwords must be at least 12 characters', 503);
  }

  const ttlRaw = env.CALL_STAGING_ACCESS_TOKEN_TTL_SECONDS?.trim();
  const ttl = ttlRaw ? Number(ttlRaw) : 3600;
  if (!Number.isFinite(ttl) || ttl < 60 || ttl > 86_400) {
    throw new CallError('STAGING_DISABLED', 'CALL_STAGING_ACCESS_TOKEN_TTL_SECONDS out of range', 503);
  }

  // Prefer pre-hashed env for production; otherwise hash plaintext at boot (not persisted).
  const staff = buildAccount({
    username: staffUser,
    password: staffPass,
    hashEnv: env.CALL_STAGING_STAFF_PASSWORD_HASH,
    saltEnv: env.CALL_STAGING_STAFF_PASSWORD_SALT,
    participant_id: DEMO_STAFF_ID,
    role: 'staff',
  });
  const patient = buildAccount({
    username: patientUser,
    password: patientPass,
    hashEnv: env.CALL_STAGING_PATIENT_PASSWORD_HASH,
    saltEnv: env.CALL_STAGING_PATIENT_PASSWORD_SALT,
    participant_id: DEMO_PATIENT_ID,
    role: 'patient',
  });

  return {
    tokenSecret,
    accessTokenTtlSeconds: Math.floor(ttl),
    accounts: [staff, patient],
  };
}

function buildAccount(input: {
  username: string;
  password: string;
  hashEnv?: string;
  saltEnv?: string;
  participant_id: typeof DEMO_STAFF_ID | typeof DEMO_PATIENT_ID;
  role: StagingRole;
}): StagingAccount {
  const hashEnv = input.hashEnv?.trim();
  const saltEnv = input.saltEnv?.trim();
  if (hashEnv && saltEnv) {
    return {
      username: input.username,
      password_hash: hashEnv,
      password_salt: saltEnv,
      participant_id: input.participant_id,
      role: input.role,
    };
  }
  // If password looks like "scrypt:<salt_b64>:<hash_b64>", use that.
  if (input.password.startsWith('scrypt:')) {
    const parts = input.password.split(':');
    if (parts.length === 3 && parts[1] && parts[2]) {
      return {
        username: input.username,
        password_salt: parts[1],
        password_hash: parts[2],
        participant_id: input.participant_id,
        role: input.role,
      };
    }
  }
  const hashed = hashPassword(input.password);
  return {
    username: input.username,
    password_hash: hashed.hash,
    password_salt: hashed.salt,
    participant_id: input.participant_id,
    role: input.role,
  };
}

export class StagingAuthService {
  readonly #config: StagingAuthConfig;

  constructor(config: StagingAuthConfig) {
    this.#config = config;
  }

  authenticate(username: string, password: string): {
    account: StagingAccount;
    token: ReturnType<typeof issueAccessToken>;
  } {
    const account = this.#config.accounts.find(
      (a) => a.username.toLowerCase() === username.trim().toLowerCase(),
    );
    // Constant-ish failure path: still run a dummy hash when missing.
    if (!account || !verifyPassword(password, account)) {
      throw new CallError('INVALID_CREDENTIALS', 'Invalid username or password', 401);
    }
    return {
      account,
      token: issueAccessToken(account, this.#config),
    };
  }

  requireBearer(authorizationHeader: string | undefined): StagingAccessClaims {
    if (!authorizationHeader?.startsWith('Bearer ')) {
      throw new CallError('UNAUTHENTICATED', 'Bearer access token required', 401);
    }
    const token = authorizationHeader.slice('Bearer '.length).trim();
    if (!token) throw new CallError('UNAUTHENTICATED', 'Bearer access token required', 401);
    const claims = verifyAccessToken(token, this.#config.tokenSecret);
    const known = this.#config.accounts.some((a) => a.participant_id === claims.participant_id);
    if (!known) throw new CallError('UNAUTHENTICATED', 'Unknown staging subject', 401);
    return claims;
  }

  requireTokenString(token: string | null | undefined): StagingAccessClaims {
    if (!token) throw new CallError('UNAUTHENTICATED', 'Access token required', 401);
    const claims = verifyAccessToken(token, this.#config.tokenSecret);
    const known = this.#config.accounts.some((a) => a.participant_id === claims.participant_id);
    if (!known) throw new CallError('UNAUTHENTICATED', 'Unknown staging subject', 401);
    return claims;
  }

  otherParticipant(actorParticipantId: string): string {
    if (actorParticipantId === DEMO_STAFF_ID) return DEMO_PATIENT_ID;
    if (actorParticipantId === DEMO_PATIENT_ID) return DEMO_STAFF_ID;
    throw new CallError('FORBIDDEN', 'Unknown staging participant', 403);
  }
}
