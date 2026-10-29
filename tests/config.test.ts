import { describe, it, expect } from 'vitest';
import { parseConfig, parseServerConfig } from '../src/config.js';

describe('explicit server port', () => {
  it.each([undefined, '', ' ', '0', '-1', '65536', '1.5', '1e3', 'abc'])('rejects invalid PORT %s with an actionable error', (PORT) => {
    expect(() => parseServerConfig({ PORT })).toThrow(/PORT.*1~65535/);
  });
  it('uses the caller-selected port without a fallback', () => {
    expect(parseServerConfig({ PORT: '49152' }).PORT).toBe(49152);
  });
  it('does not require a listener port for in-process app tests', () => {
    expect(parseConfig({ NODE_ENV: 'test' })).not.toHaveProperty('PORT');
  });
  it('keeps the production authentication guard at server startup', () => {
    expect(() => parseServerConfig({ PORT: '49152', NODE_ENV: 'production', DEV_AUTH_ENABLED: 'true' })).toThrow(/forbidden in production/);
  });
});
