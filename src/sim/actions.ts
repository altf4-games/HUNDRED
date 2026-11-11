// Starting and finishing actions, and the slow drift of needs and mood.
import { CFG } from './config';
import { commitTheft } from './crime';
import { moneyStress, pay, price, servesNow, vacancies, hire } from './economy';
import { clamp, clamp01, dayOf, minuteOf, remember } from './events';
import { chance, randInt, range } from './rng';
import type { ActionKind, Agent, Building, Household, Sim } from './types';
import { travelMinutes } from './world';

export function isWalking(a: Agent): boolean {
  return a.tripFrom >= 0;
}

export function startAction(sim: Sim, a: Agent, action: ActionKind, place: number, minutes: number): void {
  a.action = action;
  a.place = place;
  a.decidedAt = sim.tick;
  if (place !== a.at) {
    const t = travelMinutes(sim.world, a.at, place);
    a.tripFrom = a.at;
    a.tripStart = sim.tick;
    a.tripEnd = sim.tick + t;
    a.until = a.tripEnd + Math.max(1, minutes);
  } else {
    a.tripFrom = -1;
    a.until = sim.tick + Math.max(1, minutes);
  }
}

/** Called when a walk ends. Returns false if the plan no longer makes sense. */
export function arrive(sim: Sim, a: Agent): void {
  a.at = a.place;
  a.tripFrom = -1;
  const needsService = a.action === 'eatOut' || a.action === 'shop' || a.action === 'shopFood' || a.action === 'doctor' || a.action === 'jobHunt';
  if (needsService && !servesNow(sim, a.place, minuteOf(sim))) a.until = sim.tick; // closed: think again
}

function tryHire(sim: Sim, a: Agent): void {
  const open = vacancies(sim);
  let tries = 0;
  for (const b of open) {
    if (a.job >= 0 && b.baseWage <= (sim.biz[a.job]?.baseWage ?? 0) * 1.08) continue;
    if (tries++ >= 3) break;
    const p = 0.3 + a.skill * 0.35 + (a.rep - 0.5) * 0.4 - a.record * 0.12;
    if (chance(sim.rng, clamp(p, 0.05, 0.9))) { hire(sim, a, b.id); return; }
  }
  if (a.job < 0) a.moodBoost -= 0.03;
}

/** Apply the completion effects of the action that just ended. */
export function finishAction(sim: Sim, a: Agent): void {
  if (isWalking(a) || a.at !== a.place) return; // interrupted before arriving
  const n = a.needs;
  const kind = (sim.world.buildings[a.place] as Building).kind;
  const hh = sim.households[a.hh] as Household;
  switch (a.action) {
    case 'eatHome':
      if (hh.food > 0) { hh.food--; n.hunger = clamp01(n.hunger + 0.75); }
      else { n.hunger = clamp01(n.hunger + 0.18); a.moodBoost -= 0.04; }
      break;
    case 'eatOut': {
      const cost = price(sim, kind === 'restaurant' ? CFG.mealRestaurant : CFG.mealCafe);
      if (pay(sim, a, a.place, cost)) {
        n.hunger = clamp01(n.hunger + (kind === 'restaurant' ? 0.9 : 0.75));
        n.fun = clamp01(n.fun + (kind === 'restaurant' ? 0.15 : 0.06));
      }
      break;
    }
    case 'shopFood': {
      const unit = price(sim, CFG.mealHome);
      const want = hh.members.length * 9 - hh.food;
      const units = Math.max(0, Math.min(want, Math.floor((a.cash * 0.7) / unit)));
      if (units > 0 && pay(sim, a, a.place, units * unit)) hh.food += units;
      break;
    }
    case 'shop': {
      // People with money to spare spend more of it.
      const cost = price(sim, Math.round(CFG.storeBasket * range(sim.rng, 0.6, 1.6) + Math.max(0, a.cash - 400) * CFG.wealthSpend));
      if (pay(sim, a, a.place, cost)) n.fun = clamp01(n.fun + 0.35);
      break;
    }
    case 'socialise':
      if (kind === 'bar') { if (pay(sim, a, a.place, price(sim, CFG.barVisit))) { n.fun = clamp01(n.fun + 0.25); n.energy = clamp01(n.energy - 0.03); } }
      else if (kind === 'cafe') { if (pay(sim, a, a.place, price(sim, Math.round(CFG.mealCafe * 0.45)))) { n.fun = clamp01(n.fun + 0.1); n.hunger = clamp01(n.hunger + 0.1); } }
      else n.fun = clamp01(n.fun + 0.12);
      break;
    case 'jobHunt':
      tryHire(sim, a);
      break;
    case 'doctor':
      if (a.illness && !a.illness.treated) {
        const fee = price(sim, CFG.clinicFee);
        // The clinic never turns anyone away; those who cannot pay are treated free.
        if (a.cash >= fee) pay(sim, a, a.place, fee);
        a.illness.treated = true;
        a.illness.until = sim.tick + Math.ceil((a.illness.until - sim.tick) * 0.5);
        n.health = clamp01(n.health + 0.15);
        remember(a, dayOf(sim), 'recovered', 'Saw the doctor at the clinic.');
      }
      break;
    case 'school':
      n.hunger = Math.max(n.hunger, 0.62); // school lunch
      a.skill = Math.min(1, a.skill + 0.002);
      break;
    case 'steal':
      commitTheft(sim, a);
      break;
    default:
      break;
  }
}

