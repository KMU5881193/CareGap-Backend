/**
 * Entry: pnpm call:demo:server
 * Binds 127.0.0.1 only. Forbidden when NODE_ENV=production.
 */
import 'dotenv/config';
import { createCallPrototypeDemoApp } from './demo-app.js';

const env = process.env;
if (env.NODE_ENV === 'production') {
  console.error('Call prototype demo server refuses to start in production');
  process.exit(1);
}

const host = '127.0.0.1';
const port = Number(env.CALL_PROTOTYPE_PORT ?? '4091');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('CALL_PROTOTYPE_PORT must be an integer 1–65535');
  process.exit(1);
}

const demo = createCallPrototypeDemoApp({ env });
demo.httpServer.listen(port, host, () => {
  const livekit = demo.media.isConfigured() ? 'configured' : 'MISSING (mock-only tokens blocked)';
  console.log(`CareGap call prototype listening on http://${host}:${port}`);
  console.log(`LiveKit: ${livekit}`);
  console.log('Participants: demo-staff | demo-patient');
});

const shutdown = async () => {
  await demo.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
