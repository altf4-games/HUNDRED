// The hooks through which a Mind steers the sim: daily intentions and dilemmas.
// The sim builds a numbered list of options plus the rule-based choice, hands it to the Mind,
// and applies the rule choice itself if the budget is spent or the deadline passes.
import { CFG, splitBudget } from './config';
import { startAction } from './actions';
import { intentionOptions, jobTitle, placeOf } from './brain';
import { attemptArrest } from './crime';
import { fire, moneyStress } from './economy';
import { dayOf, emit, fullName, isActive, remember } from './events';
import { householdLeaves } from './migration';
import { chance } from './rng';
import { becomePartners } from './social';
import type { Agent, Building, DecisionRequest, DilemmaKind, Household, IntentionTag, Sim } from './types';

function traitWords(a: Agent): string {
  const t = a.traits;
  const w: string[] = [];
  w.push(t.sociability > 0.6 ? 'outgoing' : t.sociability < 0.4 ? 'reserved' : 'easygoing');
  w.push(t.ambition > 0.6 ? 'ambitious' : t.ambition < 0.4 ? 'content' : 'steady');
  w.push(t.honesty > 0.65 ? 'honest' : t.honesty < 0.45 ? 'slippery' : 'fair');
  if (t.impulsivity > 0.6) w.push('impulsive');
  if (t.resilience > 0.62) w.push('tough'); else if (t.resilience < 0.38) w.push('fragile');
  return w.join(', ');
}

export function persona(sim: Sim, a: Agent): string {
  return `${fullName(a)}, ${a.age}, ${jobTitle(sim, a)} in a small town. Personality: ${traitWords(a)}.`;
}

export function stateLine(sim: Sim, a: Agent): string {
  const mood = a.mood > 0.65 ? 'in good spirits' : a.mood > 0.42 ? 'getting by' : 'feeling low';
  const stress = a.age >= 18 ? moneyStress(sim, a) : 0;
  const money = stress > 0.7 ? 'nearly broke' : stress > 0.35 ? 'short of money' : 'financially okay';
  const bits = [mood, money];
  if (a.illness) bits.push('ill');
  if (a.partner >= 0) bits.push(`with ${(sim.agents[a.partner] as Agent).first}`);
  return `Right now: ${bits.join(', ')}.`;
}

function recentMemories(a: Agent, n: number): string[] {
  return a.mem.slice(-n).map((m) => m.text);
}

function submit(sim: Sim, req: DecisionRequest): void {
  const b = splitBudget(sim.budget);
  const calls = sim.town.callsToday;
  const kindBudget = req.kind === 'intention' ? b.intentions : b.dilemmas;
  const used = req.kind === 'intention' ? calls.intentions : calls.dilemmas;
  sim.pending.push(req);
  if (used >= kindBudget) {
    // Out of budget for today: the rule decides on the spot and no call is made.
    resolveDecision(sim, req.id, req.ruleChoice, '', 'rule');
    return;
  }
  if (req.kind === 'intention') calls.intentions++; else calls.dilemmas++;
  sim.town.callsTotal++;
  const by = sim.mind.kind === 'llm' ? 'llm' : 'rule';
  sim.mind.decide(req, (choice, reason) => resolveDecision(sim, req.id, choice, reason, by));
}

/** Ask for an agent's intention for the next few days. Deadline is dawn. */
export function requestIntention(sim: Sim, a: Agent): void {
  const opts = intentionOptions(sim, a);
  let best = 0;
  for (let i = 1; i < opts.length; i++) if ((opts[i]!).weight > (opts[best]!).weight) best = i;
  const dawn = dayOf(sim) * CFG.dayTicks + 6 * 60;
  submit(sim, {
    id: sim.nextDecisionId++, kind: 'intention', dilemma: null, agent: a.id, other: -1, place: -1,
    persona: persona(sim, a),
    situation: `${stateLine(sim, a)} What should ${a.first} focus on over the next few days?`,
    memories: recentMemories(a, 4),
    options: opts.map((o) => o.label),
    tags: opts.map((o) => (o.target >= 0 ? `${o.tag}:${o.target}` : o.tag)),
    ruleChoice: best, created: sim.tick, deadline: Math.max(dawn, sim.tick + 30),
  });
}

