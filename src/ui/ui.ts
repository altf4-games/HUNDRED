// DOM panels. Reads sim state and calls the sim's public API; never mutates state directly.
// Refreshes are throttled by the caller to a few times per second.
import type { AiState } from '../mind/llmMind';
import { jobTitle } from '../sim/brain';
import { CFG, splitBudget } from '../sim/config';
import { moneyStress } from '../sim/economy';
import { clock, godCloseFactory, godDoublePolice, godFluOutbreak, godStimulus, occupantsOf } from '../sim/sim';
import type { Agent, Building, Business, DayMetrics, Household, Sim, SimEvent } from '../sim/types';
import { sparkline } from './charts';
import { describeAction, intentionText, moodEmoji } from './describe';

export interface App {
  sim: Sim;
  speed: number;
  skipping: boolean;
  selected: number;
  selectedBuilding: number;
  following: boolean;
  ai: AiState;
  holding: boolean;
  setSpeed(n: number): void;
  skipTo(day: number, fast: boolean): void;
  stopSkip(): void;
  select(agent: number, fly?: boolean): void;
  selectBuilding(id: number): void;
  toggleFollow(): void;
  focusEvent(ev: SimEvent): void;
  restart(seed: number): void;
  setBudget(n: number): void;
  innerVoice(agent: Agent): Promise<{ text: string; by: 'llm' | 'rule' }>;
  openReport(): void;
  toast(text: string): void;
}

export const EVENT_ICON: Record<string, string> = {
  hired: '💼', fired: '📉', quit: '🚪', befriended: '🤝', closeFriends: '💛', fellOut: '💢', reconciled: '🕊️', dating: '💕', partnered: '🏡',
  brokeUp: '💔', theft: '🫣', fight: '🥊', arrest: '🚓', released: '🔓', fellIll: '🤒', recovered: '💪', died: '🕯️', businessClosed: '🔒',
  businessOpened: '🎉', layoffs: '📉', movedAway: '🧳', movedIn: '📦', shock: '📈', outbreak: '🦠', policy: '⚡', gossip: '👂', decision: '🧠',
  evicted: '🏚️', milestone: '🏁',
};

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

const SKIN_CSS = ['#f6d3b8', '#e9b98f', '#d39a6a', '#b07a4e', '#8a5a36', '#5e3b24'];
const pct = (v: number) => `${Math.round(v * 100)}%`;
const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

export interface UI {
  refresh(): void;
  reset(): void;
  showIntro(onStart: (seed: number) => void): void;
  tip(html: string | null, x?: number, y?: number): void;
}

