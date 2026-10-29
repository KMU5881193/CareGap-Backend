import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
} from 'livekit-server-sdk';
import { CallError } from './types.js';
import type { CallMediaProvider, CreateJoinTokenInput } from './ports.js';

export type LiveKitConfig = {
  url: string;
  apiKey: string;
  apiSecret: string;
};

export function parseLiveKitConfig(env: NodeJS.ProcessEnv): LiveKitConfig | null {
  const url = env.LIVEKIT_URL?.trim();
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) return null;
  if (/YOUR_|PLACEHOLDER/i.test(url) || /YOUR_|PLACEHOLDER/i.test(apiKey) || /YOUR_|PLACEHOLDER/i.test(apiSecret)) {
    return null;
  }
  return { url, apiKey, apiSecret };
}

/**
 * Real LiveKit Cloud media provider.
 * API key/secret stay on the server. Tokens are short-lived and microphone-only.
 */
export class LiveKitProvider implements CallMediaProvider {
  readonly #config: LiveKitConfig;
  readonly #rooms: RoomServiceClient;

  constructor(config: LiveKitConfig) {
    this.#config = config;
    // RoomServiceClient expects https host; convert wss→https.
    const httpHost = config.url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
    this.#rooms = new RoomServiceClient(httpHost, config.apiKey, config.apiSecret);
  }

  isConfigured(): boolean {
    return true;
  }

  async createJoinToken(input: CreateJoinTokenInput): Promise<{ token: string; livekitUrl: string; expiresAt: string }> {
    const ttl = Math.max(30, Math.min(input.ttlSeconds, 600));
    const at = new AccessToken(this.#config.apiKey, this.#config.apiSecret, {
      identity: input.identity,
      ttl,
    });
    at.addGrant({
      roomJoin: true,
      room: input.roomName,
      canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE],
      canSubscribe: true,
      roomAdmin: false,
      roomRecord: false,
      canPublishData: false,
    });
    const token = await at.toJwt();
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    return { token, livekitUrl: this.#config.url, expiresAt };
  }

  async ensureRoom(roomName: string, maxParticipants: number): Promise<void> {
    try {
      await this.#rooms.createRoom({
        name: roomName,
        emptyTimeout: 60 * 10,
        maxParticipants,
      });
    } catch (error) {
      // Room may already exist from a prior ensure — treat as ok when name matches.
      const message = error instanceof Error ? error.message : String(error);
      if (!/already exists|conflict/i.test(message)) {
        throw new CallError('MEDIA_UNAVAILABLE', 'Failed to ensure LiveKit room', 503);
      }
    }
  }

  async deleteRoom(roomName: string): Promise<void> {
    try {
      await this.#rooms.deleteRoom(roomName);
    } catch {
      // Room may already be gone — cleanup is best-effort.
    }
  }

  async removeParticipant(roomName: string, identity: string): Promise<void> {
    try {
      await this.#rooms.removeParticipant(roomName, identity);
    } catch {
      // Participant may already have left.
    }
  }
}

/** Test double — does not contact LiveKit Cloud. */
export class FakeCallMediaProvider implements CallMediaProvider {
  readonly #url: string;
  readonly rooms = new Set<string>();
  readonly removed: Array<{ room: string; identity: string }> = [];
  configured: boolean;
  tokensIssued = 0;

  constructor(opts?: { url?: string; configured?: boolean }) {
    this.#url = opts?.url ?? 'wss://fake.livekit.local';
    this.configured = opts?.configured ?? true;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async createJoinToken(input: CreateJoinTokenInput): Promise<{ token: string; livekitUrl: string; expiresAt: string }> {
    if (!this.configured) {
      throw new CallError('LIVEKIT_CONFIG_MISSING', 'LiveKit is not configured', 503);
    }
    this.tokensIssued += 1;
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
    return {
      token: `fake.${input.roomName}.${input.identity}.${this.tokensIssued}`,
      livekitUrl: this.#url,
      expiresAt,
    };
  }

  async ensureRoom(roomName: string, _maxParticipants: number): Promise<void> {
    this.rooms.add(roomName);
  }

  async deleteRoom(roomName: string): Promise<void> {
    this.rooms.delete(roomName);
  }

  async removeParticipant(roomName: string, identity: string): Promise<void> {
    this.removed.push({ room: roomName, identity });
  }
}
