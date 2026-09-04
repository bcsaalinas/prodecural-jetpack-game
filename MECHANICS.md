# mechanics

This is the math guide for the lab. It uses the same equations as the code.
Read `ARCHITECTURE.md` first if you want the file and system map.

**Coordinate convention:** y points down. Gravity is positive and thrust
acceleration is negative. Up means a smaller y value.

**Units:** seconds and pixels. `vy = 900` means 900 px/s downward.

---

## 1. Main game loop

Lives in `src/main.ts`. Shape:

```
requestAnimationFrame(frame)
  rawDt = clamp(now - last, 0, 0.25s)     // wall-clock time since last frame
  acc  += rawDt * timeScale               // timeScale = 0.1x..2x sim speed
  while (acc >= fixedDt):                 // fixedDt default 1/60 s
      game.step(fixedDt)                  // physics ALWAYS in equal chunks
      telemetry.sample(game)
      acc -= fixedDt
  renderer.render(ctx, stats)             // render once, independently
```

Two clocks exist on purpose:

- **Frame dt:** noisy and machine-dependent (60 Hz, 120 Hz, hitches, background
  tabs). Used only to feed the accumulator and to display FPS.
- **Fixed dt:** a constant (`cfg.fixedDt`). Physics only advances in
  exactly this increment. See §7 for why.

Each `game.step(dt)` runs, in order (`src/game/Game.ts`):

1. input timers update, read `thrustHeld`
2. difficulty ← `computeDifficulty(distance)`, world speed ← curve
3. player physics (integrate + corridor clamp)
4. world scroll: `camera.x += worldSpeed * dt`
5. spawn due obstacles, despawn passed ones
6. AABB collision vs hazards → possibly DEAD

Rendering happens after all steps, once per frame, and never mutates state.

## 2. Player physics

`src/game/Player.ts` + `src/game/Physics.ts`. The player is a vertical
1-dimensional dynamical system with state `(y, vy)`:

```
a  = gravity + (held ? thrustAcceleration : 0)     // forces summed first
vy = clamp(vy + a*dt, maxRiseSpeed, maxFallSpeed)  // velocity integrated
y  = y + vy*dt                                     // position from NEW velocity
```

There is no horizontal player physics. See section 8.

**Why model velocity instead of moving by N px/frame?** Velocity is memory.
When you release the button, `vy` keeps its current (negative = upward) value
and gravity must bleed it to zero before you descend. That lag is what makes
a jetpack feel like it has inertia rather than feeling like an elevator.

## 3. Gravity

A constant acceleration, `cfg.gravity` (default **1450 px/s²**), added to
`vy` every step whether or not you thrust. It never stops acting while you
thrust. Thrust is *added to* gravity, not used as a replacement. Holding does
not pin the player at a fixed rise speed. Acceleration continues until
the `maxRiseSpeed` clamp catches you.

## 4. Jetpack thrust

`cfg.thrustAcceleration` (default **−2600 px/s²**), applied only while the
input is held. Net acceleration while held:

```
a_held = 1450 + (−2600) = −1150 px/s²   (upward)
```

Two derived quantities explain most of the feel:

- **Duty cycle** = gravity / |thrust| = 1450/2600 ≈ **0.56**. To hover on
  average you must hold ~56% of the time. If |thrust| ≤ gravity, hovering is
  impossible. Input can only slow the fall.
- **Responsiveness** = how fast vy can change = the magnitudes of the
  accelerations. Doubling gravity AND thrust keeps the same duty cycle and
  roughly the same envelope, but direction reversals happen twice as fast
  (see Experiment 2).

Thrust startup/cutoff is intentionally *not* scripted: the apparent "spool
up" is just `vy` being large and needing time to reverse.

## 5. Velocity integration

We use **semi-implicit (symplectic) Euler**: update velocity first, then
advance position with the *new* velocity. Explicit Euler (old velocity into
position) systematically adds energy to oscillating systems; over thousands of
steps a hover would drift. Semi-implicit Euler is stable, free, and is what
most engine integrators resemble for simple bodies.

