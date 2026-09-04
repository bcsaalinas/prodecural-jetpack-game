/**
 * DOM controls for the live gameplay config
 * sliders write through immediately and bulk changes refresh the input values
 */

import { defaultConfig, type GameplayConfig } from "../config/gameplayConfig.js";
import { PRESETS } from "../config/presets.js";
import { Game } from "../game/Game.js";

interface SliderDef {
  key: keyof GameplayConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  hint?: string;
}

const f0 = (v: number) => v.toFixed(0);
const f2 = (v: number) => v.toFixed(2);

const SECTIONS: Array<{ title: string; sliders: SliderDef[] }> = [
  {
    title: "Physics (feel)",
    sliders: [
      { key: "gravity", label: "gravity", min: 200, max: 4000, step: 10, format: f0, hint: "px/s^2 down" },
      { key: "thrustAcceleration", label: "thrust accel", min: -5000, max: -200, step: 10, format: f0, hint: "px/s^2 up (neg)" },
      { key: "maxRiseSpeed", label: "max rise speed", min: -1500, max: -50, step: 10, format: f0, hint: "clamp, neg" },
      { key: "maxFallSpeed", label: "max fall speed", min: 100, max: 2000, step: 10, format: f0, hint: "terminal velocity" },
      { key: "startVelocityY", label: "start vy", min: -600, max: 600, step: 10, format: f0 },
      { key: "linearDamping", label: "linear damping", min: 0, max: 3, step: 0.05, format: f2, hint: "1/s, 0 = off" },
    ],
  },
  {
    title: "Simulation",
    sliders: [
      {
        key: "fixedDt",
        label: "fixed timestep",
        min: 1 / 240,
        max: 1 / 20,
        step: 0.0005,
        format: (v) => `${(v * 1000).toFixed(1)}ms (${(1 / v).toFixed(0)}Hz)`,
        hint: "try 1/20 to feel instability",
      },
    ],
  },
  {
    title: "World & difficulty",
    sliders: [
      { key: "worldStartSpeed", label: "start speed", min: 50, max: 1200, step: 10, format: f0, hint: "px/s @ d=0" },
      { key: "worldMaxSpeed", label: "max speed", min: 50, max: 1600, step: 10, format: f0, hint: "px/s @ d=1" },
      { key: "difficultyDistance", label: "difficulty dist", min: 1000, max: 60000, step: 500, format: f0, hint: "px for d: 0->1" },
    ],
  },
  {
    title: "Player & corridor",
    sliders: [
      { key: "playerWidth", label: "player width", min: 10, max: 120, step: 1, format: f0 },
      { key: "playerHeight", label: "player height", min: 10, max: 160, step: 1, format: f0 },
      { key: "floorHeight", label: "floor height", min: 0, max: 200, step: 2, format: f0 },
      { key: "ceilingHeight", label: "ceiling height", min: 0, max: 200, step: 2, format: f0 },
      { key: "playerScreenX", label: "player screen X", min: 60, max: 600, step: 10, format: f0, hint: "pinned; world scrolls" },
    ],
  },
  {
    title: "Obstacles",
    sliders: [
      { key: "spawnAheadDistance", label: "spawn ahead dist", min: 500, max: 3000, step: 50, format: f0, hint: "reaction budget" },
      { key: "minSpacing", label: "min spacing", min: 80, max: 1200, step: 10, format: f0, hint: "@ d=1" },
      { key: "maxSpacing", label: "max spacing", min: 80, max: 1600, step: 10, format: f0, hint: "@ d=0" },
      { key: "openingMin", label: "opening min", min: 60, max: 600, step: 5, format: f0, hint: "gap @ d=1" },
      { key: "openingMax", label: "opening max", min: 60, max: 700, step: 5, format: f0, hint: "gap @ d=0" },
      { key: "obstacleWidth", label: "obstacle width", min: 10, max: 300, step: 5, format: f0 },
      { key: "movingHazardSpeed", label: "mover speed", min: 0, max: 300, step: 5, format: f0 },
      { key: "movingHazardAmplitude", label: "mover amplitude", min: 0, max: 250, step: 5, format: f0 },
      { key: "minReactionTime", label: "min reaction time", min: 0, max: 3, step: 0.05, format: f2, hint: "validator, s" },
    ],
  },
];

/** time scale shared with the loop in main */
export interface LoopControl {
  timeScale: number;
}