/** Put a high-stakes choice to an agent. They mull it over until it resolves. */
export function requestDilemma(sim: Sim, kind: DilemmaKind, a: Agent, other = -1, place = -1): void {
  const rng = sim.rng;
  const t = a.traits;
  const o = other >= 0 ? (sim.agents[other] as Agent) : null;
  let situation = '';
  let options: string[] = [];
  let tags: string[] = [];
  let rule = 1;
  switch (kind) {
    case 'steal': {
      const shop = (sim.world.buildings[place] as Building).name;
      situation = `${a.first} is hungry, the cupboard is empty and there is almost no money left. ${shop} is right there.`;
      options = [`Steal from ${shop}`, 'Go without and ask around for help'];
      tags = ['steal', 'abstain'];
      rule = chance(rng, (1 - t.honesty) * (0.35 + t.impulsivity * 0.6)) ? 0 : 1;
      break;
    }
    case 'quit': {
      const job = (sim.world.buildings[a.job] as Building).name;
      situation = `${a.first} has been miserable for days working at ${job} for $${a.wage} a day, with $${a.cash} saved.`;
      options = ['Quit and look for something better', 'Stay and stick it out'];
      tags = ['quit', 'stay'];
      rule = t.ambition > 0.55 && a.cash > 250 && chance(rng, 0.6) ? 0 : 1;
      break;
    }
    case 'propose': {
      situation = `${a.first} has been seeing ${fullName(o as Agent)} for a while and things are going well.`;
      options = [`Ask ${(o as Agent).first} to move in together`, 'Wait a while longer'];
      tags = ['propose', 'wait'];
      rule = (a.rel[other]?.aff ?? 0) > 0.8 || t.impulsivity > 0.6 || chance(rng, 0.35) ? 0 : 1;
      break;
    }
    case 'report': {
      const shop = place >= 0 ? (sim.world.buildings[place] as Building).name : 'a shop';
      situation = `${a.first} just saw a friend, ${fullName(o as Agent)}, stealing from ${shop}. Nobody else noticed.`;
      options = [`Report ${(o as Agent).first} to the police`, 'Say nothing'];
      tags = ['report', 'silent'];
      rule = t.honesty > 0.66 && (a.rel[other]?.aff ?? 0) < 0.7 ? 0 : 1;
      break;
    }
    case 'leave': {
      situation = `${a.first} has been out of work for ${a.unemployedDays} days and the household is running out of money and hope.`;
      options = ['Pack up and leave town for good', 'Stay and keep trying'];
      tags = ['leave', 'stay'];
      rule = chance(rng, CFG.leaveChance + (1 - t.resilience) * 0.2) ? 0 : 1;
      break;
    }
  }
  a.lastDilemmaDay = dayOf(sim);
  const req: DecisionRequest = {
    id: sim.nextDecisionId++, kind: 'dilemma', dilemma: kind, agent: a.id, other, place,
    persona: persona(sim, a), situation: `${stateLine(sim, a)} ${situation}`, memories: recentMemories(a, 3),
    options, tags, ruleChoice: rule, created: sim.tick, deadline: sim.tick + CFG.dilemmaDeadline,
  };
  a.pendingDecision = req.id;
  submit(sim, req);
  // Still unresolved: the model is thinking, so the agent stops to mull (unless busy asleep or in jail).
  if (a.pendingDecision === req.id && a.action !== 'sleep' && a.action !== 'jailed' && a.tripFrom < 0) {
    startAction(sim, a, 'mull', a.at, CFG.dilemmaDeadline);
  }
}

