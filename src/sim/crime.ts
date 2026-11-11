// Theft, fights, witnesses, police and jail.
import { CFG } from './config';
import { requestDilemma } from './decisions';
import { fire } from './economy';
import { clamp, dayOf, emit, fullName, isActive, remember } from './events';
import { chance, randInt } from './rng';
import type { Agent, Building, Business, Sim } from './types';

/** Agents standing in the same building, not counting those passing through. */
export function witnessesAt(sim: Sim, place: number, except: number, except2 = -1): Agent[] {
  const out: Agent[] = [];
  for (const o of sim.agents) {
    if (isActive(o) && o.id !== except && o.id !== except2 && o.at === place && o.tripFrom < 0 && o.action !== 'sleep') out.push(o);
  }
  return out;
}

export function officers(sim: Sim): number {
  for (const b of sim.biz) {
    if (b && (sim.world.buildings[b.id] as Building).kind === 'police') return b.staff.length + sim.town.policeBoost;
  }
  return sim.town.policeBoost;
}

export function commitTheft(sim: Sim, a: Agent): void {
  const b = sim.biz[a.at] as Business | null;
  if (!b || !b.open || b.cash <= 0) return;
  const shop = (sim.world.buildings[a.at] as Building).name;
  const amount = Math.min(b.cash, randInt(sim.rng, 30, 90));
  b.cash -= amount;
  a.cash += amount;
  sim.town.crimesToday++;
  const day = dayOf(sim);
  const seenBy = witnessesAt(sim, a.at, a.id);
  const seen = seenBy.length > 0 && chance(sim.rng, 1 - Math.pow(0.55, seenBy.length));
  if (!seen) {
    emit(sim, 'theft', 2, `$${amount} went missing from the till at ${shop}. Nobody saw who took it.`, -1, -1, a.at);
    remember(a, day, 'theft', `Stole $${amount} from ${shop} and got away with it.`);
    return;
  }
  const text = `${fullName(a)} was seen stealing $${amount} from ${shop}.`;
  emit(sim, 'theft', 3, text, a.id, -1, a.at);
  a.rep = clamp(a.rep - 0.12, 0, 1);
  for (const w of seenBy) remember(w, day, 'theft', text, a.id);
  const strangers = seenBy.filter((w) => (w.rel[a.id]?.aff ?? 0) < CFG.friendAt);
  if (strangers.length > 0) { attemptArrest(sim, a, 'theft', strangers.length); return; }
  // Only friends saw it. One of them has to decide what to do.
  const friend = seenBy.find((w) => w.age >= 16 && w.pendingDecision < 0);
  if (friend) requestDilemma(sim, 'report', friend, a.id, a.at);
}

export function attemptArrest(sim: Sim, a: Agent, crime: 'theft' | 'fight', reports: number): void {
  const p = clamp(CFG.arrestBase + CFG.arrestPerOfficer * officers(sim) + 0.04 * reports, 0, 0.93);
  if (officers(sim) <= 0 || !chance(sim.rng, p)) {
    emit(sim, 'gossip', 1, `Police looked into the ${crime} but ${fullName(a)} was not charged.`, a.id);
    return;
  }
  const days = crime === 'theft' ? randInt(sim.rng, CFG.jailDaysMin, CFG.jailDaysMax) : 1;
  const fine = Math.min(a.cash, crime === 'theft' ? CFG.fineTheft : CFG.fineFight);
  a.cash -= fine;
  sim.town.cash += fine;
  a.jailUntil = sim.tick + days * CFG.dayTicks;
  a.record++;
  a.rep = clamp(a.rep - 0.25, 0, 1);
  a.moodBoost -= 0.3;
  a.forced = null;
  a.until = sim.tick; // drop everything; decide() walks them to the station
  emit(sim, 'arrest', crime === 'theft' ? 4 : 3, `${fullName(a)} was arrested for ${crime} and jailed for ${days} day${days > 1 ? 's' : ''}.`, a.id, -1, a.at);
  if (a.job >= 0 && chance(sim.rng, crime === 'theft' ? 0.55 : 0.25)) fire(sim, a, 'arrest');
  if (a.partner >= 0) (sim.agents[a.partner] as Agent).moodBoost -= 0.15;
}

export function fight(sim: Sim, a: Agent, b: Agent, place: number): void {
  const where = (sim.world.buildings[place] as Building).name;
  const text = `${fullName(a)} and ${fullName(b)} got into a fight at ${where}.`;
  emit(sim, 'fight', 3, text, a.id, b.id, place);
  sim.town.crimesToday++;
  a.needs.health = clamp(a.needs.health - 0.12, 0, 1);
  b.needs.health = clamp(b.needs.health - 0.12, 0, 1);
  a.rep = clamp(a.rep - 0.06, 0, 1);
  const day = dayOf(sim);
  const seen = witnessesAt(sim, place, a.id, b.id);
  for (const w of seen) remember(w, day, 'fight', text, a.id);
  if (seen.length > 0) attemptArrest(sim, a, 'fight', seen.length);
}
