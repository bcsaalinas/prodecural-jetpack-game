/**
 * one button input state with simulation time counters
 * browser events stay in main so the game can run without a DOM in verification
 */
export class Input {
  isDown = false;
  downDuration = 0;
  upDuration = 0;

  press(): void {
    if (this.isDown) return; // repeated keydown must not reset hold time
    this.isDown = true;
    this.downDuration = 0;
  }

  release(): void {
    if (!this.isDown) return;
    this.isDown = false;
    this.upDuration = 0;
  }

  /** Called once per fixed step so durations are simulation-time, not wall time. */
  update(dt: number): void {
    if (this.isDown) this.downDuration += dt;
    else this.upDuration += dt;
  }

  reset(): void {
    this.isDown = false;
    this.downDuration = 0;
    this.upDuration = 0;
  }
}
