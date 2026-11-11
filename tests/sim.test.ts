import { describe, expect, it } from 'vitest';
import { RuleMind } from '../src/mind/ruleMind';
import { CFG, splitBudget } from '../src/sim/config';
import { ledgerExpected, totalMoney } from '../src/sim/economy';
import { stateHash } from '../src/sim/hash';
import { checkInvariants } from '../src/sim/invariants';
import { buildReport } from '../src/sim/report';
import { makeRng, rand } from '../src/sim/rng';
import { createSim, godCloseFactory, godDoublePolice, godFluOutbreak, godStimulus, runTicks, tick } from '../src/sim/sim';
import type { DecisionRequest, Mind } from '../src/sim/types';
import { whereIs } from '../src/sim/where';
import { routeLength, travelMinutes } from '../src/sim/world';

const DAY = CFG.dayTicks;

describe('rng', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = makeRng(5), b = makeRng(5), c = makeRng(6);
    const xs = Array.from({ length: 200 }, () => rand(a));
    const ys = Array.from({ length: 200 }, () => rand(b));
    const zs = Array.from({ length: 200 }, () => rand(c));
    expect(xs).toEqual(ys);
    expect(xs).not.toEqual(zs);
    expect(xs.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe('world', () => {
  const sim = createSim(42, new RuleMind());
  it('has the planned mix of buildings', () => {
    const kinds = sim.world.buildings.map((b) => b.kind);
    expect(kinds.filter((k) => k === 'house').length).toBeGreaterThanOrEqual(30);
    expect(kinds.filter((k) => k === 'apartment').length).toBe(3);
    for (const k of ['school', 'clinic', 'police', 'townhall', 'grocery', 'store', 'cafe', 'restaurant', 'bar', 'factory', 'office', 'farm', 'park']) {
      expect(kinds).toContain(k);
    }
  });
  it('connects every pair of doors, with the longest commute under 45 sim minutes', () => {
    let longest = 0;
    const n = sim.world.buildings.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      expect(routeLength(sim.world, i, j)).toBeGreaterThan(0);
      longest = Math.max(longest, travelMinutes(sim.world, i, j));
    }
    expect(longest).toBeLessThan(45);
  });
  it('starts with 100 people in the planned age bands', () => {
    expect(sim.agents.length).toBe(100);
    expect(sim.agents.filter((a) => a.age < 18).length).toBe(18);
    expect(sim.agents.filter((a) => a.age >= 66).length).toBe(12);
  });
});

describe('simulation', () => {
  it('runs 15 days with no invariant violations and a balanced ledger', () => {
    const sim = createSim(7, new RuleMind());
    const out = [0, 0];
    for (let d = 0; d < 15; d++) {
      runTicks(sim, DAY);
      expect(checkInvariants(sim)).toEqual([]);
    }
    expect(totalMoney(sim)).toBe(ledgerExpected(sim));
    for (const a of sim.agents) {
      whereIs(sim, a, sim.tick, out);
      expect(Number.isFinite(out[0]) && Number.isFinite(out[1])).toBe(true);
    }
    expect(sim.metrics.length).toBe(16);
    expect(sim.news.length).toBe(15);
  });

  it('gives the same state hash for the same seed and a different one for another seed', () => {
    const a = createSim(11, new RuleMind()), b = createSim(11, new RuleMind()), c = createSim(12, new RuleMind());
    runTicks(a, DAY * 6); runTicks(b, DAY * 6); runTicks(c, DAY * 6);
    expect(stateHash(a)).toBe(stateHash(b));
    expect(stateHash(a)).not.toBe(stateHash(c));
  });

  it('keeps the ledger balanced through every god tool', () => {
    const sim = createSim(3, new RuleMind());
    runTicks(sim, DAY * 2);
    godStimulus(sim);
    godFluOutbreak(sim);
    godDoublePolice(sim);
    expect(godCloseFactory(sim)).toBe(true);
    runTicks(sim, DAY * 5);
    expect(checkInvariants(sim)).toEqual([]);
    expect(sim.events.some((e) => e.type === 'policy')).toBe(true);
  });

  it('builds a report with at least four stories', () => {
    const sim = createSim(42, new RuleMind());
    runTicks(sim, DAY * 20);
    const r = buildReport(sim);
    expect(r.stories.length).toBeGreaterThanOrEqual(4);
    expect(r.metrics.length).toBe(21);
  });
});

describe('mind budget', () => {
  it('splits 12 calls into 8 intentions, 3 dilemmas and 1 newspaper', () => {
    expect(splitBudget(12)).toEqual({ intentions: 8, dilemmas: 3, news: 1 });
    expect(splitBudget(0)).toEqual({ intentions: 0, dilemmas: 0, news: 0 });
    for (let t = 0; t <= 30; t++) {
      const b = splitBudget(t);
      expect(b.intentions + b.dilemmas + b.news).toBe(t);
    }
  });

  it('never exceeds the daily budget, and makes zero calls at budget 0', () => {
    let calls = 0;
    const counting: Mind = { kind: 'rule', decide(req, resolve) { calls++; resolve(req.ruleChoice, ''); }, newspaper() { calls++; } };
    const sim = createSim(9, counting, { budget: 5 });
    for (let d = 0; d < 10; d++) {
      const before = calls;
      runTicks(sim, DAY);
      expect(calls - before).toBeLessThanOrEqual(5);
    }
    expect(calls).toBeGreaterThan(10);

    let silent = 0;
    const none: Mind = { kind: 'rule', decide() { silent++; }, newspaper() { silent++; } };
    const fast = createSim(9, none, { budget: 0 });
    runTicks(fast, DAY * 10);
    expect(silent).toBe(0);
    expect(checkInvariants(fast)).toEqual([]);
  });

  it('replays a run with asynchronous model decisions exactly from its log', () => {
    // A stand-in for the LLM: answers a while later, often disagreeing with the rules.
    const waiting: { req: DecisionRequest; resolve: (c: number, r: string) => void; at: number }[] = [];
    let simRef: ReturnType<typeof createSim> | null = null;
    const slow: Mind = {
      kind: 'llm',
      decide(req, resolve) { waiting.push({ req, resolve, at: (simRef?.tick ?? 0) + 7 + (req.id % 40) }); },
    };
    const sim = createSim(21, slow);
    simRef = sim;
    for (let t = 0; t < DAY * 8; t++) {
      for (let i = waiting.length - 1; i >= 0; i--) {
        const w = waiting[i]!;
        if (w.at <= sim.tick) { waiting.splice(i, 1); w.resolve((w.req.ruleChoice + 1) % w.req.options.length, 'because'); }
      }
      tick(sim);
    }
    expect(sim.decisions.some((d) => d.by === 'llm')).toBe(true);
    expect(checkInvariants(sim)).toEqual([]);

    const again = createSim(21, new RuleMind(), { replay: sim.decisions });
    runTicks(again, DAY * 8);
    expect(stateHash(again)).toBe(stateHash(sim));

    const rules = createSim(21, new RuleMind());
    runTicks(rules, DAY * 8);
    expect(stateHash(rules)).not.toBe(stateHash(sim));
  });
});
