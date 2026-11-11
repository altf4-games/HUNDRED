// Wages, prices, rent, tax, businesses. All money moves through the helpers here so the
// ledger can prove that cash only enters or leaves town through named sources and sinks.
import { CFG } from './config';
import { clamp, dayOf, emit, fullName, isActive, isSenior, isWorkingAge } from './events';
import { chance, rand, range } from './rng';
import type { Agent, Building, BuildingKind, Business, Household, Sector, Sim } from './types';

interface BizSpec { sector: Sector; slots: number; wage: number; start: number; end: number; weekend: boolean; open: [number, number]; }

export const BIZ_SPEC: Partial<Record<BuildingKind, BizSpec>> = {
  factory: { sector: 'industry', slots: 16, wage: 84, start: 8 * 60, end: 16 * 60 + 30, weekend: false, open: [0, 0] },
  office: { sector: 'industry', slots: 10, wage: 108, start: 9 * 60, end: 17 * 60, weekend: false, open: [0, 0] },
  farm: { sector: 'industry', slots: 8, wage: 70, start: 7 * 60, end: 15 * 60, weekend: false, open: [0, 0] },
  grocery: { sector: 'commerce', slots: 4, wage: 64, start: 8 * 60, end: 17 * 60, weekend: true, open: [8 * 60, 20 * 60] },
  store: { sector: 'commerce', slots: 3, wage: 64, start: 9 * 60, end: 18 * 60, weekend: true, open: [9 * 60, 19 * 60] },
  cafe: { sector: 'commerce', slots: 3, wage: 60, start: 7 * 60, end: 15 * 60 + 30, weekend: true, open: [7 * 60, 18 * 60] },
  restaurant: { sector: 'commerce', slots: 4, wage: 62, start: 11 * 60, end: 20 * 60, weekend: true, open: [11 * 60, 22 * 60] },
  bar: { sector: 'commerce', slots: 3, wage: 60, start: 15 * 60, end: 23 * 60, weekend: true, open: [15 * 60, 23 * 60 + 40] },
  school: { sector: 'civic', slots: 5, wage: 94, start: 8 * 60, end: 16 * 60, weekend: false, open: [0, 0] },
  clinic: { sector: 'civic', slots: 4, wage: 116, start: 8 * 60, end: 17 * 60, weekend: true, open: [8 * 60, 18 * 60] },
  police: { sector: 'civic', slots: 4, wage: 100, start: 8 * 60, end: 17 * 60, weekend: true, open: [0, 0] },
  townhall: { sector: 'civic', slots: 4, wage: 98, start: 9 * 60, end: 17 * 60, weekend: false, open: [9 * 60, 18 * 60] },
};

export function createBusinesses(sim: Sim): void {
  for (const b of sim.world.buildings) {
    const spec = BIZ_SPEC[b.kind];
    if (!spec) { sim.biz.push(null); continue; }
    const cash = spec.sector === 'civic' ? 0 : Math.round(spec.slots * spec.wage * CFG.startCashDays);
    sim.biz.push({
      id: b.id, sector: spec.sector, open: true, cash, slots: spec.slots, baseWage: spec.wage,
      staff: [], hiring: true, brokeDays: 0, closedDay: -1, demand: 1, salesToday: 0,
      shiftStart: spec.start, shiftEnd: spec.end, worksWeekend: spec.weekend,
    });
  }
}

export function source(sim: Sim, key: string, amount: number): void {
  sim.ledger.sources[key] = (sim.ledger.sources[key] ?? 0) + amount;
}

export function sink(sim: Sim, key: string, amount: number): void {
  sim.ledger.sinks[key] = (sim.ledger.sinks[key] ?? 0) + amount;
}

export function totalMoney(sim: Sim): number {
  let t = sim.town.cash;
  for (const a of sim.agents) if (a.status === 'active') t += a.cash;
  for (const b of sim.biz) if (b) t += b.cash;
  return t;
}

/** Expected total given the ledger. Equal to totalMoney() when no money has leaked. */
export function ledgerExpected(sim: Sim): number {
  let t = sim.ledger.initial;
  for (const k in sim.ledger.sources) t += sim.ledger.sources[k] as number;
  for (const k in sim.ledger.sinks) t -= sim.ledger.sinks[k] as number;
  return t;
}

