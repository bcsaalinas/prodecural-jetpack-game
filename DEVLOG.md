# build log

This is the build record for the first working version. Current system design
lives in `ARCHITECTURE.md`. Current math lives in `MECHANICS.md`.
Date: 2026-08-27.

## step 0: environment inspection

- Working directory contained only `AGENTS.md` (the spec).
- Environment: macOS (darwin), Node v26.0.0, npm 11.12.1.
- Decision: no git repo present; none created (not requested).

## step 1: project scaffold

Created:

- `package.json` — scripts: `dev` (vite), `build` (tsc --noEmit + vite build),
  `verify` (headless test build + runner). Dev deps: typescript ^5.5.4,
  vite ^5.4.8. `"type": "module"`.
- `tsconfig.json` — strict TS, `noUnusedLocals/Parameters`, bundler
  resolution, noEmit (Vite handles bundling).
- `tsconfig.verify.json` — NodeNext emit of `src/game` + `src/config` to
  `dist-verify/` so the real game code can run headlessly in Node.
  (DOM lib included for `console` typings; game code itself is DOM-free.)
- `index.html` — 960x600 canvas + `<aside id="panel">` host for the dev panel.
- `src/style.css` — neutral dark "engineering tool" theme, monospace.

Design decision recorded here because it affects every file:
**all relative imports use explicit `.js` extensions** (NodeNext style).
This lets the same sources be consumed by both Vite (which resolves
`.js` → `.ts`) and Node (which requires real extensions). Verified working
in dev mode via curl (Vite transforms `/src/game/Game.js` → `Game.ts`, 200).

## step 2: config and presets

- `src/config/gameplayConfig.ts` — `GameplayConfig` interface (all 26
  tunables), `defaultConfig()`, `clamp`/`lerp` helpers, canvas constants.
  Every knob carries a comment stating units and whether it is math or feel.
- `src/config/presets.ts` — 6 presets (Floaty, Balanced, Heavy,
  Very Responsive, High Gravity, Low Gravity) as PARTIAL configs touching
  only gravity/thrust/clamps/damping, each with a `_description` explaining
  the intent (duty cycle = gravity/|thrust| is documented here).

## step 3: core game systems

- `Random.ts` — mulberry32 seeded PRNG; `next/range/int/pickWeighted`.
  Zero-seed guard. Weighted pick consumes exactly one draw (stream alignment).
- `Physics.ts` — `VerticalState` + `integrateVertical()`: semi-implicit Euler
  (velocity first, then position from new velocity), optional exponential
  damping, min/max velocity clamps. Pure function so prediction/validation
  reuse the exact live math.
- `World.ts` — corridor geometry: `floorY()`, `ceilingY()`, `corridorHeight()`.
- `Camera.ts` — documents the "player pinned, world scrolls" architecture;
  `camera.x` IS distance traveled; `worldToScreenX = worldX - camera.x`.
- `Player.ts` — vertical dynamics + corridor clamp + state machine
  (FALLING / THRUSTING / FLOOR_CONTACT / CEILING_CONTACT). Fixed a typo found
  on review (`h.playerHeight` → `h: this.cfg.playerHeight`).
- `Obstacle.ts` — fixed-worldX obstacles, 5 archetypes (GATE, BLOCK_TOP,
  BLOCK_BOTTOM, FLOATING, MOVING), per-frame screen-space `getRects()`,
  `distanceToPlayer()` / `timeToPlayer()` helpers, validator fields.
- `Difficulty.ts` — `difficulty = clamp(distance/difficultyDistance,0,1)`;
  world speed / spacing / opening / mover speed as lerps on that scalar.
- `Trajectory.ts` — `simulatePath()` (copy state, same integrator, same
  corridor clamp) and `reachableBand()` (full-thrust / zero-thrust endpoints;
  comment explains why linear dynamics make these bounds exact).
- `Validator.ts` — spawn-time reachability check: reaction-window gate, then
  reachable-band vs safe-interval overlap per obstacle type; MOVING checked
  at worst-case amplitude (documented conservative). Returns reasons with
  numbers for the debug UI.
- `Spawner.ts` — distance-timeline schedule (`nextSpawnX`), difficulty
  evaluated at the obstacle world position (frame-timing independent),
  weighted type draw, corridor-aware geometry, amplitude clamping for movers,
  validator integration + capped rejection log + console.warn.
- `Collision.ts` — strict-inequality AABB overlap, x-range broad-phase
  reject, first-hit reporting. Tunneling math documented (15 px/step at
  defaults vs 40 px thinnest obstacle).
- `Input.ts` — DOM-free held/released state with hold/release duration
  timers (main.ts wires real events into it).
