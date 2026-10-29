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
baseSpacing = max(60, spacingAt(difficulty, rng))
recoveryAfter = obstacleId % 3 == 0 ? max(0, recoveryTime) : 0
nextSpawnX += baseSpacing + worldSpeedAt(difficulty) * recoveryAfter
```

Spacing in pixels (not seconds) is deliberate: density-in-pixels is what the
player experiences. The local recovery budget is deliberately in seconds,
converted to pixels using the speed scheduled at that obstacle's world position.

### Small pacing experiment: three challenges, then recovery

The GDD's local pacing and `LARGE_SPACING` recovery idea starts here with one
small rule: every third obstacle gets extra space after it. `recoveryTime`
defaults to **0.75 s**. At 320 px/s this adds 240 px; at 760 px/s it adds 570 px.
The player gets a regular opportunity to settle momentum and read the next
hazard while global difficulty continues to rise.

The debug label `RECOVERY after: +0.75s` records the extra spacing budget.
This is approximate extra travel time, not total safe time: obstacle width
uses some of the base interval, and speed can increase while crossing the gap.
This rule does not guarantee sequence reachability or implement the planned
grammar/search/agent system; obstacle types still use the baseline seeded draw.

Change **extra recovery time** under Obstacles while playing; it affects newly
scheduled spacing, leaving already generated world positions intact. Set it to
**0** and restart with seed **12345** for the previous rhythm, then repeat at
**0.75**. The first extended interval is between obstacles **#3 and #4**.
Restart resets the cadence. No additional RNG draws or live player state enter
the spacing rule, so identical seed/config still reproduce the same geometry
regardless of how many obstacles are generated in one update. Layouts from older
versions change when this new setting is enabled.

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

### Development candidate / agent inspector

Run `npm run dev` and open **Candidate lab · DEV** above the developer panel.
This tool is removed from production by Vite's `import.meta.env.DEV` branch;
it is loaded lazily and does no generation/testing until opened. Opening it
pauses an active run. Closing leaves that run paused for an explicit resume.

**Generate candidates** captures the current gameplay configuration and lab
seed. Six finite encounters appear immediately, before agent testing: three
authored movement phrases × two spacing/clearance alternatives. Each card shows
geometry and status; select it to inspect the derivation, world positions,
safe collider intervals, parameter choices, and construction check.
Open **Generation steps + concrete parameters** beneath the replay to view
the expansion trace and geometry table. New live physics edits apply only
after regeneration. Agent settings apply when a new
test is started; one-decision stepping continues the existing captured settings.

The first bounded grammar experiment uses:

```
<Encounter> → <Pattern> <Recovery> <Pattern>
CLIMB / DIVE → BLOCK_BOTTOM GATE LARGE_SPACING BLOCK_TOP
DIVE / CLIMB → BLOCK_TOP GATE LARGE_SPACING BLOCK_BOTTOM
PRECISION / REVERSAL → GATE GATE LARGE_SPACING GATE
spacing ∈ {maxSpacing × 0.9, maxSpacing × 1.1}
extra recovery distance = worldStartSpeed × recoveryTime
clearance ∈ {20, 40}px
target offset ∈ {-0.05, 0, +0.05} of available vertical travel
```

Each candidate gets a seed stream derived from master seed and its stable index.
Targets guide a simple construction controller:
`HOLD when y + vy × 0.22 > targetY`, otherwise RELEASE. It runs the actual
`Player.update` integrator and corridor response. For each obstacle, all frames
where player and obstacle overlap horizontally define an envelope:
`gapTop = min(playerY) - clearance` and
`gapBottom = max(playerY + playerHeight) + clearance`, clipped to the corridor.
The appropriate solids are built outside that envelope. The resulting recorded
control path is replayed through actual collision detection before marking the
candidate construction-checked. Empty solids or a colliding witness are rejected
and remain visible. Thus the opening can widen to fit the construction path;
`openingMin/Max` are not used in this initial experiment. This proves a path
for one reset entry state in the discrete simulation, not for arbitrary entries
or encounter-to-encounter boundaries. The lab rejects horizontal steps large
enough to skip an entire collider, but still shares the game's discrete AABB
limitations. Speed stays at the captured `worldStartSpeed`; difficulty is frozen.

**Test all candidates** or **Test selected candidate** runs an independent
receding-horizon beam-search agent. Each decision observes current position,
velocity, and solids visible within the game's 960px viewport. It expands HOLD
and RELEASE actions using the real simulation, removes colliding branches, and
keeps the lowest-cost beam with stable tie-breaking. The heuristic is squared
distance from the next visible safe interval center using `y + vy × 0.15`, plus
a small control-switch cost. It executes only the first action and replans.
Default budget: beam 8, horizon 8 actions, action interval 0.1s (rounded to fixed
steps). The agent never receives construction controls or target fractions.
No visible obstacle means it aims at the corridor center. Failure under this
bounded planner is a performance result, not proof of impossibility.

The inspector shows completion/progress, collision ID, control switches, vertical
travel, and minimum vertical clearance while horizontally crossing obstacle
solids. A timeline shows HOLD in green and RELEASE in gray. **Agent: one
decision** advances the actual controller; **Replay: one frame** only advances
through its saved fixed-step frames. Play/pause, scrubbing, and witness visibility
make it possible to compare construction and agent trajectories. Each replay
frame includes the decision's visible obstacles, rollout count, collided
branches, and predicted cost. `PREFIX_ONLY` means the full planning horizon
had no surviving branch but a shorter prefix did. `NO_SAFE_ACTION` means neither
first-action branch survived; the controller records RELEASE as its fallback
and the actual collision ends the test, with no fabricated prediction score.
**Prepare JSON** exports seed, config, derivation,
concrete geometry, witness, agent settings, decisions, and replay frames.

This inspector is a development harness for watching one agent decision at a
time. The runtime generator that actually searches, ranks and schedules
encounters is described in §18–§27 below; it reuses the same headless
simulation and the same agent code.

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
| `encounterMode` | 1 | 0 = weighted v0.1 spawner, 1 = encounter search (§24) |
| `searchPopulation` × `searchGenerations` | 8 × 3 | fixed evaluation budget per encounter |
| `searchElites` | 2 | feasible genomes copied unchanged each generation |
| `entryStateCount` / `entryCoverage` | 5 / 0.8 | incoming states tested, fraction that must have a safe path |
| `feasibilityInterval` | 0.1 s | control quantum of the feasibility search = minimum control duration |
| `feasibilityMaxStates` | 120 | merged states kept per layer; bounds feasibility work |
| `minObstacleGapTime` | 0.3 s | minimum warning between fronts inside an encounter |
| `minClearance` / `tightClearance` | 10 / 24 px | witness gate / pressure threshold |
| `searchFrameBudgetMs` | 6 ms | wall time per frame for search; latency only |

Rule of thumb: accelerations and clamps are *physics*; spacing/openings are
*level design*; damping and start velocity are *feel*; the search knobs are
*budget and fairness policy*.

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

## 18. Encounter genomes and legal bounds

`src/game/procedural/EncounterGenome.ts`. The search unit is an **encounter**:
two to four obstacles that are evaluated and committed together. Its genome is
a list of genes:

```
ObstacleGene {
  type        GATE | BLOCK_TOP | BLOCK_BOTTOM | FLOATING | MOVING
  demand      CLIMB | DIVE | PRECISION | CHOICE | TIMING | RECOVERY | NEUTRAL   (derived)
  spacing     px from the previous obstacle front (unused on the first gene)
  center      corridor fraction 0..1 of the gap or body centre
  opening     corridor fraction left free (gate gap, or the open side of a block)
  size        corridor fraction of a floating / moving body
  moverSpeed, moverAmplitude, moverPhase
}
```

Fractions instead of pixels keep a genome meaningful when the corridor or the
player size change. `legalBounds(cfg, world)` is the search space: spacing
`[0.6 × minSpacing, 1.5 × maxSpacing]`, openings no smaller than
`(playerHeight + 2 × minClearance) / corridor`, lengths 2–4, mover periods
readable. `initRanges` is the narrower difficulty-controlled slice used only for
initial candidates:

```
d_eff       = difficulty × phase.budgetScale
spacingBase = lerp(maxSpacing, minSpacing, d_eff) × phase.spacingScale
gateBase    = lerp(openingMax, openingMin, d_eff) / corridor × phase.openingScale
```

Mutation picks one operator per child: `SHIFT_CENTER`, `CHANGE_SPACING`,
`CHANGE_OPENING`, `CHANGE_SIZE`, `MOVER_TIMING`, `SWITCH_TYPE`, `INSERT`,
`REMOVE`, `SWAP`. Crossover splices a prefix of one parent with a suffix of
another. Every result passes `repairGenome`, which clamps each field to the
legal bounds and recomputes the demand, so an operator can never produce
illegal geometry; the verifier checks 960 mutations stay inside the bounds.

`realizeGenome` turns genes into `Obstacle` objects with the same part
conventions as the weighted spawner, so collision and drawing are unchanged.

`cheapConstraints` rejects before any simulation, with a reason: length,
free space `< playerHeight + 2 × minClearance`, warning time
`spacing / speed < minObstacleGapTime`, movers in phases that forbid them,
unreadable mover periods, and a third consecutive PRECISION or TIMING
encounter.

## 19. Hierarchical deterministic seeds

`src/game/procedural/RandomStreams.ts`. One sequential stream is ideal while
nothing is ever regenerated. Once a validator can reject and resample, a single
stream makes every later encounter shift because one encounter consumed extra
draws. The search therefore derives streams by hashing:

```
encounterSeed(master, i)        = hash32(hash32(master, tag), i)
genomeSeed(encounter, gen, slot) = hash32(hash32(encounter, tag + gen), slot)
```

`hash32` is the murmur3 finaliser over two inputs. Consequences: encounter 20
never changes because encounter 4 needed a retry; `masterSeed + encounterIndex`
reproduces one encounter in isolation; a test can target a single broken
encounter. The agent itself uses no randomness at all.

## 20. Local pacing: WARMUP → BUILD → PEAK → RECOVERY

`src/game/procedural/Pacing.ts`. Global difficulty (§12) stays the budget;
pacing phases decide how much of it each encounter spends and what the agent
measurements should look like:

| phase | budget | completion targets S / I / N | switches/s | pressure | moving | gap after |
|---|---|---|---|---|---|---|
| WARMUP (encounter 0) | 0.5 | 1.0 / 1.0 / 0.8 | 0.4–2.5 | 0–0.15 | no | 1.2 s |
| BUILD | 0.85 | 1.0 / 0.8 / 0.6 | 1.2–4.0 | 0.08–0.4 | d > 0.1 | 0.9 s |
| PEAK | 1.0 | 0.8 / 0.6 / 0.2 | 2.0–6.0 | 0.2–0.7 | d > 0.1 | 0.8 s |
| RECOVERY | 0.4 | 1.0 / 1.0 / 1.0 | 0–2.0 | 0–0.1 | no | 1.3 s |

`phaseForEncounter(i)`: index 0 is WARMUP, then BUILD, PEAK, RECOVERY repeat.
These are initial illustrative settings for five entry states; they change only
after playtests. PEAK's low novice target can never override a feasibility
gate, because gates run before fitness.

## 21. Whole-sequence feasibility and entry states

`src/game/procedural/SequenceValidator.ts`. The single-obstacle validator (§15)
remains a cheap prefilter. Velocity carries through a sequence, so two gates
that are each reachable can be jointly impossible. The sequence check asks:
*from a plausible incoming state, does any HOLD/RELEASE path survive every
obstacle plus the exit buffer?*

```
layer = { entry state }
repeat until the encounter window ends:
    for each state, for HOLD and RELEASE:
        clone, advance `feasibilityInterval` of fixed steps, drop on collision
        merge states whose (round(y/4), round(vy/20)) bin repeats, keeping the safest
    cap the layer at feasibilityMaxStates (flagged)
