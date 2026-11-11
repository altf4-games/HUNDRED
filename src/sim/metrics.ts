// One snapshot of the town per day.
import { isActive, isWorkingAge } from './events';
import type { Agent, DayMetrics, Sim } from './types';

export function gini(values: number[]): number {
  const v = values.slice().sort((a, b) => a - b);
  const n = v.length;
  let sum = 0, weighted = 0;
  for (let i = 0; i < n; i++) { sum += v[i] as number; weighted += (i + 1) * (v[i] as number); }
  if (n === 0 || sum <= 0) return 0;
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

export function snapshot(sim: Sim, day: number): DayMetrics {
  const active = sim.agents.filter(isActive);
  const adults = active.filter((a) => a.age >= 18);
  const working = active.filter(isWorkingAge);
  const cash = adults.map((a) => a.cash).sort((a, b) => a - b);
  let mood = 0, friendships = 0, couples = 0, sick = 0;
  for (const a of active) {
    mood += a.mood;
    if (a.illness) sick++;
    for (const k in a.rel) {
      const r = a.rel[k];
      if (!r || +k < a.id || !isActive(sim.agents[+k] as Agent)) continue;
      if (r.kind === 'friend' || r.kind === 'close') friendships++;
      else if (r.kind === 'dating' || r.kind === 'partner') couples++;
    }
  }
  let open = 0, demand = 0, industries = 0;
  for (const b of sim.biz) {
    if (!b) continue;
    if (b.open) open++;
    if (b.sector === 'industry') { demand += b.open ? b.demand : 0; industries++; }
  }
  const total = cash.reduce((s, c) => s + c, 0);
  return {
    day,
    population: active.length,
    mood: active.length ? mood / active.length : 0,
    employment: working.length ? working.filter((a) => a.job >= 0).length / working.length : 0,
    meanWealth: cash.length ? total / cash.length : 0,
    medianWealth: cash.length ? (cash[Math.floor(cash.length / 2)] as number) : 0,
    gini: gini(cash),
    crimes: sim.town.crimesToday,
    illnesses: sim.town.illnessesToday,
    sick,
    priceIndex: sim.town.priceIndex,
    openBusinesses: open,
    friendships,
    couples,
    treasury: sim.town.cash,
    demand: industries ? demand / industries : 0,
  };
}
