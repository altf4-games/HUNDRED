// Interactions, relationships, gossip and contagion. Runs every CFG.socialEvery minutes.
import { vacantHomes } from './agent';
import { CFG } from './config';
import { fight } from './crime';
import { clamp, clamp01, dayOf, emit, fullName, isActive, remember } from './events';
import { infect } from './health';
import { chance, rand, range } from './rng';
import type { Agent, Building, BuildingKind, Household, Rel, Sim } from './types';

const CHATTY: Partial<Record<BuildingKind, number>> = {
  bar: 0.55, cafe: 0.5, restaurant: 0.45, park: 0.5, school: 0.2, house: 0.14, apartment: 0.14,
  factory: 0.1, office: 0.12, farm: 0.12, grocery: 0.12, store: 0.12, townhall: 0.12, clinic: 0.08, police: 0.1,
};

function relOf(a: Agent, b: Agent, day: number): Rel {
  let r = a.rel[b.id];
  if (!r) { r = { aff: 0, fam: 0, kind: 'none', since: day }; a.rel[b.id] = r; }
  return r;
}

function setKind(a: Agent, b: Agent, kind: Rel['kind'], day: number): void {
  const r1 = relOf(a, b, day), r2 = relOf(b, a, day);
  r1.kind = kind; r2.kind = kind; r1.since = day; r2.since = day;
}

function canChat(a: Agent): boolean {
  return a.action !== 'sleep' && a.action !== 'jailed' && a.action !== 'mull' && a.action !== 'sickRest' && a.action !== 'steal';
}

/** One conversation. Affinity is kept symmetric. `nudge` is an intention-driven push. */
export function interact(sim: Sim, a: Agent, b: Agent, place: number, nudge = 0): void {
  const day = dayOf(sim);
  const ra = relOf(a, b, day), rb = relOf(b, a, day);
  const ta = a.traits, tb = b.traits;
  const compat = 1 - (Math.abs(ta.sociability - tb.sociability) * 0.4 + Math.abs(ta.honesty - tb.honesty) * 0.35 + Math.abs(ta.ambition - tb.ambition) * 0.25);
  let delta = (compat - 0.775) * 0.12 + (a.mood + b.mood - 1.25) * 0.03 + range(sim.rng, -0.032, 0.032) + nudge;
  if (ra.kind === 'family') delta = delta * 0.3 + 0.003;
  else if (ra.kind === 'partner' || ra.kind === 'dating') delta += 0.006;
  else if (ra.kind === 'rival') delta -= 0.008;
  if (b.rep < 0.4 || a.rep < 0.4) delta -= 0.01; // a bad name makes people wary
  const aff = clamp(ra.aff + delta, -1, 1);
  ra.aff = aff; rb.aff = aff;
  const fam = Math.min(1, ra.fam + 0.03);
  ra.fam = fam; rb.fam = fam;
  a.needs.social = clamp01(a.needs.social + 0.04);
  b.needs.social = clamp01(b.needs.social + 0.04);
  updateKind(sim, a, b, ra, place);

  // Gossip: pass on something witnessed or heard about a third person.
  if (chance(sim.rng, CFG.gossipChance)) {
    for (let i = a.mem.length - 1; i >= 0; i--) {
      const m = a.mem[i]!;
      if ((m.type !== 'theft' && m.type !== 'fight' && m.type !== 'arrest') || m.other < 0 || m.other === b.id || m.other === a.id) continue;
      if (b.mem.some((x) => x.other === m.other && x.day === m.day && x.type === m.type)) break;
      const subject = sim.agents[m.other] as Agent;
      remember(b, m.day, m.type, m.text.startsWith('Heard') ? m.text : `Heard from ${a.first}: ${m.text}`, m.other);
      if (isActive(subject)) {
        subject.rep = clamp(subject.rep - 0.015, 0, 1);
        const rs = relOf(b, subject, day), rs2 = relOf(subject, b, day);
        rs.aff = clamp(rs.aff - 0.06, -1, 1); rs2.aff = rs.aff;
      }
      break;
    }
  }

  const kind = (sim.world.buildings[place] as Building).kind;
  if (kind === 'bar' && a.age >= 18 && b.age >= 18) {
    const hot = ra.kind === 'rival' ? 6 : a.traits.impulsivity > 0.65 && a.mood < 0.42 ? 2.5 : 0.25;
    if (chance(sim.rng, CFG.barFightChance * hot)) {
      fight(sim, a, b, place);
      const v = clamp(ra.aff - 0.35, -1, 1);
      ra.aff = v; rb.aff = v;
      updateKind(sim, a, b, ra, place);
    }
  }
}