/** Advance needs and mood by `dt` minutes. Called every 10 ticks per agent. */
export function updateNeeds(sim: Sim, a: Agent, dt: number): void {
  const n = a.needs;
  const walking = isWalking(a);
  const act = walking ? 'walk' : a.action;
  const asleep = act === 'sleep';
  n.hunger -= dt * (asleep ? CFG.hungerDecayAsleep : CFG.hungerDecay);
  if (asleep) n.energy += dt * CFG.energySleepGain;
  else n.energy -= dt * CFG.energyDecay * (act === 'work' ? 1.12 : act === 'relax' || act === 'sickRest' ? 0.6 : 1);
  n.social -= dt * CFG.socialDecay;
  n.fun -= dt * CFG.funDecay;
  if (act === 'socialise' || act === 'visit') { n.social += dt / 110; n.fun += dt / 190; }
  else if (act === 'eatOut') { n.social += dt / 300; }
  else if (act === 'work') { n.social += dt / 1000; n.fun -= dt / 3000; a.workedToday += dt; }
  else if (act === 'school') { n.social += dt / 600; n.fun += dt / 2400; }
  else if (act === 'relax') { n.fun += dt / 240; n.social += dt / 2600; }
  else if (act === 'jailed') { n.fun -= dt / 900; n.hunger = Math.max(n.hunger, 0.45); }
  if (a.illness) n.health -= (dt * a.illness.severity) / (a.illness.treated ? 5200 : 2300);
  else if (n.hunger > 0.2 && n.energy > 0.2) n.health += dt * CFG.healthRegen;
  if (n.hunger <= 0.02) n.health -= dt / 1100;
  if (n.energy <= 0.02) n.health -= dt / 1800;
  n.hunger = clamp01(n.hunger); n.energy = clamp01(n.energy); n.social = clamp01(n.social);
  n.fun = clamp01(n.fun); n.health = clamp01(n.health);

  const stress = a.age >= 18 ? moneyStress(sim, a) : 0;
  let target = 0.22 * n.hunger + 0.2 * n.energy + 0.19 * n.social + 0.17 * n.fun + 0.22 * n.health;
  target += (a.traits.resilience - 0.5) * 0.16 - 0.06;
  target -= stress * 0.28;
  if (a.illness) target -= a.illness.severity * 0.2;
  if (act === 'jailed') target -= 0.2;
  if (a.age >= 18 && a.age < 66 && a.job < 0) target -= 0.16;
  target += a.moodBoost;
  a.mood = clamp01(a.mood + (clamp01(target) - a.mood) * CFG.moodFollow);
  a.moodBoost *= CFG.boostDecay;
  if (Math.abs(a.moodBoost) < 0.002) a.moodBoost = 0;
}

export function randomMinutes(sim: Sim, lo: number, hi: number): number {
  return randInt(sim.rng, lo, hi);
}
