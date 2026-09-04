/** canvas debug drawing with no simulation writes */

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../config/gameplayConfig.js";
import { Game, GameState } from "../game/Game.js";
import { ObstacleType } from "../game/Obstacle.js";
import { predictedHit, predictScreenPath } from "./TrajectoryPredictor.js";
import type { Telemetry } from "./Telemetry.js";

const COLORS = {
  gridMinor: "#1b1f27",
  gridMajor: "#252b36",
  gridLabel: "#3f4656",
  corridor: "#20242d",
  corridorEdge: "#3d4350",
  collider: "#4cc38a",
  obstacle: "#7a828f",
  obstacleMoving: "#8a7fb8",
  obstacleBad: "#e06c75",
  safeGap: "rgba(76, 195, 138, 0.14)",
  player: "#e8e8ec",
  flame: "#e5c07b",
  vel: "#4cc38a",
  thrust: "#e5c07b",
  gravity: "#e06c75",
  net: "#ffffff",
  trajHold: "#e5c07b",
  trajRelease: "#56b6c2",
  hudBg: "rgba(10, 12, 16, 0.78)",
  text: "#cfd3dc",
  textDim: "#8a90a0",
  warn: "#e5c07b",
  danger: "#e06c75",
};

export interface FrameStats {
  fps: number;
  frameDt: number; // real time for this rendered frame
}

export class DebugRenderer {
  constructor(private game: Game, private telemetry: Telemetry) {}

  render(ctx: CanvasRenderingContext2D, stats: FrameStats): void {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    this.drawGrid(ctx);
    this.drawCorridor(ctx);
    this.drawObstacles(ctx);
    this.drawPlayer(ctx);
    if (this.game.debug.trajectory) this.drawTrajectories(ctx);
    if (this.game.debug.vectors) this.drawVectors(ctx);
    if (this.game.debug.telemetry) this.drawTelemetry(ctx);
    if (this.game.debug.overlay) this.drawHud(ctx, stats);
    this.drawStateOverlays(ctx);
  }

  /** anchor vertical grid lines to world x so camera movement stays visible */
  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const camX = this.game.camera.x;
    ctx.lineWidth = 1;