no survivors → infeasible, with the reason
else        → rebuild the input sequence of the safest terminal and REPLAY it
              through the real collision test: the witness
```

The control interval is also the minimum control duration: a one-frame-perfect
path cannot pass. Entry states are **five fixed quantiles** of the previous
encounter's exit set (witness terminals plus completed agent rollouts), sorted
by projected altitude `y + vy × 0.25` so velocity counts; encounter 0 uses
centre / high / low / rising / falling. The same set is reused for every
candidate at that boundary, so no genome can win by a convenient start.

Gates, in order, each recorded with its reason: `CHEAP` (§18), `COVERAGE`
(fewer than `entryCoverage` of the entries have a path), `CLEARANCE` (the
safest witness passes closer than `minClearance`). The verifier contains two
gates 150 px apart at 760 px/s with centres at 20 % and 80 % of the corridor:
each passes §15 on its own, the pair is rejected as
`feasible from 0/5 entry states … no collision-free HOLD/RELEASE path`.

## 22. Skill profiles and difficulty measurement

`src/game/procedural/AgentController.ts`, documented in detail in `AGENT.md`.
Difficulty is inferred from how bounded planners perform, never from geometry.
One receding-horizon beam-search planner runs with three limits:

| profile | beam | horizon | action | reaction delay |
|---|---|---|---|---|
| strong | 8 | 10 × 0.12 s | 0.12 s | 0 |
| intermediate | 4 | 6 × 0.16 s | 0.16 s | 0.12 s |
| novice | 2 | 4 × 0.20 s | 0.20 s | 0.25 s |

A delayed profile plans against the obstacles that were visible
`reactionDelay` seconds ago; its physics still run at full rate. Each profile
flies every entry state: 3 × 5 = 15 rollouts per candidate. From them
(`Fitness.measure`):

```
completion[p] = completed rollouts / entry states           (steps of 0.2)
switchRate    = HOLD/RELEASE switches per second            (strong, successful)
pressure      = fraction of crossing steps with clearance < tightClearance
settle        = 1 - |vy at exit| / maxFallSpeed
```

## 23. Fitness: difficulty, rhythm, novelty, readability

`src/game/procedural/Fitness.ts`, `DiversityArchive.ts`:

```
difficultyMatch = 1 - mean_p |completion[p] - target[p, phase]|
rhythmMatch     = mean(closeness(switchRate), closeness(pressure), closeness(settle))
novelty         = min over recent encounters of 0.7 × structural + 0.3 × behavioral distance
readability     = 0.5 × clamp(warningTime / (2 × minObstacleGapTime))
                + 0.5 × clamp(meanClearance / (4 × minClearance))