export function isWeekend(day: number): boolean {
  return day % 7 >= 5;
}

/** Is the place serving customers at this minute? */
export function servesNow(sim: Sim, id: number, minute: number): boolean {
  const b = sim.biz[id];
  const kind = (sim.world.buildings[id] as Building).kind;
  if (kind === 'park') return minute >= 6 * 60 && minute < 21 * 60;
  const spec = BIZ_SPEC[kind];
  if (!b || !spec || !b.open || b.staff.length === 0) return false;
  return minute >= spec.open[0] && minute < spec.open[1];
}

export function price(sim: Sim, base: number): number {
  return Math.max(1, Math.round(base * sim.town.priceIndex));
}

/** Customer pays a business. Imports leave town; clinic fees go to the treasury. */
export function pay(sim: Sim, a: Agent, bizId: number, amount: number): boolean {
  const b = sim.biz[bizId];
  if (!b || !b.open || a.cash < amount) return false;
  a.cash -= amount;
  if (b.sector === 'civic') { sim.town.cash += amount; return true; }
  const cog = Math.round(amount * CFG.costOfGoods);
  sink(sim, 'imports', cog);
  b.cash += amount - cog;
  b.salesToday += amount;
  return true;
}

export function wageFor(b: Business, a: Agent): number {
  return Math.round(b.baseWage * (0.85 + 0.3 * a.skill));
}

export function hire(sim: Sim, a: Agent, bizId: number, quiet = false): void {
  const b = sim.biz[bizId] as Business;
  if (a.job >= 0) leaveJob(sim, a);
  b.staff.push(a.id);
  a.job = bizId;
  a.wage = wageFor(b, a);
  a.unemployedDays = 0;
  if (!quiet) {
    a.moodBoost += 0.25;
    emit(sim, 'hired', 2, `${fullName(a)} was hired at ${(sim.world.buildings[bizId] as Building).name}.`, a.id, -1, bizId);
  }
}

function leaveJob(sim: Sim, a: Agent): void {
  const b = sim.biz[a.job];
  if (b) b.staff = b.staff.filter((id) => id !== a.id);
  a.job = -1;
  a.wage = 0;
}

export function fire(sim: Sim, a: Agent, why: 'layoff' | 'closure' | 'arrest' | 'quit'): void {
  if (a.job < 0) return;
  const name = (sim.world.buildings[a.job] as Building).name;
  const place = a.job;
  leaveJob(sim, a);
  if (why === 'quit') {
    emit(sim, 'quit', 2, `${fullName(a)} quit their job at ${name}.`, a.id, -1, place);
  } else {
    a.moodBoost -= 0.3;
    const reason = why === 'closure' ? 'when it closed' : why === 'arrest' ? 'after being arrested' : 'in a round of layoffs';
    emit(sim, 'fired', 3, `${fullName(a)} lost their job at ${name} ${reason}.`, a.id, -1, place);
  }
  // Whatever they were doing at work no longer applies.
  if (a.action === 'work') a.until = sim.tick;
}

export function householdCash(sim: Sim, hh: Household): number {
  let t = 0;
  for (const id of hh.members) t += (sim.agents[id] as Agent).cash;
  return t;
}

export function rentOf(sim: Sim, hh: Household): number {
  const kind = (sim.world.buildings[hh.home] as Building).kind;
  return price(sim, kind === 'apartment' ? CFG.rentApartment : CFG.rentHouse);
}

/** 0 (comfortable) .. 1 (cannot cover a week of rent and food). */
export function moneyStress(sim: Sim, a: Agent): number {
  const hh = sim.households[a.hh] as Household;
  if (hh.home < 0) return 0;
  const need = (rentOf(sim, hh) + hh.members.length * 3 * price(sim, CFG.mealHome)) * 6;
  return clamp(1 - householdCash(sim, hh) / need, 0, 1);
}

