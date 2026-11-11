// Tick loop and the public API. Everything outside src/sim/ talks to the sim through this file.
import { arrive, finishAction, isWalking, updateNeeds } from './actions';
import { createPopulation } from './agent';
import { decide } from './brain';
import { CFG } from './config';
import { dailyDilemmas, expireDecisions, requestIntentionBatch, resolveDecision } from './decisions';
import { closeBusiness, createBusinesses, endOfDayEconomy, source } from './economy';
import { dayOf, emit, isActive } from './events';
import { dailyHealth, infect } from './health';
import { snapshot } from './metrics';
import { dailyMigration } from './migration';
import { makeRng, rand } from './rng';
import { dailySocial, socialTick, visitInteraction } from './social';
import type { Agent, Building, Business, DecisionLog, Mind, NewsRequest, Sim, SimEvent } from './types';
import { createWorld } from './world';

export interface SimOptions {
  budget?: number;
  /** Decision log from an earlier run. Model choices are re-applied at their logged ticks. */
  replay?: DecisionLog[];
}

/** A mind that never answers. Used for replays and for Fast skip (budget 0 makes it moot). */
export const silentMind: Mind = { kind: 'replay', decide() { /* the log or the deadline decides */ } };

export function createSim(seed: number, mind: Mind, opts: SimOptions = {}): Sim {
  const rng = makeRng(seed);
  const world = createWorld(rng);
  const sim: Sim = {
    seed, rng, tick: 0, world,
    agents: [], households: [], biz: [],
    town: { cash: 0, priceIndex: 1, policeBoost: 0, crimesToday: 0, illnessesToday: 0, callsToday: { intentions: 0, dilemmas: 0, news: 0 }, callsTotal: 0 },
    ledger: { initial: 0, sources: {}, sinks: {} },
    events: [], metrics: [], pending: [], decisions: [], news: [],
    budget: opts.budget ?? CFG.budgetDefault,
    mind: opts.replay ? silentMind : mind,
    nextDecisionId: 0,
    replay: opts.replay ? opts.replay.filter((d) => d.by === 'llm') : null,
    replayCursor: 0,
    occupants: world.buildings.map(() => []),
  };
  createBusinesses(sim);
  createPopulation(sim);
  // Stagger the first wake-ups so the town does not move as one.
  for (const a of sim.agents) {
    a.until = 5 * 60 + Math.floor(rand(rng) * 150);
    a.action = 'sleep';
    a.startMood = a.mood;
  }
  sim.metrics.push(snapshot(sim, 0));
  return sim;
}

function topEvents(sim: Sim, day: number, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = sim.events.length - 1; i >= 0; i--) {
    const e = sim.events[i] as SimEvent;
    if (e.day < day) break;
    if (e.day === day && e.type !== 'decision') out.push(e);
  }
  return out.sort((a, b) => b.sev - a.sev || a.id - b.id).slice(0, n);
}

function newspaper(sim: Sim, day: number): void {
  const top = topEvents(sim, day, 4);
  const m = sim.metrics[sim.metrics.length - 1]!;
  const lead = top[0];
  const headline = lead ? lead.text.replace(/\.$/, '') : 'A quiet day in town';
  const rest = top.slice(1, 3).map((e) => e.text).join(' ');
  const blurb = `${rest || 'Nothing else of note happened.'} ${Math.round(m.employment * 100)}% of the town is in work; the mood is ${m.mood > 0.62 ? 'bright' : m.mood > 0.5 ? 'steady' : 'grim'}.`;
  sim.news.push({ day, headline, blurb, by: 'rule' });
  if (sim.town.callsToday.news < (sim.budget > 0 ? 1 : 0) && sim.mind.newspaper) {
    sim.town.callsToday.news++;
    sim.town.callsTotal++;
    const req: NewsRequest = { day, facts: top.map((e) => e.text), ruleHeadline: headline, ruleBlurb: blurb };
    sim.mind.newspaper(req, (h, b) => setNews(sim, day, h, b));
  }
}

/** Flavour only: replaces the rule-written paper for a day. Not part of the state hash. */
export function setNews(sim: Sim, day: number, headline: string, blurb: string): void {
  const item = sim.news.find((n) => n.day === day);
  if (item && headline) { item.headline = headline; item.blurb = blurb || item.blurb; item.by = 'llm'; }
}

function endOfDay(sim: Sim): void {
  const ended = dayOf(sim) - 1;
  endOfDayEconomy(sim);
  dailyHealth(sim);
  dailyMigration(sim);
  dailySocial(sim);
  sim.metrics.push(snapshot(sim, ended + 1));
  sim.town.crimesToday = 0;
  sim.town.illnessesToday = 0;
  sim.town.callsToday = { intentions: 0, dilemmas: 0, news: 0 };
  newspaper(sim, ended);
  if (ended + 1 === CFG.totalDays) emit(sim, 'milestone', 5, 'Day 100. The town takes stock of how far it has come.', -1);
  dailyDilemmas(sim);
  requestIntentionBatch(sim);
}