function updateKind(sim: Sim, a: Agent, b: Agent, r: Rel, place: number): void {
  const day = dayOf(sim);
  const k = r.kind;
  const names = `${fullName(a)} and ${fullName(b)}`;
  if (k === 'family') return;
  if (k === 'dating' || k === 'partner') {
    if (r.aff <= CFG.breakupAt) breakUp(sim, a, b);
    return;
  }
  if (k === 'rival') {
    if (r.aff > 0.02) {
      setKind(a, b, 'none', day);
      emit(sim, 'reconciled', 2, `${names} patched things up.`, a.id, b.id, place);
    }
    return;
  }
  if (r.aff <= CFG.rivalAt) {
    setKind(a, b, 'rival', day);
    emit(sim, 'fellOut', k === 'none' ? 2 : 3, `${names} fell out badly.`, a.id, b.id, place);
    a.moodBoost -= 0.08; b.moodBoost -= 0.08;
    return;
  }
  // Romance can grow out of any warm acquaintance.
  if (k !== 'ex' && a.age >= 18 && b.age >= 18 && a.partner < 0 && b.partner < 0 && Math.abs(a.age - b.age) <= 12
    && r.aff >= CFG.datingAt && r.fam >= 0.45 && a.hh !== b.hh) {
    const keen = (a.intention?.tag === 'find-love' ? 2 : 1) * (b.intention?.tag === 'find-love' ? 2 : 1);
    if (chance(sim.rng, 0.1 * keen)) {
      setKind(a, b, 'dating', day);
      a.partner = b.id; b.partner = a.id;
      a.moodBoost += 0.3; b.moodBoost += 0.3;
      emit(sim, 'dating', 2, `${names} started seeing each other.`, a.id, b.id, place);
      return;
    }
  }
  if (k === 'none' && r.aff >= CFG.friendAt && r.fam >= 0.3) {
    setKind(a, b, 'friend', day);
    emit(sim, 'befriended', 1, `${names} became friends.`, a.id, b.id, place);
  } else if (k === 'friend' && r.aff >= CFG.closeAt) {
    setKind(a, b, 'close', day);
    emit(sim, 'closeFriends', 2, `${names} became close friends.`, a.id, b.id, place);
  } else if (k === 'friend' && r.aff < CFG.friendAt - 0.17) {
    setKind(a, b, 'none', day);
  } else if (k === 'close' && r.aff < CFG.closeAt - 0.2) {
    setKind(a, b, 'friend', day);
  }
}

function breakUp(sim: Sim, a: Agent, b: Agent): void {
  const day = dayOf(sim);
  setKind(a, b, 'ex', day);
  a.partner = -1; b.partner = -1;
  a.moodBoost -= 0.35; b.moodBoost -= 0.35;
  emit(sim, 'brokeUp', 3, `${fullName(a)} and ${fullName(b)} broke up.`, a.id, b.id);
  if (a.hh !== b.hh) return;
  // Whoever has less to their name moves out, if there is anywhere to go.
  const mover = a.cash <= b.cash ? a : b;
  const homes = vacantHomes(sim);
  if (homes.length === 0) return;
  const home = homes[Math.floor(rand(sim.rng) * homes.length)] as number;
  moveTo(sim, [mover], { id: sim.households.length, home, members: [], food: 3 });
}

function moveTo(sim: Sim, movers: Agent[], into: Household): void {
  if (!sim.households[into.id]) sim.households.push(into);
  for (const m of movers) {
    const old = sim.households[m.hh] as Household;
    old.members = old.members.filter((id) => id !== m.id);
    if (old.members.length === 0) old.home = -1;
    m.hh = into.id;
    into.members.push(m.id);
    // If they were at the old home, the next decision walks them to the new one.
    if (m.action === 'sleep' || m.action === 'relax' || m.action === 'eatHome') m.until = sim.tick;
  }
}

