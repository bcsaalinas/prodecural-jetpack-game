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
| P | pause or resume |
| . | one fixed step |
| R | restart with the same seed |

The panel also has slow motion, simulation speed, presets, seed control, and
JSON config import and export.

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
  debug/
    DebugRenderer.ts    canvas debug layers
    DebugPanel.ts       live DOM controls
    Telemetry.ts        fixed step sample buffer
    TrajectoryPredictor.ts
                        screen projection and predicted hits
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
- every live gameplay value starts in `gameplayConfig.ts`

These rules are small on purpose. They make a run traceable from input to
render without hiding the useful math.
