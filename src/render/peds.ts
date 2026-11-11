// Humanoid peds: head, hair, eyes, torso, hips, arms, hands, legs, shoes, backpack, shadow.
// One InstancedMesh per body part (limbs share one mesh for left and right), so the whole
// population costs about a dozen draw calls. Animation is procedural.
import * as THREE from 'three';
import { CFG } from '../sim/config';
import { hash01 } from '../sim/rng';
import type { Agent, Building, Sim } from '../sim/types';
import { whereIs } from '../sim/where';
import { HALF } from './city';

const MAX = CFG.maxAgents;
const PED_H = 0.62; // world units for a look.height of 1
const SKIN = [0xf6d3b8, 0xe9b98f, 0xd39a6a, 0xb07a4e, 0x8a5a36, 0x5e3b24];
const HAIR = [0x1c1612, 0x3b2616, 0x6a4424, 0xa9743a, 0xd9b36a, 0x9a9a9a, 0xe8e6e0];

interface Part { mesh: THREE.InstancedMesh; per: number; }

export interface PedView {
  group: THREE.Group;
  /** Displayed position per agent id (x, z) and visibility 0..1. */
  posX: Float32Array;
  posZ: Float32Array;
  vis: Float32Array;
  height: Float32Array;
  update(sim: Sim, tickFloat: number, dt: number, simSpeed: number, time: number): void;
  setSelected(id: number): void;
}

function part(geo: THREE.BufferGeometry, per: number, mat: THREE.Material, shadow = true): Part {
  const mesh = new THREE.InstancedMesh(geo, mat, MAX * per);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = shadow;
  mesh.frustumCulled = false;
  mesh.count = 0;
  // Colour buffers must exist before the first render.
  const c = new THREE.Color(1, 1, 1);
  for (let i = 0; i < MAX * per; i++) mesh.setColorAt(i, c);
  return { mesh, per };
}

