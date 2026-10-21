import * as THREE from 'three';

/** Etwas weniger als echte Schwerkraft: Würfe sollen sich gut anfühlen, nicht realistisch abfallen. */
export const PROJECTILE_GRAVITY = 9.81 * 0.6;

/**
 * Abwurfgeschwindigkeit, um mit Tempo `speed` von `from` nach `to` zu treffen (flache Flugbahn).
 * @returns null, wenn das Ziel außer Reichweite ist.
 */
export function aimBallistic(from: THREE.Vector3, to: THREE.Vector3, speed: number, gravity = PROJECTILE_GRAVITY): THREE.Vector3 | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const h = to.y - from.y;
  const v2 = speed * speed;
  const disc = v2 * v2 - gravity * (gravity * d * d + 2 * h * v2);
  if (disc < 0 || d < 1e-3) return null;
  const angle = Math.atan2(v2 - Math.sqrt(disc), gravity * d);
  const horizontal = Math.cos(angle) * speed;
  return new THREE.Vector3((dx / d) * horizontal, Math.sin(angle) * speed, (dz / d) * horizontal);
}
