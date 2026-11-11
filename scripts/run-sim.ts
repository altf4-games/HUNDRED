// Headless runner: npm run sim -- --days 100 --seed 42
// Runs the sim on RuleMind, checks invariants every day, and runs twice to prove determinism.
import { RuleMind } from '../src/mind/ruleMind';
import { CFG } from '../src/sim/config';
import { stateHash } from '../src/sim/hash';
import { checkInvariants } from '../src/sim/invariants';
import { buildReport } from '../src/sim/report';
import { createSim, tick } from '../src/sim/sim';
import type { Sim } from '../src/sim/types';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const days = arg('days', 100);
const seed = arg('seed', 42);
const verbose = process.argv.includes('--verbose');
const brief = process.argv.includes('--brief');

function run(check: boolean): { sim: Sim; problems: string[]; maxCalls: number } {
  const sim = createSim(seed, new RuleMind());
  const problems: string[] = [];
  let maxCalls = 0;
  for (let d = 0; d < days; d++) {
    for (let t = 0; t < CFG.dayTicks; t++) {
      tick(sim);
      if (t === CFG.dayTicks - 2) {
        const c = sim.town.callsToday;
        maxCalls = Math.max(maxCalls, c.intentions + c.dilemmas + c.news);
      }
    }
    if (check) for (const p of checkInvariants(sim)) problems.push(`day ${d + 1}: ${p}`);
  }
  return { sim, problems, maxCalls };
}

const t0 = performance.now();
const first = run(true);
const t1 = performance.now();
const second = run(false);
const h1 = stateHash(first.sim), h2 = stateHash(second.sim);
const sim = first.sim;
const rep = buildReport(sim);
const m0 = sim.metrics[0]!, m1 = sim.metrics[sim.metrics.length - 1]!;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const counts: Record<string, number> = {};
for (const e of sim.events) counts[e.type] = (counts[e.type] ?? 0) + 1;

if (brief) {
  // One line per seed, for comparing seeds side by side while tuning.
  const c = (k: string) => counts[k] ?? 0;
  console.log(`seed ${String(seed).padStart(4)} pop ${m0.population}->${m1.population} emp ${pct(m0.employment)}->${pct(m1.employment)} mood ${m0.mood.toFixed(2)}->${m1.mood.toFixed(2)} wealth ${Math.round(m0.meanWealth)}->${Math.round(m1.meanWealth)} gini ${m1.gini.toFixed(2)} biz ${m1.openBusinesses} fr ${m0.friendships}->${m1.friendships} cpl ${m0.couples}->${m1.couples} px ${m1.priceIndex.toFixed(2)} tre ${Math.round(m1.treasury)} | theft ${c('theft')} fight ${c('fight')} arrest ${c('arrest')} ill ${c('fellIll')} died ${c('died')} fired ${c('fired')} hired ${c('hired')} closed ${c('businessClosed')} out ${c('movedAway')} in ${c('movedIn')} dating ${c('dating')} partnered ${c('partnered')} brokeUp ${c('brokeUp')} fellOut ${c('fellOut')} shock ${c('shock')} outbreak ${c('outbreak')}`);
} else {
  console.log(`\nHUNDRED  seed ${seed}  ${days} days  (${((t1 - t0) / 1000).toFixed(2)}s per run)\n`);
  const row = (label: string, a: string | number, b: string | number) => console.log(`  ${label.padEnd(16)} ${String(a).padStart(8)}  ->  ${String(b).padStart(8)}`);
  row('population', m0.population, m1.population);
  row('employment', pct(m0.employment), pct(m1.employment));
  row('mean mood', m0.mood.toFixed(2), m1.mood.toFixed(2));
  row('mean wealth', Math.round(m0.meanWealth), Math.round(m1.meanWealth));
  row('median wealth', Math.round(m0.medianWealth), Math.round(m1.medianWealth));
  row('gini', m0.gini.toFixed(2), m1.gini.toFixed(2));
  row('open businesses', m0.openBusinesses, m1.openBusinesses);
  row('friendships', m0.friendships, m1.friendships);
  row('couples', m0.couples, m1.couples);
  row('price index', m0.priceIndex.toFixed(2), m1.priceIndex.toFixed(2));
  row('treasury', Math.round(m0.treasury), Math.round(m1.treasury));
  console.log(`\n  events: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  ledger sources: ${JSON.stringify(sim.ledger.sources)}`);
  console.log(`  ledger sinks:   ${JSON.stringify(sim.ledger.sinks)}`);
  console.log(`  mind calls: ${sim.town.callsTotal} total, max ${first.maxCalls} in a day (budget ${sim.budget})`);
  console.log('\n  stories:');
  for (const s of rep.stories) console.log(`   - ${s.title}: ${s.name}. ${s.summary}`);
  if (verbose) {
    console.log('\n  timeline:');
    for (const e of rep.timeline) console.log(`   day ${String(e.day + 1).padStart(3)}  ${e.text}`);
    console.log('\n  day  pop  emp  mood  wealth  sick  crimes  demand  treasury  biz');
    for (const m of sim.metrics) {
      if (m.day % 5 === 0) console.log(`  ${String(m.day).padStart(3)}  ${String(m.population).padStart(3)}  ${pct(m.employment).padStart(4)}  ${m.mood.toFixed(2)}  ${String(Math.round(m.meanWealth)).padStart(6)}  ${String(m.sick).padStart(4)}  ${String(m.crimes).padStart(6)}  ${m.demand.toFixed(2).padStart(6)}  ${String(Math.round(m.treasury)).padStart(8)}  ${m.openBusinesses}`);
    }
    console.log('\n  businesses:');
    for (const b of sim.biz) if (b) console.log(`   ${sim.world.buildings[b.id]!.name.padEnd(22)} ${b.open ? 'open  ' : 'CLOSED'} cash ${String(Math.round(b.cash)).padStart(6)} staff ${b.staff.length}/${b.slots} demand ${b.demand.toFixed(2)}`);
  }
  console.log(`\n  state hash: ${h1}  (second run: ${h2})`);
}

let failed = false;
if (h1 !== h2) { console.log('  FAIL: two runs with the same seed gave different hashes'); failed = true; }
if (first.maxCalls > sim.budget) { console.log('  FAIL: mind calls exceeded the daily budget'); failed = true; }
if (first.problems.length) {
  failed = true;
  console.log(`  FAIL: ${first.problems.length} invariant violations`);
  for (const p of first.problems.slice(0, 12)) console.log(`    ${p}`);
}
if ((t1 - t0) / 1000 > 30) { console.log('  FAIL: run took longer than 30 seconds'); failed = true; }
if (!brief) console.log(failed ? '\n  INVARIANTS FAILED\n' : '\n  all invariants passed\n');
process.exit(failed ? 1 : 0);
