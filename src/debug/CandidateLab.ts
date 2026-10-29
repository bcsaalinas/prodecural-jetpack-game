import { CANVAS_HEIGHT, type GameplayConfig } from "../config/gameplayConfig.js";
import { AgentRun, DEFAULT_AGENT, type AgentResult, type AgentSettings } from "../game/procedural/AgentController.js";
import { generateCandidates } from "../game/procedural/CandidateGenerator.js";
import type { Candidate, TraceFrame } from "../game/procedural/Encounter.js";
import "./CandidateLab.css";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ""): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}

/** Development inspector owns its own snapshot, simulations, and replay clock.
 * It never writes generated obstacles or agent inputs into the live game. */
class CandidateLab {
  private readonly dialog = element("dialog");
  private readonly status = element("p");
  private readonly list = element("div");
  private readonly detail = element("div");
  private readonly selectedHeading = element("h2", "Selected candidate");
  private readonly stage = element("canvas");
  private readonly timeline = element("canvas");
  private readonly replay = element("input");
  private readonly frameInfo = element("p");
  private readonly metrics = element("p");
  private readonly exportBox = element("textarea");
  private readonly seed = element("input");
  private readonly beam = element("input");
  private readonly horizon = element("input");
  private readonly interval = element("input");
  private readonly showWitness = element("input");
  private readonly playButton: HTMLButtonElement;
  private candidates: Candidate[] = [];
  private results = new Map<string, AgentResult>();
  private runs = new Map<string, AgentRun<Candidate>>();
  private selected = "";
  private queue: string[] = [];
  private epoch = 0;
  private replayIndex = 0;
  private playing = false;
  private replayEpoch = 0;
  private lastReplayTime = 0;
  private replayRemainder = 0;

  constructor(private cfg: GameplayConfig, host: HTMLElement, private pauseGame: () => void) {
    const open = this.button("Candidate lab · DEV", () => this.open());
    open.className = "candidate-lab-open";
    host.prepend(open);
    this.dialog.id = "candidate-lab";
    this.dialog.setAttribute("aria-label", "Candidate generation and agent lab");
    const header = element("header");
    header.append(element("h1", "CANDIDATE / AGENT LAB"), element("span", "DEVELOPMENT ONLY"),
      this.button("Close lab", () => this.dialog.close()));
    this.dialog.append(header,
      element("p", "Snapshot → grammar alternatives → concrete geometry → construction check → agent test. Separate finite encounters; the endless spawner is unchanged."));
    const toolbar = element("div");
    toolbar.className = "lab-toolbar";
    this.numberField(toolbar, "Candidate seed", this.seed, cfg.seed, 0, 4294967295, 1);
    this.numberField(toolbar, "Beam width", this.beam, DEFAULT_AGENT.beamWidth, 1, 16, 1);
    this.numberField(toolbar, "Horizon actions", this.horizon, DEFAULT_AGENT.horizonActions, 1, 12, 1);
    this.numberField(toolbar, "Action interval (s)", this.interval, DEFAULT_AGENT.actionSeconds, 0.05, 0.3, 0.05);
    toolbar.append(this.button("Generate candidates", () => this.generate()),
      this.button("Test all candidates", () => this.startTesting(true)),
      this.button("Test selected candidate", () => this.startTesting(false)),
      this.button("Agent: one decision", () => this.oneDecision()),
      this.button("Stop testing", () => {
        this.stop();
        this.status.textContent = "TESTING STOPPED · recorded partial results retained. Test selected restarts; Agent: one decision continues.";
      }));
    this.status.setAttribute("role", "status");
    this.dialog.append(toolbar, this.status);
    const body = element("div");
    body.className = "lab-body";
    const candidatesPane = element("section");
    candidatesPane.append(element("h2", "All generated candidates"), this.list);
    this.list.className = "candidate-list";
    const inspectPane = element("section");
    inspectPane.className = "lab-inspect";
    inspectPane.append(this.selectedHeading, this.metrics);
    this.stage.width = 820;
    this.stage.height = 310;
    this.stage.setAttribute("aria-label", "Encounter geometry, construction witness and agent trajectory");
    inspectPane.append(this.stage);
    const legend = element("label");
    this.showWitness.type = "checkbox";
    this.showWitness.checked = true;
    this.showWitness.addEventListener("change", () => this.drawSelected());
    legend.append(this.showWitness, document.createTextNode(" Show construction witness (yellow dashed). Agent path: cyan. Collision: red."));
    inspectPane.append(legend);
    const playback = element("div");
    playback.className = "lab-toolbar";
    this.playButton = this.button("Play agent replay", () => this.toggleReplay());
    playback.append(this.playButton, this.button("Replay: one frame", () => {
      this.playing = false;
      this.replayEpoch++;
      this.seek(this.replayIndex + 1);
    }), this.button("Replay: reset", () => { this.playing = false; this.replayEpoch++; this.seek(0); }));
    this.replay.type = "range";
    this.replay.min = "0";
    this.replay.max = "0";
    this.replay.step = "1";
    this.replay.value = "0";
    this.replay.setAttribute("aria-label", "Agent replay frame");
    this.replay.addEventListener("input", () => {
      this.playing = false; this.replayEpoch++; this.seek(Number(this.replay.value));
    });
    this.timeline.width = 820;
    this.timeline.height = 28;
    this.timeline.setAttribute("aria-label", "Agent HOLD and RELEASE input timeline");
    inspectPane.append(playback, this.replay, this.timeline, this.frameInfo);
    const generationDetails = element("details");
    generationDetails.append(element("summary", "Generation steps + concrete parameters"), this.detail);
    inspectPane.append(generationDetails);
    const exportDetails = element("details");
    exportDetails.append(element("summary", "Inspect / copy candidate and test JSON"));
    this.exportBox.readOnly = true;
    this.exportBox.setAttribute("aria-label", "Candidate and agent test JSON");
    exportDetails.append(this.button("Prepare JSON", () => this.prepareExport()), this.exportBox);
    inspectPane.append(exportDetails);
    body.append(candidatesPane, inspectPane);
    this.dialog.append(body);
    this.dialog.addEventListener("close", () => this.stop());
    document.body.append(this.dialog);
  }

