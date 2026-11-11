// App shell: owns the sim, drives the fixed-step tick loop, and wires render, UI and mind.
import * as THREE from 'three';
import { type AiState, LlmMind } from './mind/llmMind';
import { chroniclePrompt, voicePrompt } from './mind/prompts';
import { RuleMind } from './mind/ruleMind';
import { type CameraRig, createCameraRig } from './render/camera';
import { BUILDING_HEIGHT, HALF } from './render/city';
import { type PedView, createPeds } from './render/peds';
import { createView } from './render/scene';
import { CFG } from './sim/config';
import { persona, stateLine } from './sim/decisions';
import { clock, createSim, flushPending, occupantsOf, pendingIntentions, runTicks, setBudget, setMind, tick } from './sim/sim';
import type { Agent, Building, Sim, SimEvent } from './sim/types';
import { describeAction, intentionText, ruleVoice } from './ui/describe';
import { createLabels } from './ui/labels';
import { createReportView } from './ui/reportView';
import './ui/style.css';
import { type App, createUI, esc } from './ui/ui';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const labelsRoot = document.getElementById('labels') as HTMLElement;

const DAWN = 6 * 60;
const HOLD_TIMEOUT_MS = 20000; // longest the clock waits at dawn for the night's model calls
const END_TICK = CFG.totalDays * CFG.dayTicks;

const ruleMind = new RuleMind();
const urlSeed = Number(new URLSearchParams(location.search).get('seed'));

/** New towns open at first light so there is something to watch straight away. */
function freshSim(seed: number, budget: number): Sim {
  const s = createSim(seed, ruleMind, { budget });
  runTicks(s, DAWN - 20);
  return s;
}

const llm = new LlmMind((id) => app.sim.pending.some((p) => p.id === id));
let userSetBudget = false;
let started = false;
let reportShown = false;
let acc = 0;
let holdSince = 0;
let skipTarget = 0;
let skipRestoreBudget = -1;
let usedFastSkip = false; // a run that used Fast skip never spends a model call, chronicle included
let hovered = -1;
const voiceCache = new Map<string, { text: string; by: 'llm' | 'rule' }>();

const app: App = {
  sim: freshSim(urlSeed > 0 ? Math.floor(urlSeed) : 42, CFG.budgetDefault),
  speed: 1, skipping: false, selected: -1, selectedBuilding: -1, following: false,
  ai: llm.state, holding: false,
  setSpeed(n) { app.speed = n; if (app.skipping) app.stopSkip(); },
  skipTo(day, fast) {
    const target = Math.min(END_TICK, day * CFG.dayTicks);
    if (target <= app.sim.tick) { app.toast(`It is already past day ${day}.`); return; }
    skipTarget = target;
    app.skipping = true;
    if (fast) {
      usedFastSkip = true;
      // Fast skip makes zero model calls: budget 0, anything outstanding goes to the rules.
      skipRestoreBudget = app.sim.budget;
      setBudget(app.sim, 0);
      llm.clear();
      flushPending(app.sim);
    }
  },
  stopSkip() {
    app.skipping = false;
    app.holding = false;
    if (skipRestoreBudget >= 0) { setBudget(app.sim, skipRestoreBudget); skipRestoreBudget = -1; }
    acc = 0;
  },
  select(agent, fly = false) {
    app.selected = agent;
    app.selectedBuilding = -1;
    app.following = false;
    peds.setSelected(agent);
    if (agent >= 0 && fly) {
      const a = app.sim.agents[agent] as Agent;
      if (a.status === 'active') { rig.flyTo(peds.posX[agent] as number, peds.posZ[agent] as number, Math.min(rig.dist, 13)); app.following = true; }
    }
  },
  selectBuilding(id) {
    app.selected = -1; app.following = false; peds.setSelected(-1);
    app.selectedBuilding = id;
  },
  toggleFollow() {
    app.following = !app.following;
    if (app.following && app.selected >= 0) rig.flyTo(peds.posX[app.selected] as number, peds.posZ[app.selected] as number, Math.min(rig.dist, 13));
  },
  focusEvent(ev: SimEvent) {
    const a = ev.a >= 0 ? (app.sim.agents[ev.a] as Agent) : null;
    if (a && a.status === 'active') { app.select(a.id, true); return; }
    if (ev.place >= 0) {
      const b = app.sim.world.buildings[ev.place] as Building;
      rig.flyTo(b.x + b.w / 2 - HALF, b.y + b.h / 2 - HALF, Math.min(rig.dist, 22));
      app.selectBuilding(b.id);
    } else if (a) app.select(a.id);
  },
  restart(seed) {
    if (app.skipping) app.stopSkip();
    llm.clear();
    app.sim = freshSim(seed, app.sim.budget);
    if (llm.ready) setMind(app.sim, llm);
    view.loadWorld(app.sim.world);
    view.scene.remove(peds.group);
    peds = createPeds();
    view.scene.add(peds.group);
    app.selected = -1; app.selectedBuilding = -1; app.following = false;
    app.speed = 1; acc = 0; reportShown = false; started = true;
    voiceCache.clear();
    usedFastSkip = false;
    ui.reset();
    rig.flyTo(0, 0, 70);
    history.replaceState(null, '', `?seed=${seed}`);
  },
  setBudget(n) { userSetBudget = true; setBudget(app.sim, n); },
  async innerVoice(a) {
    const key = `${a.id}:${clock(app.sim).day}`;
    const hit = voiceCache.get(key);
    if (hit) return hit;
    let out: { text: string; by: 'llm' | 'rule' } = { text: ruleVoice(app.sim, a), by: 'rule' };
    if (llm.ready) {
      const reply = await llm.say(voicePrompt(persona(app.sim, a), stateLine(app.sim, a), describeAction(app.sim, a), a.mem.slice(-3).map((m) => m.text), intentionText(app.sim, a)));
      if (reply && reply.length > 8) out = { text: reply.slice(0, 260), by: 'llm' };
    }
    voiceCache.set(key, out);
    return out;
  },
  openReport() {
    report.open(app.sim, (facts) => (llm.ready && app.sim.budget > 0 && !usedFastSkip ? llm.say(chroniclePrompt(facts)) : Promise.resolve(null)));
  },
  toast() { /* replaced by createUI */ },
};

