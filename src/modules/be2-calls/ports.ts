import type {
  CallSession,
  JoinTokenResult,
  CallParticipantRole,
} from './types.js';

/** Resolves opaque participant ids for the call prototype. Replace with BE1 later. */
export interface CallIdentityPort {
  resolveParticipant(participantId: string): Promise<{ participant_id: string; display_role: string } | null>;
}

/**
 * Authorizes call actions between two participants.
 * Production MUST deny when BE1 relationship/eligibility is missing.
 * Synthetic adapter is demo/test only.
 */
export interface CallAuthorizationPort {
  canCreateCall(callerId: string, calleeId: string): Promise<boolean>;
  canAccept(calleeId: string, session: CallSession): Promise<boolean>;
  canDecline(calleeId: string, session: CallSession): Promise<boolean>;
  canEnd(actorId: string, session: CallSession): Promise<boolean>;
  canRequestJoinToken(actorId: string, session: CallSession): Promise<boolean>;
}

export interface CallRepositoryPort {
  save(session: CallSession): Promise<void>;
  getById(callId: string): Promise<CallSession | null>;
  findActiveForParticipant(participantId: string): Promise<CallSession | null>;
  listAll(): Promise<CallSession[]>;
}

export type CreateJoinTokenInput = {
  roomName: string;
  identity: string;
  ttlSeconds: number;
};

export interface CallMediaProvider {
  isConfigured(): boolean;
  createJoinToken(input: CreateJoinTokenInput): Promise<{ token: string; livekitUrl: string; expiresAt: string }>;
  ensureRoom(roomName: string, maxParticipants: number): Promise<void>;
  deleteRoom(roomName: string): Promise<void>;
  removeParticipant(roomName: string, identity: string): Promise<void>;
}

export type CallSignalEventType =
  | 'call.incoming'
  | 'call.ringing'
  | 'call.accepted'
  | 'call.declined'
  | 'call.connecting'
  | 'call.active'
  | 'call.ended'
  | 'call.missed'
  | 'call.failed'
  | 'call.token';

export type CallSignalEvent = {
  schema_version: 1;
  event_id: string;
  type: CallSignalEventType;
  call_id: string;
  state_version: number;
  occurred_at: string;
  data: Record<string, unknown>;
};

export interface CallSignalingPort {
  publish(participantIds: string[], event: CallSignalEvent): Promise<void>;
}

export type CreateCallInput = {
  callerId: string;
  calleeId: string;
  ringingTimeoutMs?: number;
};

export type MediaReadyInput = {
  callId: string;
  participantId: string;
  role: CallParticipantRole;
};