/** A dating couple commit and move in together. */
export function becomePartners(sim: Sim, a: Agent, b: Agent): void {
  const day = dayOf(sim);
  const r = relOf(b, a, day);
  if (r.aff < 0.6) {
    // Not ready. It stings.
    const v = clamp(r.aff - 0.12, -1, 1);
    r.aff = v; relOf(a, b, day).aff = v;
    a.moodBoost -= 0.2;
    remember(a, day, 'brokeUp', `${b.first} was not ready to move in together.`, b.id);
    return;
  }
  setKind(a, b, 'partner', day);
  a.moodBoost += 0.35; b.moodBoost += 0.35;
  const ha = sim.households[a.hh] as Household, hb = sim.households[b.hh] as Household;
  if (ha.id !== hb.id) {
    // The smaller household moves; children come along.
    const [from, to, mover] = ha.members.length <= hb.members.length ? [ha, hb, a] : [hb, ha, b];
    if (to.members.length < 6) {
      const movers = [mover, ...from.members.map((id) => sim.agents[id] as Agent).filter((m) => m.age < 18)];
      moveTo(sim, movers, to);
    }
  }
  emit(sim, 'partnered', 3, `${fullName(a)} and ${fullName(b)} moved in together.`, a.id, b.id, (sim.households[a.hh] as Household).home);
}

/** Midnight: acquaintances you never see fade. Family and couples are exempt. */
export function dailySocial(sim: Sim): void {
  for (const a of sim.agents) {
    if (!isActive(a)) continue;
    for (const k in a.rel) {
      const r = a.rel[k]!;
      if (r.kind === 'family' || r.kind === 'partner' || r.kind === 'dating') continue;
      r.aff *= CFG.affinityFade;
    }
  }
}

/** One round of chance meetings in every occupied building. */
export function socialTick(sim: Sim): void {
  const occ = sim.occupants;
  for (const list of occ) list.length = 0;
  for (const a of sim.agents) {
    if (isActive(a) && a.tripFrom < 0) (occ[a.at] as number[]).push(a.id);
  }
  const day = dayOf(sim);
  for (let place = 0; place < occ.length; place++) {
    const list = occ[place] as number[];
    if (list.length < 2) continue;
    const kind = (sim.world.buildings[place] as Building).kind;

    // Contagion: flu spreads between people sharing a room. Open air is safer.
    let infectious = 0;
    for (const id of list) { const ill = (sim.agents[id] as Agent).illness; if (ill && ill.kind === 'flu') infectious++; }
    if (infectious > 0) {
      const p = (1 - Math.pow(1 - CFG.contagion, infectious)) * (kind === 'park' ? 0.3 : 1);
      for (const id of list) {
        const o = sim.agents[id] as Agent;
        if (!o.illness && o.immuneUntil <= day && chance(sim.rng, p)) infect(sim, o, 'flu');
      }
    }

    const q = CHATTY[kind] ?? 0.1;
    for (const id of list) {
      const a = sim.agents[id] as Agent;
      if (!isActive(a) || !canChat(a) || !chance(sim.rng, q * (0.5 + a.traits.sociability))) continue;
      const b = sim.agents[list[Math.floor(rand(sim.rng) * list.length)] as number] as Agent;
      if (b.id === a.id || !isActive(b) || !canChat(b) || b.at !== place) continue;
      interact(sim, a, b, place);
    }
  }
}

/** An agent arrives to see the person their intention is about. */
export function visitInteraction(sim: Sim, a: Agent): void {
  const it = a.intention;
  if (!it || it.target < 0) return;
  const t = sim.agents[it.target] as Agent;
  if (!isActive(t) || t.at !== a.at || t.tripFrom >= 0) return;
  if (it.tag === 'reconcile-with') {
    interact(sim, a, t, a.at, 0.12);
  } else if (it.tag === 'confront') {
    if (a.traits.impulsivity > 0.55 && t.traits.impulsivity > 0.45 && chance(sim.rng, 0.3)) fight(sim, a, t, a.at);
    else interact(sim, a, t, a.at, chance(sim.rng, 0.5) ? 0.14 : -0.08); // clearing the air can go either way
    it.until = dayOf(sim); // said their piece
  }
}
