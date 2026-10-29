# Spiral Drop

Rotate a layered tower so a falling ball passes through safe gaps and avoids
striped danger sectors. Chain drops to charge a smash. Reach the base.

A StarHermit engine script game (engine 1.24.0, `engine.minor=20`): played
natively by the StarHermit client and in browsers by the engine's web
runtime (`index.html` is the loader `npm run package` writes). See `spec.md`
for the full running specification.

## Run

```
starhermit .            # the StarHermit runtime (~/sh/runtime/1.24.0/…)
npm start               # local static server (server.js) for the web loader
```

## Test

```
npm test                # rules, progress, i18n, then the native checks and play scripts
npm run test:browser    # the web package in GPU Chrome at desktop, phone, landscape
npm run plays           # regenerate tests/native/*.play from the planning bot
npm run package         # after every change: the loader and the file index
```

## Controls

- **←/→ or A/D** (hold), drag sideways, the round on-screen buttons, or the
  gamepad stick / D-pad — rotate the tower
- **Esc / Space** — pause · **U** — undo (practice, lessons) · **H** — hint
  (practice, lessons); keys and pads rebind in the runtime's Options

## Layout

- `src/rules.js`, `src/content.js` — the deterministic rules and versioned
  content (UMD; shared with `server.js` and the tests).
- `src/progress.js` — the save model and progression rules; `src/lang.js`,
  `src/strings.js`, `src/sh-strings.js` — localization (nine locales).
- `native/` — the engine client: `main.ts` (session, input, lifecycle),
  `screens.ts` (HUD and panels), `render.ts` (the tower), `audio.ts`,
  `platform.ts` (saves, options, leaderboard), `quality.ts`, `style.ts`,
  `i18n.ts`.
- `score-script.js` — the platform script that posts a finished run's total
  to the `high-score` board; `server.js` — local dev server and replay
  validator.
