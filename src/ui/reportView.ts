// The Day 100 report: then vs now, charts with event markers, standout lives, timeline, export.
import { CFG } from '../sim/config';
import { fullName } from '../sim/events';
import { stateHash } from '../sim/hash';
import { type Report, buildReport } from '../sim/report';
import type { DayMetrics, Sim } from '../sim/types';
import { type Marker, bigChart } from './charts';
import { EVENT_ICON, esc } from './ui';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

/** Plain-language summary built from the numbers. Shown until (or instead of) the model's chronicle. */
export function ruleChronicle(sim: Sim, r: Report): string {
  const a = r.first, z = r.last, t = r.totals;
  const days = sim.metrics.length - 1;
  const bits: string[] = [];
  const dPop = z.population - a.population;
  bits.push(`Over ${days} day${days === 1 ? '' : 's'} the town ${dPop > 2 ? `grew from ${a.population} to ${z.population} people` : dPop < -2 ? `shrank from ${a.population} to ${z.population} people` : `held steady at around ${z.population} people`}.`);
  const dEmp = z.employment - a.employment;
  bits.push(dEmp < -0.08 ? `Work dried up: employment fell from ${pct(a.employment)} to ${pct(z.employment)}.` : dEmp > 0.04 ? `Jobs were easier to come by, with employment up to ${pct(z.employment)}.` : `Most people who wanted work had it (${pct(z.employment)} employed).`);
  bits.push(z.mood - a.mood > 0.04 ? 'People ended up happier than they began.' : z.mood - a.mood < -0.04 ? 'The mood darkened as the days went on.' : 'The mood held about where it started.');
  if (t.closures) bits.push(`${t.closures} business${t.closures > 1 ? 'es' : ''} closed ${t.closures > 1 ? 'their' : 'its'} doors.`);
  if (t.crimes) bits.push(`${t.crimes} crime${t.crimes > 1 ? 's were' : ' was'} committed.`);
  if (t.deaths) bits.push(`${t.deaths} ${t.deaths > 1 ? 'people' : 'person'} died.`);
  bits.push(`${t.arrivals} household${t.arrivals === 1 ? '' : 's'} moved in and ${t.departures} left, while ${z.friendships - a.friendships >= 0 ? z.friendships - a.friendships : 0} new friendships took root.`);
  return bits.join(' ');
}

export function chronicleFacts(sim: Sim, r: Report): string[] {
  const a = r.first, z = r.last;
  return [
    `Population ${a.population} to ${z.population}; employment ${pct(a.employment)} to ${pct(z.employment)}; average mood ${pct(a.mood)} to ${pct(z.mood)}.`,
    `${r.totals.closures} businesses closed, ${r.totals.crimes} crimes, ${r.totals.deaths} deaths, ${r.totals.arrivals} households arrived, ${r.totals.departures} left.`,
    ...r.timeline.filter((e) => e.sev >= 4).slice(-5).map((e) => `Day ${e.day + 1}: ${e.text}`),
    ...r.stories.slice(0, 2).map((s) => `${s.name}: ${s.summary}`),
  ];
}

