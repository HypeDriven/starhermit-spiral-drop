# Known Issues — Spiral Drop

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on spark185 (OBLITERATED Q8_0, 262k ctx),
alongside the game's own unit tests and a headless-Chrome boot check.

Method note: broad "find the defects in this module" prompts to the review model mostly came back
*NO DEFECTS FOUND*; the findings below were located by reading the source and then **re-executing
the real modules** to reproduce each one. Narrow, single-question prompts to the model were used
afterwards to double-check individual findings, and where that happened it is noted in the
evidence.

## Test results

| Check | Result |
| --- | --- |
| `npm test` | 33/33 pass (`tests/run-tests.js`) |
| `node --check` on all modules | clean (7 `src/*.js` + `server.js`) |
| `tests/e2e.mjs` (headless Chrome) | **15/15 ok, `E2E PASS`** (desktop + mobile, no page errors) — re-verified 2026-09-05 |

## Confirmed defects

Each defect below was reproduced by executing the real modules against the running server, not
merely reported by the model. All four have since been **fixed and verified resolved** (see
*Resolved defects* below).

### 1. The score validator replays against the client's own config, so the time bonus is unbounded

- **File:** `src/rules.js:488` (`verifyEnvelope`), reached from `server.js:94` (`validateScore`)
- **Trigger:** POST `/api/v1/scores` with a genuine input log but a `config.parTicks` the client
  chose.
- **Behaviour:** `verifyEnvelope` does `var state = replay(env.config, env.inputLog)` and then
  checks the final hash, the terminal reason and `totalScore(state)` against the envelope — all
  computed from the same client-supplied `env.config`. Nothing rebuilds the config from
  `content.js` for the claimed `env.contentId`/`env.seed`. Since the completion bonus is
  `Math.round((parTicks - tick) * 0.5)` (`src/rules.js:274`), raising `parTicks` scales the score
  almost arbitrarily; the only ceiling is `validateScore`'s `score > 1000000` bound
  (`server.js:107`).
- **Expected:** spec §6: "validate score claims through a lightweight authoritative script using
  replayable input logs and **deterministic seeds**"; spec §2: "Daily seeds are immutable after
  publication."
- **Evidence:** the identical 457-tick daily run, submitted twice — once honestly, once with a
  declared par of 1 900 000 ticks:

  ```
  real daily parTicks: 1836
  HONEST : terminal completed  score   1250  ticks 457  timeBonus    690
  FORGED : terminal completed  score 950332  ticks 457  timeBonus 949772
  verifyEnvelope: {"ok":true,"score":950332,"terminal":"completed"}
  POST /api/v1/scores -> 200 {"validated":true,"rank":1}
  ```

### 2. Undo moves the tick counter backwards, breaking the monotonicity the spec requires

- **File:** `src/rules.js:207` (`restoreSnapshot`), called from `src/rules.js:248` (`applyCommand`,
  `undo` branch)
- **Trigger:** in any mode with `allowUndo` (Practice and Learn — `src/main.js:146`, `src/main.js:176`),
  press Undo.
- **Behaviour:** `restoreSnapshot` assigns `state.tick = snap.tick`, so the tick jumps back to the
  value it held when the snapshot was taken.
- **Expected:** spec §2 *Objective and rules contract*: the rules engine "must expose … a
  monotonically increasing turn/tick number".
- **Evidence:**

  ```
  before undo: tick 147  undoStack 2  inputLog entries 5
  undo result: {"ok":true} -> tick 55 (was 147)   monotonic? false
  ```

  Independently confirmed by the review model shown only `restoreSnapshot` and the `undo` branch:
  "`state.tick = snap.tick;` … the tick can decrease. The 'monotonically increasing' requirement is
  **not** met."

### 3. Undo corrupts the input log, so an undone run cannot be replayed

