// Leavers and newcomers.
import { arriveHousehold, vacantHomes } from './agent';
import { CFG } from './config';
import { sink, vacancies } from './economy';
import { dayOf, emit, isActive, isWorkingAge, remember } from './events';
import { detach } from './health';
import { chance, rand } from './rng';
import type { Agent, Building, Household, Sim } from './types';

export function population(sim: Sim): number {
  let n = 0;
  for (const a of sim.agents) if (a.status === 'active') n++;
  return n;
}

export function householdLeaves(sim: Sim, hh: Household): void {
  const day = dayOf(sim);
  const members = hh.members.map((id) => sim.agents[id] as Agent);
  if (members.length === 0) return;
  const head = members[0] as Agent;
  const text = members.length > 1
    ? `The ${head.last} household (${members.length} people) packed up and left town.`
    : `${head.first} ${head.last} packed up and left town.`;
  emit(sim, 'movedAway', 3, text, head.id);
  for (const a of members) {
    for (const k in a.rel) {
      const r = a.rel[k];
      const o = sim.agents[+k] as Agent;
      if (r && isActive(o) && o.hh !== a.hh && (r.kind === 'friend' || r.kind === 'close' || r.kind === 'dating' || r.kind === 'partner')) {
        o.moodBoost -= 0.1;
        remember(o, day, 'movedAway', `${a.first} ${a.last} moved away.`, a.id);
      }
    }
    sink(sim, 'emigration', a.cash);
    a.cash = 0;
    detach(sim, a, 'left');
  }
}

/** Midnight: update the counters that drive leaving, then maybe welcome newcomers. */
export function dailyMigration(sim: Sim): void {
  for (const a of sim.agents) {
    if (!isActive(a)) continue;
    if (isWorkingAge(a)) a.unemployedDays = a.job < 0 ? a.unemployedDays + 1 : 0;
    a.unhappyDays = a.mood < 0.4 ? a.unhappyDays + 1 : Math.max(0, a.unhappyDays - 1);
  }
  const pop = population(sim);
  if (pop >= CFG.popSoftCap || pop + 4 > CFG.maxAgents) return;
  const homes = vacantHomes(sim);
  if (homes.length === 0) return;
  let open = 0;
  for (const b of vacancies(sim)) open += b.slots - b.staff.length;
  const p = CFG.arrivalBase + CFG.arrivalPerVacancy * Math.min(open, 8) + (pop < CFG.lowPop ? CFG.arrivalLowPop : 0);
  if (!chance(sim.rng, p)) return;
  const home = homes[Math.floor(rand(sim.rng) * homes.length)] as number;
  const members = arriveHousehold(sim, home);
  const head = members[0] as Agent;
  const where = (sim.world.buildings[home] as Building).name;
  emit(sim, 'movedIn', 2, members.length > 1
    ? `The ${head.last} family (${members.length} people) moved into ${where}.`
    : `${head.first} ${head.last} moved into ${where}.`, head.id, -1, home);
}