Integration error is proportional to `dt`, which is one reason `dt` is fixed
(§7): the feel never changes because the frame rate changed.

## 6. Delta time

`dt` converts *rates* into *amounts*: `vy += a*dt`, `y += vy*dt`. Without it,
"gravity per frame" would mean different things at 30 Hz and 144 Hz. The
game would literally run at different speeds on different machines. Every
integration in this project is multiplied by `dt`, and every dt that reaches
physics is the same fixed constant.

## 7. Fixed timestep

Physics runs at a fixed `1/60 s` inside an accumulator; rendering is free to
happen at any rate. Reasons:

1. **Determinism.** Same seed + same step count = identical run, everywhere.
   (Verified headlessly in `scripts/verify.mjs`.)
2. **Stability.** Collision quality and integration error become constants of
   the build, not functions of the machine. A slow frame just means "render
   fewer times between steps", never "take a giant risky step".
3. **Tunable feel.** The physics tick rate is a design dial: try the
   `fixed timestep` slider at 20 Hz to feel everything get crunchy.

The loop clamps frame dt to 0.25 s (tab-switch protection) and caps steps per
frame (480) so a stalled machine drops time instead of piling up work. This is
classic "spiral of death" guard.

## 8. World scrolling (camera model)

`src/game/Camera.ts`. The player never moves horizontally. Instead:

- `camera.x` = distance traveled, increasing at `worldSpeed` px/s.
- Obstacles store a **fixed world x**; their screen x is `worldX − camera.x`.
- The player is pinned at `cfg.playerScreenX` on screen.

Why this is the standard endless-runner architecture:

- "Scroll speed" becomes one explicit number the difficulty curve owns,
  instead of being entangled with player velocity.
- Player physics stay 1-D, so the values are easy to inspect and tune.
- Obstacle coordinates never change after spawn: no accumulation of
  per-object integration error, and the level is a clean function of the seed.
- Reaction time falls out of the geometry directly (§13).

Conceptual translation: screen space vs world space differ by exactly the
camera offset. In an engine with a real camera node you would move player and
camera through world space instead; the math relationships are identical.

## 9. Collision detection

`src/game/Collision.ts`. Everything solid is an axis-aligned rectangle
(AABB): player, obstacle parts, floor, ceiling.

- **Broad phase:** obstacles are kept roughly sorted by world x; we skip any
  whose x-range cannot touch the player (typically 0 to 2 candidates remain).
  With fewer than 20 live obstacles a linear scan is already enough.
- **Narrow phase:** the AABB overlap test *is* the final collision test:
  `a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y`.
  Note the strict inequalities: touching edges do not count as overlapping.
- **Floor/ceiling** use a different, simpler response: clamp position and
  zero the velocity component pointing into the surface (no bounce).

**Tunneling.** A discrete step moves the player at most
`maxFallSpeed * dt` = 900/60 ≈ **15 px**. This is less than the player height
and the thinnest obstacle (~40 px), so tunneling cannot occur at defaults.
Crank `max fall speed` up and `fixed timestep` to 50 ms and you *can* pass
through things. That is the demonstration. The robust production fix is swept
(continuous) collision; the lab keeps discrete collision so the trade-off is
visible.

## 10. Obstacle spawning

`src/game/Spawner.ts`. Spawning is scheduled on a **distance timeline**, not
a timer: `nextSpawnX` is a world position; when the camera comes within
`spawnAheadDistance` of it, the obstacle is generated and the next position
is drawn:

```
nextSpawnX += spacingAt(difficulty, rng)    // spacing in PIXELS
```

Spacing in pixels (not seconds) is deliberate: density-in-pixels is what the
player experiences; seconds would couple density to the current speed.

Obstacle vocabulary (design archetypes, all grey boxes):

| type | forces the player to… |
|---|---|
| `GATE` | thread a vertical opening (precision slot) |
| `BLOCK_TOP` | fly *under* (dive) |
| `BLOCK_BOTTOM` | fly *over* (climb) |
| `FLOATING` | choose over or under (decision) |
| `MOVING` | time a vertical oscillator (appears at difficulty > 0.1) |

