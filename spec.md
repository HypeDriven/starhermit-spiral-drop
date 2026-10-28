# Spiral Drop — Product and Game Specification

**Document status:** running specification of the game as built: a StarHermit engine script game (engine 1.22.0, host API 1.22, `engine.minor=20`).  
**Game index:** 45  
**Genre:** Rotation action puzzle  
**Players:** 1 player; optional asynchronous score comparison  
**Targets:** the StarHermit client (native) and browsers (the engine's web runtime): desktop, phones in portrait and landscape  
**Rendering:** `starhermit:scene` (three.js r185-parity scene API) with an immediate-mode `starhermit:ui` interface layer

## 1. Product vision

Spiral Drop is a game in which players rotate a layered tower so a falling ball passes through safe gaps and avoids danger sectors. Its signature setting is a glossy kinetic tower above an endless gradient. The product should feel immediately understandable, responsive within one input, and polished enough that the board or playfield itself is the visual hero. Sessions should begin quickly, make the next useful action obvious without solving the game for the player, and end with a clear explanation of score and progress.

The experience must be original. Do not copy names, layouts, characters, iconography, writing, audio, progression maps, or level data from an existing title. Use an original visual language, original procedural assets, and internally authored content.

### Design pillars

1. **Readable before spectacular:** legal actions, hazards, selection, ownership, and goals remain legible with effects disabled.
2. **One-input confidence:** every press, tap, drag, key, or pointer action gives immediate visual and sonic acknowledgment.
3. **Short path to play:** a returning player reaches the primary playfield in at most two deliberate actions.
4. **Fair mastery:** randomness is seeded and inspectable; outcomes never depend on hidden purchases or invisible stat boosts.
5. **Scalable beauty:** the same art direction survives low-power mobile hardware and high-resolution desktop displays.

## 2. Core game design

### Objective and rules contract

Rotate a layered tower so a falling ball passes through safe gaps and avoids danger sectors.

The rules engine must represent legal actions independently from rendering. It must expose legal-action queries, deterministic resolution, serializable state, a monotonically increasing turn/tick number, and a terminal-state reason. Tutorials and hints call the same legal-action API used by play rather than duplicating rules.

### Core loop

The repeated loop is: **rotate the tower, align a safe gap, let the ball fall, and stop before danger**. Input is locked only during the shortest non-interruptible resolution phase. Cosmetic animation may continue after the logical state is ready, but skip/fast-forward must settle every object into the exact deterministic end state.

### Scoring and victory

Score descended layers, uninterrupted drops, and precision landings. Results show a component breakdown rather than one unexplained total. Store integers for score and simulation units; format values only in presentation. Ties use, in order: primary objective completion, fewer invalid actions, lower authoritative elapsed time, then stable session identifier.

### Modes

- **Learn:** interactive lessons introduce one rule at a time and require the player to perform the action.
- **Journey:** authored progression with gradually combined mechanics and periodic mastery stages.
- **Daily:** one shared seed and ruleset per UTC day, synchronized to platform time.
- **Practice:** selectable difficulty, restart, undo where rules permit, and no effect on competitive rating.
- **Challenge:** constrained goals such as move limits, speed targets, altered layouts, or restricted tools.
- **Score chase:** asynchronous global and friends comparisons using validated seeds and rulesets.

### Difficulty and content generation

- Represent content as versioned data: identifier, seed, initial state, goals, allowed mechanics, par values, tutorial flags, and presentation theme.
- Run offline validators to prove basic legality, reachable goals, bounded duration, and absence of soft locks. Logic puzzles additionally require a unique or explicitly accepted solution class.
- Difficulty is measured from solution depth, branching factor, time pressure, motor precision, hidden information, and recovery options—not merely larger numbers.
- Introduce one new concept in isolation, combine it with one known concept, then test mastery before adding another.
- Daily seeds are immutable after publication. If content is defective, mark the day excluded from ranking rather than silently replacing it.

### Game-state model

`boot → title → profile-ready → mode-select → preparing → tutorial/countdown → active ↔ paused/reconnecting → resolving → results → progression`.

Every transition has one owner and an explicit reason. Backgrounding pauses solo simulation. In hosted play, the authoritative clock continues where rules require it, while the returning client receives a fresh snapshot and a concise “while you were away” summary.

## 3. The game on the StarHermit engine

### Implementation

- `starhermit.txt` declares an engine script game: `engine.entry=native/main.ts`, `engine.version=1.22.0`, `engine.minor=20`, capabilities `platform,storage,clipboard`, the keyboard actions (`control.*`) and gamepad defaults (`engine.gamepad.*`), and `server=score-script.js`. Browsers open `index.html`, the loader `npm run package` (`starhermit package --web .`) writes with the file index `starhermit-files.json`; both are committed and regenerated after every change.
- The rules (`src/rules.js`: the 60 Hz deterministic simulation, commands, scoring, hints, replay envelopes) and content (`src/content.js`: five themes, the seeded layer generator, the 40 Journey stages, the Daily, three Practice presets, six Challenges, five lessons) are the browser build's UMD scripts, unchanged, loaded with `loadClassic`; `server.js` (local dev server and replay validator) and the node tests share them.
- `native/main.ts` is the session state machine (title → setup → countdown → active ⇄ paused → results, plus replay), input, progression and lifecycle; `native/screens.ts` the HUD and every panel (`starhermit:ui`); `native/render.ts` the tower (`starhermit:scene`); `native/audio.ts` sound (`starhermit:audio`); `native/platform.ts` saves, options and the platform; `native/quality.ts` the graphics budgets per quality tier; `native/style.ts` the look (`tools/ui-style.css` → `assets/ui-style.json` with `npm run css`); `native/i18n.ts` the language. `src/progress.js` is the pure save model and the progression rules (merges, the old cloud doc, achievements, stars, streaks, bests); `src/lang.js` the translation lookup over `src/strings.js`.
- **Time** is the runtime's fixed steps at 60 Hz, one rules tick a step. Each step applies the rotation held at that step (keys, pad, the round buttons or a drag) as `rotateStart` / `rotateStop` commands, then runs the tick. While a landing resolves (4 ticks) rotation changes wait for the next step instead of being refused. The countdown (“3”, “2”, “1”, “Drop!” 700 ms apart, play 550 ms after “Drop!”), the drag's 130 ms idle stop, captions (1.6 s) and toasts (2.6 s) count the same steps, so slow frames, pauses and a hidden window never change a run, and play scripts replay exactly. The tower is drawn between the last two steps (the runtime's interpolation), as the browser build drew it with its accumulator's alpha. Behind the menus an attract tower spins and drops every other step (the old 33 ms interval).

### Controls

- **Keys** (rebindable in the runtime's Options): ←/A and →/D rotate while held (both held: the last pressed wins); Esc or Space pauses and resumes (Space on a focused button presses the button); U undoes (Practice, Learn); H gives a hint (Practice, Learn). Esc also backs out of menu panels. F1 is the runtime's.
- **Gamepad**: D-pad or left stick rotates; Start or East pauses; West undoes; North hints; South presses the focused button.
- **Pointer and touch**: a sideways drag over the tower rotates it in the drag's direction (a 1 px move turns it; 130 ms without movement stops it; releasing stops it). The round ⟲ / ⟳ buttons (76 px, 68 px on portrait phones, 56 px in short landscape) rotate while held, or toggle with Hold-to-rotate off. The pause button (two drawn bars), Undo and Hint chips are buttons too. Presses on HUD controls never start a drag.

### Screens and layouts

- **HUD**: objective chip (wrapping, up to ~70 characters wide), score, “Layer n / total”, the smash charge (⚡ per streak layer, up to three, plus SMASH when charged), the Challenge clock (⏱) or rotation budget (⟳), and pause; at the bottom the round rotate buttons with Undo and Hint between them, mirrored with Left-handed controls. Cue captions sit above the buttons and are hidden while a panel is open. The countdown is a large accent numeral; toasts drop in at the top.
- **Panels** over the dimmed tower (a modal dialog: Esc / Back closes): Title (Play — next stage, Daily Drop (✓ when done today), Journey, Practice, Challenges, Learn to Play, Scores, Settings, How to Play, Sign in / Invite a friend, the progress summary line), mode setup (rules, ~duration, ranked badge, assists, Start / Back), Journey grid (40 stages, stars, mastery stages outlined gold, locked stages disabled), Practice, Challenges (with best scores), Learn (✓ per finished lesson), Scores (Local bests / Global / Friends tabs; boards read from the platform's high-score leaderboard, guests included; Friends signed in), How to Play (rule cards with the current key bindings), Settings, Pause (Resume, Restart, Settings, Help, Leave round), Results (headline, content name, score breakdown and total, run stats, Journey stars, new achievements, the leaderboard line, Next / Retry, Replay this stage, Watch replay, Menu), and an erase confirmation. Each panel's action row stays below its scrolling body.
- **Layouts** by the window's logical size: portrait phones (≤ 640 px wide) use bottom sheets (82 % of the height at most); short landscape (≤ 480 px tall) stacks the HUD status in a column at the start and the rotate buttons in a column at the end; otherwise panels are centred (680 px, 720 px from 1024 px). The runtime's safe areas and UI scale apply.
- **Watch replay** replays the last run's input log on fixed steps from a fresh state, says “Replay — Esc to exit”, and returns to the title when it ends (“Replay finished.”).

### Settings

The runtime's Options own volumes and mute, graphics quality (Auto and the levels, render scale, adaptive resolution, frame-rate limit and readout), the language, larger text, high contrast (also the game's high-contrast tokens and ring colours) and reduced motion (no camera spring, shake, bounce, motes or sky drift); Settings opens them (**Open Options**) and the key bindings (**Key bindings**). The game's own options are engine settings (synced with the account): **Captions for audio cues**, **Color-vision-safe palette** (danger, accent and safe colours from `CVD_THEME_PATCH`), **Left-handed controls**, **Hold-to-rotate buttons (vs toggle)**. **Replay tutorial** opens lesson 1's setup; **Erase local data** asks, then resets the progress (and the account's copy when signed in) and the game's options.

### Graphics

- The scene follows render.js (three.js r160): perspective camera (fov 42, distance 7.4, pulled back on narrow windows so the ring fits) on a critically damped spring following the ball, the key directional light (÷ π, r155+ physical units) following the camera with shadows, the hemisphere fill (0.85, 0.62 with reflections, ÷ π) and the ball's point light, `new RoomEnvironment(renderer)` prefiltered with PMREM as each lit material's own envMap at its old envMapIntensity (safe 0.22, danger 0.18, ball 0.6, pillar and base 0.25), the WGSL sky dome (gradient, drifting bands and twinkling stars when animated; tone mapping skipped without post effects and the sky pre-darkened by half under them), fog, ACES tone mapping at exposure 1.05 (0.95 for Paper Dawn).
- Rings are `ExtrudeGeometry` annulus sectors: safe arcs, striped danger arcs (the stripe canvas sRGB-encoded so it reads as r160 read its linear canvas), bevelled on detailed tiers; the rest ring has a glowing rim, the ball a grounded marker; landing dust and smash shards are pooled `Points`; the ball leaves a short trail while falling.
- Per quality tier (`native/quality.ts`, the old gfx.js presets): Low — Lambert, no shadows, no post (MSAA), static sky, plain rings, few particles; Balanced — Standard materials, 1024² shadows, bloom (0.42 / 0.35 / threshold 0.9, half res), linear grade (saturation 1.12, split toning 0.05–0.6, vignette 0.28), FXAA, reflections, bevels, grain and fluting; High — Physical clearcoat, 2048² shadows, GTAO (radius 0.45, 8 samples), SMAA, motes; Ultra — 4096² shadows, full-res GTAO (16) and bloom, MSAA, finer tessellation and textures. Particle pools scale ≤ 2× with the level inside a tier.

### Sound

The authored clips (`sfx/*.opus`) play per rules event (rotate, drop, pass, land, smash, danger, invalid, undo, win, countdown, achievement, UI tap), loaded one at a time once the mixer runs. The adaptive music pad (four chords; an octave up above intensity 0.3; faster bars and a blip above 0.6) is rendered into three loop clips cross-faded by the drop streak; the low-passed noise ambience is a loop on the music bus at the old ambience-to-music ratio. Captions (Drop, Layer passed ×n, Combo ×n, Precision landing, Danger sector smashed / — run over, Undone, Stage complete, Achievement unlocked, Action not available) show when Captions is on.

### Saves and platform

- The save (`saves`, schema 1, device and cloud) is `{ v, progress, telemetry }`; two devices' saves merge with the browser build's `mergeProgress` (more stars and higher scores, unions with the earliest unlock, the later daily streak) and the larger telemetry counters. The browser build's cloud slot (`game:<slug>`, `{ settings, progress, telemetry, savedAt }`) shows as a foreign save: its progress is merged, its captions / palette / handedness / hold options adopted unless set here since, and it is replaced once. The old settings-KV keys are read the same way, then removed.
- Signed in, every finished Journey, Daily or Challenge run (won or lost) posts its total through `score-script.js` (a practice session whose socket sends `{ type: 'result', scores: { 'high-score': total } }`; the script range-checks 0–1,000,000) and the results show posting / rank / posted / not posted. Practice and Learn post nothing; guests post nothing. The Daily's UTC day comes from the platform clock (`serverNow()`), else the device's. The title offers Sign in with StarHermit (guests) and Invite a friend (copies the invite link).
- A hidden window pauses an active run or its countdown (resuming restarts the countdown) and silences the pads; signing out shows a toast and play continues locally.

### Localization

Every player-facing string is drawn through `T()` from `src/strings.js` in the runtime's interface language (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT; regional tables list only their differences); the account strings are `src/sh-strings.js`. A language change shows on the next frame without ending the run.

### Checks

- `npm test`: `tests/run-tests.js` (33 rules and content tests), `tests/progress.test.mjs` (merges, the old cloud doc, progression rules), `tests/i18n.test.mjs` (every key in every locale, placeholders, no unused rows), then `tests/native.mjs`: the web index is current, `tsc` (no skipLibCheck), `starhermit check .` with zero warnings, and the play scripts as signed-out render checks — `journey-keys` (Journey 1–4 by keys from the bot's plans with exact totals, the replay, the map), `lesson-phone` (DPR-3 phone by finger: lesson 1's rotation goal, lesson 2, pause, then a run turned only by swipes), `challenge-landscape` (Minimal Touch at 844×390@3, Scores, How to Play), `practice-menus` (lesson 4's hint and undo, Practice's pause / Settings / Help / Restart / Leave, the erase confirmation) and today's Daily (`.daily.play`, generated at test time).
- `tools/gen-plays.mjs` writes the scripts from `tools/bot.mjs` (a planning bot that plays the rules on the client's fixed steps); the first active step comes 159 frames after the `until =3` line on the 1.22.0 render check.
- `npm run test:browser` (`tools/browser-play.mjs`) plays the packaged loader in Chrome on the GPU at desktop (Journey 1–2 by held keys, pause), phone (lesson 2 by a held finger on a rotate button, a retry turned by drags, pause) and landscape (Journey 1 by finger, Scores), failing on console errors or warnings.

### Known limitations

- Hosted multiplayer does not exist (solo game); the score posted is the client's total, range-checked by `score-script.js` (server-side replay verification is not used on the platform; `server.js`'s validator is the local dev server's).
- Kept from the rules: Undo restores the state at the drop's start, where the gap is aligned, so the ball drops again at once (Undo mostly rewinds score and streak). The Creature of Habit achievement is checked before the day's streak update, so it unlocks on the run after the third consecutive Daily.
- The synthesized fallback sounds the browser build played while a clip decoded are not ported (a still-loading clip is silent), nor are their seeded pitch variants.
- Practice towers are seeded from the device clock and random numbers (as before), so Practice play scripts check menus only.
- In the web runtime, a finger tap right after a drag ends can be ignored (the browser check waits 1.5 s before tapping the pause button).

## 4. Content, economy, and retention

- Launch scope: tutorial sequence, at least 40 authored stages or equivalent procedural depth, daily challenge, practice, five visual themes, and a mastery track.
- Cosmetic rewards may alter materials, trails, board surrounds, ambience, or profile flourishes, but never hitboxes, timing windows, information, or power.
- Reward cadence: early feedback every session, meaningful unlock every 3–5 sessions, and long-term goals visible without manipulative countdowns.
- No real-money wagering, paid random rewards, forced advertising, energy pressure, punitive streak loss, or purchases that affect competitive outcomes.
- Notifications, if ever added by the host, are opt-in, frequency-capped, quiet-hour aware, and never use false urgency.

