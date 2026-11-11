// State hash for the determinism check: same seed, same hash.
import type { Sim } from './types';

export function stateHash(sim: Sim): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  };
  feed(`${sim.tick}|${sim.rng.s}|${sim.town.cash}|${sim.town.priceIndex}`);
  for (const a of sim.agents) {
    feed(`${a.id}${a.status}${a.cash}|${a.mood}|${a.at}|${a.action}|${a.job}|${a.hh}|${a.partner}|${a.rep}|${a.skill}|${a.needs.hunger}|${a.needs.health}|${a.intention?.tag ?? ''}`);
    for (const k in a.rel) { const r = a.rel[k]!; feed(`${k}${r.kind}${r.aff}`); }
  }
  for (const b of sim.biz) if (b) feed(`${b.id}${b.open}${b.cash}|${b.demand}|${b.staff.join(',')}`);
  feed(`${sim.events.length}|${sim.decisions.length}`);
  return (h >>> 0).toString(16).padStart(8, '0');
}
