/**
 * browser entry point for input, fixed step timing, rendering, and the panel
 * gameplay code stays outside this file so it can run in Node verification
 */

import { CANVAS_HEIGHT, CANVAS_WIDTH, defaultConfig } from "./config/gameplayConfig.js";
import { Game, GameState } from "./game/Game.js";
import { DebugPanel, type LoopControl } from "./debug/DebugPanel.js";
import { DebugRenderer } from "./debug/DebugRenderer.js";
import { Telemetry } from "./debug/Telemetry.js";

const canvas = document.getElementById("game") as HTMLCanvasElement;
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;
const ctx = canvas.getContext("2d")!;

const cfg = defaultConfig();
const game = new Game(cfg);
const telemetry = new Telemetry();
const renderer = new DebugRenderer(game, telemetry);

const loop: LoopControl = { timeScale: 1 };
const panelRoot = document.getElementById("panel") as HTMLElement;
const panel = new DebugPanel(panelRoot, game, loop);

// all browser input writes to the same one button state

function isTypingTarget(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
}

window.addEventListener("keydown", (e) => {
  if (isTypingTarget(e)) return;

  switch (e.code) {
    case "Space":
      e.preventDefault(); // space controls thrust instead of page scroll
      game.input.press();
      break;
    case "KeyP":
      game.togglePause();
      break;
    case "Period":
      game.stepOnce();
      break;
    case "KeyR":
      game.restart(game.cfg.seed);
      telemetry.clear();
      panel.refreshInputs();
      break;
    case "F1":
      e.preventDefault();
      game.debug.overlay = !game.debug.overlay;
      break;
    case "F2":
      e.preventDefault();
      game.debug.colliders = !game.debug.colliders;
      break;
    case "F3":
      e.preventDefault();
      game.debug.vectors = !game.debug.vectors;
      break;
    case "F4":
      e.preventDefault();
      game.debug.trajectory = !game.debug.trajectory;
      break;
    case "F5":
      e.preventDefault(); // F5 belongs to telemetry in this lab
      game.debug.telemetry = !game.debug.telemetry;
      break;
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "Space") game.input.release();
});

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  game.input.press();
});
canvas.addEventListener("pointerup", () => game.input.release());
canvas.addEventListener("pointercancel", () => game.input.release());

// rendering uses frame time while simulation only receives fixed dt

let last = performance.now();
let acc = 0;
let fps = 60;
let frameDt = 1 / 60;

// the cap drops old time when the machine cannot catch up
const MAX_STEPS_PER_FRAME = 480;

function frame(now: number): void {
  const rawDt = Math.min((now - last) / 1000, 0.25); // do not replay a long tab switch
  last = now;
  frameDt = rawDt;
  if (rawDt > 0) fps = fps * 0.92 + (1 / rawDt) * 0.08; // smooth display only

  acc += rawDt * loop.timeScale;

  const dt = cfg.fixedDt;
  let steps = 0;
  while (acc >= dt && steps < MAX_STEPS_PER_FRAME) {
    const wasRunning = game.state === GameState.RUNNING || game.state === GameState.READY;
    game.step(dt);
    if (wasRunning && game.state === GameState.RUNNING) telemetry.sample(game);
    acc -= dt;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) acc = 0;

  renderer.render(ctx, { fps, frameDt });
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// status text does not need the render rate
setInterval(() => panel.tick(), 200);
panel.tick();
