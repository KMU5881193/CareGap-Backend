import type { CallSignalEvent, CallSignalingPort } from './ports.js';

export type SignalSubscriber = (event: CallSignalEvent) => void;

/**
 * In-process signaling fan-out for the local demo harness / unit tests.
 * Not a production WebSocket gateway.
 */
export class LocalCallSignalingAdapter implements CallSignalingPort {
  readonly #subs = new Map<string, Set<SignalSubscriber>>();
  readonly history: CallSignalEvent[] = [];

  subscribe(participantId: string, handler: SignalSubscriber): () => void {
    let set = this.#subs.get(participantId);
    if (!set) {
      set = new Set();
      this.#subs.set(participantId, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
      if (set!.size === 0) this.#subs.delete(participantId);
    };
  }

  async publish(participantIds: string[], event: CallSignalEvent): Promise<void> {
    this.history.push(event);
    const unique = [...new Set(participantIds)];
    for (const id of unique) {
      const set = this.#subs.get(id);
      if (!set) continue;
      for (const handler of set) {
        try {
          handler(event);
        } catch {
          // Subscriber errors must not break call control.
        }
      }
    }
  }
}
