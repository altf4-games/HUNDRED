// Seeded generation of agents and households.
import { CFG } from './config';
import { hire, source, vacancies } from './economy';
import { FEMALE_NAMES, MALE_NAMES, SURNAMES } from './names';
import { type Rng, bell, chance, pick, rand, randInt, range, shuffle } from './rng';
import type { Agent, Building, Household, Look, Rel, RelKind, Sim } from './types';

const SHIRTS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd68910, 0x8e44ad, 0x16a085, 0xe67e22, 0x5d6d7e, 0xf4d03f, 0xec7063, 0x48c9b0, 0xf2f3f4, 0x34495e, 0xaf7ac5, 0x7fb3d5, 0xa04000];
const PANTS = [0x2c3e50, 0x34495e, 0x5d4037, 0x1b2631, 0x566573, 0x6e2c00, 0x283747, 0x7b7d7d, 0x4a235a, 0x1e8449];

function makeLook(rng: Rng, age: number, female: boolean): Look {
  let height = range(rng, 0.93, 1.07);
  if (age < 18) height = 0.56 + ((age - 6) / 12) * 0.4;
  if (age >= 66) height *= 0.96;
  if (female && age >= 18) height *= 0.96;
  let hairStyle = female ? (chance(rng, 0.62) ? 1 : chance(rng, 0.5) ? 2 : 0) : (chance(rng, 0.85) ? 0 : 1);
  if (!female && age > 45 && chance(rng, 0.3)) hairStyle = 3;
  let hairColor = randInt(rng, 0, 4);
  if (age >= 60) hairColor = chance(rng, 0.8) ? 5 : 6; // grey / white
  return {
    skin: randInt(rng, 0, 5), hairStyle, hairColor,
    shirt: pick(rng, SHIRTS), pants: pick(rng, PANTS), height, female,
  };
}

export function makeAgent(sim: Sim, age: number, female: boolean, last: string, hh: number): Agent {
  const rng = sim.rng;
  const id = sim.agents.length;
  const home = (sim.households[hh] as Household).home;
  const a: Agent = {
    id, status: 'active',
    first: pick(rng, female ? FEMALE_NAMES : MALE_NAMES), last, age, female, hh,
    traits: { sociability: bell(rng), ambition: bell(rng), honesty: Math.min(1, bell(rng) + 0.12), impulsivity: bell(rng), resilience: bell(rng) },
    needs: { hunger: range(rng, 0.6, 0.9), energy: range(rng, 0.7, 1), social: range(rng, 0.4, 0.8), fun: range(rng, 0.4, 0.8), health: range(rng, 0.8, 1) },
    cash: 0, skill: age < 18 ? 0.1 : range(rng, 0.2, 0.8), mood: 0.6, moodBoost: 0, rep: 0.6,
    job: -1, wage: 0, workedToday: 0,
    rel: {}, partner: -1, mem: [], intention: null, lastIntentionDay: -randInt(rng, 0, 12), shock: 0,
    illness: null, immuneUntil: 0, jailUntil: 0, record: 0, unemployedDays: 0, unhappyDays: 0,
    at: home, action: 'sleep', place: home, until: 0, decidedAt: sim.tick,
    tripFrom: -1, tripStart: 0, tripEnd: 0, forced: null, pendingDecision: -1, lastDilemmaDay: -9, lastVisitDay: -9, lastHuntDay: -9,
    look: makeLook(rng, age, female),
    arrivedDay: Math.floor(sim.tick / CFG.dayTicks), goneDay: -1, startCash: 0, startMood: 0.6, startJob: -1,
  };
  // Avoid two people with the same full name; it makes the event feed confusing.
  let guard = 0;
  while (guard++ < 8 && sim.agents.some((o) => o.status === 'active' && o.first === a.first && o.last === a.last)) {
    a.first = pick(rng, female ? FEMALE_NAMES : MALE_NAMES);
  }
  sim.agents.push(a);
  (sim.households[hh] as Household).members.push(id);
  return a;
}

export function setRel(a: Agent, b: Agent, aff: number, fam: number, kind: RelKind, day: number): void {
  const r: Rel = { aff, fam, kind, since: day };
  a.rel[b.id] = r;
  b.rel[a.id] = { ...r };
}

export function vacantHomes(sim: Sim): number[] {
  const used = new Map<number, number>();
  for (const hh of sim.households) if (hh.home >= 0 && hh.members.length > 0) used.set(hh.home, (used.get(hh.home) ?? 0) + 1);
  const out: number[] = [];
  for (const b of sim.world.buildings) if (b.homes > (used.get(b.id) ?? 0)) out.push(b.id);
  return out;
}

type HhKind = 'family' | 'couple' | 'single' | 'flatshare' | 'seniorCouple' | 'seniorSingle';

