// Procedural city: ground, roads, buildings, trees, lamps, signs. All geometry, no assets.
import * as THREE from 'three';
import { hash01 } from '../sim/rng';
import type { Building, BuildingKind, Decor, World } from '../sim/types';
import { TILE_ROAD } from '../sim/types';
import { Builder } from './builder';

export const HALF = 32;

const WALLS = [0xf3e9d2, 0xe8d5b7, 0xd9e4ec, 0xf6e7a8, 0xe0b9a0, 0xcfdcc4, 0xf4f4f0, 0xd8c9e8, 0xf0c9c0];
const ROOFS = [0x9c4a3c, 0x5b6470, 0x7a3b2e, 0x40564a, 0x8a5a44, 0x4c4f5a];
const GREENS = [0x4f9a4a, 0x5fae52, 0x3f8a48, 0x6bb35a, 0x4a9460];
const PINES = [0x2f6e4a, 0x2a6145, 0x35775a];

export const BUILDING_HEIGHT: Record<BuildingKind, number> = {
  house: 2.1, apartment: 4.6, school: 2.8, clinic: 2.3, police: 2.3, townhall: 4.2, grocery: 2.1, store: 2.1,
  cafe: 2.0, restaurant: 2.1, bar: 2.1, factory: 3.4, office: 5.6, farm: 2.8, park: 1.6,
};

interface WindowSpec { m: THREE.Matrix4; building: number; seed: number; }

export interface City {
  group: THREE.Group;
  windows: THREE.InstancedMesh;
  windowBuilding: Int16Array;
  windowSeed: Float32Array;
  lampGlow: THREE.Mesh;
  lampBulbs: THREE.Mesh;
  signs: { icon: THREE.Sprite; label: THREE.Sprite; building: number }[];
  smokeAt: THREE.Vector3[];
  water: THREE.MeshStandardMaterial;
}

function tree(b: Builder, x: number, z: number, s: number, seed: number): void {
  const pine = hash01(seed, 1) < 0.3;
  const lean = (hash01(seed, 2) - 0.5) * 0.1;
  b.cylinder(x, 0, z, 0.05 * s, 0.08 * s, 0.5 * s, 0x6b4a32, 5);
  if (pine) {
    const c = PINES[Math.floor(hash01(seed, 3) * PINES.length)] as number;
    b.cone(x, 0.35 * s, z, 0.42 * s, 0.75 * s, c, 7);
    b.cone(x + lean, 0.8 * s, z, 0.3 * s, 0.65 * s, c, 7);
  } else {
    const c = GREENS[Math.floor(hash01(seed, 3) * GREENS.length)] as number;
    b.blob(x, 0.85 * s, z, 0.48 * s, c, 0.9, 1);
    b.blob(x + 0.2 * s, 1.15 * s, z + lean * 3, 0.32 * s, c, 0.9, 0);
  }
}

function makeSprite(text: string, icon: string, big: boolean): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  if (big) {
    c.width = 128; c.height = 128;
    ctx.fillStyle = 'rgba(18,22,34,0.82)';
    ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
    ctx.font = '64px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(icon, 64, 70);
  } else {
    ctx.font = '600 34px system-ui, -apple-system, "Segoe UI", sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + 44;
    c.width = w; c.height = 64;
    ctx.font = '600 34px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(18,22,34,0.8)';
    ctx.beginPath(); ctx.roundRect(2, 6, w - 4, 52, 26); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, 34);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false });
  const s = new THREE.Sprite(mat);
  s.userData.aspect = c.width / c.height;
  s.renderOrder = 10;
  return s;
}

function grassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#6fae5a';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const x = hash01(i, 11) * 256, y = hash01(i, 12) * 256, k = hash01(i, 13);
    ctx.fillStyle = k < 0.5 ? 'rgba(60,120,60,0.22)' : 'rgba(150,200,110,0.2)';
    ctx.fillRect(x, y, 2 + k * 3, 2 + k * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(50, 50);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,220,150,0.9)');
  g.addColorStop(0.5, 'rgba(255,200,120,0.3)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function buildCity(world: World): City {
  const group = new THREE.Group();
  const solid = new Builder(); // casts shadows
  const flat = new Builder(); // ground-level decals
  const windows: WindowSpec[] = [];
  const smokeAt: THREE.Vector3[] = [];
  const lampAt: THREE.Vector3[] = [];
  const wm = new THREE.Matrix4();
  const wq = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  /** Window on a wall of the current building. side: 0 front(+z) 1 back 2 right(+x) 3 left. */
  const win = (building: number, side: number, along: number, y: number, depth: number, w: number, h: number) => {
    const ry = [0, Math.PI, Math.PI / 2, -Math.PI / 2][side] as number;
    const off = depth + 0.03;
    const lx = side === 0 ? along : side === 1 ? along : side === 2 ? off : -off;
    const lz = side === 0 ? off : side === 1 ? -off : along;
    wq.setFromAxisAngle(up, ry);
    wm.compose(new THREE.Vector3(lx, y, lz), wq, new THREE.Vector3(w, h, 1)).premultiply(solid.xf);
    windows.push({ m: wm.clone(), building, seed: hash01(windows.length, building) });
  };
  const winRow = (building: number, side: number, span: number, depth: number, y: number, count: number, w: number, h: number, skipMid = false) => {
    for (let i = 0; i < count; i++) {
      if (skipMid && count % 2 === 1 && i === (count - 1) / 2) continue;
      const along = count === 1 ? 0 : -span / 2 + (span * (i + 0.5)) / count;
      win(building, side, along, y, depth, w, h);
    }
  };
  const door = (hd: number, color = 0x5a3d2b, w = 0.36, h = 0.62, x = 0) => {
    solid.box(x, 0, hd + 0.02, w, h, 0.05, color);
    solid.box(x, 0, hd + 0.16, w + 0.3, 0.05, 0.28, 0xb9b4a8);
  };
  const flatRoof = (w: number, d: number, y: number, color: number) => {
    solid.box(0, y, 0, w + 0.12, 0.12, d + 0.12, color);
    solid.box(0, y + 0.12, d / 2, w + 0.12, 0.14, 0.08, color);
    solid.box(0, y + 0.12, -d / 2, w + 0.12, 0.14, 0.08, color);
    solid.box(w / 2, y + 0.12, 0, 0.08, 0.14, d + 0.12, color);
    solid.box(-w / 2, y + 0.12, 0, 0.08, 0.14, d + 0.12, color);
  };
  const shopFront = (id: number, w: number, d: number, h: number, wall: number, trim: number, awning: number) => {
    const hd = d / 2;
    solid.box(0, 0, 0, w, h, d, wall, 0, 0.02);
    flatRoof(w, d, h, trim);
    solid.slab(0, h * 0.62, hd + 0.3, w * 0.94, 0.06, 0.66, awning, 0.32);
    solid.box(0, h * 0.72, hd + 0.03, w * 0.7, 0.3, 0.06, trim);
    door(hd, 0x3b2f2a, 0.4, 0.66, w * 0.3);
    win(id, 0, -w * 0.12, h * 0.36, hd, w * 0.56, h * 0.36);
    winRow(id, 1, w * 0.8, hd, h * 0.5, 3, 0.4, 0.4);
    winRow(id, 2, d * 0.7, w / 2, h * 0.5, 2, 0.4, 0.4);
    winRow(id, 3, d * 0.7, w / 2, h * 0.5, 2, 0.4, 0.4);
  };

  // ------------------------------------------------------------ roads
  const n = world.size;
  const lines = world.roadLines;
  const lo = lines[0] as number, hi = lines[lines.length - 1] as number;
  const ASPHALT = 0x41454d, KERB = 0xb8b6ad, PAINT = 0xe9e4cf;
  for (const line of lines) {
    const through = line === 26 || line === 37;
    const from = through ? -40 : lo, to = through ? n + 40 : hi + 1;
    const len = to - from, mid = (from + to) / 2 - HALF;
    const c = line + 0.5 - HALF;
    flat.ground(mid, 0.02, c, len, 1, ASPHALT);
    flat.ground(c, 0.021, mid, 1, len, ASPHALT);
  }
  const isRoad = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && world.tiles[y * n + x] === TILE_ROAD;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!isRoad(x, y)) continue;
    const horiz = isRoad(x - 1, y) || isRoad(x + 1, y);
    const vert = isRoad(x, y - 1) || isRoad(x, y + 1);
    const cx = x + 0.5 - HALF, cz = y + 0.5 - HALF;
    if (horiz && vert) continue; // intersection: plain asphalt
    if (horiz) {
      flat.ground(cx, 0.03, cz, 0.42, 0.045, PAINT);
      solid.box(cx, 0, cz - 0.43, 1, 0.045, 0.14, KERB);
      solid.box(cx, 0, cz + 0.43, 1, 0.045, 0.14, KERB);
    } else {
      flat.ground(cx, 0.03, cz, 0.045, 0.42, PAINT);
      solid.box(cx - 0.43, 0, cz, 0.14, 0.045, 1, KERB);
      solid.box(cx + 0.43, 0, cz, 0.14, 0.045, 1, KERB);
    }
  }
  // Crosswalk stripes and a lamp at every intersection.
  for (const lx of lines) for (const lz of lines) {
    const cx = lx + 0.5 - HALF, cz = lz + 0.5 - HALF;
    for (let i = -1; i <= 1; i++) {
      flat.ground(cx + i * 0.2, 0.031, cz - 0.72, 0.09, 0.3, PAINT);
      flat.ground(cx + i * 0.2, 0.031, cz + 0.72, 0.09, 0.3, PAINT);
      flat.ground(cx - 0.72, 0.031, cz + i * 0.2, 0.3, 0.09, PAINT);
      flat.ground(cx + 0.72, 0.031, cz + i * 0.2, 0.3, 0.09, PAINT);
    }
    lampAt.push(new THREE.Vector3(cx + 0.62, 0, cz + 0.62));
  }
  for (let i = 0; i < lines.length - 1; i++) for (const l of lines) {
    // Mid-block lamps along every street.
    const mid = ((lines[i] as number) + (lines[i + 1] as number)) / 2 + 0.5 - HALF;
    lampAt.push(new THREE.Vector3(mid, 0, l + 0.5 - HALF - 0.62));
    lampAt.push(new THREE.Vector3(l + 0.5 - HALF + 0.62, 0, mid));
  }
  solid.setOrigin(0, 0, 0);
  for (const p of lampAt) {
    solid.cylinder(p.x, 0, p.z, 0.025, 0.035, 1.25, 0x2e3440, 5);
    solid.box(p.x, 1.22, p.z, 0.2, 0.05, 0.09, 0x2e3440);
  }

  // ------------------------------------------------------------ buildings
  for (const bd of world.buildings) {
    const north = bd.doorY < bd.y;
    const cx = bd.x + bd.w / 2 - HALF, cz = bd.y + bd.h / 2 - HALF;
    solid.setOrigin(cx, 0, cz, north ? Math.PI : 0);
    flat.setOrigin(cx, 0, cz, north ? Math.PI : 0);
    const v = bd.variant;
    const id = bd.id;
    const fw = bd.w, fd = bd.h; // footprint
    const paved = bd.kind !== 'house' && bd.kind !== 'park' && bd.kind !== 'farm';
    if (bd.kind !== 'park') {
      flat.ground(0, 0.012, 0, fw + 1, fd + 1.6, paved ? 0xc9c3b4 : 0x7dbb63);
      // Path from the door to the street.
      const gap = Math.abs(bd.doorY + 0.5 - (north ? bd.y : bd.y + bd.h));
      flat.ground(0, 0.016, fd / 2 + gap / 2, 0.5, gap + 0.2, 0xd8d0bd);
    }
    switch (bd.kind) {
      case 'house': {
        const two = v % 3 === 0;
        const w = 2.5, d = 2.2, h = two ? 1.75 : 1.05, hd = d / 2;
        const wall = WALLS[v % WALLS.length] as number, roof = ROOFS[(v >> 2) % ROOFS.length] as number;
        solid.box(0, 0, 0, w, h, d, wall, 0, 0.015);
        solid.gable(0, h, 0, w + 0.3, 0.75, d + 0.34, roof);
        solid.box(w * 0.28, h + 0.25, -0.3, 0.22, 0.7, 0.22, 0x8d6e63);
        door(hd, [0x5a3d2b, 0x2f4858, 0x7a2e2e, 0x355e3b][v % 4]);
        win(id, 0, -0.75, 0.6, hd, 0.42, 0.42); win(id, 0, 0.75, 0.6, hd, 0.42, 0.42);
        winRow(id, 1, w * 0.8, hd, 0.6, 2, 0.42, 0.42);
        winRow(id, 2, d * 0.5, w / 2, 0.6, 1, 0.42, 0.42); winRow(id, 3, d * 0.5, w / 2, 0.6, 1, 0.42, 0.42);
        if (two) { winRow(id, 0, w * 0.8, hd, 1.3, 3, 0.36, 0.36); winRow(id, 1, w * 0.8, hd, 1.3, 2, 0.36, 0.36); }
        // Garden touches.
        if (v % 2 === 0) tree(solid, -1.25, 1.35, 0.75 + hash01(v, 4) * 0.3, v);
        if (v % 5 < 3) { solid.blob(1.2, 0.16, 1.3, 0.2, 0x4f9a4a, 0.8); solid.blob(0.9, 0.13, 1.35, 0.15, 0x5fae52, 0.8); }
        solid.box(-0.55, 0, hd + 0.55, 0.05, 0.3, 0.05, 0x8d6e63); solid.box(-0.55, 0.3, hd + 0.55, 0.16, 0.1, 0.1, [0xc0392b, 0x2e86c1, 0xf2f3f4][v % 3] as number);
        break;
      }
      case 'apartment': {
        const w = 3.4, d = 3.0, floors = 4, fh = 0.95, h = floors * fh + 0.2, hd = d / 2;
        const wall = [0xc98b6b, 0xd9c7a8, 0xa9b7c6][v % 3] as number;
        solid.box(0, 0, 0, w, h, d, wall, 0, 0.012);
        flatRoof(w, d, h, 0x6b6f7a);
        solid.cylinder(0.9, h + 0.12, -0.6, 0.3, 0.3, 0.5, 0x8b9099, 8);
        solid.box(-0.8, h + 0.12, 0.4, 0.6, 0.3, 0.5, 0x9aa0a8);
        solid.box(0, 0.8, hd + 0.25, 1.1, 0.07, 0.5, 0x6b6f7a);
        door(hd, 0x2f3b4c, 0.5, 0.7);
        for (let f = 0; f < floors; f++) {
          const y = 0.55 + f * fh;
          winRow(id, 0, w * 0.86, hd, y, 5, 0.38, 0.46, f === 0);
          winRow(id, 1, w * 0.86, hd, y, 5, 0.38, 0.46);
          winRow(id, 2, d * 0.8, w / 2, y, 3, 0.38, 0.46); winRow(id, 3, d * 0.8, w / 2, y, 3, 0.38, 0.46);
          if (f > 0) { solid.box(-1.0, y - 0.3, hd + 0.14, 0.7, 0.05, 0.28, 0x6b6f7a); solid.box(1.0, y - 0.3, hd + 0.14, 0.7, 0.05, 0.28, 0x6b6f7a); }
        }
        break;
      }
      case 'office': {
        const w = 3.3, d = 3.3, floors = 6, fh = 0.82, h = floors * fh + 0.25, hd = d / 2;
        solid.box(0, 0, 0, w, h, d, 0x8fa3b5, 0, 0.01);
        solid.box(0, 0, 0, w + 0.08, 0.5, d + 0.08, 0x5a6877);
        flatRoof(w, d, h, 0x4f5b68);
        solid.box(0.6, h + 0.12, 0.3, 0.9, 0.35, 0.7, 0x77828e);
        solid.cylinder(-0.9, h + 0.12, -0.8, 0.02, 0.02, 1.1, 0x2e3440, 4);
        door(hd, 0x1d2a38, 0.7, 0.72);
        for (let f = 0; f < floors; f++) {
          const y = 0.55 + f * fh + (f === 0 ? 0.25 : 0);
          for (let s = 0; s < 4; s++) winRow(id, s, 3.0, hd, y, 6, 0.42, 0.5, f === 0 && s === 0);
        }
        break;
      }
      case 'grocery': shopFront(id, 3.6, 2.4, 1.5, 0xe9f2df, 0x3f8a48, 0x4caf50); solid.box(-1.4, 0, 1.5, 0.5, 0.3, 0.35, 0xd68910); solid.box(-0.8, 0, 1.5, 0.5, 0.3, 0.35, 0xc0392b); break;
      case 'store': shopFront(id, 3.6, 2.4, 1.5, 0xe6e0f0, 0x5b4a8a, 0x7e57c2); break;
      case 'restaurant': shopFront(id, 3.6, 2.4, 1.55, 0xf7e7d3, 0x8e2f2f, 0xc0392b); solid.box(1.2, 1.55, -0.6, 0.3, 0.7, 0.3, 0x7b5e57); break;
      case 'bar': shopFront(id, 3.6, 2.4, 1.5, 0x6d4c41, 0x3e2723, 0xd68910); solid.cylinder(-1.5, 0, 1.5, 0.16, 0.16, 0.34, 0x8d6e63, 8); solid.cylinder(-1.1, 0, 1.6, 0.16, 0.16, 0.34, 0x8d6e63, 8); break;
      case 'cafe': {
        shopFront(id, 2.6, 2.2, 1.4, 0xfdf3e3, 0x8d5a3b, 0xe07a5f);
        for (let i = 0; i < 2; i++) {
          const tx = -0.9 + i * 1.2, tz = 1.75;
          solid.cylinder(tx, 0, tz, 0.03, 0.03, 0.32, 0x555555, 5);
          solid.cylinder(tx, 0.32, tz, 0.2, 0.2, 0.03, 0xf5f5f0, 10);
          solid.cylinder(tx, 0, tz, 0.015, 0.015, 0.95, 0x777777, 4);
          solid.cone(tx, 0.82, tz, 0.42, 0.2, i ? 0xe07a5f : 0xf2cc8f, 8);
        }
        break;
      }
      case 'townhall': {
        const w = 3.6, d = 2.8, h = 2.0, hd = d / 2;
        solid.box(0, 0, -0.2, w, h, d, 0xece4d0, 0, 0.012);
        solid.box(0, 0, hd + 0.05, 2.6, 0.14, 0.9, 0xd4ccb8);
        solid.box(0, 0.14, hd, 2.2, 0.12, 0.6, 0xd4ccb8);
        for (let i = 0; i < 4; i++) solid.cylinder(-0.9 + i * 0.6, 0.26, hd + 0.2, 0.08, 0.09, 1.5, 0xf6f1e3, 8);
        solid.box(0, 1.76, hd + 0.05, 2.5, 0.16, 0.7, 0xf6f1e3);
        solid.gable(0, 1.92, hd + 0.05, 0.7, 0.5, 2.5, 0xd9cfb8, Math.PI / 2);
        solid.gable(0, h, -0.2, w + 0.2, 0.55, d + 0.2, 0x607d8b);
        solid.box(0, h, -0.3, 0.8, 1.3, 0.8, 0xece4d0);
        solid.cone(0, h + 1.3, -0.3, 0.68, 0.7, 0x607d8b, 4);
        solid.cylinder(0, h + 2.0, -0.3, 0.015, 0.015, 0.6, 0x333333, 4);
        solid.box(0.16, h + 2.4, -0.3, 0.3, 0.18, 0.02, 0xc0392b);
        door(hd - 0.2, 0x4e342e, 0.5, 0.9);
        winRow(id, 0, w * 0.9, hd - 0.2, 0.95, 4, 0.34, 0.7);
        winRow(id, 1, w * 0.85, hd + 0.2, 0.95, 4, 0.34, 0.7);
        winRow(id, 2, d * 0.7, w / 2, 0.95, 2, 0.34, 0.7); winRow(id, 3, d * 0.7, w / 2, 0.95, 2, 0.34, 0.7);
        win(id, 0, 0, h + 0.85, 0.1, 0.36, 0.36);
        break;
      }
      case 'police': {
        const w = 3.6, d = 2.4, h = 1.6, hd = d / 2;
        solid.box(0, 0, 0, w, h, d, 0xe8ecf0, 0, 0.012);
        solid.box(0, h * 0.62, 0, w + 0.04, 0.22, d + 0.04, 0x1f4e9c);
        flatRoof(w, d, h, 0x37474f);
        solid.box(0, h + 0.26, 0.5, 0.3, 0.16, 0.16, 0x2979ff);
        solid.box(1.1, 0, hd + 0.02, 1.0, 0.85, 0.05, 0x546e7a);
        door(hd, 0x1f3a5f, 0.42, 0.7, -0.6);
        winRow(id, 0, 1.2, hd, 0.62, 2, 0.34, 0.4); winRow(id, 1, w * 0.8, hd, 0.62, 4, 0.34, 0.3);
        winRow(id, 2, d * 0.7, w / 2, 0.62, 2, 0.34, 0.4); winRow(id, 3, d * 0.7, w / 2, 0.62, 2, 0.34, 0.4);
        break;
      }
      case 'clinic': {
        const w = 3.6, d = 2.4, h = 1.7, hd = d / 2;
        solid.box(0, 0, 0, w, h, d, 0xf7f9fa, 0, 0.01);
        solid.box(0, 0.25, 0, w + 0.04, 0.12, d + 0.04, 0x26a69a);
        flatRoof(w, d, h, 0xb0bec5);
        solid.box(1.1, 1.25, hd + 0.03, 0.42, 0.13, 0.05, 0xd32f2f); solid.box(1.1, 1.25, hd + 0.03, 0.13, 0.42, 0.05, 0xd32f2f);
        solid.box(0, h + 0.14, 0, 0.8, 0.06, 0.24, 0xd32f2f); solid.box(0, h + 0.14, 0, 0.24, 0.06, 0.8, 0xd32f2f);
        solid.box(0, 0.85, hd + 0.3, 1.3, 0.06, 0.6, 0x26a69a);
        door(hd, 0x80cbc4, 0.6, 0.72);
        winRow(id, 0, w * 0.85, hd, 0.8, 5, 0.36, 0.44, true); winRow(id, 1, w * 0.85, hd, 0.8, 5, 0.36, 0.44);
        winRow(id, 2, d * 0.7, w / 2, 0.8, 2, 0.36, 0.44); winRow(id, 3, d * 0.7, w / 2, 0.8, 2, 0.36, 0.44);
        break;
      }
      case 'school': {
        const w = 7.4, d = 3.0, h = 1.9, hd = d / 2;
        solid.box(0, 0, 0, w, h, d, 0xd98c5f, 0, 0.012);
        flatRoof(w, d, h, 0x6d4c41);
        solid.box(0, 0, hd - 0.1, 1.8, h + 0.6, 0.7, 0xe8b08a);
        solid.gable(0, h + 0.6, hd - 0.1, 0.9, 0.4, 2.0, 0x6d4c41, Math.PI / 2);
        door(hd + 0.25, 0x33691e, 0.7, 0.8);
        win(id, 0, 0, h + 0.2, hd + 0.25, 0.4, 0.4);
        for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) win(id, 0, sx * (1.4 + i * 0.62), 0.95, hd, 0.44, 0.7);
        winRow(id, 1, w * 0.92, hd, 0.95, 10, 0.44, 0.7);
        winRow(id, 2, d * 0.7, w / 2, 0.95, 2, 0.44, 0.7); winRow(id, 3, d * 0.7, w / 2, 0.95, 2, 0.44, 0.7);
        solid.cylinder(3.2, 0, hd + 1.0, 0.02, 0.02, 2.2, 0x9e9e9e, 4); solid.box(3.38, 1.9, hd + 1.0, 0.36, 0.22, 0.02, 0x1e88e5);
        // Playground behind the building.
        const pz = -hd - 2.6;
        flat.ground(0, 0.018, pz, 6, 2.6, 0xd9b38c);
        for (const sx of [-1, 1]) { solid.cylinder(-2 + sx * 0.5, 0, pz, 0.03, 0.03, 0.9, 0xe53935, 5); }
        solid.box(-2, 0.88, pz, 1.1, 0.05, 0.05, 0xe53935);
        solid.box(-2.2, 0.35, pz, 0.04, 0.5, 0.04, 0x455a64); solid.box(-1.8, 0.35, pz, 0.04, 0.5, 0.04, 0x455a64);
        solid.box(-2.2, 0.33, pz, 0.2, 0.03, 0.14, 0xfdd835); solid.box(-1.8, 0.33, pz, 0.2, 0.03, 0.14, 0xfdd835);
        solid.box(1.0, 0, pz, 0.5, 0.75, 0.5, 0x1e88e5); solid.slab(1.75, 0.38, pz, 1.2, 0.05, 0.36, 0xfdd835, 0, 0, -0.55);
        solid.cylinder(2.8, 0, pz + 0.3, 0.5, 0.5, 0.1, 0x43a047, 10);
        break;
      }
      case 'factory': {
        const w = 7.4, d = 4.8, h = 2.2, hd = d / 2;
        solid.box(0, 0, 0, w, h, d, 0x90a4ae, 0, 0.02);
        solid.box(0, 0, 0, w + 0.06, 0.4, d + 0.06, 0x607d8b);
        for (let i = 0; i < 5; i++) solid.gable(-w / 2 + (w / 5) * (i + 0.5), h, 0, d, 0.45, w / 5, 0x78909c, Math.PI / 2);
        for (const sx of [2.2, 3.0]) {
          solid.cylinder(sx, 0, -1.2, 0.2, 0.26, 4.2, 0xb0bec5, 9);
          solid.cylinder(sx, 3.3, -1.2, 0.215, 0.225, 0.35, 0xc62828, 9);
          smokeAt.push(new THREE.Vector3(sx, 4.3, -1.2).applyMatrix4(solid.xf));
        }
        solid.cylinder(-3.0, 0, -1.4, 0.55, 0.55, 2.7, 0xcfd8dc, 12);
        solid.box(-2.2, 0, hd + 0.02, 1.4, 1.2, 0.06, 0x455a64); solid.box(-0.4, 0, hd + 0.02, 1.4, 1.2, 0.06, 0x455a64);
        solid.box(-1.3, 0, hd + 0.5, 3.6, 0.22, 1.0, 0x9e9e9e);
        door(hd, 0x37474f, 0.5, 0.75, 2.2);
        winRow(id, 0, 2.6, hd, 1.55, 4, 0.5, 0.3); for (const s of [1]) winRow(id, s, w * 0.9, hd, 1.4, 9, 0.5, 0.4);
        winRow(id, 2, d * 0.8, w / 2, 1.4, 5, 0.5, 0.4); winRow(id, 3, d * 0.8, w / 2, 1.4, 5, 0.5, 0.4);
        solid.box(3.0, 0, 3.2, 0.5, 0.4, 0.5, 0x8d6e63); solid.box(2.4, 0, 3.3, 0.5, 0.4, 0.5, 0xa1887f); solid.box(2.7, 0.4, 3.25, 0.5, 0.4, 0.5, 0x8d6e63);
        break;
      }
      case 'farm': {
        const w = 3.0, d = 2.2, h = 1.5, hd = d / 2;
        solid.box(0, 0, 0, w, h, d, 0xb23a2e, 0, 0.02);
        solid.gable(0, h, 0, w + 0.3, 1.0, d + 0.3, 0x4e342e);
        solid.box(0, 0, hd + 0.02, 1.0, 1.05, 0.05, 0xf5f0e6);
        solid.slab(0, 0.52, hd + 0.05, 1.3, 0.07, 0.03, 0xb23a2e, 0, 0, 0.8); solid.slab(0, 0.52, hd + 0.05, 1.3, 0.07, 0.03, 0xb23a2e, 0, 0, -0.8);
        win(id, 0, 0, 1.75, 0.2, 0.36, 0.36);
        winRow(id, 2, d * 0.6, w / 2, 0.8, 2, 0.34, 0.34); winRow(id, 3, d * 0.6, w / 2, 0.8, 2, 0.34, 0.34);
        solid.cylinder(-2.3, 0, -0.3, 0.5, 0.5, 2.3, 0xcfd8dc, 12); solid.cone(-2.3, 2.3, -0.3, 0.55, 0.45, 0x90a4ae, 12);
        for (let i = 0; i < 4; i++) solid.cylinder(2.2 + (i % 2) * 0.5, 0.2, 0.9 + Math.floor(i / 2) * 0.5, 0.2, 0.2, 0.4, 0xe0c068, 9, Math.PI / 2);
        break;
      }
      case 'park': {
        const s = bd.w;
        flat.ground(0, 0.012, 0, s, s, 0x63b05a);
        flat.ground(0, 0.017, 0, s, 0.7, 0xe2d6b5); flat.ground(0, 0.0175, 0, 0.7, s, 0xe2d6b5);
        flat.disc(0, 0.019, 0, 1.6, 0xe2d6b5, 24);
        solid.cylinder(0, 0, 0, 0.95, 1.0, 0.22, 0xb8b6ad, 16);
        solid.cylinder(0, 0.2, 0, 0.12, 0.16, 0.6, 0xb8b6ad, 8);
        solid.cylinder(0, 0.75, 0, 0.3, 0.1, 0.08, 0xb8b6ad, 10);
        for (let i = 0; i < 26; i++) {
          // Trees hug the edges so the middle stays open for people.
          const side = i % 4, t = hash01(i, 21) * (s - 1.2) - (s - 1.2) / 2, e = s / 2 - 0.5 - hash01(i, 22) * 0.5;
          if (Math.abs(t) < 0.9) continue;
          const tx = side === 0 ? t : side === 1 ? t : side === 2 ? e : -e;
          const tz = side === 0 ? e : side === 1 ? -e : t;
          tree(solid, tx, tz, 0.9 + hash01(i, 23) * 0.6, i * 31 + 5);
        }
        for (const [bx, bz, r] of [[1.3, 2.1, 0], [-1.3, 2.1, 0], [1.3, -2.1, 0], [-1.3, -2.1, 0], [2.1, 1.3, 1], [2.1, -1.3, 1], [-2.1, 1.3, 1], [-2.1, -1.3, 1]] as const) {
          const ry = r ? Math.PI / 2 : 0;
          solid.box(bx, 0.16, bz, 0.7, 0.05, 0.22, 0x8d6e63, ry);
          solid.box(bx, 0, bz, 0.6, 0.16, 0.06, 0x555555, ry);
        }
        for (let i = 0; i < 4; i++) {
          const fx = (i % 2 ? 1 : -1) * 3.1, fz = (i < 2 ? 1 : -1) * 3.1;
          flat.disc(fx, 0.02, fz, 0.75, 0x7a5c3e, 12);
          for (let k = 0; k < 9; k++) solid.blob(fx + (hash01(k, i) - 0.5) * 1.1, 0.1, fz + (hash01(k, i + 9) - 0.5) * 1.1, 0.1, [0xe91e63, 0xfdd835, 0xffffff, 0xff7043, 0xab47bc][k % 5] as number);
        }
        break;
      }
    }
  }

  // ------------------------------------------------------------ decor blocks
  solid.setOrigin(0, 0, 0);
  flat.setOrigin(0, 0, 0);
  const waterDiscs: THREE.Mesh[] = [];
  const water = new THREE.MeshStandardMaterial({ color: 0x4aa3c7, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 });
  world.decor.forEach((dc: Decor, di: number) => {
    const cx = dc.x + dc.w / 2 - HALF, cz = dc.y + dc.h / 2 - HALF;
    const rx = (k: number) => cx + (hash01(di * 131 + k, 1) - 0.5) * (dc.w - 0.8);
    const rz = (k: number) => cz + (hash01(di * 131 + k, 2) - 0.5) * (dc.h - 0.8);
    switch (dc.kind) {
      case 'woods':
        flat.ground(cx, 0.011, cz, dc.w, dc.h, 0x5a9a4e);
        for (let k = 0; k < 46; k++) tree(solid, rx(k), rz(k), 0.9 + hash01(k, di) * 0.9, di * 97 + k);
        break;
      case 'garden':
        for (let k = 0; k < Math.round((dc.w * dc.h) / 7); k++) tree(solid, rx(k), rz(k), 0.8 + hash01(k, di) * 0.5, di * 97 + k);
        for (let k = 0; k < 6; k++) solid.blob(rx(k + 40), 0.09, rz(k + 40), 0.1, [0xe91e63, 0xfdd835, 0xffffff][k % 3] as number);
        break;
      case 'field': {
        flat.ground(cx, 0.011, cz, dc.w, dc.h, 0x8a6a45);
        const crop = [0x7cb342, 0xd4b84a, 0x9ccc65][di % 3] as number;
        const rows = Math.floor(dc.h / 0.55);
        for (let r = 0; r < rows; r++) solid.box(cx, 0, dc.y - HALF + 0.35 + r * 0.55, dc.w - 0.6, 0.14 + hash01(r, di) * 0.08, 0.26, crop, 0, 0.04);
        break;
      }
      case 'pond': {
        flat.ground(cx, 0.011, cz, dc.w, dc.h, 0x66ad58);
        flat.disc(cx, 0.016, cz, 3.9, 0xd9c79a, 28);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(3.6, 32), water);
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(cx, 0.03, cz);
        waterDiscs.push(disc);
        solid.box(cx + 2.8, 0.06, cz, 2.2, 0.06, 0.5, 0x8d6e63);
        for (let k = 0; k < 4; k++) solid.cylinder(cx + 2.0 + (k % 2) * 1.6, 0, cz - 0.22 + Math.floor(k / 2) * 0.44, 0.04, 0.04, 0.2, 0x6d4c41, 5);
        for (let k = 0; k < 18; k++) {
          const a = hash01(k, di) * Math.PI * 2, r = 4.3 + hash01(k, di + 3) * 0.6;
          if (Math.abs(Math.cos(a) * r) < 4.9 && Math.abs(Math.sin(a) * r) < 4.9) tree(solid, cx + Math.cos(a) * r, cz + Math.sin(a) * r, 0.9 + hash01(k, 8) * 0.6, k * 13 + di);
        }
        for (let k = 0; k < 14; k++) { const a = hash01(k, 77) * 6.28; solid.box(cx + Math.cos(a) * 3.55, 0, cz + Math.sin(a) * 3.55, 0.03, 0.3 + hash01(k, 5) * 0.2, 0.03, 0x558b2f); }
        break;
      }
      case 'cemetery': {
        flat.ground(cx, 0.011, cz, dc.w, dc.h, 0x5d9950);
        const hw = dc.w / 2 - 0.4, hh = dc.h / 2 - 0.4;
        solid.box(cx, 0, cz - hh, hw * 2, 0.3, 0.12, 0x9e9e9e); solid.box(cx, 0, cz + hh, hw * 2, 0.3, 0.12, 0x9e9e9e);
        solid.box(cx - hw, 0, cz, 0.12, 0.3, hh * 2, 0x9e9e9e); solid.box(cx + hw, 0, cz, 0.12, 0.3, hh * 2, 0x9e9e9e);
        for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) {
          if (hash01(r * 9 + c, di) < 0.25) continue;
          solid.box(cx - 3.6 + c * 0.95, 0, cz - 1.2 + r * 1.0, 0.3, 0.34 + hash01(r, c) * 0.14, 0.08, 0xb0b5b9);
        }
        solid.box(cx - 2.6, 0, cz - 3.2, 1.4, 1.1, 1.9, 0xe0dccf); solid.gable(cx - 2.6, 1.1, cz - 3.2, 1.6, 0.7, 2.1, 0x5b6470, 0);
        solid.box(cx - 2.6, 1.8, cz - 2.3, 0.06, 0.5, 0.06, 0x444444); solid.box(cx - 2.6, 2.1, cz - 2.3, 0.26, 0.06, 0.06, 0x444444);
        for (let k = 0; k < 9; k++) tree(solid, cx + (hash01(k, 31) - 0.5) * 8, cz + 3.4 + hash01(k, 32) * 0.8, 1.1 + hash01(k, 33) * 0.5, k * 3 + 1);
        break;
      }
    }
  });

  // Outskirts: scattered trees beyond the ring road, and low hills on the horizon.
  for (let k = 0; k < 420; k++) {
    const a = hash01(k, 51) * Math.PI * 2, r = 34 + hash01(k, 52) * 34;
    const x = Math.cos(a) * r * 1.15, z = Math.sin(a) * r * 1.15;
    const tx = x + HALF, tz = z + HALF;
    if (tx > 3 && tx < 61 && tz > 3 && tz < 61) continue;
    if (Math.abs(tz - 26.5) < 1.2 || Math.abs(tz - 37.5) < 1.2 || Math.abs(tx - 26.5) < 1.2 || Math.abs(tx - 37.5) < 1.2) continue;
    tree(solid, x, z, 1 + hash01(k, 53) * 1.1, k);
  }
  const hills = new Builder();
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * Math.PI * 2 + hash01(k, 61) * 0.2, r = 105 + hash01(k, 62) * 40;
    const g = new THREE.Color(0x4f8f55).lerp(new THREE.Color(0x7fa9b8), hash01(k, 63) * 0.5).getHex();
    hills.blob(Math.cos(a) * r, -2, Math.sin(a) * r, 22 + hash01(k, 64) * 16, g, 0.42 + hash01(k, 65) * 0.3, 1);
  }

  // ------------------------------------------------------------ assemble
  const groundMat = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const flatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  group.add(flat.build(flatMat, false));
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
  group.add(solid.build(solidMat, true));
  group.add(hills.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }), false));
  for (const d of waterDiscs) group.add(d);

  const winMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), windows.length);
  const windowBuilding = new Int16Array(windows.length);
  const windowSeed = new Float32Array(windows.length);
  const dark = new THREE.Color(0x2b3a4d);
  windows.forEach((w, i) => {
    winMesh.setMatrixAt(i, w.m);
    winMesh.setColorAt(i, dark);
    windowBuilding[i] = w.building;
    windowSeed[i] = w.seed;
  });
  winMesh.instanceMatrix.needsUpdate = true;
  group.add(winMesh);

  // Lamps: one merged mesh of bulbs, one of ground glows. Both just change material at night.
  const bulbs = new Builder(), glows: THREE.BufferGeometry[] = [];
  for (const p of lampAt) {
    bulbs.box(p.x, 1.16, p.z, 0.12, 0.05, 0.08, 0xffffff);
    const g = new THREE.PlaneGeometry(3.4, 3.4);
    g.rotateX(-Math.PI / 2);
    g.translate(p.x, 0.06, p.z);
    glows.push(g);
  }
  const lampBulbs = bulbs.build(new THREE.MeshBasicMaterial({ color: 0x555555, toneMapped: false }), false);
  const glowGeo = new THREE.BufferGeometry();
  const pos: number[] = [], uv: number[] = [];
  for (const g of glows) {
    const ng = g.toNonIndexed();
    pos.push(...(ng.attributes.position!.array as Float32Array));
    uv.push(...(ng.attributes.uv!.array as Float32Array));
  }
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  glowGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const lampGlow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  lampGlow.renderOrder = 2;
  group.add(lampBulbs, lampGlow);

  // Signs for everything that is not a private house.
  const signs: City['signs'] = [];
  for (const bd of world.buildings as Building[]) {
    if (bd.kind === 'house') continue;
    const icon = makeSprite('', bd.icon, true);
    const label = makeSprite(bd.name, '', false);
    const x = bd.x + bd.w / 2 - HALF, z = bd.y + bd.h / 2 - HALF, y = BUILDING_HEIGHT[bd.kind] + 0.9;
    icon.position.set(x, y, z);
    label.position.set(x, y, z);
    group.add(icon, label);
    signs.push({ icon, label, building: bd.id });
  }

  return { group, windows: winMesh, windowBuilding, windowSeed, lampGlow, lampBulbs, signs, smokeAt, water };
}
