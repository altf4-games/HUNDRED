// Day-100 report data: then-vs-now, standout lives, town timeline. Pure, so the headless
// runner and the UI share it.
import { jobTitle } from './brain';
import { fullName, isActive } from './events';
import type { Agent, DayMetrics, Memory, Sim, SimEvent } from './types';

export interface Story {
  title: string;
  agent: number;
  name: string;
  summary: string;
  timeline: Memory[];
}

export interface Report {
  first: DayMetrics;
  last: DayMetrics;
  metrics: DayMetrics[];
  stories: Story[];
  timeline: SimEvent[];
  totals: { crimes: number; illnesses: number; deaths: number; arrivals: number; departures: number; closures: number; modelDecisions: number };
}

export function friendsOf(sim: Sim, a: Agent): number {
  let n = 0;
  for (const k in a.rel) {
    const r = a.rel[k]!;
    if ((r.kind === 'friend' || r.kind === 'close') && isActive(sim.agents[+k] as Agent)) n++;
  }
  return n;
}

/** "Works as a cook" / "Retired" / "Out of work". */
export function jobPhrase(sim: Sim, a: Agent): string {
  const t = jobTitle(sim, a);
  if (t === 'retired') return 'Retired';
  if (t === 'unemployed') return 'Out of work';
  if (t === 'pupil') return 'At school';
  return `Works as ${/^[aeiou]/.test(t) ? 'an' : 'a'} ${t}`;
}

function keyMoments(a: Agent): Memory[] {
  const skip = new Set(['befriended', 'gossip', 'recovered']);
  // Their own moments always name them; fights they merely witnessed or heard about do not.
  const own = a.mem.filter((m) => !m.text.startsWith('Heard') && m.text.includes(a.first));
  const strong = own.filter((m) => !skip.has(m.type));
  return (strong.length >= 3 ? strong : own.length ? own : a.mem).slice(-6);
}

export function buildReport(sim: Sim): Report {
  const first = sim.metrics[0]!;
  const last = sim.metrics[sim.metrics.length - 1]!;
  const everyone = sim.agents.filter((a) => a.age >= 18);
  const active = everyone.filter(isActive);
  const stories: Story[] = [];
  const used = new Set<number>();
  const add = (title: string, a: Agent | undefined, summary: (a: Agent) => string) => {
    if (!a || used.has(a.id)) return;
    used.add(a.id);
    stories.push({ title, agent: a.id, name: fullName(a), summary: summary(a), timeline: keyMoments(a) });
  };
  const by = (list: Agent[], f: (a: Agent) => number) => list.slice().sort((x, y) => f(y) - f(x) || x.id - y.id);
  const originals = active.filter((a) => a.arrivedDay === 0);

  add('Biggest rise', by(originals, (a) => a.cash - a.startCash)[0],
    (a) => `Started with $${a.startCash} and now has $${a.cash}. ${jobPhrase(sim, a)}.`);
  add('Biggest fall', by(originals, (a) => a.startCash - a.cash + (a.startJob >= 0 && a.job < 0 ? 400 : 0) + a.record * 200)[0],
    (a) => `Went from $${a.startCash} to $${a.cash}${a.startJob >= 0 && a.job < 0 ? ' and lost their job along the way' : ''}.`);
  add('Most connected', by(active, (a) => friendsOf(sim, a))[0],
    (a) => `Counts ${friendsOf(sim, a)} friends in town${a.partner >= 0 ? ` and shares a life with ${(sim.agents[a.partner] as Agent).first}` : ''}.`);
  const notorious = by(everyone, (a) => a.record * 2 + (0.6 - a.rep) * 3)[0];
  if (notorious && (notorious.record > 0 || notorious.rep < 0.45)) {
    add('Most notorious', notorious, (a) => `${a.record} run-in${a.record === 1 ? '' : 's'} with the police; reputation ${Math.round(a.rep * 100)}/100.`);
  }
  add('A newcomer', by(active.filter((a) => a.arrivedDay > 0), (a) => friendsOf(sim, a) * 100 + a.cash)[0],
    (a) => `Arrived on day ${a.arrivedDay + 1}. ${jobPhrase(sim, a)}, with ${friendsOf(sim, a)} friends in town.`);
  const love = by(active.filter((a) => a.mem.some((m) => m.type === 'partnered' || m.type === 'dating')), (a) => (a.partner >= 0 ? 10 : 0) + a.mood)[0];
  add('A love story', love, (a) => (a.partner >= 0 ? `Found ${(sim.agents[a.partner] as Agent).first} during these hundred days.` : 'Love came and went.'));
  add('Happiest soul', by(active, (a) => a.mood)[0], (a) => `Mood ${Math.round(a.mood * 100)}/100. ${jobPhrase(sim, a)}, and seems to have it figured out.`);
  add('Hardest road', by(active, (a) => -a.mood)[0], (a) => `Mood ${Math.round(a.mood * 100)}/100. ${a.job < 0 && a.age < 66 ? 'Out of work.' : 'Still getting up every morning.'}`);
  const lost = by(everyone.filter((a) => a.status === 'dead'), (a) => friendsOf(sim, a))[0];
  add('In memoriam', lost, (a) => `Died on day ${a.goneDay + 1}, aged ${a.age}.`);

  const timeline = sim.events
    .filter((e) => e.sev >= 3 && e.type !== 'decision')
    .sort((a, b) => b.sev - a.sev || a.id - b.id)
    .slice(0, 22)
    .sort((a, b) => a.id - b.id);

  const count = (t: string) => sim.events.reduce((n, e) => n + (e.type === t ? 1 : 0), 0);
  return {
    first, last, metrics: sim.metrics, stories, timeline,
    totals: {
      crimes: sim.metrics.reduce((n, m) => n + m.crimes, 0),
      illnesses: sim.metrics.reduce((n, m) => n + m.illnesses, 0),
      deaths: count('died'), arrivals: count('movedIn'), departures: count('movedAway'), closures: count('businessClosed'),
      modelDecisions: sim.decisions.filter((d) => d.by === 'llm').length,
    },
  };
}