fitness         = 0.45 × difficultyMatch + 0.20 × rhythmMatch + 0.20 × novelty + 0.15 × readability
```

`closeness` is 1 inside the phase band and falls to 0 one band-width outside.
Structural distance compares types, lanes (H/M/L), spacing bins and demands
position by position; behavioral distance compares the strong agent's hold
fraction and switch rate. Readability is capped so an empty layout cannot keep
collecting it. All four terms are kept separately in the debug output.

## 24. Bounded evolutionary search

`src/game/procedural/SearchGenerator.ts`:

```
population[0] = motifs matching the phase (even slots) + random legal genomes (odd slots)
for generation in 0 .. G-1:
    for each genome:  cheap gate → feasibility from every entry → 15 rollouts → fitness
    elites  = best E feasible (distinct geometry), copied unchanged
    others  = tournament(3) parent → 25 % crossover with a second parent → mutate → repair
winner = feasible genome with the highest fitness; ties by generation then slot
if nothing is feasible: the verified safe fallback (two wide centred gates, widest spacing),
    evaluated through the same gates; if even that fails: an empty gap
```

Identical genomes (same `genomeKey`) reuse the cached evaluation. The budget is
fixed (`searchPopulation × searchGenerations`, default 24 evaluations), the
tie-breaks are deterministic and every stream is derived (§19), so the same
master seed, config and budget choose the same encounter. The strategy switch
in the panel replaces evolution with fresh random populations at the same
budget, which is the comparison the design document asks for (§27).

## 25. Runtime scheduling, determinism and the frame budget

`src/game/procedural/EncounterScheduler.ts`, called from `Spawner` when
`encounterMode = 1`. The scheduler searches encounters in order (each needs the
previous exits), keeps up to two finished encounters in a buffer, and commits
one when its start enters the spawn horizon. The game loop calls
`game.backgroundWork(searchFrameBudgetMs)` once per rendered frame; the search
is a generator that yields after every feasibility run and every rollout, so a
frame spends at most a few milliseconds plus one granule.

The simulation window of encounter *i* starts on a **real camera value**:
encounter 0 steps the live speed rule from `camera.x = 0` until
`startX - playerScreenX - 0.6 s × speed`, and each later window starts exactly
where the previous one ended. Because the headless simulation advances the
camera with the same rule as `Game.simulate`, every simulated camera value and
time is one the live game will actually produce, which is why moving hazards
(absolute time) line up. The verifier reproduces ~240 live steps exactly,
including a moving-hazard collision.

If the player reaches an encounter whose search is unfinished, the search is
**completed synchronously** and the hitch is logged (`sync finishes` in the
HUD). A timing-dependent fallback would make replays differ between machines;
a hitch does not. The verifier runs the same seed at 0.05 ms per frame and at an
infinite budget and asserts identical obstacles and death reports.

Measured on this machine: about 20 ms per candidate evaluation (≈170 000
fixed steps), 300–500 ms per encounter at the default budget, which the
default 6 ms frame budget delivers in 1–2 s of wall time while an encounter
takes 2–4 s to play.

## 26. Search inspection in the debug tools

- **F6** draws, per committed encounter: the start bracket with phase, global
  difficulty, candidate id, fitness and S/I/N completion; the five entry states;
  the dashed feasibility witness; the strong (cyan), intermediate (purple) and
  novice (orange) rollouts from the middle entry state, with ✕ at a crash.
- The HUD shows the active search (encounter, generation, evaluations, elapsed),
  buffer size, synchronous finishes, fallbacks, and the encounter the player is
  inside with its fitness breakdown.
- The panel section **Encounter search** holds the generator and strategy
  switches, the budget and gate sliders, and the last committed record: targets,
  winner origin and parents, the fitness equation with its numbers, measured
  completion / switch / pressure / settle against the bands, coverage, gate
  counts with example reasons, the winner's mutation history, the near winners
  and recent rejections, and the scheduler log. "Copy last encounter JSON"
  exports the whole record including witness and traces.
- The death report adds encounter index, phase, target, candidate id, fitness,
  fallback use and the reproduction recipe (seed + encounter index + config +
  budget).

## 27. Measured comparison: search vs random vs weighted

`npm run verify` prints Experiment B: three seeds × four encounters, evaluated
with the same feasibility gates, profiles and fitness. Columns: feasible rate
among evaluated candidates, mean target-difficulty error of the winners, mean
fitness, novelty, distinct phrases, fallbacks. At the default budget of 24
evaluations the evolutionary and random strategies land close to each other,
and both reach a lower target error than the weighted spawner's own
3-obstacle chunks. Read the table as a measurement, not a verdict: the budget
is small, the targets are uncalibrated, and the weighted spawner never aims at
a target at all. Raise `searchGenerations` and rerun to see where evolution
starts to pull ahead on this machine.

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

14. **Search vs random.** In the panel, switch Strategy to RANDOM, restart
    with seed 12345, and compare the fitness breakdowns of E1–E3 with the
    EVOLVE run. Then raise generations from 3 to 8 and repeat. The question is
    at which budget selection beats sampling, not whether it does in principle.

15. **Skill models.** Watch F6 on a PEAK encounter: the novice (orange) path
    often crashes where the strong (cyan) path threads through. Lower
    `min gap time` to 0.2 s and observe the novice completion target of 0.2
    being met by tighter spacing rather than smaller gaps.

16. **Entry coverage.** Set `entry coverage` to 1.0 and `entry states` to 5.
    COVERAGE rejections rise in the gate counts; the search spends its budget
    proving every arrival state. Lower coverage to 0.4 and see riskier
    encounters pass.

17. **Boundary conditions.** Pause (P) inside an encounter and look at the
    five green entry boxes at its start: they are the quantiles of where the
    agents left the previous encounter. A high-exit encounter followed by a
    low gate is where the sequence validator earns its keep.

18. **Budget and hitches.** Set `frame budget` to 0.5 ms and `population` to
    32. The HUD's `sync` counter climbs when the player outruns the search;
    the obstacles are still identical to a run at 16 ms (determinism), only the
    frame time changes.

19. **Fallback.** Raise `min gap time` to 5 s. Every candidate fails the cheap
    gate, then the fallback fails too, and the scheduler commits empty gaps
    labelled `EMPTY_GAP`. The run continues. Lower it to 2.6 s with population
    2 and generations 1 and some seeds commit the verified safe fallback
    instead.

20. **Weighted baseline.** Switch Generator to WEIGHTED with the same seed and
    compare the v0.1 sequence with the searched one: same physics, same seed
    family, different composition rules.

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
- *Why can individually fair obstacles form an unfair sequence?* Velocity is
  state; the reachable band after one obstacle is the entry set of the next
  (§21).
- *How is difficulty measured without a human?* Bounded planners with
  different limits fly every candidate from fixed entry states; their completion
  rates are compared with phase targets (§22–§23).
- *Why does search stay deterministic with a frame budget?* The budget only
  decides when a result arrives; inputs are captured at search start and every
  stream is derived from the seed (§19, §25).
