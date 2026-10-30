import { describe, expect, it } from 'vitest';
import {
  FakeCallMediaProvider,
  parseLiveKitConfig,
} from '../src/modules/be2-calls/livekit-provider.js';

describe('LiveKit provider config', () => {
  it('returns null when LiveKit env is missing', () => {
    expect(parseLiveKitConfig({})).toBeNull();
    expect(parseLiveKitConfig({
      LIVEKIT_URL: 'wss://YOUR-PROJECT.livekit.cloud',
      LIVEKIT_API_KEY: 'YOUR_API_KEY',
      LIVEKIT_API_SECRET: 'YOUR_API_SECRET',
    })).toBeNull();
  });

  it('parses non-placeholder credentials', () => {
    const config = parseLiveKitConfig({
      LIVEKIT_URL: 'wss://example.livekit.cloud',
      LIVEKIT_API_KEY: 'APIabc',
      LIVEKIT_API_SECRET: 'secret-value',
    });
    expect(config).toEqual({
      url: 'wss://example.livekit.cloud',
      apiKey: 'APIabc',
      apiSecret: 'secret-value',
    });
  });

  it('fake provider tracks room lifecycle without network', async () => {
    const media = new FakeCallMediaProvider();
    await media.ensureRoom('cg_test', 2);
    expect(media.rooms.has('cg_test')).toBe(true);
    const token = await media.createJoinToken({
      roomName: 'cg_test',
      identity: 'caller_x',
      ttlSeconds: 60,
    });
    expect(token.token).toContain('cg_test');
    await media.deleteRoom('cg_test');
    expect(media.rooms.has('cg_test')).toBe(false);
  });
});