Type is a weighted draw (GATE 3 : TOP 2 : BOTTOM 2 : FLOATING 1.5 : MOVING 1);
gap size, block height, position, phase all come from the seeded stream.
The generation function consumes random draws in a fixed order per obstacle,
which keeps the stream aligned run-over-run.

## 11. Seeded randomness

`src/game/Random.ts` uses mulberry32, a 32-bit PRNG. `Math.random()` is called
*only* when you press "Restart RANDOM seed" (to pick the seed, never to
generate). Everything else flows from one seeded stream created at run start.

Consequences:

- seed `12345` + same config ⇒ bit-identical level on any machine, forever
- bugs are reproducible: "obstacle #7 is unfair" is a shareable statement
- physics A/B tests are fair: same level, different gravity
- the headless verifier asserts replay determinism

## 12. Difficulty progression

`src/game/Difficulty.ts`. A scalar in [0,1] driven by distance only:

```
difficulty = clamp(distance / difficultyDistance, 0, 1)
```

Everything else is a lerp on that scalar:

```
worldSpeed = lerp(worldStartSpeed, worldMaxSpeed, difficulty)   // ramps up
spacing    = lerp(maxSpacing,      minSpacing,    difficulty)   // tighter
opening    = lerp(openingMax,      openingMin,    difficulty)   // narrower
moverSpeed = movingHazardSpeed * (1 + difficulty)               // faster
```

Distance-driven (not time-driven) so parking on the floor or pausing never
advances difficulty, and slow motion does not warp the ramp. The spawner
evaluates difficulty at an obstacle world position, so obstacle tightness is
fixed by location. Frame timing cannot change it.

## 13. Reaction-time calculation

For an obstacle whose front edge is `D` px from the player:

```
reactionTime = D / worldSpeed
```

This is the number that connects speed to fairness. Examples at defaults:

- spawn horizon 1300 px at 320 px/s → ~4.1 s of warning at spawn
- at max speed 760 px/s the same 1300 px is ~1.7 s
- spacing 260 px at 760 px/s → a new decision every ~0.34 s

The HUD shows live distance + time for the nearest obstacle; each obstacle
also remembers the reaction window it had *at spawn* (shown on death). The
validator rejects obstacles whose spawn-time window is below
`minReactionTime` (default 0.8 s, near the floor of human visual reaction
plus input latency).

## 14. Trajectory prediction

`src/game/Trajectory.ts` + `src/debug/TrajectoryPredictor.ts` (F4).

The player `(y, vy)` values are **copied** and stepped forward with the same
integrator and the same corridor clamps, once with input held and once
released. Predicted points are drawn at `x = playerScreenX + worldSpeed*t`:
the x axis is *future world progress*, so the curve reads as "your path
through the approaching obstacles". A red ✕ marks where the current input
branch would first intersect a hazard (assuming constant speed).

Because thrust enters the dynamics additively, holding maximizes upward
velocity at *every* instant. The held and released pair are not just two
guesses, they are the exact **upper and lower bounds** of every reachable
position. That fact is what makes the validator (§15) sound.

## 15. Impossible-obstacle validation

`src/game/Validator.ts` runs at spawn time. The question is: *from the current
player state, does any input sequence survive this obstacle?*

1. `t = distance / worldSpeed`; reject if `t < minReactionTime`.
2. Compute the reachable vertical band `[minY, maxY]` at time `t`
   (full thrust and zero thrust endpoints, exact per section 14).
3. The obstacle is passable iff the band overlaps at least one safe
   top-y interval: inside the gap for a GATE, below the block for
   BLOCK_TOP, above for BLOCK_BOTTOM, either side for FLOATING/MOVING.

Limitations are deliberate because this is a teaching system. Obstacles are
validated one at a time (a chain of individually-possible obstacles can still
be jointly impossible); MOVING hazards are checked against worst-case extent
(conservative). Rejected obstacles are drawn red, labeled with the reason,
and logged in the panel. They are not removed because *watching generation
fail* is the lesson.

## 16. Important tunable constants

All in `src/config/gameplayConfig.ts`, all live-editable in the panel.