export class DebugPanel {
  private sliderInputs = new Map<keyof GameplayConfig, { input: HTMLInputElement; val: HTMLSpanElement; def: SliderDef }>();
  private statusEl!: HTMLDivElement;
  private presetInfoEl!: HTMLDivElement;
  private validatorEl!: HTMLDivElement;
  private jsonBox!: HTMLTextAreaElement;
  private seedInput!: HTMLInputElement;
  private speedButtons: Array<{ v: number; btn: HTMLButtonElement }> = [];

  constructor(
    private root: HTMLElement,
    private game: Game,
    private loop: LoopControl,
  ) {
    this.build();
    this.refreshInputs();
  }

  private build(): void {
    const h1 = document.createElement("h1");
    h1.textContent = "JETPACK MECHANICS LAB — dev panel";
    this.root.appendChild(h1);

    this.buildSimSection();
    for (const sec of SECTIONS) this.buildSliderSection(sec.title, sec.sliders);
    this.buildSeedSection();
    this.buildPresetSection();
    this.buildJsonSection();
    this.buildValidatorSection();
    this.buildShortcutsSection();
  }

  private section(title: string): HTMLElement {
    const s = document.createElement("section");
    const h = document.createElement("h2");
    h.textContent = title;
    s.appendChild(h);
    this.root.appendChild(s);
    return s;
  }

  private buildSimSection(): void {
    const s = this.section("Simulation control");
    const g = this.game;

    const row1 = this.btnRow(s);
    this.btn(row1, "Pause / Resume (P)", () => g.togglePause());
    this.btn(row1, "Step 1 frame (.)", () => g.stepOnce());
    this.btn(row1, "Restart same seed (R)", () => { g.restart(g.cfg.seed); this.refreshInputs(); });
    this.btn(row1, "Restart RANDOM seed", () => { g.restartWithRandomSeed(); this.refreshInputs(); });

    const row2 = this.btnRow(s);
    const speeds = [0.1, 0.25, 0.5, 1, 2];
    for (const v of speeds) {
      const b = this.btn(row2, `${v}x`, () => {
        this.loop.timeScale = v;
        this.markSpeedButtons();
      });
      this.speedButtons.push({ v, btn: b });
    }
    this.markSpeedButtons();
    const slow = document.createElement("div");
    slow.className = "status-line";
    slow.textContent = "slow motion = 0.1x–0.5x · speeds >1x stress-test the loop";
    s.appendChild(slow);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "status-line";
    s.appendChild(this.statusEl);
  }