const view = createView(canvas, app.sim.world);
let peds: PedView = createPeds();
view.scene.add(peds.group);
const rig: CameraRig = createCameraRig(view.camera, canvas);
const ui = createUI(uiRoot, app);
const labels = createLabels(labelsRoot);
const report = createReportView(uiRoot, (agent) => app.select(agent, true));

// ------------------------------------------------------------------ AI minds
llm.onState = (s: AiState) => {
  app.ai = s;
  // Measure on the first few calls; if the model is slow on this machine, halve the budget.
  if (s.calls === 4 && s.avgSec > 4.5 && !userSetBudget && app.sim.budget > 6) {
    setBudget(app.sim, 6);
    app.toast(`The model takes about ${s.avgSec.toFixed(1)}s per call on this device, so the daily budget was lowered to 6. Change it under God tools.`);
  }
};
llm.load().then((ok) => {
  if (ok) { setMind(app.sim, llm); app.toast('AI minds are on. From tonight the model sets intentions and resolves dilemmas.'); }
  else app.toast(llm.state.text);
});

// ------------------------------------------------------------------ picking
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const box = new THREE.Box3();
const hit = new THREE.Vector3();
function buildingAt(x: number, y: number): number {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, view.camera);
  let best = -1, bestD = Infinity;
  for (const b of app.sim.world.buildings) {
    const h = b.kind === 'park' ? 0.2 : BUILDING_HEIGHT[b.kind] - 0.4;
    box.min.set(b.x - HALF, 0, b.y - HALF);
    box.max.set(b.x + b.w - HALF, h, b.y + b.h - HALF);
    if (ray.ray.intersectBox(box, hit)) {
      const d = hit.distanceToSquared(view.camera.position);
      if (d < bestD) { bestD = d; best = b.id; }
    }
  }
  return best;
}
rig.onClick = (x, y) => {
  const p = labels.pick(x, y, 30);
  if (p >= 0) { app.select(p); return; }
  const b = buildingAt(x, y);
  if (b >= 0) app.selectBuilding(b); else app.select(-1);
};
let hoverX = 0, hoverY = 0, hoverDirty = false;
rig.onHover = (x, y) => { hoverX = x; hoverY = y; hoverDirty = true; };
rig.onUserPan = () => { app.following = false; };
canvas.addEventListener('pointerleave', () => { hovered = -1; ui.tip(null); });

function updateHover(): void {
  hoverDirty = false;
  const sim = app.sim;
  const p = labels.pick(hoverX, hoverY, 24);
  hovered = p;
  if (p >= 0) {
    const a = sim.agents[p] as Agent;
    ui.tip(`<b>${esc(a.first)} ${esc(a.last)}</b>, ${a.age}<br><span class="dim">${esc(describeAction(sim, a))}</span>`, hoverX, hoverY);
    canvas.style.cursor = 'pointer';
    return;
  }
  canvas.style.cursor = '';
  const b = buildingAt(hoverX, hoverY);
  if (b < 0) { ui.tip(null); return; }
  const bd = sim.world.buildings[b] as Building;
  const inside = occupantsOf(sim, b);
  const names = inside.slice(0, 6).map((o) => esc(o.first)).join(', ');
  ui.tip(`<b>${bd.icon} ${esc(bd.name)}</b><br><span class="dim">${inside.length ? `${inside.length} inside: ${names}${inside.length > 6 ? '…' : ''}` : 'Nobody inside'}</span>`, hoverX, hoverY);
}

