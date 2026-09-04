/**
 * presets only change vertical feel values
 * gravity / abs(thrust) gives the average hold time needed to stay level
 * raising both accelerations keeps that ratio but makes corrections faster
 */

import type { GameplayConfig } from "./gameplayConfig.js";

export type Preset = Partial<GameplayConfig> & { readonly _description?: string };

export const PRESETS: Record<string, Preset> = {
  Floaty: {
    _description: "Low gravity, weak thrust. Slow vy changes, long float arcs.",
    gravity: 900,
    thrustAcceleration: -1500,
    maxRiseSpeed: -420,
    maxFallSpeed: 520,
    linearDamping: 0,
  },
  Balanced: {
    _description: "Default lab tuning. Duty cycle 1450/2600 ~ 56% hold.",
    gravity: 1450,
    thrustAcceleration: -2600,
    maxRiseSpeed: -620,
    maxFallSpeed: 900,
    linearDamping: 0,
  },
  Heavy: {
    _description: "Everything pulls down hard; thrust barely wins. Duty cycle 64%.",
    gravity: 2300,
    thrustAcceleration: -3600,
    maxRiseSpeed: -760,
    maxFallSpeed: 1250,
    linearDamping: 0,
  },
  "Very Responsive": {
    _description:
      "High gravity AND high thrust: same envelope as Balanced but vy changes " +
      "much faster, so corrections feel instant.",
    gravity: 1900,
    thrustAcceleration: -3400,
    maxRiseSpeed: -700,
    maxFallSpeed: 1000,
    linearDamping: 0,
  },
  "High Gravity": {
    _description: "Extreme pull-down with matching thrust. Punishing but precise.",
    gravity: 2600,
    thrustAcceleration: -4200,
    maxRiseSpeed: -800,
    maxFallSpeed: 1400,
    linearDamping: 0,
  },
  "Low Gravity": {
    _description: "Moon-like. Tiny accelerations, easy but sluggish corrections.",
    gravity: 650,
    thrustAcceleration: -1050,
    maxRiseSpeed: -380,
    maxFallSpeed: 480,
    linearDamping: 0,
  },
};