/** Apply a choice. Safe to call from outside the tick (model replies arrive between ticks). */
export function resolveDecision(sim: Sim, id: number, choice: number, reason: string, by: 'rule' | 'llm'): boolean {
  const idx = sim.pending.findIndex((r) => r.id === id);
  if (idx < 0) return false; // already expired or resolved
  const req = sim.pending[idx] as DecisionRequest;
  sim.pending.splice(idx, 1);
  let who = by;
  if (!Number.isInteger(choice) || choice < 0 || choice >= req.options.length) { choice = req.ruleChoice; who = 'rule'; reason = ''; }
  const a = sim.agents[req.agent] as Agent;
  const tag = req.tags[choice] as string;
  const label = req.options[choice] as string;
  sim.decisions.push({ id, tick: sim.tick, kind: req.kind, agent: a.id, choice, tag, reason, by: who });
  if (a.pendingDecision === id) {
    a.pendingDecision = -1;
    if (a.action === 'mull') a.until = sim.tick; // stop mulling and act
  }
  if (!isActive(a)) return true;
  const day = dayOf(sim);
  const why = reason ? ` "${reason}"` : '';

  if (req.kind === 'intention') {
    const [t, target] = tag.split(':');
    a.intention = { tag: t as IntentionTag, target: target !== undefined ? +target : -1, until: day + CFG.intentionDays, reason: reason || label, by: who };
    a.lastIntentionDay = day;
    a.shock = 0;
    if (t !== 'carry-on') remember(a, day, 'decision', `Resolved to: ${label.toLowerCase()}.${why}`);
    return true;
  }

  const other = req.other >= 0 ? (sim.agents[req.other] as Agent) : null;
  emit(sim, 'decision', 2, `${fullName(a)} made a choice: ${label.toLowerCase()}.${why}`, a.id, -1, req.place);
  switch (tag) {
    case 'steal':
      a.forced = { action: 'steal', place: req.place, minutes: 12 };
      break;
    case 'abstain':
      a.moodBoost -= 0.05;
      break;
    case 'quit':
      if (a.job >= 0) {
        fire(sim, a, 'quit');
        a.intention = { tag: 'find-better-job', target: -1, until: day + CFG.intentionDays, reason: reason || 'Time for something better', by: who };
      }
      break;
    case 'propose':
      if (other && isActive(other) && a.partner === other.id) becomePartners(sim, a, other);
      break;
    case 'report':
      if (other && isActive(other)) {
        const r = a.rel[other.id], r2 = other.rel[a.id];
        if (r) r.aff -= 0.5;
        if (r2) r2.aff -= 0.5;
        attemptArrest(sim, other, 'theft', 1);
      }
      break;
    case 'leave': {
      const hh = sim.households[a.hh] as Household;
      if (hh.home >= 0) householdLeaves(sim, hh);
      break;
    }
    default:
      break;
  }
  return true;
}

/** Fall back to the rule choice for anything past its deadline. */
export function expireDecisions(sim: Sim): void {
  for (let i = sim.pending.length - 1; i >= 0; i--) {
    const r = sim.pending[i] as DecisionRequest;
    if (r.deadline <= sim.tick) resolveDecision(sim, r.id, r.ruleChoice, '', 'rule');
  }
}

/** Midnight: pick who gets a fresh intention. Those whose lives changed most go first. */
export function requestIntentionBatch(sim: Sim): void {
  const day = dayOf(sim);
  const n = splitBudget(sim.budget).intentions;
  if (n <= 0) return;
  const pool = sim.agents.filter((a) => isActive(a) && a.age >= 14 && a.jailUntil <= sim.tick);
  // Crisis first, then whoever has gone longest without one.
  pool.sort((x, y) => (y.shock >= 3 ? y.shock : 0) - (x.shock >= 3 ? x.shock : 0) || x.lastIntentionDay - y.lastIntentionDay || x.id - y.id);
  for (let i = 0; i < Math.min(n, pool.length); i++) {
    const a = pool[i] as Agent;
    if (a.lastIntentionDay === day) continue;
    requestIntention(sim, a);
  }
  for (const a of sim.agents) a.shock *= 0.5;
}

/** Midnight: slow-burning dilemmas (quit, propose, leave). */
export function dailyDilemmas(sim: Sim): void {
  const day = dayOf(sim);
  for (const a of sim.agents) {
    if (!isActive(a) || a.age < 18 || a.pendingDecision >= 0 || day - a.lastDilemmaDay < 4) continue;
    if (a.job >= 0 && a.unhappyDays >= 5 && a.age < 66) { requestDilemma(sim, 'quit', a); continue; }
    if (a.partner >= 0 && a.id < a.partner) {
      const r = a.rel[a.partner];
      if (r && r.kind === 'dating' && day - r.since >= CFG.proposeAfterDays && r.aff >= CFG.proposeAt) { requestDilemma(sim, 'propose', a, a.partner); continue; }
    }
    const hh = sim.households[a.hh] as Household;
    if (hh.home >= 0 && firstAdult(sim, hh) === a.id) {
      const adults = hh.members.map((id) => sim.agents[id] as Agent).filter((m) => m.age >= 18);
      const anyJob = adults.some((m) => m.job >= 0);
      const working = adults.filter((m) => m.age < 66);
      if (!anyJob && working.length > 0 && a.age < 66 && a.unemployedDays >= CFG.leaveAfterUnhappyDays && a.mood < 0.52) {
        requestDilemma(sim, 'leave', a);
      }
    }
  }
}

function firstAdult(sim: Sim, hh: Household): number {
  for (const id of hh.members) if ((sim.agents[id] as Agent).age >= 18) return id;
  return -1;
}

export { placeOf };
