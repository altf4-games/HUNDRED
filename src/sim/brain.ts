// Utility AI: when an action ends, score what could come next and take the best.
//   score = need urgency x trait modifier x intention bias x feasibility + small seeded noise
import { CFG } from './config';
import { isWalking, startAction } from './actions';
import { requestDilemma } from './decisions';
import { BIZ_SPEC, isWeekend, moneyStress, price, servesNow } from './economy';
import { dayOf, emit, fullName, isActive, minuteOf } from './events';
import { hash01, rand, randInt } from './rng';
import type { ActionKind, Agent, Building, BuildingKind, Business, Household, IntentionTag, Sim, World } from './types';

const placeCache = new WeakMap<World, Record<string, number>>();
export function placeOf(sim: Sim, kind: BuildingKind): number {
  let m = placeCache.get(sim.world);
  if (!m) {
    m = {};
    for (const b of sim.world.buildings) if (m[b.kind] === undefined) m[b.kind] = b.id;
    placeCache.set(sim.world, m);
  }
  return m[kind] ?? -1;
}

export function homeOf(sim: Sim, a: Agent): number {
  return (sim.households[a.hh] as Household).home;
}

/** Minute of day this agent gets up. */
export function wakeMinute(sim: Sim, a: Agent): number {
  const jitter = Math.floor(hash01(a.id, 7) * 50);
  if (a.age < 18) return 7 * 60 + jitter / 2;
  const b = a.job >= 0 ? sim.biz[a.job] : null;
  if (b) return Math.max(5 * 60, Math.min(8 * 60 + 30, b.shiftStart - 80)) + jitter / 2;
  return 6 * 60 + 50 + jitter * 1.6;
}

function bedMinute(a: Agent): number {
  if (a.age < 13) return 20 * 60 + 30;
  if (a.age < 18) return 21 * 60 + 30;
  return 22 * 60 + Math.floor(a.traits.sociability * 70);
}

function bias(a: Agent, tag: IntentionTag, yes: number): number {
  return a.intention && a.intention.tag === tag ? yes : 1;
}