/** Advance the simulation by one sim minute. Never waits on the Mind. */
export function tick(sim: Sim): void {
  const t = sim.tick;
  if (sim.replay) {
    while (sim.replayCursor < sim.replay.length && (sim.replay[sim.replayCursor] as DecisionLog).tick <= t) {
      const d = sim.replay[sim.replayCursor++] as DecisionLog;
      resolveDecision(sim, d.id, d.choice, d.reason, 'llm');
    }
  }
  if (sim.pending.length > 0) expireDecisions(sim);

  const agents = sim.agents;
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i] as Agent;
    if (a.status !== 'active') continue;
    if (a.tripFrom >= 0 && t >= a.tripEnd) {
      arrive(sim, a);
      if (a.action === 'visit') visitInteraction(sim, a);
    }
    if (t >= a.until && a.pendingDecision < 0) {
      finishAction(sim, a);
      if (a.status === 'active') decide(sim, a);
    } else if (t >= a.until && a.action !== 'mull') {
      // Waiting on a dilemma while asleep or in jail: keep the routine going.
      finishAction(sim, a);
      decide(sim, a);
    }
    if ((t + a.id) % 10 === 0) updateNeeds(sim, a, 10);
  }
  if (t % CFG.socialEvery === 0) socialTick(sim);
  sim.tick = t + 1;
  // Midnight bookkeeping runs as the last minute of the day completes, so a run of exactly
  // N days includes N daily snapshots.
  if (sim.tick % CFG.dayTicks === 0) endOfDay(sim);
}

export function runTicks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) tick(sim);
}

// ---------------------------------------------------------------- queries

export function clock(sim: Sim): { day: number; hour: number; minute: number; weekday: string } {
  const day = dayOf(sim);
  const m = sim.tick % CFG.dayTicks;
  return { day: day + 1, hour: Math.floor(m / 60), minute: m % 60, weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day % 7] as string };
}

export function activeAgents(sim: Sim): Agent[] {
  return sim.agents.filter(isActive);
}

export function occupantsOf(sim: Sim, building: number): Agent[] {
  return sim.agents.filter((a) => isActive(a) && a.at === building && !isWalking(a));
}

/** Overnight model requests still waiting for an answer. Drives the dawn gate. */
export function pendingIntentions(sim: Sim): number {
  let n = 0;
  for (const r of sim.pending) if (r.kind === 'intention') n++;
  return n;
}

/** Apply the rule choice to everything outstanding (dawn timeout, or switching AI off). */
export function flushPending(sim: Sim): void {
  for (const r of [...sim.pending]) resolveDecision(sim, r.id, r.ruleChoice, '', 'rule');
}

export function setBudget(sim: Sim, total: number): void {
  sim.budget = Math.max(0, Math.min(CFG.budgetMax, Math.round(total)));
}

export function setMind(sim: Sim, mind: Mind): void {
  sim.mind = mind;
}

// ---------------------------------------------------------------- god tools

function kindId(sim: Sim, kind: Building['kind']): number {
  return sim.world.buildings.findIndex((b) => b.kind === kind);
}

export function godCloseFactory(sim: Sim): boolean {
  const b = sim.biz[kindId(sim, 'factory')] as Business;
  if (!b.open) return false;
  emit(sim, 'policy', 5, 'By decree, the factory has been shut down.', -1, -1, b.id);
  closeBusiness(sim, b, 'Brightworks Factory closed. Every worker was sent home.');
  return true;
}

export function godStimulus(sim: Sim, perAdult = 300): void {
  let total = 0;
  for (const a of sim.agents) if (isActive(a) && a.age >= 18) { a.cash += perAdult; a.moodBoost += 0.15; total += perAdult; }
  source(sim, 'stimulus', total);
  emit(sim, 'policy', 4, `A stimulus payment of $${perAdult} landed in every adult's account.`, -1);
}

export function godFluOutbreak(sim: Sim, count = 12): void {
  const pool = sim.agents.filter((a) => isActive(a) && !a.illness);
  let n = 0;
  for (let i = 0; i < pool.length && n < count; i++) {
    const a = pool[Math.floor(rand(sim.rng) * pool.length)] as Agent;
    if (a.illness) continue;
    a.immuneUntil = 0;
    infect(sim, a, 'flu');
    n++;
  }
  emit(sim, 'outbreak', 4, `A nasty flu strain arrived in town. ${n} people fell ill at once.`, -1);
}

export function godDoublePolice(sim: Sim): void {
  const b = sim.biz[kindId(sim, 'police')] as Business;
  sim.town.policeBoost += Math.max(2, b.staff.length);
  emit(sim, 'policy', 3, 'Police numbers were doubled with officers seconded from the county.', -1, -1, b.id);
}
