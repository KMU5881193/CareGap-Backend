/**
 * Phase 3 independent VoIP call prototype domain types.
 * Opaque identifiers only — no PII in room names or participant identities.
 */

export const CALL_STATES = [
  'IDLE',
  'RINGING',
  'ACCEPTED',
  'CONNECTING',
  'ACTIVE',
  'DECLINED',
  'MISSED',
  'ENDED',
  'FAILED',
] as const;

export type CallState = (typeof CALL_STATES)[number];

export const TERMINAL_CALL_STATES: readonly CallState[] = [
  'DECLINED',
  'MISSED',
  'ENDED',
  'FAILED',
];

export type CallParticipantRole = 'caller' | 'callee';

export type CallParticipantRef = {
  /** Synthetic or BE1 user id — opaque to media layer. */
  participant_id: string;
  role: CallParticipantRole;
  /** LiveKit identity — random opaque string, never email/phone/name. */
  media_identity: string;
};

export type CallEndReason =
  | 'ended_by_caller'
  | 'ended_by_callee'
  | 'declined'
  | 'missed_timeout'
  | 'failed'
  | 'media_error'
  | 'cancelled_by_caller';

export type CallSession = {
  call_id: string;
  state: CallState;
  state_version: number;
  room_name: string;
  caller: CallParticipantRef;
  callee: CallParticipantRef;
  created_at: string;
  updated_at: string;
  ringing_expires_at: string;
  accepted_at: string | null;
  connecting_at: string | null;
  active_at: string | null;
  ended_at: string | null;
  end_reason: CallEndReason | null;
  /** Participants who reported media connected (max 2). ACTIVE requires both. */
  media_ready: readonly string[];
  /** Generation bumped on end so previously issued JWTs are treated as stale by our API. */
  token_generation: number;
};

export type CallSessionPublic = {
  call_id: string;
  state: CallState;
  state_version: number;
  room_name: string | null;
  caller_participant_id: string;
  callee_participant_id: string;
  ringing_expires_at: string;
  accepted_at: string | null;
  active_at: string | null;
  ended_at: string | null;
  end_reason: CallEndReason | null;
};

export type JoinTokenResult = {
  call_id: string;
  room_name: string;
  identity: string;
  token: string;
  livekit_url: string;
  expires_at: string;
  token_generation: number;
};

export type CallErrorCode =
  | 'INVALID_TRANSITION'
  | 'CALL_NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHENTICATED'
  | 'CALL_BUSY'
  | 'CALL_EXPIRED'
  | 'ALREADY_HANDLED'
  | 'PARTICIPANT_LIMIT'
  | 'TOKEN_DENIED'
  | 'MEDIA_UNAVAILABLE'
  | 'LIVEKIT_CONFIG_MISSING'
  | 'DEMO_DISABLED'
  | 'STAGING_DISABLED'
  | 'RATE_LIMITED'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_REQUEST';

export class CallError extends Error {
  readonly code: CallErrorCode;
  readonly httpStatus: number;

  constructor(code: CallErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = 'CallError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function toPublicSession(session: CallSession, includeRoom: boolean): CallSessionPublic {
  return {
    call_id: session.call_id,
    state: session.state,
    state_version: session.state_version,
    room_name: includeRoom ? session.room_name : null,
    caller_participant_id: session.caller.participant_id,
    callee_participant_id: session.callee.participant_id,
    ringing_expires_at: session.ringing_expires_at,
    accepted_at: session.accepted_at,
    active_at: session.active_at,
    ended_at: session.ended_at,
    end_reason: session.end_reason,
  };
}