export function decide(sim: Sim, a: Agent): void {
  const day = dayOf(sim);
  const m = minuteOf(sim);
  const home = homeOf(sim, a);
  const rng = sim.rng;

  if (a.jailUntil > sim.tick) {
    startAction(sim, a, 'jailed', placeOf(sim, 'police'), Math.min(a.jailUntil - sim.tick, 480));
    return;
  }
  if (a.jailUntil > 0) {
    a.jailUntil = 0;
    emit(sim, 'released', 1, `${fullName(a)} was released from jail.`, a.id);
  }
  if (a.forced) {
    const f = a.forced;
    a.forced = null;
    startAction(sim, a, f.action, f.place, f.minutes);
    return;
  }
  if (a.intention && a.intention.until <= day) a.intention = null;

  const n = a.needs;
  const adult = a.age >= 18;
  const hh = sim.households[a.hh] as Household;
  const wake = wakeMinute(sim, a);
  const bed = bedMinute(a);
  const sick = a.illness ? a.illness.severity : 0;

  let best: ActionKind = 'relax';
  let bestPlace = home;
  let bestMin = 45;
  let bestScore = -1;
  const consider = (action: ActionKind, place: number, minutes: number, score: number) => {
    if (score <= 0 || place < 0) return;
    const s = score + rand(rng) * 0.2;
    if (s > bestScore) { bestScore = s; best = action; bestPlace = place; bestMin = minutes; }
  };

  // --- sleep ---
  const night = m >= bed || m < wake;
  if (night) {
    const until = m < wake ? wake - m : CFG.dayTicks - m + wake;
    consider('sleep', home, until, 3.2 + (1 - n.energy));
  } else if (n.energy < 0.12) {
    consider('sleep', home, 110, 2.6);
  }

  // --- schedule skeleton: work and school ---
  const weekend = isWeekend(day);
  const biz: Business | null = a.job >= 0 ? (sim.biz[a.job] as Business) : null;
  const onShift = !!biz && biz.open && (!weekend || biz.worksWeekend) && m >= biz.shiftStart - 45 && m < biz.shiftEnd - 20;
  if (biz && onShift && sick < 0.45) {
    const chunkEnd = m < biz.shiftStart + 240 ? Math.min(biz.shiftEnd, biz.shiftStart + 240 + Math.floor(hash01(a.id, 3) * 40)) : biz.shiftEnd;
    consider('work', a.job, Math.max(20, chunkEnd - m), 2.7 + a.traits.ambition * 0.5 * bias(a, 'work-hard', 1.5) - sick);
  }
  const school = placeOf(sim, 'school');
  if (!adult && !weekend && m >= 7 * 60 + 50 && m < 14 * 60 + 40 && sick < 0.4 && (sim.biz[school] as Business).staff.length > 0) {
    consider('school', school, 15 * 60 - m, 3);
  }

  // --- food ---
  const hungry = 1 - n.hunger;
  if (n.hunger < 0.55) {
    const atWork = onShift && a.at === a.job;
    const eatAt = atWork ? a.at : home; // packed lunch at work
    if (hh.food > 0) consider('eatHome', eatAt, 28, hungry * 3.3 * bias(a, 'save-money', 1.3) * bias(a, 'look-after-family', 1.15));
    else consider('eatHome', eatAt, 20, hungry * 1.4);
    if (adult) {
      const cafe = placeOf(sim, 'cafe');
      const rest = placeOf(sim, 'restaurant');
      const flush = Math.min(1.7, 0.6 + a.cash / 900); // comfortable people eat out more
      const out = bias(a, 'save-money', 0.35) * bias(a, 'go-out-more', 1.35) * (0.65 + 0.5 * a.traits.sociability) * flush;
      if (servesNow(sim, cafe, m) && a.cash > price(sim, CFG.mealCafe) * 5) consider('eatOut', cafe, 40, hungry * 2.5 * out);
      if (servesNow(sim, rest, m) && a.cash > price(sim, CFG.mealRestaurant) * 8) consider('eatOut', rest, 65, hungry * 2.3 * out * (m > 17 * 60 ? 1.25 : 0.9));
    }
  }

  if (adult) {
    // --- shopping ---
    const grocery = placeOf(sim, 'grocery');
    if (hh.food < hh.members.length * 2 && servesNow(sim, grocery, m) && a.cash > price(sim, CFG.mealHome) * 4) {
      const someoneOnIt = hh.members.some((id) => id !== a.id && (sim.agents[id] as Agent).action === 'shopFood');
      if (!someoneOnIt) consider('shopFood', grocery, 25, 1.7 + (hh.food === 0 ? 1.7 : 0));
    }
    const store = placeOf(sim, 'store');
    if (n.fun < 0.75 && servesNow(sim, store, m) && a.cash > price(sim, CFG.storeBasket) * 7) {
      consider('shop', store, 35, (1 - n.fun) * 1.5 * (0.6 + 0.4 * a.traits.ambition) * Math.min(2, 0.6 + a.cash / 800) * bias(a, 'save-money', 0.3));
    }

    // --- job hunting ---
    const hall = placeOf(sim, 'townhall');
    const looking = a.age < 66 && (a.job < 0 || a.intention?.tag === 'find-better-job');
    if (looking && a.lastHuntDay !== day && servesNow(sim, hall, m) && !weekend && !onShift) {
      const stress = moneyStress(sim, a);
      consider('jobHunt', hall, 80, a.job < 0 ? 2.1 + a.traits.ambition * 0.6 + stress * 0.8 : 1.6);
    }

    // --- visiting someone because of an intention ---
    const it = a.intention;
    if (it && it.target >= 0 && (it.tag === 'reconcile-with' || it.tag === 'confront') && a.lastVisitDay !== day) {
      const t = sim.agents[it.target] as Agent;
      if (isActive(t) && !isWalking(t) && t.action !== 'sleep' && t.action !== 'jailed' && t.action !== 'work' && t.action !== 'school') {
        consider('visit', t.at, 40, 2.3);
      }
    }
  }

  // --- health ---
  if (a.illness) {
    const clinic = placeOf(sim, 'clinic');
    if (!a.illness.treated && servesNow(sim, clinic, m) && (sick > 0.4 || a.cash >= price(sim, CFG.clinicFee))) {
      consider('doctor', clinic, 45, (2.3 + sick * 1.6) * bias(a, 'get-healthy', 1.4));
    }
    if (sick > 0.3) consider('sickRest', home, 150, 1.5 + sick);
  }

  // --- going out ---
  const soc = (1 - n.social) * 2.4 * (0.5 + a.traits.sociability) *
    bias(a, 'go-out-more', 1.6) * bias(a, 'find-love', 1.5) * bias(a, 'lie-low', 0.5) * bias(a, 'look-after-family', 0.7) * (sick > 0.3 ? 0.4 : 1);
  const stay = randInt(rng, 55, 115);
  const park = placeOf(sim, 'park');
  if (servesNow(sim, park, m)) consider('socialise', park, stay, soc * (adult ? 0.85 : 1.35) + (1 - n.fun) * 0.4);
  if (adult) {
    const bar = placeOf(sim, 'bar');
    const cafe = placeOf(sim, 'cafe');
    if (m >= 17 * 60 && servesNow(sim, bar, m) && a.cash > price(sim, CFG.barVisit) * 4) {
      consider('socialise', bar, stay, soc * 1.1 * bias(a, 'save-money', 0.4) * bias(a, 'get-healthy', 0.3));
    }
    if (servesNow(sim, cafe, m) && a.cash > price(sim, CFG.mealCafe) * 4) consider('socialise', cafe, stay - 20, soc * 0.9 * bias(a, 'save-money', 0.6));
  }

  // --- staying in ---
  consider('relax', home, randInt(rng, 50, 95),
    ((1 - n.fun) * 1.3 + 0.25) * bias(a, 'lie-low', 1.4) * bias(a, 'look-after-family', 1.5) * bias(a, 'go-out-more', 0.6));

  // --- desperation ---
  if (a.age >= 16 && (hh.food === 0 || n.hunger < 0.3) && n.hunger < 0.5 && a.lastDilemmaDay !== day && a.traits.honesty < 0.6
    && a.intention?.tag !== 'lie-low' && moneyStress(sim, a) > CFG.stealStress) {
    const grocery = placeOf(sim, 'grocery');
    const store = placeOf(sim, 'store');
    const target = servesNow(sim, grocery, m) ? grocery : servesNow(sim, store, m) ? store : -1;
    if (target >= 0) {
      requestDilemma(sim, 'steal', a, -1, target);
      if (a.pendingDecision >= 0) return; // mulling it over
      if (a.forced) { decide(sim, a); return; }
    }
  }

  const chosen = best as ActionKind; // widened: `best` is assigned inside the closure
  if (chosen === 'jobHunt') a.lastHuntDay = day;
  if (chosen === 'visit') a.lastVisitDay = day;
  startAction(sim, a, chosen, bestPlace, bestMin);
}