- **File:** `src/rules.js:251` (`applyCommand`, `undo` branch) with `src/rules.js:469` (`replay`)
- **Trigger:** press Undo in Practice or Learn, then replay or validate the resulting input log.
- **Behaviour:** the undo entry is appended *after* `restoreSnapshot` has rewound `state.tick`, so
  it is stamped with the old tick and lands out of order in `state.inputLog`. Nothing removes the
  commands that were undone, and `state.seenCommandIds` is not rewound either. `replay()` then does
  `inputLog.slice().sort((a, b) => a.tick - b.tick)`, which reorders the undo *before* the commands
  it was meant to undo.
- **Expected:** spec §5: the replay envelope's "ordered commands" plus periodic state hashes must
  reproduce the run.
- **Evidence:** the tail of the log after one undo — note the tick going 56 → 132 → 55:

  ```
  [{"tick":56,"type":"rotateStop","id":"c3"},
   {"tick":132,"type":"rotateStart","dir":-1,"id":"c4"},
   {"tick":55,"type":"undo","id":"u1"}]
  ```

### 4. The leaderboard's invalid-action tie-break is hard-coded to zero

- **File:** `server.js:146-148`
- **Trigger:** two entries with the same completion status and score.
- **Behaviour:** the sort builds its comparison objects with `invalidActions: 0` on **both** sides:

  ```js
  scores.entries.sort((a, b) => R.compareResults(
    { reason: a.terminal, score: a.score, invalidActions: 0, ticks: a.ticks, sessionId: a.id },
    { reason: b.terminal, score: b.score, invalidActions: 0, ticks: b.ticks, sessionId: b.id }));
  ```

  so the `invalidActions` step of `compareResults` (`src/rules.js:526`) can never fire, and ties
  fall through to `ticks`. The data exists — `buildEnvelope` ships `result.stats` including
  `invalidActions` (`src/rules.js:514`) — but the stored entry (`server.js:128-141`) never records
  it.
- **Expected:** spec §2: "Ties use, in order: primary objective completion, **fewer invalid
  actions**, lower authoritative elapsed time, then stable session identifier." `compareResults`
  implements the chain correctly; the caller defeats it.
- **Evidence:** `server.js:146-148` as quoted, against `src/rules.js:521-529`.

## Resolved defects

All four confirmed defects above were re-checked against the current source on 2026-09-05 and are
no longer reproducible; each is fixed and the fix is verified. No code changed in this re-check —
the fixes were already present in the working tree — so the entries below document how and where
each is fixed.

### 1. Score validator replays against the client's own config → RESOLVED

- **Fix:** `server.js` re-validates against an **authoritative** config rebuilt from the published
  (versioned) content descriptor rather than the submitted one. New `resolveContent()`
  (`server.js:101-117`) maps `daily-*`/`jNN`/challenge ids to the real descriptor, and
  `validateScore()` (`server.js:128-137`) replaces `env.config` with
  `C.toConfig(content, …)` before `verifyEnvelope`. Daily seeds/`parTicks`/layers come from
  `content.js`, so the client can no longer inflate `parTicks` (the `timeBonus` is bounded and the
  replayed hash no longer matches).
- **Verify:** a fully-forged daily envelope (real input flow, `parTicks=1900000`) stands alone in
  `verifyEnvelope` (`score 950332`) but is rejected by the server rebuild with
  `{"ok":false,"reason":"hash-mismatch"}`. Honest run still validates `ok:true, score 1250`.

### 2. Undo moves the tick counter backwards → RESOLVED

- **Fix:** `restoreSnapshot` (`src/rules.js:206-218`) no longer assigns `state.tick = snap.tick`;
  it restores play state but leaves the monotonic tick untouched. `undo` is therefore stamped with
  the current (non-decreasing) tick.
- **Verify:** after a real eligible undo the tick stayed at 64 (was 64 before), `monotonic? true`.

### 3. Undo corrupts the input log → RESOLVED

- **Fix:** follows from fix 2 — because `restoreSnapshot` no longer rewinds the tick, the `undo`
  entry is stamped in-order (after the commands it undoes) instead of landing out of order in
  `state.inputLog`. `inputLog` remains ordered and `replay()` reproduces the run.
