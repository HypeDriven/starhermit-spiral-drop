# Spiral Drop

Rotate a layered tower so a falling ball passes through safe gaps and avoids
striped danger sectors. Chain drops to charge a smash. Reach the base.

## Run

```
node server.js          # → http://localhost:8080 (static + API + validated boards)
# or any static server, e.g.:  npx serve .
```

Fully playable offline from a static host; the Node server adds server-time
sync, replay-validated leaderboards, and activity tracking.

## Test

```
node tests/run-tests.js
```

33 tests: legality, invalid-action reasons, every scoring component, terminal
states, undo, serialization round-trips, deterministic replay (same seed +
commands → identical state hashes), envelope tamper detection, content
validators for all 40 journey stages / challenges / lessons, daily-seed
immutability, and fuzz runs (no hangs, NaNs, or unbounded loops).

## Controls

- **←/→ or A/D** (hold), drag sideways, on-screen arrows, or gamepad stick/d-pad — rotate tower
- **Esc / Space** — pause · **U** — undo (practice) · **H** — hint (practice/learn)

## Architecture

- `src/rules.js` — pure deterministic engine (fixed 60 Hz tick, seeded RNG,
  serializable state, legal-action API, replay envelopes + verification). UMD,
  shared verbatim between browser, tests, and the server validator.
- `src/content.js` — versioned content: 5 themes, 40 journey stages, daily
  generator (one immutable seed per UTC day), 6 challenges, 5 lessons, offline
  validators (legality, reachability, bounded duration, no soft locks).
- `src/render.js` — Three.js scene: gradient sky dome, pooled ring views,
  pooled particles, critically-damped camera spring, quality tiers
  (shadows/particles/pixel-ratio/render-scale), ACES tone mapping, context-loss
  recovery. Never mutates rules state.
- `src/ui.js` — semantic HTML screens/HUD: title, mode setup, journey map,
  results with score breakdown, settings (audio buses, quality, accessibility),
  help cards, live regions, captions.
- `src/audio.js` — WebAudio procedural synth; music/effects/ambience/voice
  buses; seeded sound variants.
- `src/platform.js` — StarHermit host adapter: launch-token scope, `/api/v1/time`
  sync with round-trip offset, score submission, presence. Offline-tolerant.
- `server.js` — static host + API: score validation by deterministic replay,
  tie-breaks (completion → invalid actions → time → session id), rate limits,
  durable JSON boards.

## Modes

Learn (5 interactive lessons) · Journey (40 authored stages across 5 themes)
· Daily (shared UTC seed, ranked when hosted) · Practice (3 difficulties,
undo + hints, unrated) · Challenges (move budget, clock, narrow gaps, drift
storm, long tower, smash gauntlet) · Score chase (local + validated global
boards, friends filter).

## Accessibility

Full keyboard operation with visible focus, screen-reader live regions for
objective/score/results, stripe-textured danger (never color-only), CVD-safe
palette, high contrast, larger text, reduced motion, left-handed controls,
captions for audio cues, hold-vs-toggle rotate buttons, safe-area-aware
responsive layouts for portrait/landscape mobile and desktop.
