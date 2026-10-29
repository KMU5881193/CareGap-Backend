/**
 * Secure external staging HTTP + WebSocket surface for Phase 3 calls.
 * Independent of examples/call-prototype local demo and of src/app.ts.
 * Requires CALL_STAGING_ENABLED=true and validated credentials/secrets.
 */
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  CallSessionService,
} from './call-session-service.js';
import { InMemoryCallRepository } from './in-memory-repository.js';
import { LiveKitProvider, parseLiveKitConfig } from './livekit-provider.js';
import { LocalCallSignalingAdapter } from './local-signaling.js';
import type { CallMediaProvider, CallSignalEvent } from './ports.js';
import {
  StagingAuthService,
  parseStagingAuthConfig,
  type StagingAccessClaims,
} from './staging-auth.js';
import { FixedWindowRateLimiter } from './staging-rate-limit.js';
import {
  DEMO_PATIENT_ID,
  DEMO_STAFF_ID,
  SyntheticCallAuthorizationAdapter,
  SyntheticCallIdentityAdapter,
} from './synthetic-adapters.js';
import { CallError } from './types.js';

export type StagingAppOptions = {
  env?: NodeJS.ProcessEnv;
  media?: CallMediaProvider;
  auth?: StagingAuthService;
  ringingTimeoutMs?: number;
  /** Override bind host checks only — listen is done by the entrypoint. */
  trustProxy?: boolean;
};

export type StagingApp = {
  app: express.Express;
  httpServer: ReturnType<typeof createServer>;
  service: CallSessionService;
  signaling: LocalCallSignalingAdapter;
  media: CallMediaProvider;
  auth: StagingAuthService;
  close: () => Promise<void>;
};

function assertStagingEnabled(env: NodeJS.ProcessEnv): void {
  if (env.CALL_STAGING_ENABLED !== 'true') {
    throw new CallError('STAGING_DISABLED', 'CALL_STAGING_ENABLED=true is required', 403);
  }
}

