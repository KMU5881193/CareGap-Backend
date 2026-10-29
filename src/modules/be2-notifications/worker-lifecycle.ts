import type { Clock } from './clock.js';
import type { DeviceRegistrationRepository } from './devices.js';
import type { InAppNotificationStorePort } from './in-app-store.js';
import type { NotificationOutboxRepository } from './outbox.js';
import type { NotificationPreferenceRepository } from './preferences.js';
import type { PushProvider } from './push-provider.js';
import { NotificationWorker, type WorkerOptions } from './worker.js';
import { resolveFirebaseConfig } from './firebase-config.js';

export type WorkerLifecycleConfig = {
  /**
   * Explicit opt-in. Default false — createApp must not start workers.
   * Set only in controlled local/test harnesses.
   */
  enabled: boolean;
  /** Poll interval. Ignored when enabled is false. */
  intervalMs?: number;
  /** Process env used to resolve FCM. Real FCM requires FCM_ENABLED=true. */
  env?: NodeJS.ProcessEnv;
  workerOptions?: WorkerOptions;
};

export type WorkerLifecycleHandle = {
  readonly running: boolean;
  start(): void;
  stop(): Promise<void>;
  /** Single tick for tests — refused when lifecycle is not enabled. */
  tickOnce(): Promise<{ claimed: number; sent: number; retried: number; failed: number }>;
};

/**
 * Notification worker start/stop lifecycle.
 * - Never auto-starts from createApp.
 * - Refuses start when `enabled` is false.
 * - Refuses start when FCM_ENABLED=true but caller did not supply a real PushProvider
 *   (fail-closed; no silent Mock swap).
 * - When FCM_ENABLED=false, only an explicitly injected PushProvider (typically Mock in tests) may run.
 */
export function createNotificationWorkerLifecycle(deps: {
  outbox: NotificationOutboxRepository;
  devices: DeviceRegistrationRepository;
  preferences: NotificationPreferenceRepository;
  store: InAppNotificationStorePort;
  push: PushProvider;
  clock: Clock;
  config: WorkerLifecycleConfig;
}): WorkerLifecycleHandle {
  const intervalMs = deps.config.intervalMs ?? 5_000;
  const worker = new NotificationWorker(
    deps.outbox,
    deps.devices,
    deps.preferences,
    deps.store,
    deps.push,
    deps.clock,
    deps.config.workerOptions,
  );

  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let stopping: Promise<void> | undefined;

  function assertMayRun(): void {
    if (!deps.config.enabled) {
      throw new Error('NOTIFICATION_WORKER_DISABLED: explicit opt-in required');
    }
    const firebase = resolveFirebaseConfig(deps.config.env ?? { FCM_ENABLED: 'false' });
    if (firebase.enabled && deps.push.name === 'mock') {
      throw new Error('FCM_MOCK_FORBIDDEN: real FCM config cannot use MockPushProvider');
    }
  }

  return {
    get running() {
      return running;
    },
    start() {
      assertMayRun();
      if (running) return;
      running = true;
      timer = setInterval(() => {
        void worker.tick().catch(() => {
          /* tick errors must not crash the process; permanent failures are on the job */
        });
      }, intervalMs);
      timer.unref?.();
    },
    async stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        if (timer) clearInterval(timer);
        timer = undefined;
        running = false;
      })();
      await stopping;
      stopping = undefined;
    },
    async tickOnce() {
      assertMayRun();
      return worker.tick();
    },
  };
}