export function createPeds(): PedView {
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ roughness: 0.75 });
  const hairMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x1b1b1f });

  // Geometry is authored in "ped units" where a standing adult is about 1 tall.
  const headGeo = new THREE.SphereGeometry(0.112, 12, 9);
  headGeo.scale(0.92, 1.05, 0.98);
  const hairGeo = new THREE.SphereGeometry(0.122, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56);
  hairGeo.rotateX(-0.28);
  const hairBackGeo = new THREE.SphereGeometry(0.1, 8, 6);
  const eyeGeo = (() => {
    const l = new THREE.BoxGeometry(0.022, 0.03, 0.02); l.translate(-0.04, 0.012, 0.104);
    const r = new THREE.BoxGeometry(0.022, 0.03, 0.02); r.translate(0.04, 0.012, 0.104);
    const g = new THREE.BufferGeometry();
    const lp = l.toNonIndexed().attributes.position!.array as Float32Array, rp = r.toNonIndexed().attributes.position!.array as Float32Array;
    const all = new Float32Array(lp.length + rp.length);
    all.set(lp); all.set(rp, lp.length);
    g.setAttribute('position', new THREE.BufferAttribute(all, 3));
    g.computeVertexNormals();
    return g;
  })();
  // Torso tapers slightly from shoulders to waist.
  const torsoGeo = new THREE.CylinderGeometry(0.15, 0.125, 0.32, 8);
  torsoGeo.scale(1, 1, 0.6);
  const hipsGeo = new THREE.CylinderGeometry(0.128, 0.12, 0.13, 8);
  hipsGeo.scale(1, 1, 0.62);
  // Limbs hang from their pivot (origin at shoulder / hip).
  const armGeo = new THREE.CylinderGeometry(0.042, 0.034, 0.3, 6); armGeo.translate(0, -0.15, 0);
  const handGeo = new THREE.SphereGeometry(0.04, 6, 5); handGeo.translate(0, -0.33, 0);
  const legGeo = new THREE.CylinderGeometry(0.058, 0.044, 0.44, 6); legGeo.translate(0, -0.22, 0);
  const shoeGeo = new THREE.BoxGeometry(0.085, 0.05, 0.17); shoeGeo.translate(0, -0.455, 0.035);
  const packGeo = new THREE.BoxGeometry(0.2, 0.22, 0.09); packGeo.translate(0, 0.7, -0.14);
  const shadowGeo = new THREE.CircleGeometry(0.2, 12); shadowGeo.rotateX(-Math.PI / 2);

  const head = part(headGeo, 1, skinMat);
  const hair = part(hairGeo, 1, hairMat);
  const hairBack = part(hairBackGeo, 1, hairMat);
  const eyes = part(eyeGeo, 1, dark, false);
  const torso = part(torsoGeo, 1, cloth);
  const hips = part(hipsGeo, 1, cloth);
  const arms = part(armGeo, 2, cloth);
  const hands = part(handGeo, 2, skinMat, false);
  const legs = part(legGeo, 2, cloth);
  const shoes = part(shoeGeo, 2, new THREE.MeshStandardMaterial({ roughness: 0.6 }), false);
  const pack = part(packGeo, 1, cloth, false);
  const shadow = part(shadowGeo, 1, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }), false);
  shadow.mesh.renderOrder = 1;
  const all = [head, hair, hairBack, eyes, torso, hips, arms, hands, legs, shoes, pack, shadow];
  for (const p of all) group.add(p.mesh);

  // Selection ring.
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.34, 28), new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  ring.renderOrder = 3;
  group.add(ring);
  let selected = -1;

  // Per-agent display state, indexed by agent id (ids can exceed the instance cap over a run).
  const CAP = 1024;
  const posX = new Float32Array(CAP), posZ = new Float32Array(CAP), vis = new Float32Array(CAP), height = new Float32Array(CAP);
  const yaw = new Float32Array(CAP), phase = new Float32Array(CAP), gait = new Float32Array(CAP);
  const seen = new Uint8Array(CAP);
  const slotOwner = new Int16Array(MAX).fill(-1);
  const slotOf = new Int16Array(CAP).fill(-1);

  const out = [0, 0];
  const base = new THREE.Matrix4(), m = new THREE.Matrix4(), local = new THREE.Matrix4();
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const col = new THREE.Color();

  const setLocal = (x: number, y: number, z: number, rx: number, ry: number, rz: number, sx = 1, sy = 1, sz = 1) => {
    e.set(rx, ry, rz);
    q.setFromEuler(e);
    local.compose(v.set(x, y, z), q, s.set(sx, sy, sz));
    m.multiplyMatrices(base, local);
  };

  const paint = (slot: number, a: Agent, sim: Sim) => {
    const L = a.look;
    const job = a.job >= 0 ? (sim.world.buildings[a.job] as Building).kind : null;
    let shirt = L.shirt, pants = L.pants, hairCol = HAIR[L.hairColor] as number;
    if (job === 'police') { shirt = 0x1f3f8f; pants = 0x18243a; hairCol = 0x16213a; } // cap
    else if (job === 'clinic') { shirt = 0xf4f7f9; pants = 0x7fc4bd; }
    else if (job === 'factory') { pants = 0x37474f; }
    const skin = SKIN[L.skin] as number;
    head.mesh.setColorAt(slot, col.set(skin));
    hair.mesh.setColorAt(slot, col.set(hairCol));
    hairBack.mesh.setColorAt(slot, col.set(hairCol));
    torso.mesh.setColorAt(slot, col.set(shirt));
    hips.mesh.setColorAt(slot, col.set(pants));
    pack.mesh.setColorAt(slot, col.set([0xe53935, 0x1e88e5, 0xfdd835, 0x43a047][a.id % 4] as number));
    for (let k = 0; k < 2; k++) {
      arms.mesh.setColorAt(slot * 2 + k, col.set(shirt));
      hands.mesh.setColorAt(slot * 2 + k, col.set(skin));
      legs.mesh.setColorAt(slot * 2 + k, col.set(pants));
      shoes.mesh.setColorAt(slot * 2 + k, col.set(a.age < 18 ? 0xf2f2f2 : 0x2b2b2e));
    }
    for (const p of all) if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
  };

  // Jobs change outfits; repaint when the job changes.
  const paintedJob = new Int16Array(CAP).fill(-2);

  function update(sim: Sim, tickFloat: number, dt: number, simSpeed: number, time: number): void {
    const agents = sim.agents;
    let maxSlot = -1;
    for (let i = 0; i < agents.length && i < CAP; i++) {
      const a = agents[i] as Agent;
      let slot = slotOf[i] as number;
      if (a.status !== 'active') {
        if (slot >= 0) { slotOwner[slot] = -1; slotOf[i] = -1; for (const p of all) for (let k = 0; k < p.per; k++) p.mesh.setMatrixAt(slot * p.per + k, zero); }
        continue;
      }
      if (slot < 0) {
        slot = slotOwner.indexOf(-1);
        if (slot < 0) continue; // over the instancing cap; cannot happen while the sim caps population
        slotOwner[slot] = i; slotOf[i] = slot;
        paintedJob[i] = -2;
      }
      if (slot > maxSlot) maxSlot = slot;
      if (paintedJob[i] !== a.job) { paint(slot, a, sim); paintedJob[i] = a.job; }

      const outdoors = whereIs(sim, a, tickFloat, out);
      let tx = (out[0] as number) - HALF, tz = (out[1] as number) - HALF;
      const walking = a.tripFrom >= 0;
      let px = posX[i] as number, pz = posZ[i] as number;
      if (!seen[i]) { seen[i] = 1; px = tx; pz = tz; yaw[i] = hash01(i, 3) * 6.28; }

      // Keep to the right-hand pavement while walking along a street.
      const ddx = tx - px, ddz = tz - pz;
      const dd = Math.hypot(ddx, ddz);
      if (walking && dd > 0.001) {
        const side = 0.36;
        tx += (-ddz / dd) * side * Math.min(1, dd * 4);
        tz += (ddx / dd) * side * Math.min(1, dd * 4);
      }
      // Ease towards the target; at high sim speed just keep up.
      const k = simSpeed > 8 ? 1 : Math.min(1, dt * (walking ? 9 : 2.2));
      const nx = px + (tx - px) * k, nz = pz + (tz - pz) * k;
      const moved = Math.hypot(nx - px, nz - pz);
      const speed = dt > 0 ? moved / dt : 0;
      posX[i] = nx; posZ[i] = nz;
      if (moved > 0.0008) {
        const want = Math.atan2(nx - px, nz - pz);
        let d = want - (yaw[i] as number);
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        yaw[i] = (yaw[i] as number) + d * Math.min(1, dt * 10 + (simSpeed > 8 ? 1 : 0));
      }
      const targetGait = Math.min(1, speed / 1.2);
      gait[i] = (gait[i] as number) + (targetGait - (gait[i] as number)) * Math.min(1, dt * 8);
      // Cadence is capped so legs never blur, even though time is compressed.
      phase[i] = (phase[i] as number) + dt * Math.min(11.5, 5 + speed * 2.4) * (gait[i] as number > 0.05 ? 1 : 0);

      const show = outdoors ? 1 : 0;
      vis[i] = (vis[i] as number) + (show - (vis[i] as number)) * Math.min(1, dt * (simSpeed > 8 ? 30 : 7));
      const visible = vis[i] as number;
      const L = a.look;
      const H = PED_H * L.height;
      height[i] = H * 1.08;
      if (visible < 0.02) {
        for (const p of all) for (let j = 0; j < p.per; j++) p.mesh.setMatrixAt(slot * p.per + j, zero);
        continue;
      }

      const g = gait[i] as number, ph = phase[i] as number;
      const swing = Math.sin(ph) * 0.62 * g;
      const child = a.age < 18, senior = a.age >= 66;
      const sitting = !walking && g < 0.1 && (sim.world.buildings[a.at] as Building).kind === 'park' && hash01(a.id, a.decidedAt) < 0.35;
      const idle = 1 - g;
      const breathe = Math.sin(time * 1.7 + i) * 0.006 * idle;
      const sway = Math.sin(time * 0.9 + i * 1.3) * 0.035 * idle;
      const bob = Math.abs(Math.sin(ph)) * 0.022 * g;
      const stoop = (senior ? 0.16 : 0) + g * 0.05 + (a.illness && !sitting ? 0.1 : 0);
      const sc = H * visible;
      const sitDrop = sitting ? -0.2 : 0;
      const wide = L.female ? 0.92 : 1.04;

      // Base: world position, facing, scale to this person's height.
      e.set(0, (yaw[i] as number) + sway, 0);
      q.setFromEuler(e);
      base.compose(v.set(nx, (bob + sitDrop) * H, nz), q, s.set(sc, sc, sc));

      setLocal(0, 0.5, 0, 0, 0, 0, wide, 1, 1); hips.mesh.setMatrixAt(slot, m);
      setLocal(0, 0.705 + breathe, stoop * 0.05, stoop, 0, 0, wide, 1, 1); torso.mesh.setMatrixAt(slot, m);
      const hy = 0.965 + breathe - stoop * 0.03, hz = stoop * 0.14;
      const nod = Math.sin(time * 0.6 + i * 2.1) * 0.05 * idle;
      setLocal(0, hy, hz, stoop * 0.5 + nod, 0, 0); head.mesh.setMatrixAt(slot, m); eyes.mesh.setMatrixAt(slot, m);
      if (L.hairStyle === 3) hair.mesh.setMatrixAt(slot, zero);
      else { setLocal(0, hy + 0.012, hz - 0.004, stoop * 0.5 + nod, 0, 0); hair.mesh.setMatrixAt(slot, m); }
      if (L.hairStyle === 1) { setLocal(0, hy - 0.07, hz - 0.075, stoop * 0.5 + 0.15, 0, 0, 1.15, 1.5, 0.6); hairBack.mesh.setMatrixAt(slot, m); }
      else if (L.hairStyle === 2) { setLocal(0, hy + 0.1, hz - 0.085, 0, 0, 0, 0.55, 0.55, 0.55); hairBack.mesh.setMatrixAt(slot, m); }
      else hairBack.mesh.setMatrixAt(slot, zero);
      if (child) { setLocal(0, breathe, stoop * 0.05, stoop, 0, 0); pack.mesh.setMatrixAt(slot, m); }
      else pack.mesh.setMatrixAt(slot, zero);

      // Arms swing opposite to legs; elbows are implied by a slight outward splay.
      const shoulderY = 0.835 + breathe, shoulderX = 0.17 * wide;
      const armIdle = sitting ? -0.5 : 0;
      for (let side = 0; side < 2; side++) {
        const sgn = side === 0 ? -1 : 1;
        setLocal(sgn * shoulderX, shoulderY, stoop * 0.1, armIdle - sgn * swing * 0.85 + stoop * 0.3, 0, sgn * (0.09 + idle * 0.03));
        arms.mesh.setMatrixAt(slot * 2 + side, m); hands.mesh.setMatrixAt(slot * 2 + side, m);
        const legRot = sitting ? -1.45 : sgn * swing;
        setLocal(sgn * 0.066 * wide, 0.46, 0, legRot, 0, 0);
        legs.mesh.setMatrixAt(slot * 2 + side, m); shoes.mesh.setMatrixAt(slot * 2 + side, m);
      }
      // Blob shadow stays flat on the ground regardless of bob.
      local.makeScale(H * 1.5 * visible, 1, H * 1.5 * visible).setPosition(nx, 0.055, nz);
      shadow.mesh.setMatrixAt(slot, local);
    }
    for (const p of all) {
      p.mesh.count = (maxSlot + 1) * p.per;
      p.mesh.instanceMatrix.needsUpdate = true;
    }
    if (selected >= 0 && selected < CAP && (vis[selected] as number) > 0.3 && agents[selected]?.status === 'active') {
      ring.visible = true;
      ring.position.set(posX[selected] as number, 0.07, posZ[selected] as number);
      const pulse = 1 + Math.sin(time * 4) * 0.08;
      ring.scale.set(pulse, pulse, pulse);
    } else ring.visible = false;
  }

  return { group, posX, posZ, vis, height, update, setSelected(id) { selected = id; } };
}