// ------------------------------------------------------------------ stepping
/** At 30x and Skip the clock waits at dawn for the night's model calls, up to a timeout. */
function shouldHold(now: number): boolean {
  const sim = app.sim;
  const fast = app.skipping || app.speed >= 30;
  if (!fast || sim.mind.kind !== 'llm' || sim.tick % CFG.dayTicks !== DAWN - 1 || pendingIntentions(sim) === 0) {
    app.holding = false; holdSince = 0;
    return false;
  }
  if (holdSince === 0) holdSince = now;
  if (now - holdSince > HOLD_TIMEOUT_MS) {
    flushPending(sim); // unfinished calls fall back to rules
    app.holding = false; holdSince = 0;
    return false;
  }
  app.holding = true;
  return true;
}

function finishRun(): void {
  if (reportShown) return;
  reportShown = true;
  if (app.skipping) app.stopSkip();
  app.speed = 0;
  app.openReport();
}

function step(dt: number, now: number): void {
  const sim = app.sim;
  if (!started || report.isOpen()) return;
  if (app.skipping) {
    const t0 = performance.now();
    while (performance.now() - t0 < 13) {
      if (sim.tick >= skipTarget) { app.stopSkip(); if (sim.tick >= END_TICK) finishRun(); break; }
      if (shouldHold(now)) break;
      tick(sim);
    }
    return;
  }
  acc += dt * app.speed;
  let n = Math.min(90, Math.floor(acc));
  acc -= Math.floor(acc);
  while (n-- > 0) {
    if (shouldHold(now)) { acc = 0; break; }
    tick(sim);
    if (sim.tick === END_TICK) { finishRun(); break; }
  }
  if (app.speed === 0) app.holding = false;
}

// ------------------------------------------------------------------ frame loop
let last = performance.now();
let lastUi = 0;
let frame = 0;
const focus = new THREE.Vector3();

function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frame++;
  step(dt, now);

  const sim = app.sim;
  const moving = started && !app.skipping && !app.holding && app.speed > 0;
  const tickFloat = moving ? sim.tick - 1 + acc : sim.tick;
  const hour = ((tickFloat % CFG.dayTicks) + CFG.dayTicks) % CFG.dayTicks / 60;

  if (app.following && app.selected >= 0 && (sim.agents[app.selected] as Agent | undefined)?.status === 'active') {
    rig.follow(peds.posX[app.selected] as number, peds.posZ[app.selected] as number, dt);
  }
  rig.update(dt);
  peds.update(sim, tickFloat, dt, app.skipping ? 999 : app.speed, now / 1000);
  focus.copy(rig.target);
  view.setTime(hour, focus);
  view.updateSmoke(dt, hour > 8 && hour < 16.5 && !!sim.biz.find((b) => b && sim.world.buildings[b.id]!.kind === 'factory' && b.open && b.staff.length > 0));

  // Signs: icons stay readable from afar; names appear as you come closer.
  const d = rig.dist;
  const iconS = THREE.MathUtils.clamp(d * 0.034, 0.75, 4.2);
  const f = THREE.MathUtils.clamp(d * 0.03, 0.75, 1.5);
  for (const s of view.city.signs) {
    const b = sim.world.buildings[s.building] as Building;
    const baseY = BUILDING_HEIGHT[b.kind] + 0.5 + iconS * 0.5;
    s.icon.scale.set(iconS, iconS, 1);
    s.icon.position.y = baseY;
    s.label.visible = d < 46;
    s.label.scale.set((s.label.userData.aspect as number) * 0.5 * f, 0.5 * f, 1);
    s.label.position.y = baseY + iconS * 0.5 + 0.34 * f;
  }

  labels.update(sim, peds, view.camera, d, app.selected, hovered);
  if (hoverDirty) updateHover();
  if (now - lastUi > 240) {
    lastUi = now;
    view.updateWindows(sim);
    ui.refresh();
  }
  // While skipping, most frame time goes to the sim; draw every third frame.
  if (!app.skipping || frame % 3 === 0) view.renderer.render(view.scene, view.camera);
}

window.addEventListener('resize', () => view.resize());
view.resize();
ui.showIntro((seed) => {
  if (seed !== app.sim.seed) app.restart(seed);
  started = true;
  rig.autoOrbit = false;
  rig.flyTo(0, 2, 62);
});
requestAnimationFrame(loop);

// Handy for debugging from the console.
(window as unknown as { hundred: unknown }).hundred = { app, llm, rig, view, get peds() { return peds; }, advance: (n: number) => runTicks(app.sim, n) };
