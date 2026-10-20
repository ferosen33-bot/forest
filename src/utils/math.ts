/** Kleine, allokationsfreie Mathe-Helfer, die überall gebraucht werden. */

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Hermite-Interpolation zwischen edge0 und edge1 (wie GLSL smoothstep). */
export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Bewegt `current` maximal um `maxDelta` in Richtung `target`. */
export const approach = (current: number, target: number, maxDelta: number): number =>
  current < target ? Math.min(current + maxDelta, target) : Math.max(current - maxDelta, target);

/**
 * Framerate-unabhängiges exponentielles Glätten.
 * `rate` = wie schnell der Wert konvergiert (1/s).
 */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-rate * dt));