function takeFromHousehold(sim: Sim, hh: Household, amount: number): number {
  let left = amount;
  const adults = hh.members.map((id) => sim.agents[id] as Agent).sort((x, y) => y.cash - x.cash || x.id - y.id);
  for (const a of adults) {
    const take = Math.min(a.cash, left);
    a.cash -= take;
    left -= take;
    if (left <= 0) break;
  }
  return amount - left;
}

function payrollDay(b: Business, sim: Sim): number {
  let t = 0;
  for (const id of b.staff) t += (sim.agents[id] as Agent).wage;
  return t > 0 ? t : b.baseWage;
}

function fromTreasury(sim: Sim, a: Agent, amount: number): void {
  const paid = Math.min(amount, Math.max(0, sim.town.cash));
  sim.town.cash -= paid;
  a.cash += paid;
}

/** Midnight bookkeeping for the day that just ended. */
export function endOfDayEconomy(sim: Sim): void {
  const day = dayOf(sim) - 1;
  const town = sim.town;
  const buildings = sim.world.buildings;

  // 1. Outside money: export income and the state grant.
  town.cash += CFG.stateGrant;
  source(sim, 'stateGrant', CFG.stateGrant);

  for (const b of sim.biz) {
    if (!b) continue;
    const name = (buildings[b.id] as Building).name;
    if (!b.open) {
      if (b.sector !== 'civic' && day - b.closedDay >= CFG.reopenAfterDays && chance(sim.rng, CFG.reopenChance)) {
        b.open = true; b.cash = CFG.reopenCash; b.hiring = true; b.brokeDays = 0; b.demand = 1;
        source(sim, 'investment', CFG.reopenCash);
        emit(sim, 'businessOpened', 4, `${name} reopened under new management.`, -1, -1, b.id);
      }
      continue;
    }
    const workers = b.staff.map((id) => sim.agents[id] as Agent).filter((a) => a.workedToday >= 180);

    if (b.sector === 'industry') {
      let income = 0;
      for (const a of workers) income += a.wage * CFG.exportMargin * b.demand;
      income = Math.round(income);
      const overhead = Math.round(income * CFG.overhead);
      b.cash += income - overhead;
      source(sim, 'exports', income);
      sink(sim, 'overhead', overhead);
    }

    // 2. Payroll. Civic staff are paid by the treasury.
    let unpaid = false;
    for (const a of workers) {
      const pot = b.sector === 'civic' ? town.cash : b.cash;
      const gross = Math.min(a.wage, Math.max(0, pot));
      if (gross < a.wage) unpaid = true;
      const tax = Math.round(gross * CFG.incomeTax);
      if (b.sector === 'civic') town.cash -= gross; else b.cash -= gross;
      town.cash += tax;
      a.cash += gross - tax;
      a.skill = Math.min(1, a.skill + (a.intention?.tag === 'work-hard' ? 0.006 : 0.003));
    }

    // 3. Business health.
    if (b.sector !== 'civic') {
      const pd = payrollDay(b, sim);
      b.brokeDays = unpaid ? b.brokeDays + 1 : Math.max(0, b.brokeDays - 1);
      if (b.brokeDays >= CFG.closeAfterBrokeDays) {
        closeBusiness(sim, b, `${name} ran out of money and closed its doors.`);
        continue;
      }
      if (b.cash < pd * CFG.layoffBelowDays && b.staff.length > 1) {
        const n = b.cash < pd && b.staff.length > 3 ? 2 : 1;
        const order = b.staff.map((id) => sim.agents[id] as Agent).sort((x, y) => x.skill - y.skill || x.id - y.id);
        for (let i = 0; i < n; i++) fire(sim, order[i] as Agent, 'layoff');
        if (n > 1) emit(sim, 'layoffs', 4, `${name} laid off ${n} workers as cash ran short.`, -1, -1, b.id);
      }
      b.hiring = b.cash > pd * CFG.hireAboveDays && b.staff.length < b.slots;
      const cap = pd * CFG.profitCapDays;
      if (b.cash > cap) {
        const out = Math.round((b.cash - cap) * CFG.profitDrain);
        b.cash -= out;
        sink(sim, 'profits', out);
      }
      if (b.sector === 'industry') driftDemand(sim, b, name);
    }
    b.salesToday = 0;
  }

  // 4. Civic staffing follows the treasury.
  const civic = sim.biz.filter((b): b is Business => !!b && b.sector === 'civic');
  let civicPayroll = 0;
  for (const b of civic) civicPayroll += payrollDay(b, sim);
  const flush = town.cash > CFG.treasuryReserve;
  for (const b of civic) b.hiring = flush && b.staff.length < b.slots;
  if (town.cash < civicPayroll * 1.5) {
    const big = civic.filter((b) => b.staff.length > 1).sort((x, y) => y.staff.length - x.staff.length || x.id - y.id)[0];
    if (big) {
      const order = big.staff.map((id) => sim.agents[id] as Agent).sort((x, y) => x.skill - y.skill || x.id - y.id);
      fire(sim, order[0] as Agent, 'layoff');
    }
  }

  // 5. Rent, then pensions, benefits and child allowance.
  for (const hh of sim.households) {
    if (hh.home < 0 || hh.members.length === 0) continue;
    const rent = rentOf(sim, hh);
    const paid = takeFromHousehold(sim, hh, rent);
    town.cash += paid;
    if (paid < rent) for (const id of hh.members) (sim.agents[id] as Agent).moodBoost -= 0.06;
  }
  for (const a of sim.agents) {
    if (!isActive(a)) continue;
    if (isSenior(a)) fromTreasury(sim, a, CFG.pension);
    else if (isWorkingAge(a) && a.job < 0) fromTreasury(sim, a, CFG.benefit);
    else if (a.age < 18) {
      const hh = sim.households[a.hh] as Household;
      const carer = hh.members.map((id) => sim.agents[id] as Agent).find((m) => m.age >= 18);
      if (carer) fromTreasury(sim, carer, CFG.childAllowance);
    }
    a.workedToday = 0;
  }

  // 6. A treasury that hoards spends the surplus on works contracted out of town.
  if (town.cash > 9000) {
    const out = Math.round((town.cash - 9000) * 0.12);
    town.cash -= out;
    sink(sim, 'publicWorks', out);
  }

  // 7. Prices follow export demand and how much cash is sloshing around.
  let demand = 0, n = 0;
  for (const b of sim.biz) if (b && b.sector === 'industry' && b.open) { demand += b.demand; n++; }
  const avgDemand = n ? demand / n : 0.8;
  const target = 1 + 0.3 * (avgDemand - 1) + 0.15 * clamp(totalMoney(sim) / sim.ledger.initial - 1, -0.5, 1);
  town.priceIndex = clamp(town.priceIndex + (target - town.priceIndex) * 0.06 + range(sim.rng, -0.006, 0.006), 0.7, 1.6);
}

