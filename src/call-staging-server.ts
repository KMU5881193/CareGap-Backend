/**
 * Render / cloud entry for Phase 3 secure call staging.
 * Does not start the local demo harness and does not use src/app.ts routes.
 *
 * Requires:
 *   CALL_STAGING_ENABLED=true
 *   CALL_STAGING_TOKEN_SECRET (>=32 chars)
 *   CALL_STAGING_STAFF_USERNAME / PASSWORD
 *   CALL_STAGING_PATIENT_USERNAME / PASSWORD
 *   LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
 *   PORT (provided by Render)
 */
import 'dotenv/config';
import { createCallStagingApp } from './modules/be2-calls/staging-app.js';
import { CallError } from './modules/be2-calls/types.js';

function requirePort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error('PORT must be set to an integer 1–65535 (Render provides this)');
  }
  const port = Number(raw);
  if (port < 1 || port > 65535) throw new Error('PORT out of range');
  return port;
}

async function main(): Promise<void> {
  const env = process.env;
  if (env.CALL_STAGING_ENABLED !== 'true') {
    console.error('Refusing to start: set CALL_STAGING_ENABLED=true');
    process.exit(1);
  }

  let staging;
  try {
    staging = createCallStagingApp({
      env,
      trustProxy: env.CALL_STAGING_TRUST_PROXY !== 'false',
    });
  } catch (error) {
    const message = error instanceof CallError ? `${error.code}: ${error.message}` : String(error);
    console.error('Staging configuration invalid:', message);
    process.exit(1);
  }

  const port = requirePort(env);
  const host = env.CALL_STAGING_BIND_HOST?.trim() || '0.0.0.0';

  await new Promise<void>((resolve, reject) => {
    staging.httpServer.listen(port, host, () => resolve());
    staging.httpServer.once('error', reject);
  });

  console.log(`CareGap call staging listening on http://${host}:${port}`);
  console.log('Auth: Bearer access tokens via POST /api/staging/auth/login');
  console.log('LiveKit: configured');
  console.log('Note: public clients must use HTTPS/WSS (TLS terminated by the platform)');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Shutting down (${signal})…`);
    try {
      await staging.close();
      process.exit(0);
    } catch (error) {
      console.error('Shutdown error', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
