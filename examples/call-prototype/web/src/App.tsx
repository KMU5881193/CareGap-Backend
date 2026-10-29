import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useRoomContext,
} from '@livekit/components-react';
import {
  callApi,
  connectSignal,
  otherParticipant,
  type CallSessionPublic,
  type DemoParticipant,
  type JoinTokenPayload,
  type SignalEvent,
} from './api';

type MicPermission = 'unknown' | 'granted' | 'denied' | 'prompt';

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function MuteControls() {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="secondary"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void localParticipant
          .setMicrophoneEnabled(!isMicrophoneEnabled)
          .finally(() => setBusy(false));
      }}
    >
      {isMicrophoneEnabled ? '음소거' : '음소거 해제'}
    </button>
  );
}

function MediaReadyReporter({
  onReady,
}: {
  onReady: () => void;
}) {
  const room = useRoomContext();
  const reported = useRef(false);

  useEffect(() => {
    const maybeReport = () => {
      if (reported.current) return;
      if (room.state === 'connected') {
        reported.current = true;
        onReady();
      }
    };
    maybeReport();
    room.on('connected', maybeReport);
    return () => {
      room.off('connected', maybeReport);
    };
  }, [room, onReady]);

  return null;
}

export default function App() {
  const [role, setRole] = useState<DemoParticipant>('demo-staff');
  const [signalStatus, setSignalStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('closed');
  const [session, setSession] = useState<CallSessionPublic | null>(null);
  const [incoming, setIncoming] = useState<CallSessionPublic | null>(null);
  const [token, setToken] = useState<JoinTokenPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [micPermission, setMicPermission] = useState<MicPermission>('unknown');
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [livekitConfigured, setLivekitConfigured] = useState<boolean | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const activeStartedAt = useRef<number | null>(null);

  const peer = useMemo(() => otherParticipant(role), [role]);

  useEffect(() => {
    void callApi.health().then((body) => {
      setLivekitConfigured(Boolean(body?.data?.livekit_configured));
    }).catch(() => setLivekitConfigured(null));
  }, []);

  useEffect(() => {
    if (!navigator.permissions?.query) return;
    void navigator.permissions.query({ name: 'microphone' as PermissionName }).then((status) => {
      setMicPermission(status.state as MicPermission);
      status.onchange = () => setMicPermission(status.state as MicPermission);
    }).catch(() => setMicPermission('unknown'));
  }, []);

  useEffect(() => {
    setSession(null);
    setIncoming(null);
    setToken(null);
    setError(null);
    const disconnect = connectSignal(
      role,
      (event: SignalEvent) => {
        if (event.type === 'call.incoming') {
          void callApi.getCall(role, event.call_id).then((s) => {
            setIncoming(s);
            setSession(s);
          }).catch((err: Error) => setError(err.message));
        }
        if (
          event.type === 'call.ringing'
          || event.type === 'call.accepted'
          || event.type === 'call.connecting'
          || event.type === 'call.active'
          || event.type === 'call.declined'
          || event.type === 'call.ended'
          || event.type === 'call.missed'
          || event.type === 'call.failed'
        ) {
          void callApi.getCall(role, event.call_id).then((s) => {
            setSession(s);
            if (s.state !== 'RINGING') setIncoming(null);
            if (s.state === 'CONNECTING' || s.state === 'ACTIVE') {
              void ensureToken(role, s.call_id);
            }
            if (['DECLINED', 'ENDED', 'MISSED', 'FAILED'].includes(s.state)) {
              setToken(null);
            }
          }).catch((err: Error) => setError(err.message));
        }
      },
      setSignalStatus,
    );
    return disconnect;
    // ensureToken is stable enough via role; intentional
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  useEffect(() => {
    if (session?.state === 'ACTIVE' && session.active_at) {
      activeStartedAt.current = Date.parse(session.active_at);
    } else if (session?.state !== 'ACTIVE') {
      activeStartedAt.current = null;
      setElapsedMs(0);
    }
  }, [session?.state, session?.active_at]);

  useEffect(() => {
    if (session?.state !== 'ACTIVE') return;
    const id = window.setInterval(() => {
      if (activeStartedAt.current) {
        setElapsedMs(Date.now() - activeStartedAt.current);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [session?.state]);

  const ensureToken = useCallback(async (participant: DemoParticipant, callId: string) => {
    const issued = await callApi.joinToken(participant, callId);
    setToken(issued);
    return issued;
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onMediaReady = useCallback(() => {
    if (!session) return;
    void callApi.mediaReady(role, session.call_id).then(setSession).catch((err: Error) => setError(err.message));
  }, [role, session]);

  const inMedia =
    token
    && session
    && (session.state === 'CONNECTING' || session.state === 'ACTIVE');

  return (
    <div className="app">
      <header>
        <h1>CareGap Call Prototype</h1>
        <p>독립 1:1 음성 통화 시연 · LiveKit Cloud · 합성 참가자만 사용</p>
      </header>

      <section className="panel">
        <div className="row">
          <label>
            테스트 역할
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as DemoParticipant)}
              disabled={busy || Boolean(session && !['DECLINED', 'ENDED', 'MISSED', 'FAILED'].includes(session.state))}
            >
              <option value="demo-staff">demo-staff (상담사)</option>
              <option value="demo-patient">demo-patient (대상자)</option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy || signalStatus !== 'open'}
            onClick={() => run(async () => {
              setAudioUnlocked(true);
              const created = await callApi.createCall(role, peer);
              setSession(created);
              setIncoming(null);
            })}
          >
            전화 걸기 → {peer}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setAudioUnlocked(true)}
          >
            오디오 잠금 해제
          </button>
        </div>

        <div className="status-grid">
          <div className="stat"><span>시그널링</span><strong>{signalStatus}</strong></div>
          <div className="stat"><span>통화 상태</span><strong>{session?.state ?? 'IDLE'}</strong></div>
          <div className="stat"><span>마이크 권한</span><strong>{micPermission}</strong></div>
          <div className="stat"><span>LiveKit</span><strong>{livekitConfigured == null ? '확인 중' : livekitConfigured ? '서버 설정됨' : '미설정'}</strong></div>
          <div className="stat"><span>통화 시간</span><strong className="timer">{formatElapsed(elapsedMs)}</strong></div>
          <div className="stat"><span>오디오 잠금</span><strong>{audioUnlocked ? '해제됨' : '브라우저 제한 가능'}</strong></div>
        </div>

        {incoming && incoming.state === 'RINGING' && incoming.callee_participant_id === role && (
          <div className="incoming">
            <strong>수신 요청</strong>
            <p className="hint" style={{ marginTop: 4 }}>
              from {incoming.caller_participant_id} · 만료 {incoming.ringing_expires_at}
            </p>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(async () => {
                  setAudioUnlocked(true);
                  const accepted = await callApi.accept(role, incoming.call_id);
                  setSession(accepted);
                  setIncoming(null);
                  await ensureToken(role, accepted.call_id);
                })}
              >
                수락
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => run(async () => {
                  const declined = await callApi.decline(role, incoming.call_id);
                  setSession(declined);
                  setIncoming(null);
                  setToken(null);
                })}
              >
                거절
              </button>
            </div>
          </div>
        )}

        <div className="row" style={{ marginTop: '0.85rem' }}>
          {session && !['DECLINED', 'ENDED', 'MISSED', 'FAILED'].includes(session.state) && (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => run(async () => {
                const ended = await callApi.end(role, session.call_id);
                setSession(ended);
                setIncoming(null);
                setToken(null);
              })}
            >
              통화 종료
            </button>
          )}
        </div>

        {error && <div className="error">{error}</div>}

        <div className="room-wrap">
          {inMedia && token && (
            <LiveKitRoom
              token={token.token}
              serverUrl={token.livekit_url}
              connect={audioUnlocked}
              audio={true}
              video={false}
              onError={(err) => setError(err.message)}
              onConnected={() => {
                setAudioUnlocked(true);
              }}
            >
              <RoomAudioRenderer />
              <MediaReadyReporter onReady={onMediaReady} />
              <div className="row" style={{ marginTop: '0.5rem' }}>
                <MuteControls />
              </div>
            </LiveKitRoom>
          )}
        </div>

        <p className="hint">
          Chrome 창 두 개를 열고 서로 다른 역할을 선택한 뒤, 상담사가 전화를 걸고 대상자가 수락하세요.
          브라우저 autoplay 제한이 있으면 「오디오 잠금 해제」를 누른 후 수락하세요.
          이 화면은 운영 CareGap FE와 결합되지 않습니다.
        </p>
      </section>
    </div>
  );
}