export interface IntentionOption { tag: IntentionTag; target: number; label: string; weight: number; }

/** Candidate intentions for an agent, with the weights the rule-based picker uses. */
export function intentionOptions(sim: Sim, a: Agent): IntentionOption[] {
  const day = dayOf(sim);
  const out: IntentionOption[] = [{ tag: 'carry-on', target: -1, label: 'Carry on as usual', weight: 0.3 }];
  const t = a.traits;
  const working = a.age >= 18 && a.age < 66;
  const stress = a.age >= 18 ? moneyStress(sim, a) : 0;
  const hh = sim.households[a.hh] as Household;
  if (working && a.job < 0) out.push({ tag: 'find-better-job', target: -1, label: 'Put everything into finding a job', weight: 1.2 + a.unemployedDays * 0.05 });
  else if (working && t.ambition > 0.62 && a.wage < 80) out.push({ tag: 'find-better-job', target: -1, label: 'Look for a better-paid job', weight: 0.5 });
  if (stress > 0.4) out.push({ tag: 'save-money', target: -1, label: 'Cut spending and save money', weight: 0.4 + stress });
  if (a.needs.social < 0.45) out.push({ tag: 'go-out-more', target: -1, label: 'Go out and see people more', weight: 0.5 + (0.45 - a.needs.social) * 2 + t.sociability * 0.3 });
  let rival = -1, worst = 0;
  for (const k in a.rel) {
    const r = a.rel[k];
    const o = sim.agents[+k] as Agent;
    if (r && r.kind === 'rival' && isActive(o) && r.aff < worst) { worst = r.aff; rival = +k; }
  }
  if (rival >= 0 && a.age >= 14) {
    const name = fullName(sim.agents[rival] as Agent);
    out.push({ tag: 'reconcile-with', target: rival, label: `Make peace with ${name}`, weight: 0.4 + t.honesty * 0.5 + t.sociability * 0.3 - t.impulsivity * 0.3 });
    out.push({ tag: 'confront', target: rival, label: `Have it out with ${name}`, weight: 0.3 + t.impulsivity * 0.8 - t.honesty * 0.2 });
  }
  if (a.record > 0 && a.mem.some((mm) => (mm.type === 'arrest' || mm.type === 'theft') && mm.other < 0 && day - mm.day <= 5)) {
    out.push({ tag: 'lie-low', target: -1, label: 'Keep your head down and stay out of trouble', weight: 1.0 });
  }
  const illAtHome = hh.members.some((id) => id !== a.id && (sim.agents[id] as Agent).illness);
  const hasKids = a.age >= 18 && hh.members.some((id) => (sim.agents[id] as Agent).age < 18);
  if (illAtHome) out.push({ tag: 'look-after-family', target: -1, label: 'Stay close to home and look after family', weight: 0.9 });
  else if (hasKids) out.push({ tag: 'look-after-family', target: -1, label: 'Spend more time with the family', weight: 0.28 });
  if (a.job >= 0 && t.ambition > 0.55) out.push({ tag: 'work-hard', target: -1, label: 'Work hard and get ahead', weight: 0.3 + t.ambition * 0.5 });
  if (a.illness || a.needs.health < 0.5) out.push({ tag: 'get-healthy', target: -1, label: 'Rest and get your health back', weight: 1.1 });
  if (a.age >= 18 && a.age < 60 && a.partner < 0) out.push({ tag: 'find-love', target: -1, label: 'Get out there and meet someone', weight: 0.3 + t.sociability * 0.5 });
  return out;
}

export function jobTitle(sim: Sim, a: Agent): string {
  if (a.age < 18) return 'pupil';
  if (a.job < 0) return a.age >= 66 ? 'retired' : 'unemployed';
  const kind = (sim.world.buildings[a.job] as Building).kind;
  const titles: Partial<Record<BuildingKind, string>> = {
    factory: 'factory worker', office: 'office clerk', farm: 'farmhand', grocery: 'grocer', store: 'shop assistant',
    cafe: 'barista', restaurant: 'cook', bar: 'bartender', school: 'teacher', clinic: 'nurse', police: 'police officer', townhall: 'council clerk',
  };
  return titles[kind] ?? (BIZ_SPEC[kind] ? 'worker' : 'unemployed');
}