/** Create a household in the given home. Returns its members. */
export function spawnHousehold(sim: Sim, kind: HhKind, home: number, kids = 0): Agent[] {
  const rng = sim.rng;
  const day = Math.floor(sim.tick / CFG.dayTicks);
  const hh: Household = { id: sim.households.length, home, members: [], food: 0 };
  sim.households.push(hh);
  const last = pick(rng, SURNAMES);
  const out: Agent[] = [];
  const adultAge = () => randInt(rng, 21, 58);
  const partner = (x: Agent, y: Agent) => { setRel(x, y, range(rng, 0.7, 0.95), 1, 'partner', day - 400); x.partner = y.id; y.partner = x.id; };
  if (kind === 'family' || kind === 'couple') {
    const age = kind === 'family' ? randInt(rng, 30, 48) : adultAge();
    const f = chance(rng, 0.5);
    const x = makeAgent(sim, age, f, last, hh.id);
    const y = makeAgent(sim, Math.max(20, age + randInt(rng, -5, 5)), chance(rng, 0.9) ? !f : f, last, hh.id);
    partner(x, y);
    out.push(x, y);
    for (let i = 0; i < kids; i++) {
      const c = makeAgent(sim, randInt(rng, 6, 17), chance(rng, 0.5), last, hh.id);
      setRel(c, x, 0.75, 1, 'family', day); setRel(c, y, 0.75, 1, 'family', day);
      for (const s of out) if (s.age < 18) setRel(c, s, 0.6, 1, 'family', day);
      out.push(c);
    }
  } else if (kind === 'single') {
    out.push(makeAgent(sim, adultAge(), chance(rng, 0.5), last, hh.id));
  } else if (kind === 'flatshare') {
    for (let i = 0; i < 3; i++) {
      const m = makeAgent(sim, randInt(rng, 19, 34), chance(rng, 0.5), pick(rng, SURNAMES), hh.id);
      for (const o of out) setRel(m, o, range(rng, 0.25, 0.5), 0.6, 'friend', day);
      out.push(m);
    }
  } else if (kind === 'seniorCouple') {
    const f = chance(rng, 0.5);
    const x = makeAgent(sim, randInt(rng, 66, 84), f, last, hh.id);
    const y = makeAgent(sim, randInt(rng, 66, 84), !f, last, hh.id);
    partner(x, y);
    out.push(x, y);
  } else {
    out.push(makeAgent(sim, randInt(rng, 66, 86), chance(rng, 0.55), last, hh.id));
  }
  hh.food = out.length * 6;
  return out;
}

/** Cash an arriving or starting adult holds. Recorded by the caller as a money source. */
function startingCash(rng: Rng, a: Agent): number {
  if (a.age < 18) return 0;
  return Math.round(120 + bell(rng) * 700 + (a.age >= 66 ? 250 : 0));
}

export function createPopulation(sim: Sim): void {
  const rng = sim.rng;
  const houses = shuffle(rng, sim.world.buildings.filter((b) => b.kind === 'house').map((b) => b.id));
  const flats: number[] = [];
  for (const b of sim.world.buildings) if (b.kind === 'apartment') for (let i = 0; i < b.homes; i++) flats.push(b.id);
  shuffle(rng, flats);
  const takeHouse = () => (houses.length ? houses.pop() : flats.pop()) as number;
  const takeFlat = () => (flats.length ? flats.pop() : houses.pop()) as number;

  // 18 children across 10 families, 70 working-age adults, 12 seniors.
  const kidCounts = [1, 1, 1, 2, 2, 2, 2, 2, 2, 3];
  shuffle(rng, kidCounts);
  for (const k of kidCounts) spawnHousehold(sim, 'family', takeHouse(), k);
  for (let i = 0; i < 11; i++) spawnHousehold(sim, 'couple', chance(rng, 0.75) ? takeHouse() : takeFlat());
  for (let i = 0; i < 6; i++) spawnHousehold(sim, 'flatshare', takeFlat());
  for (let i = 0; i < 10; i++) spawnHousehold(sim, 'single', chance(rng, 0.4) ? takeHouse() : takeFlat());
  for (let i = 0; i < 4; i++) spawnHousehold(sim, 'seniorCouple', takeHouse());
  for (let i = 0; i < 4; i++) spawnHousehold(sim, 'seniorSingle', takeHouse());

  let total = 0;
  for (const a of sim.agents) {
    a.cash = startingCash(rng, a);
    total += a.cash;
  }

  // Fill most jobs; leave a handful of people looking and a few vacancies open.
  const workers = shuffle(rng, sim.agents.filter((a) => a.age >= 18 && a.age < 66));
  const jobless = 5;
  for (let i = 0; i < workers.length - jobless; i++) {
    const open = vacancies(sim);
    if (open.length === 0) break;
    // Spread hires across employers rather than filling the best-paid first.
    const b = open[Math.floor(rand(rng) * open.length)] as (typeof open)[number];
    hire(sim, workers[i] as Agent, b.id, true);
  }

  // Seed acquaintances: colleagues and neighbours already know each other a little.
  const active = sim.agents;
  for (const a of active) {
    for (let k = 0; k < 3; k++) {
      const o = active[Math.floor(rand(rng) * active.length)] as Agent;
      if (o.id === a.id || a.rel[o.id]) continue;
      if ((a.age < 18) !== (o.age < 18)) continue;
      const colleagues = a.job >= 0 && a.job === o.job;
      const aff = range(rng, 0.05, colleagues ? 0.5 : 0.4);
      setRel(a, o, aff, range(rng, 0.2, 0.5), aff > CFG.friendAt ? 'friend' : 'none', 0);
    }
  }

  for (const a of sim.agents) {
    a.startCash = a.cash;
    a.startJob = a.job;
  }
  for (const b of sim.biz) if (b) total += b.cash;
  sim.town.cash = 4000;
  sim.ledger.initial = total + sim.town.cash;
}

/** A new household arrives from out of town, bringing its savings with it. */
export function arriveHousehold(sim: Sim, home: number): Agent[] {
  const rng = sim.rng;
  const roll = rand(rng);
  const building = sim.world.buildings[home] as Building;
  const members = roll < 0.3 && building.kind === 'house'
    ? spawnHousehold(sim, 'family', home, randInt(rng, 1, 2))
    : roll < 0.6 ? spawnHousehold(sim, 'couple', home)
    : spawnHousehold(sim, 'single', home);
  let brought = 0;
  for (const a of members) {
    a.cash = startingCash(rng, a);
    a.startCash = a.cash;
    a.until = sim.tick;
    brought += a.cash;
  }
  source(sim, 'immigration', brought);
  return members;
}