  private button(label: string, action: () => void): HTMLButtonElement {
    const button = element("button", label);
    button.type = "button";
    button.addEventListener("click", action);
    return button;
  }

  private numberField(host: HTMLElement, text: string, input: HTMLInputElement,
    value: number, min: number, max: number, step: number): void {
    const label = element("label", text);
    input.type = "number";
    input.value = String(value);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    label.append(input);
    host.append(label);
  }

  private open(): void {
    this.pauseGame();
    this.dialog.showModal();
    if (!this.candidates.length) this.generate();
  }

  private generate(): void {
    this.stop();
    try {
      const seed = Number(this.seed.value);
      if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error("Seed must be an unsigned 32-bit integer.");
      const candidates = generateCandidates(this.cfg, seed);
      this.candidates = candidates;
      this.results.clear();
      this.runs.clear();
      this.exportBox.value = "";
      this.selected = candidates[0].id;
      this.replayIndex = 0;
      const accepted = candidates.filter((c) => c.rejection === null).length;
      this.status.textContent = `GENERATED · ${candidates.length} candidates · ${accepted} construction checks passed · seed ${seed} · snapshot speed ${this.cfg.worldStartSpeed}px/s · dt ${(this.cfg.fixedDt * 1000).toFixed(2)}ms. Agent tests pending.`;
      this.renderCards();
      this.renderSelected();
    } catch (error) {
      this.status.textContent = `GENERATION ERROR · ${(error as Error).message} Previous candidates, if present, retain their original snapshot.`;
    }
  }

  private settings(): AgentSettings {
    return { beamWidth: Number(this.beam.value), horizonActions: Number(this.horizon.value), actionSeconds: Number(this.interval.value) };
  }

