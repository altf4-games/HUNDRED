// Name tags and thought bubbles: a small pool of DOM elements positioned over nearby peds.
// Only transforms change per frame; text is rewritten when it actually differs.
import * as THREE from 'three';
import type { PedView } from '../render/peds';
import type { Agent, Sim } from '../sim/types';
import { bubbleFor } from './describe';

const POOL = 56;

export interface Labels {
  update(sim: Sim, peds: PedView, camera: THREE.PerspectiveCamera, camDist: number, selected: number, hovered: number): void;
  /** Nearest visible ped to a screen point, or -1. */
  pick(x: number, y: number, radius: number): number;
}

export function createLabels(root: HTMLElement): Labels {
  const els: { el: HTMLElement; b: HTMLElement; n: HTMLElement; bubble: string; name: string; shown: boolean; sel: boolean }[] = [];
  for (let i = 0; i < POOL; i++) {
    const el = document.createElement('div');
    el.className = 'lab';
    const b = document.createElement('span'); b.className = 'b';
    const n = document.createElement('span'); n.className = 'n';
    el.append(b, n);
    root.appendChild(el);
    els.push({ el, b, n, bubble: '', name: '', shown: false, sel: false });
  }
  const v = new THREE.Vector3();
  // Screen positions of every visible ped, refreshed each frame, used for picking.
  const sx = new Float32Array(1024), sy = new Float32Array(1024), sOn = new Uint8Array(1024);
  let count = 0;

  function update(sim: Sim, peds: PedView, camera: THREE.PerspectiveCamera, camDist: number, selected: number, hovered: number): void {
    const w = window.innerWidth, h = window.innerHeight;
    const showBubbles = camDist < 34, showNames = camDist < 15;
    let used = 0;
    count = Math.min(1024, sim.agents.length);
    for (let i = 0; i < count; i++) {
      sOn[i] = 0;
      const a = sim.agents[i] as Agent;
      if (a.status !== 'active' || (peds.vis[i] as number) < 0.5) continue;
      v.set(peds.posX[i] as number, (peds.height[i] as number) + 0.08, peds.posZ[i] as number).project(camera);
      if (v.z > 1 || v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.1) continue;
      const px = (v.x * 0.5 + 0.5) * w, py = (-v.y * 0.5 + 0.5) * h;
      sx[i] = px; sy[i] = py; sOn[i] = 1;
      const special = i === selected || i === hovered;
      if (!(special || showBubbles) || used >= POOL) continue;
      const L = els[used++]!;
      const bubble = showBubbles || special ? bubbleFor(sim, a) : '';
      const name = showNames || special ? `${a.first} ${a.last}` : '';
      if (L.bubble !== bubble) { L.bubble = bubble; L.b.textContent = bubble; L.b.style.display = bubble ? '' : 'none'; }
      if (L.name !== name) { L.name = name; L.n.textContent = name; }
      if (L.sel !== (i === selected)) { L.sel = i === selected; L.el.classList.toggle('sel', L.sel); }
      if (!L.shown) { L.shown = true; L.el.style.display = 'block'; }
      L.el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (let i = used; i < POOL; i++) {
      const L = els[i]!;
      if (L.shown) { L.shown = false; L.el.style.display = 'none'; }
    }
  }

  function pick(x: number, y: number, radius: number): number {
    let best = -1, bestD = radius * radius;
    for (let i = 0; i < count; i++) {
      if (!sOn[i]) continue;
      // The stored point is above the head; aim for mid-body.
      const dx = (sx[i] as number) - x, dy = (sy[i] as number) + radius * 0.5 - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  return { update, pick };
}
