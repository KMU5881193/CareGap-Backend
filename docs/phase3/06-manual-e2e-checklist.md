# Manual Audio E2E Checklist

Prerequisites: real `LIVEKIT_*` in `.env`, demo server + web running.

## Steps

1. [ ] Terminal A: `pnpm call:demo:server` shows `LiveKit: configured`
2. [ ] Terminal B: `pnpm call:demo:web`
3. [ ] Chrome window A → role `demo-staff`
4. [ ] Chrome window B → role `demo-patient`
5. [ ] Both show signaling `open`
6. [ ] A clicks **전화 걸기**
7. [ ] B shows **수신 요청**
8. [ ] B clicks **오디오 잠금 해제** (if needed) then **수락**
9. [ ] Both reach `CONNECTING` then `ACTIVE`
10. [ ] Speak into mic A → hear on B
11. [ ] Speak into mic B → hear on A
12. [ ] Toggle mute on A → B stops hearing A
13. [ ] Unmute → audio returns
14. [ ] Call timer increments while `ACTIVE`
15. [ ] Either side **통화 종료** → both `ENDED`, audio stops
16. [ ] Decline path: new call, B **거절** → `DECLINED`, no token/audio

## Result recording

| Item | Result |
|---|---|
| Bidirectional audio | PASS / FAIL / NOT VERIFIED |
| Mute | PASS / FAIL / NOT VERIFIED |
| Hang-up cleanup | PASS / FAIL / NOT VERIFIED |

Do **not** mark overall Phase 3 PASS if only mock unit tests passed.