- **Verify:** an undo entry appeared at `tick 48` after the commands it undoes (no
  56→132→55 inversion), and a full recorded playthrough that undoes mid-run then finishes
  validated with `verifyEnvelope {"ok":true,...,"terminal":"danger-sector"}`.

### 4. Leaderboard invalid-action tie-break hard-coded to zero → RESOLVED

- **Fix:** `server.js` stores `invalidActions: check.invalidActions || 0` on the entry
  (`server.js:172`) and the scoreboard sort passes the real value on both sides
  (`server.js:182-183`, `a.invalidActions || 0` / `b.invalidActions || 0`) instead of
  `invalidActions: 0`.
- **Verify:** `compareResults` now orders a `completed/100` entry with 0 invalid actions ahead of
  one with 3 (returns `< 0`).

## Suspected — not confirmed

> Both suspicions below were closed out in the 2026-09-07 review: #1 is now fixed, #2 could not be
> reproduced. See *Review 2026-09-07* at the end of this document.

### 1. `replay()` can exit without a terminal state and still be treated as a run

- **File:** `src/rules.js:471-478`
- **Concern:** the loop condition is `state.phase !== 'terminal' && state.tick < limit`, so on
  reaching `MAX_TICKS` it exits with `phase` still non-terminal — `finish(state, 'tick-limit')` at
  `src/rules.js:285` is only reached from `step()` on the *following* call, which never happens.
  An empty-input replay observed exactly this: `terminal: null` at tick 108000.
- **Why unconfirmed:** `verifyEnvelope` then fails with `result-mismatch` and `server.js` returns
  422, so no bad score gets through; whether any legitimate flow can reach the cap is not
  established.

### 2. Rotation input is not re-validated when a rotate is already held

- **File:** `src/rules.js:169-171` (`legalActions`)
- **Concern:** `rotateStart` in the direction already being held is reported illegal
  (`rotate-not-available`) and charges `stats.invalidActions`. A player holding a key and pressing
  it again — or an auto-repeating key — could accumulate invalid actions that count against the
  spec tie-break.
- **Why unconfirmed:** `src/main.js` may debounce key repeat before reaching `sendCmd`; that path
  was not traced end to end.

## Checked, no defects found

- `src/rules.js` scoring is integer throughout: `TIME_BONUS_PER_TICK` is 0.5 but is always wrapped
  in `Math.round(...)` at `src/rules.js:274`, and every other component is a whole-number constant.
- `src/rules.js` terminal reasons: `completed`, `danger-sector`, `move-limit-exceeded`,
  `time-expired`, `tick-limit`, `abandoned` are each set exactly once through `finish()`, which also
  pushes a final hash.
- `src/rules.js` legality surface: `isLegal` is derived from `legalActions`, and `hint()` reads the
  same `gapAlignment` data the simulation uses — spec §2's "tutorials and hints call the same
  legal-action API".
- `src/rules.js` undo guard: `legalActions` only offers `undo` when
  `config.allowUndo && phase === 'rest' && undoStack.length > 0`, so the unguarded
  `state.undoStack.pop()` in the undo branch cannot pop an empty stack.
- Determinism: the ball's fall re-evaluates gap legality at the crossing instant rather than at
  drop time, drift is a pure function of `state.tick`, and periodic hashes are emitted once per
  simulated second — the 33 unit tests include replay determinism.
- `server.js`: per-key rate limiting (20/min), a 200 000-command and 500-layer bound before any
  replay work, best-per-(content, player) retention, and the entry's `score` taken from the
  *replayed* value rather than the claim.
- `server.js` static serving: decoded path, traversal-checked, no dotfiles.

## Not tested

- **`tests/e2e.mjs`**: was not shipped at the time of the original QA pass; it is now present and
  passes (15/15, `E2E PASS`, desktop + mobile, no page errors) — re-verified 2026-09-05.
- **Rendering**: `src/render.js` (492 lines) and the bundled `lib/three.module.js` were not
  reviewed; the boot check confirms no WebGL or console errors.
- **Hosted platform paths**: `src/platform.js` requires a host launch token; presence, activity and
  telemetry were not exercised against a real host.