- `Game.ts` — game state machine (READY → RUNNING ⇄ PAUSED → DEAD), restart
  (same/new/random seed), `stepOnce()` for frame stepping, and `simulate()`
  implementing the per-step order: input → difficulty/speed → player physics
  → world scroll → spawn/cleanup → hazard collision → death info capture.

## step 4: debug systems

- `Telemetry.ts` — 480-sample ring buffer (8 s at 60 Hz) of t, y, vy, ay,
  speed, sampled per fixed step (simulation truth, not render rate).
- `TrajectoryPredictor.ts` — screen-space projection of the held/released
  branches (x = playerScreenX + worldSpeed·t) + `predictedHit()` estimate for
  the current input branch.
- `DebugRenderer.ts` — all canvas drawing: world-scrolling grid with world-x
  labels, corridor + collider outlines, obstacles with per-obstacle debug
  labels (id, type, distance, live time-to-player, reaction at spawn, gate
  size, rejection reason), GATE safe-gap highlight, player + thrust wedge,
  physics vectors (velocity = (worldSpeed, vy), gravity, thrust, net accel)
  with arrowheads and labels, trajectory polylines + predicted-hit ✕,
  4-lane scrolling telemetry strip, HUD text block (FPS, frame/fixed dt,
  states, input timers, pos/vy/ay, world speed, distance, difficulty, seed,
  next-spawn distance, nearest obstacle), READY/PAUSED/DEAD overlays with the
  death report and killer-obstacle highlight.
- `DebugPanel.ts` — DOM dev panel: simulation controls (pause/resume, single
  step, restart same seed, restart random seed, 0.1x/0.25x/0.5x/1x/2x speed
  buttons with active state), 26 live sliders in 6 sections (sliders write
  directly into the live config), seed input + apply, preset buttons that
  print exactly which keys they changed, JSON copy/paste/apply + reset
  defaults, validator rejection log, shortcut legend. `refreshInputs()`
  re-syncs the DOM after presets/JSON/restarts.

## step 5: entry point

- Canvas/ctx setup, construction of Game/Telemetry/DebugRenderer/DebugPanel.
- Input wiring: Space, pointer (with pointer capture), touch; F1–F5 debug
  toggles (preventDefault, F5 per spec), P pause, `.` frame step, R restart;
  typing-target guard so panel inputs do not trigger shortcuts.
- The game loop: clamped frame dt (0.25 s tab-switch guard), timeScale into
  the accumulator, fixed-step while-loop with 480-step spiral-of-death cap,
  telemetry sampled per executed step, render once per frame, 5 Hz panel tick.

## step 6: build and typecheck

- `npm install` — clean.
- `npx tsc --noEmit` — 2 errors, both unused symbols (`f1` helper,
  `PlayerState` import). Fixed. Re-run: **TYPECHECK OK**.
- `npx vite build` — success: 30.88 kB JS (10.74 kB gzip), 23 modules.

## step 7: headless verification

`scripts/verify.mjs` runs the real compiled game code in Node. All 12 groups
pass:

1. RNG: same seed → same 1000-value stream; different seed → different;
   values in [0,1).
2. Deterministic replay: two scripted 8000-step runs at seed 12345 are
   bit-identical (both ended DEAD @ 2546 px after 6 obstacles).
3. Seed 999 → different obstacle sequence; spawn x strictly increasing.
4. Physics: one-step integration matches `vy=g·dt, y=g·dt²`; fall clamps at
   `maxFallSpeed`; held thrust nets upward and clamps at `maxRiseSpeed`;
   identical fixed steps → identical state.
5. AABB: partial overlap hits; edge-touch does not.
6. Prediction: released branch falls, held branch rises; reachable band
   ordered and corridor-bounded.
7. Validator: with `spawnAheadDistance=500` at 1200 px/s the validator logs
   `reaction 0.37s < min 0.80s` rejections, as designed.

## step 8: dev server smoke test

- Started `vite --port 5199`, curled `/` (200), `/src/main.ts` (transformed,
  `.js` imports rewritten to `.ts`), `/src/config/gameplayConfig.js` and
  `/src/game/Game.js` (both 200). Server stopped after the check.

## step 9: documentation

- `MECHANICS.md` — full junior-programmer walkthrough: loop, physics,
  gravity, thrust, integration, dt, fixed timestep, world scrolling,
  collision, spawning, seeded RNG, difficulty, reaction time, trajectory
  prediction, validator, tunables table, Godot/Unity translation table,
  13 experiments, and the physics-question FAQ the lab is built to answer.
- `DEVLOG.md` — this file.

## known limitations

- Validator is single-obstacle only (chains can still be jointly impossible);
  MOVING hazards validated at worst-case extent (conservative).
- `predictedHit` assumes constant world speed over the prediction window.
- Collision is discrete (not swept) by design. Tunneling is reachable via
  extreme settings as a teaching tool (Experiment 4).
