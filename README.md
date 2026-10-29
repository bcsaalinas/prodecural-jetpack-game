# jetpack mechanics lab

This is a browser lab for one button flight and endless runner math.

The project is a greybox tool. It is here to make physics, spawning, collision,
difficulty, and debug state easy to inspect. It does not try to copy the art,
branding, sound, or level content of another game.

## run it

```sh
npm install
npm run dev
```

Use `npm run build` for the production build and `npm run verify` for the
headless simulation checks.

## controls

| input | result |
|---|---|
| space, pointer, or touch held | thrust |
| release | gravity only |
| F1 | debug overlay |
| F2 | colliders |
| F3 | physics vectors |
| F4 | trajectory preview |
| F5 | telemetry graphs |
| F6 | encounter overlay: brackets, entry states, witness, agent traces |
| P | pause or resume |
| . | one fixed step |
| R | restart with the same seed |

The panel also has slow motion, simulation speed, presets, seed control, and
JSON config import and export.

## encounter search

By default obstacles arrive as **encounters** of two to four obstacles chosen
by agent-evaluated evolutionary search: candidates are generated from
motifs and random legal genomes, gated by a whole-sequence feasibility search
from five incoming states, flown by strong / intermediate / novice planners,
scored against the current pacing phase (WARMUP → BUILD → PEAK → RECOVERY),
and the best feasible one is committed ahead of the player. Searches run a
few milliseconds per frame; the result never depends on timing. The panel
section **Encounter search** switches back to the v0.1 weighted spawner,
swaps evolution for equal-budget random search, and shows why each winner was
chosen. `AGENT.md` explains the simulated player; `MECHANICS.md` §18–§27
has the equations.

During `npm run dev`, **Candidate lab · DEV** opens a separate generation and
agent inspector. View six grammar/parameter alternatives before testing, inspect
their construction witnesses, test with a bounded HOLD/RELEASE beam-search agent,
and step or replay the recorded path and input timeline. It snapshots live tuning
when generating and is excluded from production builds. This first experiment
does not yet feed the endless spawner or perform evolutionary selection; see
MECHANICS.md for the construction equations and limitations.

## source map

```text
src/
  config/
    gameplayConfig.ts   live tuning values and math helpers
    presets.ts          physics-only presets
  game/
    Game.ts             state machine and fixed step order
    Physics.ts          vertical integration
    Player.ts           player state and corridor contact
    Camera.ts           world to screen conversion
    World.ts            floor and ceiling geometry
    Obstacle.ts         obstacle data and screen rectangles
    Spawner.ts          seeded distance-based generation
    Difficulty.ts       distance curve and interpolated values
    Validator.ts        reaction and reachability checks
    Trajectory.ts       future simulation shared by debug and validation
    Collision.ts        manual AABB tests
    Input.ts            one button state and timers
    Random.ts           seeded random stream
    procedural/
      Encounter.ts      headless simulation (same step order and collision as Game)
      EncounterGenome.ts
                        genes, legal bounds, mutation, crossover, realization, cheap gates
      RandomStreams.ts  hash(master, encounter, generation, slot) seeds
      PatternLibrary.ts safe motifs and the verified fallback
      Pacing.ts         WARMUP / BUILD / PEAK / RECOVERY targets
      SequenceValidator.ts
                        entry states and whole-sequence feasibility with witnesses
      AgentController.ts
                        receding-horizon beam-search player, three skill profiles
      Fitness.ts        measurements and the fitness equation
      DiversityArchive.ts
                        novelty against recent encounters
      SearchGenerator.ts
                        bounded evolutionary search, resumable, deterministic
      EncounterScheduler.ts
                        searches ahead, buffers, commits into the world
      CandidateGenerator.ts
                        dev-only grammar alternatives for the Candidate lab
  debug/
    DebugRenderer.ts    canvas debug layers
    DebugPanel.ts       live DOM controls
    Telemetry.ts        fixed step sample buffer
    TrajectoryPredictor.ts
                        screen projection and predicted hits
    CandidateLab.ts     development-only generation, testing and replay inspector
  main.ts               browser input, accumulator, render loop
  style.css             greybox lab layout
```

The game and config folders do not use browser APIs. `scripts/verify.mjs`
compiles those folders and runs them in Node. This boundary keeps the core easy
to test and easier to move into an engine later.

## documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) explains ownership, dependencies,
  coordinates, state, and one simulation step.
- [MECHANICS.md](./MECHANICS.md) explains the math, tuning values, engine
  translation, and experiments.
- [AGENT.md](./AGENT.md) explains the simulated player that tests encounters,
  first in plain terms, then step by step.
- [TASK_LOG.md](./TASK_LOG.md) tracks the design-document milestones.
- [DEVLOG.md](./DEVLOG.md) records how the current version was built and
  checked.
- [AGENTS.md](./AGENTS.md) is the original project brief and implementation
  rules.

## main rules

- physics receives a fixed `dt`
- rendering does not write simulation state
- the player stays at one screen x
- obstacles keep fixed world x values
- one seeded random stream owns generation
- prediction reuses the same vertical integrator as live play
- the validator marks bad setups but does not rewrite the obstacle sequence
- a searched encounter is committed only after passing the feasibility gates
- search slices use wall time but never change the chosen encounter
- every live gameplay value starts in `gameplayConfig.ts`

These rules are small on purpose. They make a run traceable from input to
render without hiding the useful math.