- **Score durability**: `server.js` persists to a JSON file; restart and concurrent-writer
  behaviour was not assessed.

## QA artifacts left on disk

Reproducing the findings above required running `spiral-drop/server.js` locally, which created an
untracked `data/` directory. It holds the evidence entries used here (`ParLiar`). **Delete
`data/` before treating any of it as real data** — this QA pass had no permission to remove it.

## Review 2026-09-07 — defects found and fixed

A fresh read of every module plus targeted browser reproduction (headless Chromium against the
real UI). `npm test` 33/33 and `npm run test:e2e` 15/15 both pass before and after.

| # | File | Defect | Fix |
| --- | --- | --- | --- |
| 1 | `index.html` | Two `<link rel="icon">` tags: the later inline data-URI placeholder overrode the authored `favicon.svg`, so the game shipped the placeholder icon. | Removed the placeholder link. |
| 2 | `src/main.js` | The global `keydown` handler claimed the arrow keys and Space unconditionally, so the Settings sliders and the quality `<select>` could not be adjusted with the keyboard, and Space on a focused pause-menu button both activated it and toggled pause. | Keys are ignored when the target is a form control, and Space is left to a focused `<button>`. |
| 3 | `src/main.js` | A rotate key held while the window lost focus never got its `keyup`, leaving the tower spinning after the player came back. | `window blur` clears the held set and stops rotation. |
| 4 | `src/main.js` | Esc/pause did nothing during the countdown and backgrounding the tab did not stop it, so the run went live unattended behind the pause screen. | `pauseGame()` cancels the countdown, `resumeGame()` replays it; `visibilitychange` pauses during countdown too. |
| 5 | `src/main.js` | The on-screen ⟲/⟳ buttons are focusable but had pointer handlers only — unusable from a keyboard. | Space/Enter press-and-hold handlers (plus blur release) added. |
| 6 | `src/main.js` | `daily` was computed at module load, before `platform.init()` synced server time, so a skewed device clock chose the wrong daily board. | Recomputed after a successful time sync. |
| 7 | `src/render.js` | `setHighContrast(v)` passed the high-contrast flag into `applyTheme`'s **cvd** parameter, so toggling high contrast silently switched the colour-vision-safe palette on/off (same bug on WebGL context restore). | The renderer remembers the cvd palette state and re-applies it. |
| 8 | `src/render.js` | Every unused particle sat at the world origin instead of being parked offscreen; `update()` also allocated a fresh `Float32Array` for the ball trail on every frame. | Pools are initialised parked; the trail scratch buffer is reused. |
| 9 | `src/audio.js` | `musicBar()` returned without rescheduling when muted, so muting killed the music loop permanently, and it kept scheduling notes at a frozen `currentTime` while the context was suspended. | Muted/suspended is now a silent tick that keeps the loop alive. |
| 10 | `server.js` | The static path guard used `file.startsWith(ROOT)` / `startsWith(DATA_DIR)`, which also matches sibling paths such as `<ROOT>-backup`. | Compared on a path-separator boundary. |
| 11 | `src/rules.js` | *Suspected #1 confirmed and fixed:* `replay()` exited at `MAX_TICKS` with no terminal state (`terminal: null` at tick 108000). | `replay()` finalises with `tick-limit`, matching live play. |
| 12 | `src/ui.js` | Screens are `role="dialog" aria-modal="true"` with no accessible name; the Scores tabs never set `aria-selected`; journey stage buttons carried `role="listitem"`, stripping their button semantics. | Dialogs are labelled by their heading, tabs track selection, stage buttons keep their native role. |
| 13 | repo root | `LICENSE.md` was missing (required by the root instructions). | Added the PolyForm Noncommercial 1.0.0 text used across the fleet. |

Suspected #2 (invalid actions from repeated `rotateStart`) **could not be reproduced**: `keydown`
returns on `e.repeat`, `startRotate()` returns when `rotating === dir`, the drag handler only fires
on a direction change, and the gamepad poll is edge-guarded — no path re-sends a held direction.
