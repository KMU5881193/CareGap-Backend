export type DemoParticipant = 'demo-staff' | 'demo-patient';

export type CallSessionPublic = {
  call_id: string;
  state: string;
  state_version: number;
  room_name: string | null;
  caller_participant_id: string;
  callee_participant_id: string;
  ringing_expires_at: string;
  accepted_at: string | null;
  active_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
};

export type JoinTokenPayload = {
  call_id: string;
  room_name: string;
  identity: string;
  token: string;
  livekit_url: string;
  expires_at: string;
  token_generation: number;
};

export type SignalEvent = {
  schema_version: 1;
  event_id: string;
  type: string;
  call_id: string;
  state_version: number;
  occurred_at: string;
  data: Record<string, unknown>;
};

const API_BASE = import.meta.env.VITE_CALL_API_BASE ?? 'http://127.0.0.1:4091';
const WS_BASE = import.meta.env.VITE_CALL_WS_BASE ?? 'ws://127.0.0.1:4091';

async function request<T>(
  path: string,
  participant: DemoParticipant,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Demo-Participant': participant,
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = body?.error?.code ?? 'HTTP_ERROR';
    const message = body?.error?.message ?? res.statusText;
    throw new Error(`${code}: ${message}`);
  }
  return body.data as T;
}

export const callApi = {
  health: () => fetch(`${API_BASE}/health`).then((r) => r.json()),
  createCall: (participant: DemoParticipant, calleeId: DemoParticipant) =>
    request<CallSessionPublic>('/api/demo/calls', participant, {
      method: 'POST',
      body: JSON.stringify({ callee_id: calleeId }),
    }),
  getCall: (participant: DemoParticipant, callId: string) =>
    request<CallSessionPublic>(`/api/demo/calls/${callId}`, participant),
  accept: (participant: DemoParticipant, callId: string) =>
    request<CallSessionPublic>(`/api/demo/calls/${callId}/accept`, participant, { method: 'POST' }),
  decline: (participant: DemoParticipant, callId: string) =>
    request<CallSessionPublic>(`/api/demo/calls/${callId}/decline`, participant, { method: 'POST' }),
  end: (participant: DemoParticipant, callId: string) =>
    request<CallSessionPublic>(`/api/demo/calls/${callId}/end`, participant, { method: 'POST' }),
  joinToken: (participant: DemoParticipant, callId: string) =>
    request<JoinTokenPayload>(`/api/demo/calls/${callId}/join-token`, participant, { method: 'POST' }),
  mediaReady: (participant: DemoParticipant, callId: string) =>
    request<CallSessionPublic>(`/api/demo/calls/${callId}/media-ready`, participant, { method: 'POST' }),
};

export function connectSignal(
  participant: DemoParticipant,
  onEvent: (event: SignalEvent) => void,
  onStatus: (status: 'connecting' | 'open' | 'closed' | 'error') => void,
): () => void {
  onStatus('connecting');
  const ws = new WebSocket(`${WS_BASE}/ws?participant=${encodeURIComponent(participant)}`);
  ws.onopen = () => onStatus('open');
  ws.onclose = () => onStatus('closed');
  ws.onerror = () => onStatus('error');
  ws.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(String(msg.data)) as SignalEvent);
    } catch {
      // ignore malformed
    }
  };
  return () => {
    ws.close();
  };
}

export function otherParticipant(me: DemoParticipant): DemoParticipant {
  return me === 'demo-staff' ? 'demo-patient' : 'demo-staff';
}
