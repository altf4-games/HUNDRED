// Renderer, lighting and the day/night cycle. Reads sim state, never writes it.
import * as THREE from 'three';
import type { Building, Sim, World } from '../sim/types';
import { type City, buildCity } from './city';

interface Key { h: number; sky: number; fog: number; sun: number; sunI: number; hemiI: number; ground: number; }
// Keyframes across the day. Hours wrap at 24.
const KEYS: Key[] = [
  { h: 0, sky: 0x0a1026, fog: 0x0d1430, sun: 0x8fa8ff, sunI: 0.28, hemiI: 0.26, ground: 0x1a2035 },
  { h: 4.5, sky: 0x0d1530, fog: 0x121a38, sun: 0x8fa8ff, sunI: 0.28, hemiI: 0.28, ground: 0x1a2035 },
  { h: 6, sky: 0xf2a983, fog: 0xe9b79c, sun: 0xffb37a, sunI: 1.2, hemiI: 0.55, ground: 0x6a5a4a },
  { h: 8, sky: 0xa9d8f5, fog: 0xc4e3f5, sun: 0xfff0d6, sunI: 2.5, hemiI: 0.9, ground: 0x7a8a60 },
  { h: 13, sky: 0x8fcaf2, fog: 0xbfe0f4, sun: 0xffffff, sunI: 3.0, hemiI: 1.0, ground: 0x7a8a60 },
  { h: 17, sky: 0xa3cdee, fog: 0xcfe0ea, sun: 0xffe2b0, sunI: 2.4, hemiI: 0.85, ground: 0x7a8a60 },
  { h: 19, sky: 0xf08a5d, fog: 0xe8a07c, sun: 0xff9a5c, sunI: 1.3, hemiI: 0.55, ground: 0x6a5040 },
  { h: 20.5, sky: 0x2a2850, fog: 0x2c2b55, sun: 0x9aa8ff, sunI: 0.3, hemiI: 0.32, ground: 0x222840 },
  { h: 24, sky: 0x0a1026, fog: 0x0d1430, sun: 0x8fa8ff, sunI: 0.28, hemiI: 0.26, ground: 0x1a2035 },
];

export interface View {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  city: City;
  /** 0 in full daylight, 1 at night. */
  night: number;
  setTime(hourFloat: number, focus: THREE.Vector3): void;
  updateWindows(sim: Sim): void;
  updateSmoke(dt: number, active: boolean): void;
  /** Swap in a freshly generated town (new seed). */
  loadWorld(world: World): void;
  resize(): void;
}