  private startTesting(all: boolean): void {
    this.stop();
    try {
      const targets = this.candidates.filter((c) => c.rejection === null && (all || c.id === this.selected));
      if (!targets.length) throw new Error("No construction-checked candidate selected.");
      const settings = this.settings();
      const runs = targets.map((c) => new AgentRun(c, settings));
      for (const run of runs) {
        this.runs.set(run.candidate.id, run);
        this.results.delete(run.candidate.id);
      }
      this.queue = targets.map((c) => c.id);
      this.exportBox.value = "";
      this.replayIndex = 0;
      const epoch = this.epoch;
      const pump = (): void => {
        if (epoch !== this.epoch || !this.queue.length) return;
        const run = this.runs.get(this.queue[0])!;
        // A fixed number of decisions per task yields to the UI. Wall-clock
        // speed affects inspection latency only, never the selected controls.
        for (let i = 0; i < 4 && !run.done; i++) run.advanceDecision();
        this.results.set(run.candidate.id, run.result());
        this.status.textContent = `TESTING ${run.candidate.id} · ${run.simulation.stepCount}/${run.candidate.durationSteps} steps · ${this.queue.length} candidates remaining. Only visible obstacles enter planning.`;
        if (run.candidate.id === this.selected) this.replayIndex = run.trace.length - 1;
        if (run.done) this.queue.shift();
        this.renderCards();
        this.renderSelected();
        if (this.queue.length) window.setTimeout(pump, 0);
        else this.status.textContent = `TESTS FINISHED · ${targets.length} tested · ${targets.filter((c) => this.results.get(c.id)?.completed).length} passed. Failed agent tests remain visible; a failure does not prove the encounter impossible.`;
      };
      pump();
    } catch (error) { this.status.textContent = `AGENT ERROR · ${(error as Error).message}`; }
  }

  private oneDecision(): void {
    this.stop();
    const candidate = this.candidates.find((c) => c.id === this.selected);
    if (!candidate || candidate.rejection) return;
    try {
      let run = this.runs.get(candidate.id);
      if (!run || run.done) {
        run = new AgentRun(candidate, this.settings());
        this.runs.set(candidate.id, run);
      }
      run.advanceDecision();
      this.exportBox.value = "";
      this.results.set(candidate.id, run.result());
      this.replayIndex = run.trace.length - 1;
      this.status.textContent = `STEPPED ${candidate.id} · one planned action (${(Math.round(run.settings.actionSeconds / candidate.cfg.fixedDt) * candidate.cfg.fixedDt).toFixed(3)}s). Test selected restarts; this button continues the current run.`;
      this.renderCards();
      this.renderSelected();
    } catch (error) { this.status.textContent = `AGENT ERROR · ${(error as Error).message}`; }
  }

  private stop(): void {
    this.epoch++;
    this.queue = [];
    this.playing = false;
    this.replayEpoch++;
    this.playButton.textContent = "Play agent replay";
  }

  private renderCards(): void {
    this.list.replaceChildren();
    for (const candidate of this.candidates) {
      const result = this.results.get(candidate.id);
      const done = this.runs.get(candidate.id)?.done;
      const state = candidate.rejection ? "REJECTED" : !result ? "NOT TESTED" :
        result.completed ? "AGENT PASSED" : result.hitId !== null ? `AGENT HIT #${result.hitId}` : done ? "FINISHED" : "IN PROGRESS";
      const button = this.button(`${candidate.id} · ${state}`, () => {
        this.selected = candidate.id;
        this.playing = false;
        this.replayEpoch++;
        this.replayIndex = 0;
        this.exportBox.value = "";
        this.renderCards();
        this.renderSelected();
      });
      button.className = `candidate-card${candidate.id === this.selected ? " selected" : ""}`;
      button.setAttribute("aria-pressed", String(candidate.id === this.selected));
      const canvas = element("canvas");
      canvas.width = 270;
      canvas.height = 96;
      this.drawEncounter(canvas, candidate, result, false);
      button.append(canvas, element("span", candidate.derivation[1].replace("<Pattern> expansion → ", "")),
        element("small", `spacing ${candidate.parameters.spacing.toFixed(0)}px · clearance ${candidate.parameters.clearance}px`));
      this.list.append(button);
    }
  }

