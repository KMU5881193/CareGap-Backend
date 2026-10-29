# Phase 3 — Call Prototype Architecture

## Goal

Independent 1:1 voice-call prototype that preserves Wave A (eligibility), Wave B (identity/authz), and Phase 2 (notifications) without requiring BE1 person↔user persistence.

## Layers

| Layer | Responsibility | Location |
|---|---|---|
| `CallSessionService` | Lifecycle orchestration | `src/modules/be2-calls/call-session-service.ts` |
| `CallStateMachine` | Valid transitions only | `src/modules/be2-calls/state-machine.ts` |
| `CallIdentityPort` | Participant resolution | `ports.ts` + synthetic adapter |
| `CallAuthorizationPort` | Who may dial/accept/end/join | `ports.ts` + synthetic / deny-all |
| `CallRepositoryPort` | Session persistence | `InMemoryCallRepository` (prototype) |
| `CallMediaProvider` | LiveKit rooms + tokens | `LiveKitProvider` |
| `CallSignalingPort` | Event fan-out | `LocalCallSignalingAdapter` |

## Runtime surfaces

1. **Domain library** — imported by tests and the isolated demo server.
2. **Demo server** — `examples/call-prototype/server` (separate process, `127.0.0.1` only).
3. **Web harness** — `examples/call-prototype/web` (Vite + LiveKit React Components).

`src/app.ts` does **not** mount demo call routes. Production call APIs remain closed until BE1 relations exist (`DenyAllCallAuthorizationAdapter`).

## Media path

```
demo-staff / demo-patient
        │
        ▼
 CallSessionService (RINGING → ACCEPTED → CONNECTING → ACTIVE)
        │
        ├─ LocalCallSignalingAdapter (WS events)
        └─ LiveKitProvider (join token after accept only)
                │
                ▼
         LiveKit Cloud Room (max 2, microphone only)
```

## Non-goals (this prototype)

- PSTN, FCM VoIP push, CallKit, Android Telecom
- BE1 DB mapping / appointment eligibility HTTP
- Recording, STT, AI analysis
- Mounting call APIs on the production Express app
