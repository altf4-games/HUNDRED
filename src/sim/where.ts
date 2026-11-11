// Where an agent is in world space. Derived from sim state; the renderer never stores it.
import { hash01 } from './rng';
import type { Agent, Building, Sim } from './types';
import { routePoint } from './world';

const scratch = [0, 0];

/**
 * Writes x, y (tile units) into out[0], out[1]. Returns true when the agent is outdoors
 * and should be drawn: walking, in the park, or working the farm fields.
 */
export function whereIs(sim: Sim, a: Agent, tickFloat: number, out: Float32Array | number[]): boolean {
  if (a.tripFrom >= 0) {
    const span = a.tripEnd - a.tripStart;
    const f = span > 0 ? (tickFloat - a.tripStart) / span : 1;
    routePoint(sim.world, a.tripFrom, a.place, f, scratch);
    out[0] = scratch[0] as number; out[1] = scratch[1] as number;
    return true;
  }
  const b = sim.world.buildings[a.at] as Building;
  if (b.kind === 'park') {
    out[0] = b.x + 1 + hash01(a.id, a.decidedAt) * (b.w - 2);
    out[1] = b.y + 1.5 + hash01(a.decidedAt, a.id + 99) * (b.h - 2.5);
    return true;
  }
  if (b.kind === 'farm' && a.action === 'work') {
    out[0] = b.x - 0.5 + hash01(a.id, a.decidedAt) * 9;
    out[1] = b.y + 4.4 + hash01(a.decidedAt, a.id + 5) * 4.2;
    return true;
  }
  out[0] = b.entryX; out[1] = b.entryY;
  return false;
}