  private renderSelected(): void {
    const candidate = this.candidates.find((c) => c.id === this.selected);
    if (!candidate) return;
    this.selectedHeading.textContent = `Selected candidate ${candidate.id} · seed ${candidate.seed}`;
    this.detail.replaceChildren(element("h3", `${candidate.id} · seed ${candidate.seed}`));
    const derivation = element("ol");
    for (const rule of candidate.derivation) derivation.append(element("li", rule));
    this.detail.append(derivation);
    const table = element("table");
    const head = element("tr");
    for (const title of ["Obstacle", "World x", "Width", "Safe y interval", "Target fraction"]) head.append(element("th", title));
    table.append(head);
    for (let i = 0; i < candidate.obstacles.length; i++) {
      const o = candidate.obstacles[i];
      const row = element("tr");
      for (const value of [`#${o.id} ${o.type}`, `${o.worldX.toFixed(0)}px`, `${o.width}px`,
        `${o.gapTop?.toFixed(0)}–${o.gapBottom?.toFixed(0)}px`, candidate.parameters.targetFractions[i].toFixed(2)]) row.append(element("td", value));
      table.append(row);
    }
    this.detail.append(table, element("p", `Construction: ${candidate.rejection ?? "PASS — recorded controls survived all obstacles"}. Extra recovery before #3: ${candidate.parameters.recoveryDistance.toFixed(0)}px. Safe interval refers to collider edges; the player height must fit inside.`));
    const result = this.results.get(candidate.id);
    this.metrics.textContent = result ?
      `${result.completed ? "AGENT PASS" : result.hitId !== null ? `AGENT FAIL · collision #${result.hitId}` : "AGENT IN PROGRESS"} · progress ${(result.progress * 100).toFixed(1)}% · input switches ${result.switches} · vertical travel ${result.verticalTravel.toFixed(0)}px · min obstacle clearance ${result.minClearance === null ? "not crossed yet" : `${result.minClearance.toFixed(1)}px`} · beam ${result.settings.beamWidth}, horizon ${result.settings.horizonActions}, action ${result.settings.actionSeconds}s` :
      "AGENT NOT TESTED — construction pass demonstrates one control witness; agent performance is a separate measurement.";
    this.seek(this.replayIndex);
  }

  private seek(index: number): void {
    const candidate = this.candidates.find((c) => c.id === this.selected);
    if (!candidate) return;
    const result = this.results.get(candidate.id);
    const max = Math.max(0, (result?.trace.length ?? 1) - 1);
    this.replayIndex = Math.max(0, Math.min(index, max));
    this.replay.max = String(max);
    this.replay.value = String(this.replayIndex);
    this.replay.disabled = !result;
    this.playButton.textContent = this.playing ? "Pause agent replay" : "Play agent replay";
    this.drawSelected();
    const frame = result?.trace[this.replayIndex];
    const decisions = frame ? result?.decisions.filter((d) => d.step < frame.step) ?? [] : [];
    const decision = decisions[decisions.length - 1];
    this.frameInfo.textContent = frame ?
      `Frame ${frame.step} · t ${frame.time.toFixed(3)}s · ${frame.hold ? "HOLD" : "RELEASE"} · y ${frame.y.toFixed(1)} · vy ${frame.vy.toFixed(1)} · ${frame.hitId === null ? "no contact" : `HIT #${frame.hitId}`}\nPlanning ${decision?.planningStatus ?? "—"}: visible [${decision?.visibleIds.join(", ") ?? ""}] · rollouts ${decision?.rollouts ?? 0} · collided branches ${decision?.collidedRollouts ?? 0} · predicted cost ${decision?.predictedCost?.toFixed(4) ?? "—"}` :
      "Test a candidate to record its agent controls and trajectory. Replay stepping reads saved frames; Agent: one decision advances the actual controller.";
  }

  private drawSelected(): void {
    const candidate = this.candidates.find((c) => c.id === this.selected);
    if (!candidate) return;
    const result = this.results.get(candidate.id);
    this.drawEncounter(this.stage, candidate, result, true);
    const ctx = this.timeline.getContext("2d")!;
    ctx.fillStyle = "#14161a";
    ctx.fillRect(0, 0, this.timeline.width, this.timeline.height);
    if (!result) return;
    const width = this.timeline.width / candidate.durationSteps;
    for (const frame of result.trace.slice(1)) {
      ctx.fillStyle = frame.hold ? "#4cc38a" : "#5b6270";
      ctx.fillRect((frame.step - 1) * width, 6, Math.max(1, width), 16);
    }
    ctx.fillStyle = "#fff";
    ctx.fillRect(this.replayIndex * width, 0, 2, 28);
  }