| knob | default | mathematically meaningful? |
|---|---|---|
| `gravity` | 1450 | core dynamic, sets the time scale |
| `thrustAcceleration` | −2600 | core dynamic, sets duty cycle and response with gravity |
| `maxRiseSpeed` / `maxFallSpeed` | −620 / 900 | hard design guarantees: worst-case vertical speeds |
| `linearDamping` | 0 | optional self-stabilizing hover; pure game feel |
| `startVelocityY` | 0 | cosmetic |
| `fixedDt` | 1/60 s | simulation fidelity/stability budget |
| `worldStartSpeed` / `worldMaxSpeed` | 320 / 760 | reaction-time budget, with spacing |
| `difficultyDistance` | 12000 | ramp length of the whole run |
| `spawnAheadDistance` | 1300 | off-screen warning buffer |
| `minSpacing` / `maxSpacing` | 260 / 620 | decision density |
| `openingMin` / `openingMax` | 150 / 260 | required precision (player is 44 px tall) |
| `minReactionTime` | 0.8 s | fairness floor enforced by the validator |

Rule of thumb: accelerations and clamps are *physics*; spacing/openings are
*level design*; damping and start velocity are *feel*.

## 17. Translating to a real engine

Concept → Godot 4 → Unity mapping. The *equations* transfer; only the plumbing changes.

| here | Godot 4 | Unity |
|---|---|---|
| `vy += a*dt; y += vy*dt` in a fixed step | `CharacterBody2D.velocity.y += g*delta` in `_physics_process`, then `move_and_slide()` | `Rigidbody2D` + `AddForce`/`velocity` writes inside `FixedUpdate` |
| fixed timestep + accumulator | built-in: `_physics_process` runs at ProjectSettings physics tick rate (default 60 Hz) | built-in: `FixedUpdate` at `Time.fixedDeltaTime` (default 0.02 s) |
| world scrolls past a pinned player | either move a `Camera2D` + real bodies, or keep this exact "world moves" trick with a root `Node2D` offset | same choice: moving `Camera` + rigidbody, or scroll a parent transform |
| AABB + manual overlap | `RectangleShape2D` on `Area2D`/`CharacterBody2D`, engine broad phase | `BoxCollider2D` + `Rigidbody2D`, engine broad phase |
| floor/ceiling clamp | `move_and_slide` + `is_on_floor()/is_on_ceiling()` | collision callbacks or `Physics2D.Raycast` |
| seeded RNG | `RandomNumberGenerator.seed` | `UnityEngine.Random.InitState` or `System.Random` |
| difficulty lerp curve | same function; or an `AnimationCurve`/`Curve` resource | same function; or an `AnimationCurve` |
| trajectory prediction | copy state and loop the same function, or duplicate the body in a hidden `PhysicsServer` scene | copy state and integrate manually (never simulate the live scene) |
| telemetry graphs | draw on a `Control` with `_draw()` | `OnGUI`, `Gizmos`, or a UI canvas |

The deep lesson: nothing in this lab is browser-specific. Forces →
acceleration → velocity → position, fixed ticks, seeded generation, and
distance-based difficulty are engine-independent decisions.

---

## Experiments to Try

Run each by editing sliders live. Press **R** to replay the same seed after
each change so the level is held constant (fair comparison).

1. **Double gravity only.** Set gravity 1450 → 2900, leave thrust −2600.
   Net upward accel is now only −300 px/s². Observe: hover requires almost
   constant holding (duty cycle 2900/2600 > 1 → *hovering is impossible*,
   you can only slow the fall). This is why |thrust| must exceed gravity.

2. **Double both.** gravity 2900, thrust −5200. Duty cycle back to 0.56 and
   the envelope looks similar to Balanced, but vy reverses twice as fast.
   Use F5 telemetry: the vy slope doubles. This is why "high gravity + high
   thrust" feels *responsive* while "low + low" feels like steering a blimp.

3. **Speed vs. spacing.** worldStartSpeed 320 → 640 with spacing unchanged.
   Watch per-obstacle `T` (time-to-player) halve. Same level and controls, but
   difficulty doubled purely by removing *time*. Reaction time, not distance,
   is the currency of difficulty.

