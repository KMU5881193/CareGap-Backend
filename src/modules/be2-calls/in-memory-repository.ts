import type { CallRepositoryPort } from './ports.js';
import { isTerminalCallState } from './state-machine.js';
import type { CallSession } from './types.js';

/** Process-local call store for the prototype / tests. Not a production persistence model. */
export class InMemoryCallRepository implements CallRepositoryPort {
  readonly #sessions = new Map<string, CallSession>();

  async save(session: CallSession): Promise<void> {
    this.#sessions.set(session.call_id, structuredClone(session));
  }

  async getById(callId: string): Promise<CallSession | null> {
    const row = this.#sessions.get(callId);
    return row ? structuredClone(row) : null;
  }

  async findActiveForParticipant(participantId: string): Promise<CallSession | null> {
    for (const session of this.#sessions.values()) {
      if (isTerminalCallState(session.state)) continue;
      if (
        session.caller.participant_id === participantId
        || session.callee.participant_id === participantId
      ) {
        return structuredClone(session);
      }
    }
    return null;
  }

  async listAll(): Promise<CallSession[]> {
    return [...this.#sessions.values()].map((s) => structuredClone(s));
  }

  clear(): void {
    this.#sessions.clear();
  }
}