function driftDemand(sim: Sim, b: Business, name: string): void {
  b.demand += (1 - b.demand) * CFG.demandRevert + range(sim.rng, -CFG.demandNoise, CFG.demandNoise);
  if (chance(sim.rng, CFG.shockChance)) {
    const up = rand(sim.rng) < 0.5;
    b.demand += up ? CFG.shockSize : -CFG.shockSize;
    emit(sim, 'shock', 4, up ? `A big outside order landed at ${name}. Business is booming.` : `Orders collapsed at ${name}. Outside demand has slumped.`, -1, -1, b.id);
  }
  b.demand = clamp(b.demand, 0.35, 1.7);
}

export function closeBusiness(sim: Sim, b: Business, text: string): void {
  for (const id of [...b.staff]) fire(sim, sim.agents[id] as Agent, 'closure');
  b.open = false;
  b.hiring = false;
  b.closedDay = dayOf(sim);
  b.brokeDays = 0;
  // Leftover cash goes to the town as unpaid dues.
  sim.town.cash += b.cash;
  b.cash = 0;
  emit(sim, 'businessClosed', 5, text, -1, -1, b.id);
}

/** Businesses with an open vacancy, best wage first. */
export function vacancies(sim: Sim): Business[] {
  return sim.biz
    .filter((b): b is Business => !!b && b.open && b.hiring && b.staff.length < b.slots)
    .sort((x, y) => y.baseWage - x.baseWage || x.id - y.id);
}