4. **Coarse timestep.** `fixed timestep` slider to 50 ms (20 Hz). Watch the
   trajectory preview (F4) get visibly jagged and feel inputs quantize. With
   max fall speed raised (~1500+), you can tunnel through 40 px movers.
   This is why physics uses a fixed, small dt.

5. **Velocity clamps as skill cap.** Lower `max rise speed` to −200.
   Ascent becomes a slow capped crawl: opening size now matters far less than
   *lead time*. Clamps, not accelerations, define the worst cases a level
   designer must leave room for.

6. **Damping.** `linear damping` 0 → 1.5. The hover becomes self-stabilizing
   (vy bleeds off by itself) at the cost of mushy response. Feel how an
   invisible force can replace player skill. Set it back to 0.

7. **Spawn horizon = fairness.** `spawn ahead dist` 1300 → 600 at high speed.
   The validator starts rejecting obstacles (`reaction < 0.8 s`, red boxes).
   The panel validator log shows which guarantee broke.

8. **Impossible gaps.** `opening min` 150 → 80. At high difficulty, GATEs go
   red: the reachable band can no longer fit an 80 px slot from arbitrary
   approach states. This shows the fair minimum gap for
   these physics (player height 44 + maneuver margin).

9. **Corridor squeeze.** Raise `floor height` to 150 and `ceiling height` to
   150. Same physics, but the reachable band (Trajectory.ts) is now clipped
   by the corridor. Watch validator rejections shift from "reaction" to
   "unreachable" reasons.

10. **Terminal velocity race.** `max fall speed` 900 → 1600 with default
    spacing. Falling between gates is now faster than the world scroll, so
    overshoot becomes the main failure mode. Watch the telemetry vy graph pin
    at the new clamp.

11. **Determinism audit.** Note obstacle #1's type and position with seed
    12345. Play, die, press R (same seed): identical sequence. Then "Restart
    RANDOM seed" twice. A new sequence appears each time. `npm run verify` checks
    this property headlessly.

12. **Trajectory trust.** Enable F4. Hold until the HOLD line rises above a
    gate gap, release, and watch the RELEASE line thread it. Then repeat
    while watching telemetry: correlate the drawn curve with the vy graph
    crossing zero at the arc apex.

13. **Slow-motion reaction study.** Set 0.25x and let the run reach high
    difficulty. Measure (with the on-obstacle `T` readouts) how much thinking
    time each decision actually needs; restore 1x and feel where that time
    went.

---

## Questions this lab is built to answer

- *Why does holding rise?* Net acceleration = gravity + thrust < 0 → vy
  integrates upward (§3–4).
- *What happens to vy on release?* Nothing changes instantly. Gravity starts
  bleeding it down at `gravity` px/s²; the apex happens when vy crosses 0.
- *When does thrust overcome gravity?* When |thrustAccel| > gravity; the
  margin is your net upward acceleration.
- *What sets direction-change speed?* The acceleration magnitudes, not the
  clamps (Experiment 2).
- *Why does high g + high thrust feel responsive?* Same envelope, double the
  |a| → vy reverses in half the time.
- *How do max velocities affect skill?* They cap correction speed; below the
  level demands, no amount of tapping can recover (Experiment 5, 10).
- *How does world speed change difficulty?* It divides the reaction window:
  `t = D / v` (§13, Experiment 3).
- *How to estimate reaction windows?* distance/speed, printed live on every
  obstacle.
- *How does spacing relate to acceleration?* Minimum survivable spacing ≈
  speed × time-to-reverse-direction. Shrinking spacing below the player
  reversal time creates guaranteed hits.
- *How to prevent impossible layouts?* Reachability validation at spawn (§15).
- *How does dt affect motion?* Integration error ∝ dt; fixed dt makes it a
  constant (§6–7, Experiment 4).
- *Why fixed timestep?* Determinism + stability + tunable feel (§7).
- *Why seeded generation?* Reproducibility for QA, tuning, and tests (§11).