function parseAllowedOrigins(env: NodeJS.ProcessEnv): readonly string[] | null {
  const raw = env.CALL_STAGING_ALLOWED_ORIGINS?.trim();
  if (!raw) return null; // null = allow non-browser / no Origin (Flutter) + any Origin when unset is too open
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function originAllowed(origin: string | undefined, allowed: readonly string[] | null): boolean {
  if (!origin) return true; // Flutter / native often omit Origin
  if (allowed === null) {
    // Fail closed for browser Origins when allow-list unset: reject unknown browsers,
    // but health probes without Origin still work.
    return false;
  }
  return allowed.includes(origin);
}

function clientKey(req: express.Request): string {
  const xf = req.get('x-forwarded-for');
  if (xf) return xf.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

function sendError(res: express.Response, error: unknown): void {
  if (error instanceof CallError) {
    res.status(error.httpStatus).json({ error: { code: error.code, message: error.message } });
    return;
  }
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal error' } });
}

export function createStagingMediaProvider(env: NodeJS.ProcessEnv): CallMediaProvider {
  const config = parseLiveKitConfig(env);
  if (!config) {
    throw new CallError('LIVEKIT_CONFIG_MISSING', 'LIVEKIT_URL/API_KEY/API_SECRET required for staging', 503);
  }
  return new LiveKitProvider(config);
}

/**
 * Staging app factory. LiveKit must be configured for non-test use.
 * Tests may inject FakeCallMediaProvider + StagingAuthService.
 */
export function createCallStagingApp(options: StagingAppOptions = {}): StagingApp {
  const env = options.env ?? process.env;
  assertStagingEnabled(env);

  const auth = options.auth ?? new StagingAuthService(parseStagingAuthConfig(env));
  const media = options.media ?? createStagingMediaProvider(env);
  const signaling = new LocalCallSignalingAdapter();
  const repo = new InMemoryCallRepository();
  const service = new CallSessionService({
    identity: new SyntheticCallIdentityAdapter(),
    authz: new SyntheticCallAuthorizationAdapter(),
    repo,
    media,
    signaling,
    ringingTimeoutMs: options.ringingTimeoutMs,
  });

  const allowedOrigins = parseAllowedOrigins(env);
  const loginLimiter = new FixedWindowRateLimiter({ windowMs: 60_000, max: 20 });
  const apiLimiter = new FixedWindowRateLimiter({ windowMs: 60_000, max: 120 });

  const app = express();
  app.disable('x-powered-by');
  if (options.trustProxy ?? env.CALL_STAGING_TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }
  app.use(express.json({ limit: '64kb' }));

  app.use((req, res, next) => {
    const origin = req.get('Origin');
    if (!originAllowed(origin, allowedOrigins)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Origin not allowed' } });
    }
    if (origin && allowedOrigins) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  });

  // Reject legacy demo header on staging — never accept X-Demo-Participant as auth.
  app.use((req, _res, next) => {
    if (req.get('X-Demo-Participant')) {
      return next(new CallError('FORBIDDEN', 'X-Demo-Participant is not accepted on staging', 403));
    }
    return next();
  });

  app.get('/health', (_req, res) => {
    res.json({
      data: {
        status: 'ok',
        surface: 'call-staging',
        livekit_configured: media.isConfigured(),
        auth: 'bearer_access_token',
        participants: [DEMO_STAFF_ID, DEMO_PATIENT_ID],
      },
    });
  });

  app.post('/api/staging/auth/login', (req, res) => {
    try {
      if (!loginLimiter.allow(`login:${clientKey(req)}`)) {
        throw new CallError('RATE_LIMITED', 'Too many login attempts', 429);
      }
      const username = typeof req.body?.username === 'string' ? req.body.username : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!username || !password) {
        throw new CallError('INVALID_REQUEST', 'username and password required', 400);
      }
      const { account, token } = auth.authenticate(username, password);
      res.json({
        data: {
          ...token,
          participant_id: account.participant_id,
          role: account.role,
          username: account.username,
        },
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  function requireActor(req: express.Request): StagingAccessClaims {
    if (!apiLimiter.allow(`api:${clientKey(req)}`)) {
      throw new CallError('RATE_LIMITED', 'Too many requests', 429);
    }
    return auth.requireBearer(req.get('authorization') ?? undefined);
  }

  app.post('/api/staging/calls', async (req, res) => {
    try {
      const actor = requireActor(req);
      // Ignore client-supplied callee/room/participant overrides — only the other approved account.
      const calleeId = auth.otherParticipant(actor.participant_id);
      const session = await service.createCall({
        callerId: actor.participant_id,
        calleeId,
      });
      res.status(201).json({ data: service.toPublic(session) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/staging/calls/:callId', async (req, res) => {
    try {
      const actor = requireActor(req);
      const session = await service.getSession(req.params.callId, actor.participant_id);
      res.json({ data: service.toPublic(session) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/staging/calls/:callId/accept', async (req, res) => {
    try {
      const actor = requireActor(req);
      const session = await service.accept(req.params.callId, actor.participant_id);
      res.json({ data: service.toPublic(session) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/staging/calls/:callId/decline', async (req, res) => {
    try {
      const actor = requireActor(req);
      const session = await service.decline(req.params.callId, actor.participant_id);
      res.json({ data: service.toPublic(session) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/staging/calls/:callId/end', async (req, res) => {
    try {
      const actor = requireActor(req);
      const session = await service.end(req.params.callId, actor.participant_id);
      res.json({ data: service.toPublic(session) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/staging/calls/:callId/join-token', async (req, res) => {
    try {
      const actor = requireActor(req);
      // Token identity/room come from CallSessionService — never from client body.
      if (req.body && (req.body.room_name || req.body.identity || req.body.participant_id)) {
        throw new CallError('FORBIDDEN', 'Client may not specify room or identity', 403);
      }
      const token = await service.issueJoinToken(req.params.callId, actor.participant_id);
      res.json({ data: token });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/staging/calls/:callId/media-ready', async (req, res) => {
    try {
      const actor = requireActor(req);
      const session = await service.reportMediaReady(req.params.callId, actor.participant_id);
      res.json({ data: service.toPublic(session) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    sendError(res, error);
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (socket, req) => {
    try {
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
      if (!originAllowed(origin, allowedOrigins)) {
        socket.close(1008, 'origin denied');
        return;
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      // Reject participant query — identity must come from access token only.
      if (url.searchParams.has('participant')) {
        socket.close(1008, 'participant query forbidden');
        return;
      }
      const token =
        url.searchParams.get('access_token')
        ?? bearerFromProtocols(req.headers['sec-websocket-protocol']);
      const claims = auth.requireTokenString(token);
      const participant = claims.participant_id;
      const unsub = signaling.subscribe(participant, (event: CallSignalEvent) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
      });
      socket.on('close', () => unsub());
    } catch {
      socket.close(1008, 'unauthorized');
    }
  });

  return {
    app,
    httpServer,
    service,
    signaling,
    media,
    auth,
    close: async () => {
      service.dispose();
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

function bearerFromProtocols(header: string | string[] | undefined): string | null {
  if (!header) return null;
  const raw = Array.isArray(header) ? header.join(',') : header;
  // Clients may send: Sec-WebSocket-Protocol: bearer, <token>
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const bearerIdx = parts.findIndex((p) => p.toLowerCase() === 'bearer');
  if (bearerIdx >= 0 && parts[bearerIdx + 1]) return parts[bearerIdx + 1]!;
  return null;
}
