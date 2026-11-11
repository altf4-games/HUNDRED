// Illness, contagion, the clinic's effect, and rare deaths.
import { CFG } from './config';
import { fire, sink } from './economy';
import { dayOf, emit, fullName, isActive, isSenior, remember } from './events';
import { chance, rand, randInt, range } from './rng';
import type { Agent, Household, Sim } from './types';

export function infect(sim: Sim, a: Agent, kind: 'flu' | 'serious'): void {
  if (a.illness || !isActive(a)) return;
  const senior = isSenior(a);
  const days = kind === 'flu' ? randInt(sim.rng, 3, 6) : randInt(sim.rng, 6, 11);
  a.illness = {
    kind, treated: false,
    severity: Math.min(0.95, (kind === 'flu' ? range(sim.rng, 0.25, 0.65) : range(sim.rng, 0.55, 0.9)) + (senior ? 0.12 : 0)),
    until: sim.tick + days * CFG.dayTicks,
  };
  sim.town.illnessesToday++;
  emit(sim, 'fellIll', kind === 'flu' ? 1 : 2, kind === 'flu' ? `${fullName(a)} came down with the flu.` : `${fullName(a)} fell seriously ill.`, a.id);
}

export function sickCount(sim: Sim): number {
  let n = 0;
  for (const a of sim.agents) if (isActive(a) && a.illness) n++;
  return n;
}

/** Remove an agent from their household and job without touching money. */
export function detach(sim: Sim, a: Agent, status: 'dead' | 'left'): void {
  if (a.job >= 0) {
    const b = sim.biz[a.job];
    if (b) b.staff = b.staff.filter((id) => id !== a.id);
    a.job = -1;
  }
  const hh = sim.households[a.hh] as Household;
  hh.members = hh.members.filter((id) => id !== a.id);
  if (hh.members.length === 0) hh.home = -1;
  if (a.partner >= 0) {
    const p = sim.agents[a.partner] as Agent;
    if (p.partner === a.id) p.partner = -1;
    a.partner = -1;
  }
  a.status = status;
  a.goneDay = dayOf(sim);
  a.tripFrom = -1;
  a.pendingDecision = -1;
  a.illness = null;
}

export function die(sim: Sim, a: Agent): void {
  const day = dayOf(sim);
  const hh = sim.households[a.hh] as Household;
  const partner = a.partner;
  emit(sim, 'died', 5, `${fullName(a)} died, aged ${a.age}.`, a.id);
  // Savings pass to the family, or to the town if there is none.
  const heir = hh.members.map((id) => sim.agents[id] as Agent).find((m) => m.id !== a.id && m.age >= 18);
  if (heir) heir.cash += a.cash; else sim.town.cash += a.cash;
  a.cash = 0;
  detach(sim, a, 'dead');
  for (const k in a.rel) {
    const r = a.rel[k];
    const o = sim.agents[+k] as Agent;
    if (!r || !isActive(o)) continue;
    if (r.kind === 'family' || r.kind === 'partner' || r.kind === 'dating' || r.kind === 'close' || r.kind === 'friend') {
      o.moodBoost -= +k === partner ? 0.5 : r.kind === 'friend' ? 0.12 : 0.3;
      o.shock += 3;
      remember(o, day, 'died', `${fullName(a)} died.`, a.id);
    }
  }
  // Children left without an adult go to live with relatives elsewhere.
  const left = hh.members.map((id) => sim.agents[id] as Agent);
  if (left.length > 0 && !left.some((m) => m.age >= 18)) {
    for (const c of left) {
      sink(sim, 'emigration', c.cash);
      c.cash = 0;
      detach(sim, c, 'left');
    }
    emit(sim, 'movedAway', 3, `The ${a.last} children left town to live with relatives.`, -1);
  }
}

export function dailyHealth(sim: Sim): void {
  const day = dayOf(sim);
  for (const a of sim.agents) {
    if (!isActive(a)) continue;
    if (a.illness) {
      const ill = a.illness;
      if (sim.tick >= ill.until) {
        a.illness = null;
        a.immuneUntil = day + CFG.immunityDays;
        a.moodBoost += 0.1;
        remember(a, day, 'recovered', ill.kind === 'flu' ? 'Got over the flu.' : 'Recovered from a serious illness.');
        continue;
      }
      const p = (isSenior(a) ? CFG.deathSenior : CFG.deathBase) * ill.severity * (ill.treated ? 0.4 : 1) *
        (a.needs.health < 0.3 ? 2.5 : 1) * (ill.kind === 'serious' ? 2 : 0.6);
      if (chance(sim.rng, p)) die(sim, a);
    } else if (a.immuneUntil <= day) {
      const p = CFG.fluBase * (1 + (1 - a.needs.health) * 2 + (1 - a.needs.energy));
      if (chance(sim.rng, p)) infect(sim, a, rand(sim.rng) < (isSenior(a) ? 0.4 : 0.15) ? 'serious' : 'flu');
    }
  }
  const sick = sickCount(sim);
  if (sick >= 9) {
    const recent = sim.events.some((e) => e.type === 'outbreak' && day - e.day < 12);
    if (!recent) emit(sim, 'outbreak', 4, `A flu wave is sweeping the town: ${sick} people are ill.`, -1);
  }
}

export { fire };