  private buildSliderSection(title: string, defs: SliderDef[]): void {
    const s = this.section(title);
    for (const def of defs) {
      const row = document.createElement("div");
      row.className = "ctl-row";

      const label = document.createElement("label");
      label.textContent = def.label;
      if (def.hint) label.title = def.hint;

      const input = document.createElement("input");
      input.type = "range";
      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step);

      const val = document.createElement("span");
      val.className = "val";

      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        // the next fixed step reads this same config object
        (this.game.cfg[def.key] as number) = v;
        val.textContent = this.formatVal(def, v);
      });

      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(val);
      if (def.hint) {
        const hint = document.createElement("span");
        hint.className = "hint";
        hint.textContent = def.hint;
        row.appendChild(hint);
      }
      s.appendChild(row);
      this.sliderInputs.set(def.key, { input, val, def });
    }
  }

  private buildSeedSection(): void {
    const s = this.section("Deterministic seed");
    const row = document.createElement("div");
    row.className = "ctl-row";
    const label = document.createElement("label");
    label.textContent = "seed";
    this.seedInput = document.createElement("input");
    this.seedInput.type = "number";
    this.seedInput.step = "1";
    row.appendChild(label);
    row.appendChild(this.seedInput);
    this.btn(row, "Apply & restart", () => {
      const seed = (parseInt(this.seedInput.value, 10) || 0) >>> 0;
      this.game.restart(seed);
      this.refreshInputs();
    });
    s.appendChild(row);
    const note = document.createElement("div");
    note.className = "status-line";
    note.textContent = "Same seed + same config = identical obstacle sequence. R key = restart same seed.";
    s.appendChild(note);
  }

  private buildPresetSection(): void {
    const s = this.section("Physics presets");
    const row = this.btnRow(s);
    for (const name of Object.keys(PRESETS)) {
      this.btn(row, name, () => {
        const preset = PRESETS[name];
        const { _description, ...values } = preset;
        Object.assign(this.game.cfg, values);
        this.refreshInputs();
        this.presetInfoEl.textContent =
          `applied "${name}": ${values && JSON.stringify(values)}\n${_description ?? ""}`;
      });
    }
    this.presetInfoEl = document.createElement("div");
    this.presetInfoEl.className = "preset-json";
    this.presetInfoEl.textContent = "Presets only touch gravity / thrust / velocity clamps / damping.";
    s.appendChild(this.presetInfoEl);
  }

  private buildJsonSection(): void {
    const s = this.section("Config as JSON");
    this.jsonBox = document.createElement("textarea");
    this.jsonBox.spellcheck = false;
    s.appendChild(this.jsonBox);
    const row = this.btnRow(s);
    this.btn(row, "Copy current config", () => {
      this.jsonBox.value = JSON.stringify(this.game.cfg, null, 2);
      this.jsonBox.select();
    });
    this.btn(row, "Apply pasted JSON", () => {
      try {
        const parsed = JSON.parse(this.jsonBox.value);
        const defaults = defaultConfig();
        let applied = 0;
        for (const k of Object.keys(defaults) as Array<keyof GameplayConfig>) {
          const v = (parsed as Record<string, unknown>)[k];
          if (typeof v === "number" && Number.isFinite(v)) {
            (this.game.cfg[k] as number) = v;
            applied++;
          }
        }
        this.refreshInputs();
        this.presetInfoEl.textContent = `JSON applied: ${applied} keys (unknown/non-numeric keys ignored).`;
      } catch (err) {
        this.presetInfoEl.textContent = `JSON parse error: ${(err as Error).message}`;
      }
    });
    this.btn(row, "Reset defaults", () => {
      Object.assign(this.game.cfg, defaultConfig());
      this.refreshInputs();
    });
  }

  private buildValidatorSection(): void {
    const s = this.section("Impossible-obstacle validator");
    this.validatorEl = document.createElement("div");
    this.validatorEl.className = "status-line";
    s.appendChild(this.validatorEl);
  }

  private buildShortcutsSection(): void {
    const s = this.section("Shortcuts");
    const d = document.createElement("div");
    d.className = "status-line";
    d.innerHTML =
      "<b>Space / click / touch</b> thrust · <b>F1</b> overlay · <b>F2</b> colliders · " +
      "<b>F3</b> vectors · <b>F4</b> trajectory · <b>F5</b> telemetry · " +
      "<b>P</b> pause · <b>.</b> step frame · <b>R</b> restart same seed";
    s.appendChild(d);
  }

  /** sync controls after a bulk config change */
  refreshInputs(): void {
    for (const [key, ref] of this.sliderInputs) {
      const v = this.game.cfg[key] as number;
      ref.input.value = String(v);
      ref.val.textContent = this.formatVal(ref.def, v);
    }
    if (this.seedInput) this.seedInput.value = String(this.game.cfg.seed);
    this.markSpeedButtons();
  }

  /** refresh status text at the panel update rate */
  tick(): void {
    const g = this.game;
    this.statusEl.innerHTML =
      `state <b>${g.state}</b> · seed <b>${g.cfg.seed}</b> · timeScale <b>${this.loop.timeScale}x</b> · ` +
      `distance <b>${g.camera.x.toFixed(0)}px</b> · difficulty <b>${g.difficulty.toFixed(3)}</b>`;
    this.markSpeedButtons();

    const log = g.spawner.rejectedLog;
    this.validatorEl.textContent = log.length
      ? log.slice(-4).join("\n")
      : "no rejected obstacles yet (red = rejected in world)";
    this.validatorEl.style.whiteSpace = "pre-wrap";
  }

  private formatVal(def: SliderDef, v: number): string {
    return def.format ? def.format(v) : String(v);
  }

  private markSpeedButtons(): void {
    for (const { v, btn } of this.speedButtons) {
      btn.classList.toggle("active", Math.abs(this.loop.timeScale - v) < 1e-9);
    }
  }

  private btnRow(parent: HTMLElement): HTMLDivElement {
    const d = document.createElement("div");
    d.className = "btn-row";
    parent.appendChild(d);
    return d;
  }

  private btn(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", onClick);
    parent.appendChild(b);
    return b;
  }
}