export function createUI(root: HTMLElement, app: App): UI {
  root.innerHTML = `
    <div id="top" class="panel">
      <span class="brand">HUNDRED</span>
      <div class="clock"><b id="c-day" class="num"></b><span class="dim num" id="c-time"></span></div>
      <div class="group" id="speeds">
        <button data-s="0" title="Pause (Space)">⏸</button><button data-s="1" title="1 sim minute per second">1×</button>
        <button data-s="5">5×</button><button data-s="30">30×</button>
      </div>
      <div class="group">
        <span class="dim">to day</span><input id="skip-day" type="number" min="2" max="${CFG.totalDays}" value="${CFG.totalDays}" />
        <button id="skip" title="Run ahead with AI minds on; the clock holds briefly at dawn while they think">Skip ▸</button>
        <button id="fast" title="Run ahead on rules only: zero model calls">Fast skip (no AI)</button>
      </div>
      <span class="spacer"></span>
      <span class="pill" id="ai"><span class="dot"></span><span id="ai-text"></span><span class="bar" id="ai-bar"><i></i></span></span>
      <button id="btn-report">📊 Report</button>
      <button id="btn-god">⚡ God tools</button>
      <button id="btn-new" class="ghost" title="Start a new town"><span class="dim num" id="seed"></span> ↻</button>
      <div id="dayline"><i></i></div>
    </div>
    <div id="town" class="panel"><h3>The town</h3><div class="tiles" id="tiles"></div><div id="paper"></div></div>
    <div id="ticker" class="panel"><header><span>Town feed</span><button id="feed-all" title="Show minor events too">Major only</button></header><div id="feed"></div></div>
    <div id="inspector" class="panel"></div>
    <div id="god" class="panel"></div>
    <div id="hold" class="panel"><span class="spin"></span><span id="hold-text"></span></div>
    <div id="toast" class="panel"></div>
    <div id="tip" class="panel"></div>
    <div id="intro"><div class="card panel">
      <h1>HUNDRED</h1>
      <div class="tag2">100 people · 100 days · one small town</div>
      <p>Everyone here has a home, a temperament, needs and money worries. They work, fall out, fall in love, get sick, lose jobs, break the law and sometimes leave.
      Press play on Day 1, come back on Day 100, and read how it turned out.</p>
      <div class="seed"><span class="dim">Town seed</span><input id="intro-seed" type="number" value="42" /><button id="intro-rand" title="Random seed">🎲</button></div>
      <button class="primary go" id="intro-go">Begin Day 1</button>
      <div class="ai" id="intro-ai"></div>
      <div class="keys">Drag to pan · right-drag or <kbd>Q</kbd>/<kbd>E</kbd> to rotate · scroll to zoom from city to street · click anyone</div>
    </div></div>`;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector(`#${id}`) as T;
  const feed = $('feed'), inspector = $('inspector'), god = $('god'), tipEl = $('tip');
  let feedCursor = 0, feedAll = false, lastTilesDay = -1, lastPaperKey = '\0', toastTimer = 0;
  let inspectKey = '', voice: { agent: number; day: number; text: string; by: string } | null = null, voiceBusy = false;

  // ---------------------------------------------------------- top bar
  $('speeds').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b) app.setSpeed(Number(b.dataset.s));
  });
  const skipDay = $<HTMLInputElement>('skip-day');
  const startSkip = (fast: boolean) => {
    if (app.skipping) { app.stopSkip(); return; }
    const d = Math.max(2, Math.min(CFG.totalDays, Math.round(Number(skipDay.value) || CFG.totalDays)));
    app.skipTo(d, fast);
  };
  $('skip').onclick = () => startSkip(false);
  $('fast').onclick = () => startSkip(true);
  $('btn-report').onclick = () => app.openReport();
  $('btn-god').onclick = () => { god.classList.toggle('open'); if (god.classList.contains('open')) { inspector.classList.remove('open'); renderGod(); } };
  $('btn-new').onclick = () => ui.showIntro((seed) => app.restart(seed));
  $('feed-all').onclick = () => {
    feedAll = !feedAll;
    $('feed-all').textContent = feedAll ? 'Everything' : 'Major only';
    feed.innerHTML = ''; feedCursor = 0;
  };
  feed.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('.ev') as HTMLElement | null;
    if (el) app.focusEvent(app.sim.events[Number(el.dataset.id)] as SimEvent);
  });
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); app.setSpeed(app.speed === 0 ? 1 : 0); }
    else if (e.key === '1') app.setSpeed(1);
    else if (e.key === '2') app.setSpeed(5);
    else if (e.key === '3') app.setSpeed(30);
    else if (e.key === 'Escape') { app.select(-1); god.classList.remove('open'); }
    else if (e.key.toLowerCase() === 'f' && app.selected >= 0) app.toggleFollow();
  });

  // ---------------------------------------------------------- town tiles
  function tile(label: string, value: string, series: number[], first: number, last: number, color: string, goodUp: boolean, fmt: (d: number) => string): string {
    const d = last - first;
    const cls = Math.abs(d) < 1e-9 ? 'dim' : (d > 0) === goodUp ? 'up' : 'down';
    return `<div class="tile"><div class="k">${label}</div><span class="v num">${value}</span><span class="d ${cls}">${d > 0 ? '+' : ''}${fmt(d)}</span>${sparkline(series, color)}</div>`;
  }
  function renderTiles(): void {
    const ms = app.sim.metrics;
    const a = ms[0] as DayMetrics, z = ms[ms.length - 1] as DayMetrics;
    const col = (f: (m: DayMetrics) => number) => ms.map(f);
    const crimes7 = (i: number) => ms.slice(Math.max(0, i - 6), i + 1).reduce((s, m) => s + m.crimes, 0);
    $('tiles').innerHTML =
      tile('Population', String(z.population), col((m) => m.population), a.population, z.population, '#7cc4ff', true, (d) => String(d)) +
      tile('Mood', pct(z.mood), col((m) => m.mood), a.mood, z.mood, '#ffd166', true, (d) => `${Math.round(d * 100)}`) +
      tile('In work', pct(z.employment), col((m) => m.employment), a.employment, z.employment, '#6ee7a0', true, (d) => `${Math.round(d * 100)}`) +
      tile('Median wealth', money(z.medianWealth), col((m) => m.medianWealth), a.medianWealth, z.medianWealth, '#c4a7ff', true, (d) => money(d).replace('$-', '-$')) +
      tile('Crimes (7 days)', String(crimes7(ms.length - 1)), ms.map((_, i) => crimes7(i)), 0, crimes7(ms.length - 1), '#ff7a7a', false, (d) => String(d)) +
      tile('Sick today', String(z.sick), col((m) => m.sick), a.sick, z.sick, '#ff9f6e', false, (d) => String(d)) +
      tile('Friendships', String(z.friendships), col((m) => m.friendships), a.friendships, z.friendships, '#ff8fc7', true, (d) => String(d)) +
      tile('Open businesses', String(z.openBusinesses), col((m) => m.openBusinesses), a.openBusinesses, z.openBusinesses, '#8fe0d0', true, (d) => String(d));
  }
  function renderPaper(): void {
    const n = app.sim.news[app.sim.news.length - 1];
    const key = n ? `${n.day}${n.by}${n.headline}` : '';
    if (key === lastPaperKey) return;
    lastPaperKey = key;
    $('paper').innerHTML = n
      ? `<div class="mast"><span>The Hundred Herald</span><span>Day ${n.day + 1}${n.by === 'llm' ? ' · 🧠' : ''}</span></div><div class="head">${esc(n.headline)}</div><div class="blurb">${esc(n.blurb)}</div>`
      : `<div class="mast"><span>The Hundred Herald</span><span>Day 1</span></div><div class="head">A new day dawns over the town</div><div class="blurb">The first edition goes to print at midnight.</div>`;
  }

  // ---------------------------------------------------------- ticker
  function renderFeed(): void {
    const evs = app.sim.events;
    if (feedCursor > evs.length) { feed.innerHTML = ''; feedCursor = 0; }
    if (feedCursor === evs.length) return;
    // After a long skip only the most recent events are worth building DOM for.
    let start = feedCursor;
    if (evs.length - start > 150) { feed.innerHTML = ''; start = evs.length - 150; }
    const frag = document.createDocumentFragment();
    for (let i = start; i < evs.length; i++) {
      const e = evs[i] as SimEvent;
      if (!feedAll && e.sev < 2) continue;
      const m = e.tick % CFG.dayTicks;
      const el = document.createElement('div');
      el.className = `ev s${e.sev}`;
      el.dataset.id = String(e.id);
      el.innerHTML = `<span class="t num">D${e.day + 1} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}</span><span>${EVENT_ICON[e.type] ?? '•'}</span><span class="x">${esc(e.text)}</span>`;
      frag.prepend(el);
    }
    feed.prepend(frag);
    while (feed.childElementCount > 160) feed.lastElementChild?.remove();
    feedCursor = evs.length;
  }

  // ---------------------------------------------------------- inspector
  const bar = (label: string, v: number) => {
    const cls = v < 0.3 ? 'low' : v < 0.55 ? 'mid' : 'ok';
    return `<span class="dim">${label}</span><span class="bar"><i class="${cls}" style="width:${Math.round(v * 100)}%"></i></span><span class="num dim">${Math.round(v * 100)}</span>`;
  };
  const relLabel: Record<string, string> = { friend: 'friend', close: 'close friend', rival: 'rival', dating: 'dating', partner: 'partner', family: 'family', ex: 'ex', none: 'acquaintance' };

  function renderAgent(a: Agent): void {
    const sim = app.sim;
    const hh = sim.households[a.hh] as Household;
    const home = hh.home >= 0 ? (sim.world.buildings[hh.home] as Building).name : '—';
    const rels = Object.entries(a.rel)
      .filter(([k, r]) => r.kind !== 'none' && (sim.agents[+k] as Agent).status === 'active')
      .sort((x, y) => Math.abs(y[1].aff) - Math.abs(x[1].aff)).slice(0, 6);
    const it = a.intention;
    const day = clock(sim).day;
    const v = voice && voice.agent === a.id && voice.day === day ? voice : null;
    const gone = a.status !== 'active';
    const t = a.traits;
    inspector.innerHTML = `
      <div class="hd">
        <div class="avatar" style="background:${SKIN_CSS[a.look.skin]}">${gone ? (a.status === 'dead' ? '🕯️' : '🧳') : moodEmoji(a.mood)}</div>
        <div><div class="name">${esc(a.first)} ${esc(a.last)}</div><div class="dim">${a.age} · ${esc(jobTitle(sim, a))}${a.job >= 0 ? ` · $${a.wage}/day` : ''}</div></div>
        <button class="ghost close" data-act="close">✕</button>
      </div>
      <div class="doing">${esc(describeAction(sim, a))}${a.illness ? ` · 🤒 ${a.illness.kind === 'flu' ? 'has the flu' : 'seriously ill'}` : ''}</div>
      ${gone ? '' : `<div class="row"><button data-act="follow" class="${app.following ? 'on' : ''}">🎥 ${app.following ? 'Following' : 'Follow'}</button><button data-act="voice" ${voiceBusy ? 'disabled' : ''}>💭 Listen in</button></div>`}
      ${v ? `<div class="voice">“${esc(v.text)}” <span class="tag ${v.by === 'llm' ? 'ai' : ''}">${v.by === 'llm' ? '🧠 model' : 'template'}</span></div>` : voiceBusy ? '<div class="voice dim">Listening…</div>' : ''}
      ${it && it.tag !== 'carry-on' ? `<section><h3>Intention</h3><div><b>${esc(intentionText(sim, a))}</b> <span class="tag ${it.by === 'llm' ? 'ai' : ''}">${it.by === 'llm' ? '🧠 set by model' : 'set by rules'}</span></div>${it.reason && it.by === 'llm' ? `<div class="dim" style="margin-top:3px">“${esc(it.reason)}”</div>` : ''}</section>` : ''}
      <section><h3>Needs</h3><div class="bars">${bar('Mood', a.mood)}${bar('Hunger', a.needs.hunger)}${bar('Energy', a.needs.energy)}${bar('Social', a.needs.social)}${bar('Fun', a.needs.fun)}${bar('Health', a.needs.health)}</div></section>
      <section><h3>Life</h3>
        <div class="kv"><span class="dim">Cash</span><b class="num">${money(a.cash)}${a.age >= 18 && moneyStress(sim, a) > 0.6 ? ' 💸' : ''}</b></div>
        <div class="kv"><span class="dim">Home</span><span>${esc(home)} · ${hh.members.length} in household</span></div>
        <div class="kv"><span class="dim">Reputation</span><span class="num">${Math.round(a.rep * 100)}/100${a.record ? ` · ${a.record} offence${a.record > 1 ? 's' : ''}` : ''}</span></div>
      </section>
      <section><h3>Personality</h3><div class="bars">${bar('Sociable', t.sociability)}${bar('Ambitious', t.ambition)}${bar('Honest', t.honesty)}${bar('Impulsive', t.impulsivity)}${bar('Resilient', t.resilience)}</div></section>
      ${rels.length ? `<section><h3>People</h3>${rels.map(([k, r]) => { const o = sim.agents[+k] as Agent; return `<div class="rel" data-agent="${k}"><span>${esc(o.first)} ${esc(o.last)}</span><span class="dim">${relLabel[r.kind]} ${r.aff >= 0 ? '♥' : '✕'} ${Math.round(Math.abs(r.aff) * 100)}</span></div>`; }).join('')}</section>` : ''}
      <section><h3>Recent memories</h3>${a.mem.length ? a.mem.slice(-8).reverse().map((m) => `<div class="mem"><span class="dim num">D${m.day + 1}</span> ${EVENT_ICON[m.type] ?? ''} ${esc(m.text)}</div>`).join('') : '<div class="dim">Nothing notable yet.</div>'}</section>`;
  }

  function renderBuilding(b: Building): void {
    const sim = app.sim;
    const biz = sim.biz[b.id] as Business | null;
    const inside = occupantsOf(sim, b.id);
    const residents = sim.households.filter((h) => h.home === b.id).flatMap((h) => h.members).map((id) => sim.agents[id] as Agent);
    const list = (people: Agent[]) => people.slice(0, 14).map((p) => `<div class="rel" data-agent="${p.id}"><span>${esc(p.first)} ${esc(p.last)}</span><span class="dim">${esc(jobTitle(sim, p))}</span></div>`).join('') + (people.length > 14 ? `<div class="dim">and ${people.length - 14} more</div>` : '');
    inspector.innerHTML = `
      <div class="hd"><div class="avatar" style="background:rgba(255,255,255,0.1)">${b.icon}</div>
        <div><div class="name">${esc(b.name)}</div><div class="dim">${biz ? (biz.open ? `open · ${biz.staff.length}/${biz.slots} staff` : 'closed down') : b.homes ? `${residents.length} resident${residents.length === 1 ? '' : 's'}` : 'public space'}</div></div>
        <button class="ghost close" data-act="close">✕</button></div>
      ${biz && biz.sector !== 'civic' ? `<section><h3>Business</h3><div class="kv"><span class="dim">Cash</span><b class="num">${money(biz.cash)}</b></div><div class="kv"><span class="dim">Daily wage</span><span class="num">$${biz.baseWage}</span></div>${biz.sector === 'industry' ? `<div class="kv"><span class="dim">Export demand</span><span class="num ${biz.demand >= 1 ? 'up' : 'down'}">${Math.round(biz.demand * 100)}%</span></div>` : ''}<div class="kv"><span class="dim">Hiring</span><span>${biz.hiring && biz.staff.length < biz.slots ? 'yes' : 'no'}</span></div></section>` : ''}
      ${biz && biz.sector === 'civic' ? `<section><h3>Public service</h3><div class="kv"><span class="dim">Town treasury</span><b class="num">${money(sim.town.cash)}</b></div></section>` : ''}
      <section><h3>Inside now (${inside.length})</h3>${inside.length ? list(inside) : '<div class="dim">Nobody.</div>'}</section>
      ${b.homes ? `<section><h3>Lives here</h3>${residents.length ? list(residents) : '<div class="dim">Vacant.</div>'}</section>` : ''}
      ${biz && biz.staff.length ? `<section><h3>Staff</h3>${list(biz.staff.map((id) => sim.agents[id] as Agent))}</section>` : ''}`;
  }

  inspector.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const rel = t.closest('[data-agent]') as HTMLElement | null;
    if (rel) { app.select(Number(rel.dataset.agent), true); return; }
    const act = (t.closest('[data-act]') as HTMLElement | null)?.dataset.act;
    if (act === 'close') app.select(-1);
    else if (act === 'follow') { app.toggleFollow(); inspectKey = ''; }
    else if (act === 'voice' && app.selected >= 0 && !voiceBusy) {
      const a = app.sim.agents[app.selected] as Agent;
      voiceBusy = true; inspectKey = '';
      app.innerVoice(a).then((r) => {
        voice = { agent: a.id, day: clock(app.sim).day, text: r.text, by: r.by };
        voiceBusy = false; inspectKey = '';
      });
    }
  });

  function renderInspector(): void {
    const sim = app.sim;
    if (app.selected >= 0) {
      const a = sim.agents[app.selected] as Agent;
      // Rebuild only when something visible changed; otherwise scrolling would jump.
      const key = `a${a.id}|${a.action}|${a.place}|${a.tripFrom}|${a.status}|${Math.round(a.mood * 50)}|${Math.round(a.needs.hunger * 25)}|${Math.round(a.needs.energy * 25)}|${Math.round(a.needs.social * 25)}|${Math.round(a.needs.fun * 25)}|${a.cash}|${a.mem.length}|${a.mem[a.mem.length - 1]?.text ?? ''}|${a.intention?.tag ?? ''}|${app.following}|${voiceBusy}|${voice?.text ?? ''}|${a.job}`;
      if (key !== inspectKey) { inspectKey = key; renderAgent(a); }
      inspector.classList.add('open'); god.classList.remove('open');
    } else if (app.selectedBuilding >= 0) {
      const b = sim.world.buildings[app.selectedBuilding] as Building;
      const key = `b${b.id}|${occupantsOf(sim, b.id).map((o) => o.id).join(',')}|${sim.biz[b.id]?.cash ?? 0}|${sim.biz[b.id]?.staff.length ?? 0}`;
      if (key !== inspectKey) { inspectKey = key; renderBuilding(b); }
      inspector.classList.add('open'); god.classList.remove('open');
    } else {
      inspector.classList.remove('open'); inspectKey = '';
    }
  }

  // ---------------------------------------------------------- god tools + AI settings
  function aiSummary(): string {
    const s = app.ai;
    if (s.status === 'ready') {
      const b = app.sim.budget;
      const perDay = s.avgSec * b;
      const proj = s.calls > 0 ? `About ${s.avgSec.toFixed(1)}s per call, so a full 100-day run spends roughly ${Math.max(1, Math.round((perDay * 100) / 60))} min thinking at this budget.` : 'Measuring speed on the first few calls…';
      return `<b>${esc(s.model)}</b> is running in your browser. ${s.calls} calls so far${s.failures ? `, ${s.failures} unusable replies fell back to rules` : ''}. ${proj}`;
    }
    return esc(s.text);
  }
  function renderGod(): void {
    const b = splitBudget(app.sim.budget);
    god.innerHTML = `
      <div class="hd" style="display:flex"><h3 style="flex:1">God tools</h3><button class="ghost" data-g="close">✕</button></div>
      <div class="tools">
        <button data-g="factory">🏭 Close the factory<small>The town's biggest employer</small></button>
        <button data-g="stimulus">💵 Stimulus payment<small>$300 to every adult</small></button>
        <button data-g="flu">🦠 Flu outbreak<small>A dozen people fall ill</small></button>
        <button data-g="police">🚓 Double the police<small>More arrests, fewer escapes</small></button>
      </div>
      <h3 style="margin-top:14px">AI minds</h3>
      <div class="kv"><span>Model calls per sim day</span><b class="num" id="bud-v">${app.sim.budget}</b></div>
      <input type="range" id="bud" min="0" max="${CFG.budgetMax}" value="${app.sim.budget}" />
      <p class="dim" id="bud-split">${b.intentions} intentions · ${b.dilemmas} dilemmas · ${b.news} newspaper. Today: ${app.sim.town.callsToday.intentions + app.sim.town.callsToday.dilemmas + app.sim.town.callsToday.news} used.</p>
      <p class="dim" id="ai-sum">${aiSummary()}</p>`;
  }
  god.addEventListener('click', (e) => {
    const g = ((e.target as HTMLElement).closest('[data-g]') as HTMLElement | null)?.dataset.g;
    const sim = app.sim;
    if (g === 'close') god.classList.remove('open');
    else if (g === 'factory') { if (!godCloseFactory(sim)) app.toast('The factory is already closed.'); }
    else if (g === 'stimulus') godStimulus(sim);
    else if (g === 'flu') godFluOutbreak(sim);
    else if (g === 'police') godDoublePolice(sim);
  });
  god.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id !== 'bud') return;
    app.setBudget(Number(t.value));
    const b = splitBudget(app.sim.budget);
    god.querySelector('#bud-v')!.textContent = String(app.sim.budget);
    god.querySelector('#bud-split')!.textContent = `${b.intentions} intentions · ${b.dilemmas} dilemmas · ${b.news} newspaper.`;
  });

  // ---------------------------------------------------------- shared
  const ui: UI = {
    refresh() {
      const sim = app.sim;
      const c = clock(sim);
      $('c-day').textContent = `Day ${Math.min(c.day, 999)} / ${CFG.totalDays}`;
      $('c-time').textContent = `${c.weekday} ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
      ($('dayline').firstElementChild as HTMLElement).style.width = `${Math.min(100, (sim.tick / (CFG.totalDays * CFG.dayTicks)) * 100)}%`;
      $('seed').textContent = `seed ${sim.seed}`;
      root.querySelectorAll('#speeds button').forEach((b) => b.classList.toggle('on', !app.skipping && Number((b as HTMLElement).dataset.s) === app.speed));
      $('skip').textContent = app.skipping ? '■ Stop' : 'Skip ▸';
      $('skip').classList.toggle('on', app.skipping);
      ($('fast') as HTMLButtonElement).disabled = app.skipping;

      const ai = app.ai;
      const pill = $('ai');
      pill.className = `pill ${ai.status}`;
      const off = sim.budget === 0 && ai.status === 'ready';
      $('ai-text').textContent = ai.status === 'ready' ? (off ? 'AI minds paused (budget 0)' : `🧠 AI minds on${ai.queue ? ` · ${ai.queue} thinking` : ''}`) : ai.status === 'loading' ? ai.text : ai.status === 'unavailable' ? 'AI minds unavailable · rules' : 'AI minds starting…';
      pill.title = ai.text;
      $('ai-bar').style.display = ai.status === 'loading' ? '' : 'none';
      ($('ai-bar').firstElementChild as HTMLElement).style.width = `${Math.round(ai.progress * 100)}%`;
      const introAi = root.querySelector('#intro-ai');
      if (introAi) introAi.textContent = ai.status === 'ready' ? `🧠 AI minds ready (${ai.model}). They set agents' goals and resolve dilemmas, at most ${sim.budget} calls per sim day.` : ai.status === 'loading' ? `${ai.text}. The town can start now on rules and switch over when the model is ready.` : ai.status === 'unavailable' ? ai.text : 'Checking for WebGPU…';

      $('hold').classList.toggle('on', app.holding);
      if (app.holding) $('hold-text').textContent = `The town is thinking… ${sim.pending.filter((p) => p.kind === 'intention').length} minds still deciding before dawn`;

      if (sim.metrics.length !== lastTilesDay) { lastTilesDay = sim.metrics.length; renderTiles(); }
      renderPaper();
      renderFeed();
      renderInspector();
      if (god.classList.contains('open')) {
        const s = god.querySelector('#ai-sum');
        if (s) s.innerHTML = aiSummary();
      }
    },
    reset() {
      feed.innerHTML = ''; feedCursor = 0; lastTilesDay = -1; lastPaperKey = '\0'; inspectKey = ''; voice = null;
      god.classList.remove('open');
    },
    showIntro(onStart) {
      const intro = $('intro');
      intro.classList.remove('gone');
      const seedIn = $<HTMLInputElement>('intro-seed');
      seedIn.value = String(app.sim.seed);
      $('intro-rand').onclick = () => { seedIn.value = String(1 + Math.floor(Math.random() * 99999)); };
      $('intro-go').onclick = () => {
        intro.classList.add('gone');
        onStart(Math.max(1, Math.floor(Number(seedIn.value) || 42)));
      };
    },
    tip(html, x = 0, y = 0) {
      if (!html) { tipEl.style.display = 'none'; return; }
      tipEl.innerHTML = html;
      tipEl.style.display = 'block';
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      tipEl.style.left = `${Math.min(window.innerWidth - w - 8, x + 14)}px`;
      tipEl.style.top = `${Math.min(window.innerHeight - h - 8, y + 14)}px`;
    },
  };

  app.toast = (text: string) => {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => t.classList.remove('on'), 5000);
  };
  return ui;
}
