/**
 * Isolated Phase 3 call prototype HTTP + WebSocket harness.
 * Must NOT be imported or mounted from src/app.ts.
 * Refuses to start when NODE_ENV=production.
 */
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  CallError,
  CallSessionService,
  DEMO_PARTICIPANTS,
  DEMO_PATIENT_ID,
  DEMO_STAFF_ID,
  FakeCallMediaProvider,
  InMemoryCallRepository,
  LiveKitProvider,
  LocalCallSignalingAdapter,
  SyntheticCallAuthorizationAdapter,
  SyntheticCallIdentityAdapter,
  parseLiveKitConfig,
  type CallMediaProvider,
  type CallSignalEvent,
} from '../../../src/modules/be2-calls/index.js';

export const DEMO_ALLOWED_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
] as const;

export type DemoAppOptions = {
  env?: NodeJS.ProcessEnv;
  media?: CallMediaProvider;
  ringingTimeoutMs?: number;
};

export type DemoApp = {
  app: express.Express;
  httpServer: ReturnType<typeof createServer>;
  service: CallSessionService;
  signaling: LocalCallSignalingAdapter;
  media: CallMediaProvider;
  close: () => Promise<void>;
};

function assertDemoEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production') {
    throw new CallError('DEMO_DISABLED', 'Call prototype demo server is forbidden in production', 403);
  }
  if (env.CALL_PROTOTYPE_ENABLED === 'false') {
    throw new CallError('DEMO_DISABLED', 'CALL_PROTOTYPE_ENABLED=false', 403);
  }
}

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin / non-browser tools
  return (DEMO_ALLOWED_ORIGINS as readonly string[]).includes(origin);
}

function participantHeader(req: express.Request): string | null {
  const raw = req.get('X-Demo-Participant')?.trim();
  if (!raw) return null;
  if (!(DEMO_PARTICIPANTS as readonly string[]).includes(raw)) return null;
  return raw;
}

function sendError(res: express.Response, error: unknown): void {
  if (error instanceof CallError) {
    res.status(error.httpStatus).json({ error: { code: error.code, message: error.message } });
    return;
  }
  const message = error instanceof Error ? error.message : 'Internal error';
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
}

export function createDemoMediaProvider(env: NodeJS.ProcessEnv): CallMediaProvider {
  const config = parseLiveKitConfig(env);
  if (config) return new LiveKitProvider(config);
  return new FakeCallMediaProvider({ configured: false });
}

export function createCallPrototypeDemoApp(options: DemoAppOptions = {}): DemoApp {
  const env = options.env ?? process.env;
  assertDemoEnvironment(env);

  const media = options.media ?? createDemoMediaProvider(env);
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

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.use((req, res, next) => {
    const origin = req.get('Origin');
    if (!originAllowed(origin)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Origin not allowed' } });
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Demo-Participant');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  });

  app.get('/health', (_req, res) => {
    res.json({
      data: {
        status: 'ok',
        prototype: 'call-phase3',
        livekit_configured: media.isConfigured(),
        participants: [DEMO_STAFF_ID, DEMO_PATIENT_ID],
      },
    });
  });

  app.get('/api/demo/participants', (_req, res) => {
    res.json({
      data: {
        participants: [
          { id: DEMO_STAFF_ID, role: 'staff' },
          { id: DEMO_PATIENT_ID, role: 'patient' },
        ],
      },
    });
  });

  app.post('/api/demo/calls', async (req, res) => {
    try {
      const actor = participantHeader(req);
      if (!actor) {
        throw new CallError('UNAUTHENTICATED', 'X-Demo-Participant required (demo-staff|demo-patient)', 401);
      }
      const calleeId = typeof req.body?.callee_id === 'string' ? req.body.callee_id : '';
      if (!calleeId) throw new CallError('INVALID_REQUEST', 'callee_id required', 400);
      const session = await service.createCall({ callerId: actor, calleeId });
      res.status(201).json({ data: service.toPublic(session) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/demo/calls/:callId', async (req, res) => {
    try {
      const actor = participantHeader(req);
      if (!actor) throw new CallError('UNAUTHENTICATED', 'X-Demo-Participant required', 401);
      const session = await service.getSession(req.params.callId, actor);
      res.json({ data: service.toPublic(session) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/demo/calls/:callId/accept', async (req, res) => {
    try {
      const actor = participantHeader(req);
      if (!actor) throw new CallError('UNAUTHENTICATED', 'X-Demo-Participant required', 401);
      const session = await service.accept(req.params.callId, actor);
      res.json({ data: service.toPublic(session) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/demo/calls/:callId/decline', async (req, res) => {
    try {
      const actor = participantHeader(req);
      if (!actor) throw new CallError('UNAUTHENTICATED', 'X-Demo-Participant required', 401);
      const session = await service.decline(req.params.callId, actor);
      res.json({ data: service.toPublic(session) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/demo/calls/:callId/end', async (req, res) => {
    try {
      const actor = participantHeader(req);
      if (!actor) throw new CallError('UNAUTHENTICATED', 'X-Demo-Participant required', 401);
      const session = await service.end(req.params.callId, actor);
      res.json({ data: service.toPublic(session) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/demo/calls/:callId/join-token', async (req, res) => {
    try {
      const actor = participantHeader(req);
      if (!actor) throw new CallError('UNAUTHENTICATED', 'X-Demo-Participant required', 401);
      const token = await service.issueJoinToken(req.params.callId, actor);
      res.json({ data: token });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/demo/calls/:callId/media-ready', async (req, res) => {
    try {
      const actor = participantHeader(req);
      if (!actor) throw new CallError('UNAUTHENTICATED', 'X-Demo-Participant required', 401);
      const session = await service.reportMediaReady(req.params.callId, actor);
      res.json({ data: service.toPublic(session) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const sockets = new Map<WebSocket, string>();

  wss.on('connection', (socket, req) => {
    const origin = req.headers.origin;
    if (!originAllowed(typeof origin === 'string' ? origin : undefined)) {
      socket.close(1008, 'origin denied');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const participant = url.searchParams.get('participant') ?? '';
    if (!(DEMO_PARTICIPANTS as readonly string[]).includes(participant)) {
      socket.close(1008, 'participant denied');
      return;
    }
    sockets.set(socket, participant);
    const unsub = signaling.subscribe(participant, (event: CallSignalEvent) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    });
    socket.on('close', () => {
      unsub();
      sockets.delete(socket);
    });
  });

  return {
    app,
    httpServer,
    service,
    signaling,
    media,
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