export function createView(canvas: HTMLCanvasElement, world: World): View {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fcaf2);
  scene.fog = new THREE.Fog(0xbfe0f4, 90, 260);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);

  const hemi = new THREE.HemisphereLight(0xdfefff, 0x7a8a60, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46; sc.near = 10; sc.far = 220;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  let city = buildCity(world);
  scene.add(city.group);

  // Stars: a shell of points that fades in at night.
  const starPos = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2, el = Math.random() * 1.3 + 0.12;
    starPos[i * 3] = Math.cos(a) * Math.cos(el) * 420; starPos[i * 3 + 1] = Math.sin(el) * 420; starPos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * 420;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  scene.add(stars);

  // Sun and moon discs.
  const disc = (color: number, size: number) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 12), new THREE.MeshBasicMaterial({ color, fog: false, toneMapped: false }));
    scene.add(m);
    return m;
  };
  const sunDisc = disc(0xfff3c4, 9), moonDisc = disc(0xdfe6ff, 6);

  // Factory smoke: a small pool of soft sprites.
  const smokeTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const smoke: { s: THREE.Sprite; age: number; life: number; src: number }[] = [];
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false, color: 0xdfe3e6 }));
    s.visible = false;
    scene.add(s);
    smoke.push({ s, age: Math.random() * 6, life: 6, src: i % Math.max(1, city.smokeAt.length) });
  }

  const cA = new THREE.Color(), cB = new THREE.Color();
  const lerpHex = (a: number, b: number, t: number, into: THREE.Color) => into.copy(cA.set(a)).lerp(cB.set(b), t);
  const lit = new THREE.Color(), unlit = new THREE.Color(0x2b3a4d), glass = new THREE.Color(0x5d7f9c), tmp = new THREE.Color();
  const occupied = new Uint8Array(256);

  const view: View = {
    renderer, scene, camera, city, night: 0,
    setTime(h, focus) {
      let i = 0;
      while (i < KEYS.length - 2 && h >= (KEYS[i + 1] as Key).h) i++;
      const a = KEYS[i] as Key, b = KEYS[i + 1] as Key;
      const t = Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h)));
      lerpHex(a.sky, b.sky, t, scene.background as THREE.Color);
      lerpHex(a.fog, b.fog, t, (scene.fog as THREE.Fog).color);
      lerpHex(a.sun, b.sun, t, sun.color);
      sun.intensity = a.sunI + (b.sunI - a.sunI) * t;
      hemi.intensity = a.hemiI + (b.hemiI - a.hemiI) * t;
      lerpHex(a.ground, b.ground, t, hemi.groundColor);
      hemi.color.copy(scene.background as THREE.Color).lerp(cA.set(0xffffff), 0.5);

      // Sun arcs east to west between 6 and 19:30; the moon takes the other half.
      const dayT = (h - 6) / 13.5;
      const isDay = dayT >= 0 && dayT <= 1;
      const arc = isDay ? dayT : ((h + 24 - 19.5) % 24) / 10.5;
      const ang = arc * Math.PI;
      const dx = Math.cos(ang) * 0.85, dy = Math.max(0.16, Math.sin(ang)), dz = 0.45;
      sun.position.set(focus.x + dx * 110, dy * 110, focus.z + dz * 110);
      sun.target.position.set(focus.x, 0, focus.z);
      const far = 380;
      (isDay ? sunDisc : moonDisc).position.set(camera.position.x + dx * far, Math.sin(ang) * far * 0.8 - 20, camera.position.z + dz * far);
      sunDisc.visible = isDay; moonDisc.visible = !isDay;

      const night = h < 5 || h > 20.5 ? 1 : h < 7 ? (7 - h) / 2 : h > 18.5 ? (h - 18.5) / 2 : 0;
      view.night = night;
      (stars.material as THREE.PointsMaterial).opacity = Math.max(0, night - 0.3) * 1.3;
      stars.position.copy(camera.position);
      (city.lampGlow.material as THREE.MeshBasicMaterial).opacity = night * 0.55;
      (city.lampBulbs.material as THREE.MeshBasicMaterial).color.setHex(night > 0.25 ? 0xffe9b0 : 0x6a6f78);
      renderer.toneMappingExposure = 1.0 + night * 0.25;
    },
    updateWindows(s) {
      // A building's windows glow when someone is inside after dark.
      occupied.fill(0);
      for (const a of s.agents) if (a.status === 'active' && a.tripFrom < 0 && a.action !== 'sleep') occupied[a.at] = Math.min(255, (occupied[a.at] as number) + 1);
      const n = view.night;
      const w = city.windows;
      for (let i = 0; i < w.count; i++) {
        const b = city.windowBuilding[i] as number;
        const seed = city.windowSeed[i] as number;
        const people = occupied[b] as number;
        const kind = (s.world.buildings[b] as Building).kind;
        const share = people === 0 ? 0 : kind === 'house' ? 0.75 : Math.min(0.9, 0.25 + people * 0.09);
        if (n > 0.2 && seed < share) {
          lit.setHex(seed * 7 % 1 < 0.2 ? 0xfff1cf : 0xffcf7a);
          w.setColorAt(i, tmp.copy(glass).lerp(lit, Math.min(1, n * 1.4)));
        } else w.setColorAt(i, tmp.copy(glass).lerp(unlit, 0.35 + n * 0.65));
      }
      if (w.instanceColor) w.instanceColor.needsUpdate = true;
    },
    updateSmoke(dt, active) {
      if (city.smokeAt.length === 0) return;
      for (const p of smoke) {
        p.age += dt;
        if (p.age > p.life) {
          if (!active) { p.s.visible = false; continue; }
          p.age = 0; p.life = 5 + Math.random() * 3;
          const src = city.smokeAt[p.src] as THREE.Vector3;
          p.s.position.copy(src);
          p.s.visible = true;
        }
        if (!p.s.visible) continue;
        const k = p.age / p.life;
        p.s.position.y += dt * 0.55;
        p.s.position.x += dt * 0.28;
        const sz = 0.6 + k * 2.2;
        p.s.scale.set(sz, sz, 1);
        p.s.material.opacity = (1 - k) * 0.5 * (1 - view.night * 0.6);
      }
    },
    loadWorld(w) {
      scene.remove(city.group);
      city.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      city = buildCity(w);
      view.city = city;
      scene.add(city.group);
      for (const p of smoke) p.s.visible = false;
    },
    resize() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },
  };
  return view;
}
