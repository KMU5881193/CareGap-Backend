# Call State Machine

## States

| State | Meaning |
|---|---|
| `IDLE` | No session (UI only / pre-create) |
| `RINGING` | Callee invited; awaiting accept/decline/timeout |
| `ACCEPTED` | Callee accepted (brief; service advances to CONNECTING) |
| `CONNECTING` | Join tokens allowed; waiting for both media-ready |
| `ACTIVE` | Both participants reported media connection |
| `DECLINED` | Callee declined (terminal) |
| `MISSED` | Ringing timeout (terminal) |
| `ENDED` | Normal hang-up / cancel (terminal) |
| `FAILED` | Hard failure (terminal) |

## Allowed transitions

```
IDLE       → RINGING, FAILED
RINGING    → ACCEPTED, DECLINED, MISSED, ENDED, FAILED
ACCEPTED   → CONNECTING, ENDED, FAILED
CONNECTING → ACTIVE, ENDED, FAILED
ACTIVE     → ENDED, FAILED
DECLINED / MISSED / ENDED / FAILED → (none)
```

## Rules

1. Invalid transitions throw `INVALID_TRANSITION` (HTTP 409).
2. `ACTIVE` requires both caller and callee `media-ready` reports while `CONNECTING`.
3. Duplicate accept/end for the same actor is idempotent where safe.
4. Join tokens are denied in `RINGING` and all terminal states.
5. On terminal transition the service removes participants and deletes the LiveKit room, then bumps `token_generation` so the API refuses further join tokens.

## Ringing timeout

Default `30_000` ms (`DEFAULT_RINGING_TIMEOUT_MS`). Configurable via `CallSessionService` options / demo constructor.
