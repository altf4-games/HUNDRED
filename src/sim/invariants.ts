// Checks the headless run and the tests rely on.
import { CFG } from './config';
import { ledgerExpected, totalMoney } from './economy';
import { isActive } from './events';
import type { Sim } from './types';

export function checkInvariants(sim: Sim): string[] {
  const bad: string[] = [];
  let pop = 0;
  for (const a of sim.agents) {
    if (!isActive(a)) continue;
    pop++;
    const nums = [a.cash, a.mood, a.skill, a.rep, a.needs.hunger, a.needs.energy, a.needs.social, a.needs.fun, a.needs.health, a.moodBoost];
    if (nums.some((v) => !Number.isFinite(v))) bad.push(`agent ${a.id} has a non-finite value`);
    if (a.cash < 0) bad.push(`agent ${a.id} has negative cash ${a.cash}`);
    if (sim.tick - a.decidedAt > CFG.dayTicks) bad.push(`agent ${a.id} stuck in '${a.action}' for ${sim.tick - a.decidedAt} minutes`);
    for (const k in a.rel) if (!Number.isFinite(a.rel[k]!.aff)) bad.push(`agent ${a.id} has a non-finite relationship`);
  }
  for (const b of sim.biz) {
    if (!b) continue;
    if (!Number.isFinite(b.cash) || !Number.isFinite(b.demand)) bad.push(`business ${b.id} has a non-finite value`);
    if (b.cash < 0) bad.push(`business ${b.id} has negative cash ${b.cash}`);
  }
  if (!Number.isFinite(sim.town.cash) || sim.town.cash < 0) bad.push(`treasury is ${sim.town.cash}`);
  if (pop < 60 || pop > CFG.maxAgents) bad.push(`population ${pop} out of bounds`);
  const drift = totalMoney(sim) - ledgerExpected(sim);
  if (Math.abs(drift) > 0.5) bad.push(`money supply drifted by ${drift}`);
  return bad;
}
