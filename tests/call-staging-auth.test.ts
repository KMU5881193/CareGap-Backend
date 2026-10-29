import { describe, expect, it } from 'vitest';
import {
  CallError,
  StagingAuthService,
  hashPassword,
  issueAccessToken,
  parseStagingAuthConfig,
  verifyAccessToken,
  verifyPassword,
} from '../src/modules/be2-calls/index.js';
import { DEMO_STAFF_ID } from '../src/modules/be2-calls/synthetic-adapters.js';

const secret = 'staging-token-secret-at-least-32-chars!!';

function testEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    CALL_STAGING_TOKEN_SECRET: secret,
    CALL_STAGING_STAFF_USERNAME: 'staff.tester',
    CALL_STAGING_STAFF_PASSWORD: 'staff-password-12',
    CALL_STAGING_PATIENT_USERNAME: 'patient.tester',
    CALL_STAGING_PATIENT_PASSWORD: 'patient-password-12',
    ...overrides,
  };
}

describe('staging auth', () => {
  it('hashes and verifies passwords with timing-safe compare', () => {
    const hashed = hashPassword('staff-password-12');
    expect(verifyPassword('staff-password-12', {
      username: 'x',
      password_hash: hashed.hash,
      password_salt: hashed.salt,
      participant_id: DEMO_STAFF_ID,
      role: 'staff',
    })).toBe(true);
    expect(verifyPassword('wrong-password!!', {
      username: 'x',
      password_hash: hashed.hash,
      password_salt: hashed.salt,
      participant_id: DEMO_STAFF_ID,
      role: 'staff',
    })).toBe(false);
  });

  it('issues and verifies short-lived access tokens', () => {
    const config = parseStagingAuthConfig(testEnv());
    const auth = new StagingAuthService(config);
    const { account, token } = auth.authenticate('staff.tester', 'staff-password-12');
    expect(account.participant_id).toBe(DEMO_STAFF_ID);
    const claims = verifyAccessToken(token.access_token, secret);
    expect(claims.participant_id).toBe(DEMO_STAFF_ID);
    expect(claims.role).toBe('staff');
  });

  it('rejects expired tokens', () => {
    const config = parseStagingAuthConfig(testEnv());
    const account = config.accounts[0]!;
    const token = issueAccessToken(account, { tokenSecret: secret, accessTokenTtlSeconds: 60 }, Date.now() - 120_000);
    expect(() => verifyAccessToken(token.access_token, secret)).toThrow(CallError);
  });

  it('rejects invalid credentials', () => {
    const auth = new StagingAuthService(parseStagingAuthConfig(testEnv()));
    expect(() => auth.authenticate('staff.tester', 'nope-nope-nope1')).toThrow(CallError);
  });

  it('fails closed when staging secrets are incomplete', () => {
    expect(() => parseStagingAuthConfig({ CALL_STAGING_TOKEN_SECRET: 'short' })).toThrow(CallError);
  });
});