  private drawEncounter(canvas: HTMLCanvasElement, candidate: Candidate, result: AgentResult | undefined, detailed: boolean): void {
    const ctx = canvas.getContext("2d")!;
    const cfg = candidate.cfg;
    const extent = candidate.witness[candidate.witness.length - 1].cameraX + cfg.playerScreenX + cfg.playerWidth + 30;
    const sx = (canvas.width - 24) / extent;
    const sy = (canvas.height - 24) / CANVAS_HEIGHT;
    const x = (worldX: number): number => 12 + worldX * sx;
    const y = (screenY: number): number => 12 + screenY * sy;
    ctx.fillStyle = "#12151a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#343945";
    ctx.lineWidth = 1;
    for (const edge of [cfg.ceilingHeight, CANVAS_HEIGHT - cfg.floorHeight]) {
      ctx.beginPath(); ctx.moveTo(12, y(edge)); ctx.lineTo(canvas.width - 12, y(edge)); ctx.stroke();
    }
    for (const obstacle of candidate.obstacles) {
      ctx.fillStyle = "rgba(76,195,138,0.10)";
      ctx.fillRect(x(obstacle.worldX), y(obstacle.gapTop!), obstacle.width * sx,
        (obstacle.gapBottom! - obstacle.gapTop!) * sy);
      ctx.fillStyle = result?.hitId === obstacle.id ? "#e06c75" : "#7a828f";
      for (const rect of obstacle.getRects(0, 0)) ctx.fillRect(x(rect.x), y(rect.y), rect.w * sx, rect.h * sy);
      if (detailed) {
        ctx.fillStyle = "#cfd3dc"; ctx.font = "11px monospace";
        ctx.fillText(`#${obstacle.id}`, x(obstacle.worldX), canvas.height - 2);
      }
    }
    const path = (frames: TraceFrame[], color: string, dashed: boolean): void => {
      ctx.strokeStyle = color; ctx.lineWidth = detailed ? 1.5 : 1;
      ctx.setLineDash(dashed ? [5, 4] : []);
      ctx.beginPath();
      frames.forEach((f, i) => {
        const px = x(f.cameraX + cfg.playerScreenX + cfg.playerWidth / 2);
        const py = y(f.y + cfg.playerHeight / 2);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke(); ctx.setLineDash([]);
    };
    if (!detailed || this.showWitness.checked) path(candidate.witness, "#e5c07b", true);
    if (result) {
      path(result.trace, "#287782", false);
      if (detailed) path(result.trace.slice(0, this.replayIndex + 1), "#56b6c2", false);
      const frame = result.trace[detailed ? this.replayIndex : result.trace.length - 1];
      if (frame) {
        ctx.strokeStyle = frame.hitId === null ? "#fff" : "#e06c75";
        ctx.strokeRect(x(frame.cameraX + cfg.playerScreenX), y(frame.y), Math.max(4, cfg.playerWidth * sx), cfg.playerHeight * sy);
      }
    }
  }

  private toggleReplay(): void {
    const candidate = this.candidates.find((c) => c.id === this.selected);
    const result = candidate ? this.results.get(candidate.id) : undefined;
    if (!result || result.trace.length < 2 || this.queue.length) return;
    this.playing = !this.playing;
    const replayEpoch = ++this.replayEpoch;
    if (!this.playing) { this.seek(this.replayIndex); return; }
    if (this.replayIndex >= result.trace.length - 1) this.replayIndex = 0;
    this.lastReplayTime = performance.now();
    this.replayRemainder = 0;
    const tick = (now: number): void => {
      if (replayEpoch !== this.replayEpoch || !this.playing || !this.dialog.open || this.selected !== candidate!.id) return;
      this.replayRemainder += Math.min(0.1, (now - this.lastReplayTime) / 1000);
      this.lastReplayTime = now;
      const frames = Math.floor(this.replayRemainder / candidate!.cfg.fixedDt);
      this.replayRemainder -= frames * candidate!.cfg.fixedDt;
      if (this.replayIndex + frames >= result.trace.length - 1) this.playing = false;
      this.seek(this.replayIndex + frames);
      if (this.playing) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private prepareExport(): void {
    const candidate = this.candidates.find((c) => c.id === this.selected);
    if (!candidate) return;
    this.exportBox.value = JSON.stringify({
      version: 1, id: candidate.id, seed: candidate.seed, config: candidate.cfg,
      derivation: candidate.derivation, parameters: candidate.parameters,
      durationSteps: candidate.durationSteps, rejection: candidate.rejection,
      obstacles: candidate.obstacles.map((o) => ({ id: o.id, type: o.type, worldX: o.worldX,
        width: o.width, gapTop: o.gapTop, gapBottom: o.gapBottom, parts: o.getRects(0, 0) })),
      constructionWitness: candidate.witness, agent: this.results.get(candidate.id) ?? null,
    }, null, 2);
    this.exportBox.select();
  }
}

export function mountCandidateLab(cfg: GameplayConfig, host: HTMLElement, pauseGame: () => void): void {
  new CandidateLab(cfg, host, pauseGame);
}