    for (let gx = Math.floor(camX / 50) * 50; gx < camX + CANVAS_WIDTH + 50; gx += 50) {
      const sx = Math.round(gx - camX) + 0.5;
      const major = gx % 250 === 0;
      ctx.strokeStyle = major ? COLORS.gridMajor : COLORS.gridMinor;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, CANVAS_HEIGHT);
      ctx.stroke();
      if (major && this.game.debug.overlay) {
        this.text(ctx, `${gx}px`, sx + 3, CANVAS_HEIGHT - 6, COLORS.gridLabel);
      }
    }

    for (let gy = 0; gy < CANVAS_HEIGHT; gy += 50) {
      ctx.strokeStyle = COLORS.gridMinor;
      ctx.beginPath();
      ctx.moveTo(0, gy + 0.5);
      ctx.lineTo(CANVAS_WIDTH, gy + 0.5);
      ctx.stroke();
    }
  }

  private drawCorridor(ctx: CanvasRenderingContext2D): void {
    const w = this.game.world;
    ctx.fillStyle = COLORS.corridor;
    ctx.fillRect(0, 0, CANVAS_WIDTH, w.ceilingY());
    ctx.fillRect(0, w.floorY(), CANVAS_WIDTH, CANVAS_HEIGHT - w.floorY());

    if (this.game.debug.colliders) {
      ctx.strokeStyle = COLORS.collider;
      ctx.lineWidth = 2;
      ctx.strokeRect(0, -2, CANVAS_WIDTH, w.ceilingY() + 2);
      ctx.strokeRect(0, w.floorY(), CANVAS_WIDTH, CANVAS_HEIGHT - w.floorY() + 2);
      this.text(ctx, "CEILING collider", 8, w.ceilingY() - 6, COLORS.collider);
      this.text(ctx, "FLOOR collider", 8, w.floorY() + 14, COLORS.collider);
    }
  }

  private drawObstacles(ctx: CanvasRenderingContext2D): void {
    const g = this.game;
    const { camera, cfg } = g;
    const dbg = g.debug;

    for (const obs of g.obstacles) {
      const sx = obs.worldX - camera.x;
      if (sx > CANVAS_WIDTH + 40 || sx + obs.width < -60) continue;

      const rects = obs.getRects(camera.x, g.time);
      const fill = !obs.possible
        ? COLORS.obstacleBad
        : obs.type === ObstacleType.MOVING
          ? COLORS.obstacleMoving
          : COLORS.obstacle;

      // show the usable gate opening next to its solid colliders
      if (dbg.colliders && obs.type === ObstacleType.GATE && obs.gapTop !== null && obs.gapBottom !== null) {
        ctx.fillStyle = COLORS.safeGap;
        ctx.fillRect(sx, obs.gapTop, obs.width, obs.gapBottom - obs.gapTop);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = COLORS.collider;
        ctx.lineWidth = 1;
        ctx.strokeRect(sx, obs.gapTop, obs.width, obs.gapBottom - obs.gapTop);
        ctx.setLineDash([]);
      }

      for (const r of rects) {
        ctx.globalAlpha = obs.possible ? 1 : 0.65;
        ctx.fillStyle = fill;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.globalAlpha = 1;
        if (dbg.colliders) {
          ctx.strokeStyle = obs.possible ? COLORS.collider : COLORS.danger;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        }
      }

      if (!dbg.overlay) continue;

      const dist = obs.distanceToPlayer(camera.x, cfg.playerScreenX, cfg.playerWidth);
      const ttp = obs.timeToPlayer(camera.x, cfg.playerScreenX, cfg.playerWidth, g.worldSpeed);
      const labelX = sx;
      let labelY = Math.max(30, rects.length ? rects[0].y - 44 : 30);
      if (rects.length && rects[0].y < 60) labelY = rects[0].y + rects[0].h + 14;

      this.text(ctx, `#${obs.id} ${obs.type}`, labelX, labelY, COLORS.text);
      this.text(
        ctx,
        `D ${dist.toFixed(0)}px  T ${isFinite(ttp) ? ttp.toFixed(2) : "inf"}s`,
        labelX,
        labelY + 12,
        COLORS.textDim,
      );
      let extra = `react@spawn ${obs.spawnReactionTime.toFixed(2)}s`;
      if (obs.gapTop !== null && obs.gapBottom !== null) {
        extra = `gap ${(obs.gapBottom - obs.gapTop).toFixed(0)}px  ` + extra;
      }
      this.text(ctx, extra, labelX, labelY + 24, COLORS.textDim);
      if (!obs.possible) {
        this.text(ctx, `REJECTED: ${obs.rejectReason}`, labelX, labelY + 36, COLORS.danger);
      }
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    const g = this.game;
    const p = g.player;
    const r = p.rect();

    ctx.fillStyle = COLORS.player;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // the wedge shows held input and is not a particle effect
    if (p.thrusting && g.state === GameState.RUNNING) {
      const cx = r.x + r.w / 2;
      ctx.fillStyle = COLORS.flame;
      ctx.beginPath();
      ctx.moveTo(cx - 7, r.y + r.h);
      ctx.lineTo(cx + 7, r.y + r.h);
      ctx.lineTo(cx, r.y + r.h + 14);
      ctx.closePath();
      ctx.fill();
    }

    if (g.debug.colliders) {
      ctx.strokeStyle = COLORS.collider;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = COLORS.collider;
      ctx.fillRect(p.centerX() - 1, p.centerY() - 1, 2, 2);
    }
  }

  private drawTrajectories(ctx: CanvasRenderingContext2D): void {
    const g = this.game;

    const hold = predictScreenPath(g, true);
    const release = predictScreenPath(g, false);
    this.polyline(ctx, hold, COLORS.trajHold, [6, 4]);
    this.polyline(ctx, release, COLORS.trajRelease, [2, 4]);

    if (hold.length) this.text(ctx, "HOLD path", hold[hold.length - 1].x - 70, hold[hold.length - 1].y - 8, COLORS.trajHold);
    if (release.length) this.text(ctx, "RELEASE path", release[release.length - 1].x - 70, release[release.length - 1].y + 14, COLORS.trajRelease);

    // mark the first hit for the current held or released branch
    const hit = predictedHit(g);
    if (hit) {
      ctx.strokeStyle = COLORS.danger;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hit.x - 6, hit.y - 6);
      ctx.lineTo(hit.x + 6, hit.y + 6);
      ctx.moveTo(hit.x + 6, hit.y - 6);
      ctx.lineTo(hit.x - 6, hit.y + 6);
      ctx.stroke();
      this.text(ctx, `predicted hit #${hit.obstacleId} (current input)`, hit.x + 10, hit.y - 10, COLORS.danger);
    }
  }

  /**
   * Physics vectors from the player center.
   * velocity uses world speed for x even though screen x stays fixed
   */
  private drawVectors(ctx: CanvasRenderingContext2D): void {
    const g = this.game;
    const p = g.player;
    const ox = p.centerX();
    const oy = p.centerY();

    const V_SCALE = 0.15; // line pixels per px/s
    const A_SCALE = 0.055; // line pixels per px/s^2

    this.arrow(ctx, ox, oy, ox + g.worldSpeed * V_SCALE, oy + p.vy * V_SCALE, COLORS.vel, `v=(${g.worldSpeed.toFixed(0)},${p.vy.toFixed(0)})`);
    this.arrow(ctx, ox, oy, ox, oy + g.cfg.gravity * A_SCALE, COLORS.gravity, `g=${g.cfg.gravity.toFixed(0)}`);
    if (p.thrusting) {
      this.arrow(ctx, ox, oy, ox, oy + g.cfg.thrustAcceleration * A_SCALE, COLORS.thrust, `T=${g.cfg.thrustAcceleration.toFixed(0)}`);
    }
    this.arrow(ctx, ox, oy, ox, oy + p.ay * A_SCALE, COLORS.net, `a=${p.ay.toFixed(0)}`);
  }

  private drawTelemetry(ctx: CanvasRenderingContext2D): void {
    const T = this.telemetry;
    const rows: Array<{ label: string; unit: string; pick: (s: { y: number; vy: number; ay: number; speed: number }) => number; color: string }> = [
      { label: "y", unit: "px", pick: (s) => s.y, color: "#e8e8ec" },
      { label: "vy", unit: "px/s", pick: (s) => s.vy, color: COLORS.vel },
      { label: "ay", unit: "px/s^2", pick: (s) => s.ay, color: COLORS.thrust },
      { label: "speed", unit: "px/s", pick: (s) => s.speed, color: COLORS.trajRelease },
    ];

    const stripH = rows.length * 30 + 8;
    const top = CANVAS_HEIGHT - stripH;
    ctx.fillStyle = "rgba(8, 10, 13, 0.72)";
    ctx.fillRect(0, top, CANVAS_WIDTH, stripH);

    rows.forEach((row, i) => {
      const gy = top + 4 + i * 30;
      const gh = 22;
      const gw = CANVAS_WIDTH - 220;
      const gx = 150;

      const { min, max } = T.minMax(row.pick);
      const samples = T.samples;
      const latest = samples.length ? row.pick(samples[samples.length - 1]) : 0;

      this.text(ctx, `${row.label} [${row.unit}]`, 8, gy + 12, COLORS.text);
      this.text(ctx, `${latest.toFixed(1)}`, gx + gw + 8, gy + 12, row.color);
      this.text(ctx, `${min.toFixed(0)}..${max.toFixed(0)}`, gx - 62, gy + 12, COLORS.textDim);

      ctx.strokeStyle = "#2b303c";
      ctx.strokeRect(gx, gy, gw, gh);
      if (samples.length < 2) return;

      ctx.strokeStyle = row.color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let j = 0; j < samples.length; j++) {
        const v = row.pick(samples[j]);
        const px = gx + (j / (T.capacity - 1)) * gw;
        const py = gy + gh - ((v - min) / (max - min)) * gh;
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    });
  }

  private drawHud(ctx: CanvasRenderingContext2D, stats: FrameStats): void {
    const g = this.game;
    const cfg = g.cfg;
    const p = g.player;

    const next = g.obstacles.find((o) => o.worldX - g.camera.x + o.width > cfg.playerScreenX);
    const nextDist = next ? next.distanceToPlayer(g.camera.x, cfg.playerScreenX, cfg.playerWidth) : NaN;
    const nextT = next ? next.timeToPlayer(g.camera.x, cfg.playerScreenX, cfg.playerWidth, g.worldSpeed) : NaN;
    const spawnIn = g.spawner.nextSpawnIn(g.camera.x);

    const lines: Array<[string, string]> = [
      [`FPS ${stats.fps.toFixed(1)}`, `frame ${(stats.frameDt * 1000).toFixed(1)}ms  fixed ${(cfg.fixedDt * 1000).toFixed(1)}ms (${(1 / cfg.fixedDt).toFixed(0)}Hz)`],
      [`state ${g.state}`, `player ${p.state}  steps ${g.stepCount}`],
      [`input ${g.input.isDown ? "HELD" : "released"}`, `held ${g.input.downDuration.toFixed(2)}s  since release ${g.input.upDuration.toFixed(2)}s`],
      [`pos (${cfg.playerScreenX.toFixed(0)}, ${p.y.toFixed(1)})`, `vy ${p.vy.toFixed(1)} px/s  ay ${p.ay.toFixed(0)} px/s^2`],
      [`world ${g.worldSpeed.toFixed(0)} px/s`, `distance ${g.camera.x.toFixed(0)} px  difficulty ${g.difficulty.toFixed(3)}`],
      [`seed ${cfg.seed}`, `obstacles ${g.obstacles.length}  next spawn in ${spawnIn.toFixed(0)}px (${g.worldSpeed > 0 ? (spawnIn / g.worldSpeed).toFixed(2) : "-"}s)`],
      [
        next ? `nearest #${next.id} ${next.type}` : "nearest: none",
        next ? `${nextDist.toFixed(0)}px -> ${isFinite(nextT) ? nextT.toFixed(2) : "inf"}s` : "",
      ],
    ];

    const boxW = 560;
    const boxH = lines.length * 15 + 12;
    ctx.fillStyle = COLORS.hudBg;
    ctx.fillRect(6, 6, boxW, boxH);

    lines.forEach(([a, b], i) => {
      this.text(ctx, a, 14, 22 + i * 15, COLORS.warn);
      this.text(ctx, b, 250, 22 + i * 15, COLORS.text);
    });

    const rejected = g.spawner.rejectedLog;
    if (rejected.length > 0) {
      this.text(ctx, `validator: ${rejected[rejected.length - 1]}`, 14, 22 + lines.length * 15, COLORS.danger);
    }

    this.text(
      ctx,
      "F1 overlay · F2 colliders · F3 vectors · F4 trajectory · F5 telemetry · P pause · . step · R restart",
      6,
      CANVAS_HEIGHT - (g.debug.telemetry ? 132 : 0) - 8,
      COLORS.textDim,
    );
  }

  private drawStateOverlays(ctx: CanvasRenderingContext2D): void {
    const g = this.game;

    if (g.state === GameState.DEAD && g.deathInfo) {
      const d = g.deathInfo;
      // keep the collision source visible under the death report
      const killer = g.obstacles.find((o) => o.id === d.obstacleId);
      if (killer) {
        ctx.strokeStyle = COLORS.danger;
        ctx.lineWidth = 3;
        for (const r of killer.getRects(g.camera.x, g.time)) {
          ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
        }
      }

      const w = 460;
      const h = 150;
      const x = (CANVAS_WIDTH - w) / 2;
      const y = 150;
      ctx.fillStyle = "rgba(20, 8, 10, 0.9)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = COLORS.danger;
      ctx.strokeRect(x, y, w, h);

      this.text(ctx, `DEAD — hit ${d.obstacleType} #${d.obstacleId}`, x + 14, y + 22, COLORS.danger);
      const rows: Array<[string, string]> = [
        ["vy at impact", `${d.playerVy.toFixed(1)} px/s`],
        ["world speed", `${d.worldSpeed.toFixed(0)} px/s`],
        ["distance", `${d.distance.toFixed(0)} px`],
        ["difficulty", d.difficulty.toFixed(3)],
        ["reaction window at spawn", `${d.spawnReactionTime.toFixed(2)} s`],
        ["restart", "R = same seed · panel = new seed"],
      ];
      rows.forEach(([k, v], i) => {
        this.text(ctx, k, x + 14, y + 42 + i * 16, COLORS.textDim);
        this.text(ctx, v, x + 220, y + 42 + i * 16, COLORS.text);
      });
    } else if (g.state === GameState.READY) {
      const msg = "HOLD SPACE / CLICK to thrust — the run starts on first input";
      const w = 520;
      ctx.fillStyle = COLORS.hudBg;
      ctx.fillRect((CANVAS_WIDTH - w) / 2, 260, w, 34);
      this.text(ctx, msg, (CANVAS_WIDTH - w) / 2 + 14, 281, COLORS.warn);
    } else if (g.state === GameState.PAUSED) {
      this.text(ctx, "PAUSED — P resumes · . steps one fixed frame", CANVAS_WIDTH / 2 - 150, 40, COLORS.warn);
    }
  }

  private text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string): void {
    ctx.font = "11px Menlo, Consolas, monospace";
    ctx.fillStyle = color;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(s, x, y);
  }

  private polyline(ctx: CanvasRenderingContext2D, pts: Array<{ x: number; y: number }>, color: string, dash: number[]): void {
    if (pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  private arrow(
    ctx: CanvasRenderingContext2D,
    x0: number, y0: number, x1: number, y1: number,
    color: string, label: string,
  ): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    const ux = dx / len;
    const uy = dy / len;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * 7 - uy * 3.5, y1 - uy * 7 + ux * 3.5);
    ctx.lineTo(x1 - ux * 7 + uy * 3.5, y1 - uy * 7 - ux * 3.5);
    ctx.closePath();
    ctx.fill();

    this.text(ctx, label, x1 + 6, y1 - 4, color);
  }
}