export function exportRun(sim: Sim): void {
  const data = {
    app: 'HUNDRED', seed: sim.seed, days: sim.metrics.length - 1, stateHash: stateHash(sim), budget: sim.budget,
    metrics: sim.metrics, events: sim.events, decisions: sim.decisions, news: sim.news, ledger: sim.ledger,
    buildings: sim.world.buildings.map((b) => ({ id: b.id, kind: b.kind, name: b.name })),
    businesses: sim.biz.filter((b) => b).map((b) => ({ ...b })),
    agents: sim.agents.map((a) => ({
      id: a.id, name: fullName(a), age: a.age, status: a.status, traits: a.traits, cash: a.cash, startCash: a.startCash, mood: a.mood, job: a.job,
      partner: a.partner, record: a.record, reputation: a.rep, arrivedDay: a.arrivedDay, goneDay: a.goneDay, memories: a.mem, intention: a.intention,
    })),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `hundred-seed-${sim.seed}-day-${data.days}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export interface ReportView {
  open(sim: Sim, chronicle: (facts: string[]) => Promise<string | null>): void;
  close(): void;
  isOpen(): boolean;
}

export function createReportView(root: HTMLElement, onPick: (agent: number) => void): ReportView {
  const el = document.createElement('div');
  el.id = 'report';
  root.appendChild(el);
  let cached: { key: string; text: string } | null = null;

  const card = (k: string, then: string, now: string, delta: number, goodUp: boolean, fmt: (d: number) => string) => {
    const cls = Math.abs(delta) < 1e-9 ? 'dim' : (delta > 0) === goodUp ? 'up' : 'down';
    return `<div class="card2"><div class="k">${k}</div><div class="now num">${now}</div><div class="then num">was ${then} <span class="chg ${cls}">${delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} ${fmt(Math.abs(delta))}</span></div></div>`;
  };

  function open(sim: Sim, chronicle: (facts: string[]) => Promise<string | null>): void {
    const r = buildReport(sim);
    const a = r.first, z = r.last, ms = r.metrics;
    const days = ms.length - 1;
    const markers: Marker[] = r.timeline.filter((e) => e.sev >= 4).map((e) => ({ day: Math.min(days, e.day + 1), label: e.text }));
    const chart = (title: string, f: (m: DayMetrics) => number, color: string, fmt: (v: number) => string) =>
      `<div class="chart"><div class="ttl"><b>${title}</b><span class="dim num">${fmt(f(a))} → ${fmt(f(z))}</span></div>${bigChart(ms.map(f), color, markers, fmt)}</div>`;
    const crimeTotal = r.totals.crimes;
    const firstWeek = ms.slice(1, 8).reduce((s, m) => s + m.crimes, 0), lastWeek = ms.slice(-7).reduce((s, m) => s + m.crimes, 0);
    el.innerHTML = `<div class="wrap">
      <div class="rhead"><div style="flex:1"><div class="dim" style="letter-spacing:.18em;font-size:12px">HUNDRED · SEED ${sim.seed}</div><h1>${days >= CFG.totalDays ? 'One hundred days later' : `The town after ${days} day${days === 1 ? '' : 's'}`}</h1></div>
        <button id="r-export">⬇ Export run as JSON</button><button class="primary" id="r-close">Back to town</button></div>
      <div class="lede">${esc(ruleChronicle(sim, r))}</div>
      <div class="chron" id="r-chron" style="display:none"></div>
      <h2>Then vs. now</h2>
      <div class="cards">
        ${card('Population', String(a.population), String(z.population), z.population - a.population, true, (d) => String(d))}
        ${card('Employment', pct(a.employment), pct(z.employment), z.employment - a.employment, true, (d) => `${Math.round(d * 100)} pts`)}
        ${card('Average mood', pct(a.mood), pct(z.mood), z.mood - a.mood, true, (d) => `${Math.round(d * 100)} pts`)}
        ${card('Inequality (Gini)', a.gini.toFixed(2), z.gini.toFixed(2), z.gini - a.gini, false, (d) => d.toFixed(2))}
        ${card('Crimes per week', String(firstWeek), String(lastWeek), lastWeek - firstWeek, false, (d) => String(d))}
        ${card('Open businesses', String(a.openBusinesses), String(z.openBusinesses), z.openBusinesses - a.openBusinesses, true, (d) => String(d))}
        ${card('Median wealth', money(a.medianWealth), money(z.medianWealth), z.medianWealth - a.medianWealth, true, (d) => money(d))}
        ${card('Couples', String(a.couples), String(z.couples), z.couples - a.couples, true, (d) => String(d))}
      </div>
      <h2>How it unfolded <span style="text-transform:none;letter-spacing:0">· dots mark major events, hover for details</span></h2>
      <div class="charts">
        ${chart('Population', (m) => m.population, '#7cc4ff', (v) => String(Math.round(v)))}
        ${chart('Employment', (m) => m.employment, '#6ee7a0', pct)}
        ${chart('Average mood', (m) => m.mood, '#ffd166', pct)}
        ${chart('Mean wealth', (m) => m.meanWealth, '#c4a7ff', money)}
        ${chart('Median wealth', (m) => m.medianWealth, '#a78bfa', money)}
        ${chart('Inequality (Gini)', (m) => m.gini, '#ff9f6e', (v) => v.toFixed(2))}
        ${chart('Crimes per day', (m) => m.crimes, '#ff7a7a', (v) => String(Math.round(v)))}
        ${chart('People sick', (m) => m.sick, '#ffb38a', (v) => String(Math.round(v)))}
        ${chart('Export demand', (m) => m.demand, '#8fe0d0', pct)}
        ${chart('Price index', (m) => m.priceIndex, '#e0c8ff', (v) => v.toFixed(2))}
        ${chart('Friendships', (m) => m.friendships, '#ff8fc7', (v) => String(Math.round(v)))}
        ${chart('Town treasury', (m) => m.treasury, '#b8e986', money)}
      </div>
      <h2>Lives that stood out</h2>
      <div class="stories">${r.stories.map((s) => `<div class="story" data-agent="${s.agent}"><div class="lbl">${esc(s.title)}</div><div class="who">${esc(s.name)}</div><div>${esc(s.summary)}</div>
        <ul>${s.timeline.map((m) => `<li><b>Day ${m.day + 1}</b><span>${EVENT_ICON[m.type] ?? ''} ${esc(m.text)}</span></li>`).join('')}</ul></div>`).join('')}</div>
      <h2>Town timeline</h2>
      <div class="tl">${r.timeline.length ? r.timeline.map((e) => `<div class="s${e.sev}"><b>Day ${e.day + 1}</b>${EVENT_ICON[e.type] ?? ''} ${esc(e.text)}</div>`).join('') : '<div class="dim">Nothing dramatic yet. Give it time.</div>'}</div>
      <h2>Under the hood</h2>
      <div class="dim" style="line-height:1.6">${sim.events.length.toLocaleString('en-US')} events logged · ${crimeTotal} crimes · ${r.totals.illnesses} illnesses · ${sim.decisions.length} intentions and dilemmas decided, ${r.totals.modelDecisions} of them by the in-browser model · state hash <span class="num">${stateHash(sim)}</span>.
      Rerun seed ${sim.seed} with a different policy from God tools and compare.</div>
    </div>`;
    el.classList.add('open');
    el.scrollTop = 0;
    (el.querySelector('#r-close') as HTMLElement).onclick = close;
    (el.querySelector('#r-export') as HTMLElement).onclick = () => exportRun(sim);
    el.querySelectorAll('.story').forEach((s) => ((s as HTMLElement).onclick = () => { close(); onPick(Number((s as HTMLElement).dataset.agent)); }));

    // The model's chronicle is one call per report state; cached so reopening is free.
    const key = `${sim.seed}:${days}`;
    const show = (text: string) => {
      const c = el.querySelector('#r-chron') as HTMLElement | null;
      if (c) { c.style.display = ''; c.innerHTML = `${esc(text)} <span class="tag ai">🧠 the chronicler, a small model that may embellish</span>`; }
    };
    if (cached && cached.key === key) show(cached.text);
    else chronicle(chronicleFacts(sim, r)).then((text) => { if (text) { cached = { key, text }; if (isOpen()) show(text); } });
  }
  function close(): void { el.classList.remove('open'); }
  function isOpen(): boolean { return el.classList.contains('open'); }
  return { open, close, isOpen };
}
