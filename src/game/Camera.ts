/**
 * camera x is distance traveled and also the world to screen offset
 * the player stays at one screen x while obstacle world positions stay fixed
 */
export class Camera {
  /** distance traveled and world to screen offset in pixels */
  x = 0;

  worldToScreenX(worldX: number): number {
    return worldX - this.x;
  }

  screenToWorldX(screenX: number): number {
    return screenX + this.x;
  }
}
