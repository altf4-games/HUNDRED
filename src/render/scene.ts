// Renderer, lighting and the day/night cycle. Reads sim state, never writes it.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Building, Sim, World } from '../sim/types';
import { type City, buildCity } from './city';

// Final grade: miniature-style tilt-shift when zoomed out, plus a soft vignette. Runs on linear
// HDR colour just before tone mapping.
const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, resolution: { value: new THREE.Vector2(1, 1) }, tilt: { value: 0 }, vignette: { value: 0.3 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float tilt; uniform float vignette;
    varying vec2 vUv;
    void main() {
      float band = smoothstep(0.14, 0.62, abs(vUv.y - 0.52));
      float r = tilt * band * 5.5;
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (r > 0.08) {
        vec3 sum = c; float w = 1.0;
        for (int i = 0; i < 12; i++) {
          float a = float(i) * 2.39996;
          float d = sqrt((float(i) + 0.5) / 12.0);
          vec2 o = vec2(cos(a), sin(a)) * d * r / resolution;
          sum += texture2D(tDiffuse, vUv + o).rgb; w += 1.0;
        }
        c = sum / w;
      }
      vec2 q = vUv - 0.5;
      c *= 1.0 - vignette * dot(q, q) * 2.4;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

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
  /** Decide which windows should be lit (a few times a second). */
  updateWindows(sim: Sim): void;
  /** Fade windows towards their targets (every frame). */
  animateWindows(dt: number): void;
  /** Draw the frame. `camDist` drives the tilt-shift amount. */
  render(camDist: number): void;
  fx: boolean;
  setFx(on: boolean): void;
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
  // The shadow frustum covers the whole town and never follows the camera. A frustum that
  // moves without snapping to shadow-map texels makes shadow edges crawl and shimmer.
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -54; sc.right = 54; sc.top = 54; sc.bottom = -54; sc.near = 10; sc.far = 260;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
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
  (sunDisc.material as THREE.MeshBasicMaterial).color.multiplyScalar(2.4); // above 1 so bloom picks them up
  (moonDisc.material as THREE.MeshBasicMaterial).color.multiplyScalar(1.6);

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

  // Post-processing: multisampled HDR target -> bloom -> grade -> tone mapping and sRGB output.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.4, 0.55, 1.05);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  const cA = new THREE.Color(), cB = new THREE.Color();
  const lerpHex = (a: number, b: number, t: number, into: THREE.Color) => into.copy(cA.set(a)).lerp(cB.set(b), t);
  const lit = new THREE.Color(), unlit = new THREE.Color(0x2b3a4d), glass = new THREE.Color(0x5d7f9c), tmp = new THREE.Color();
  const occupied = new Uint8Array(256);
  const occEma = new Float32Array(256); // smoothed occupancy, so a person walking past does not toggle a window
  let winTarget = new Float32Array(0), winBright = new Float32Array(0), lastWinNight = -1;
  const darkC = new THREE.Color(), litC = new THREE.Color();

  const view: View = {
    renderer, scene, camera, city, night: 0, fx: true,
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
      void focus;
      sun.position.set(dx * 110, dy * 110, dz * 110);
      sun.target.position.set(0, 0, 0);
      const far = 380;
      (isDay ? sunDisc : moonDisc).position.set(camera.position.x + dx * far, Math.sin(ang) * far * 0.8 - 20, camera.position.z + dz * far);
      sunDisc.visible = isDay; moonDisc.visible = !isDay;

      const night = h < 5 || h > 20.5 ? 1 : h < 7 ? (7 - h) / 2 : h > 18.5 ? (h - 18.5) / 2 : 0;
      view.night = night;
      (stars.material as THREE.PointsMaterial).opacity = Math.max(0, night - 0.3) * 1.3;
      stars.position.copy(camera.position);
      (city.lampGlow.material as THREE.MeshBasicMaterial).opacity = night * 0.42;
      // Lamp bulbs ramp up smoothly (no hard switch) and go above 1 so they bloom.
      const lamp = Math.min(1, Math.max(0, (night - 0.15) / 0.5));
      (city.lampBulbs.material as THREE.MeshBasicMaterial).color.setHex(0x6a6f78).lerp(cA.set(0xffe9b0).multiplyScalar(4), lamp);
      bloom.strength = 0.14 + night * 0.5;
      renderer.toneMappingExposure = 1.0 + night * 0.25;
    },
    updateWindows(s) {
      // Which windows want to be lit. Occupancy is smoothed and each window has hysteresis, so
      // lights come on gradually through dusk and do not flicker as people move around.
      occupied.fill(0);
      for (const a of s.agents) if (a.status === 'active' && a.tripFrom < 0 && a.action !== 'sleep') occupied[a.at] = Math.min(255, (occupied[a.at] as number) + 1);
      for (let b = 0; b < occEma.length; b++) occEma[b] = (occEma[b] as number) + ((occupied[b] as number) - (occEma[b] as number)) * 0.2;
      const n = view.night;
      const w = city.windows;
      if (winTarget.length !== w.count) { winTarget = new Float32Array(w.count); winBright = new Float32Array(w.count); lastWinNight = -1; }
      for (let i = 0; i < w.count; i++) {
        const b = city.windowBuilding[i] as number;
        const seed = city.windowSeed[i] as number;
        const people = occEma[b] as number;
        const kind = (s.world.buildings[b] as Building).kind;
        const share = people < 0.15 ? 0 : kind === 'house' ? 0.75 : Math.min(0.9, 0.25 + people * 0.09);
        const onset = 0.2 + ((seed * 13.7) % 1) * 0.6; // windows light at different moments of dusk
        const was = (winTarget[i] as number) > 0.5;
        winTarget[i] = n > onset && seed < share + (was ? 0.1 : 0) ? 1 : 0;
      }
    },
    animateWindows(dt) {
      const w = city.windows;
      if (winTarget.length !== w.count) return;
      const n = view.night;
      const k = Math.min(1, dt * 2.2);
      let moving = Math.abs(n - lastWinNight) > 0.004;
      for (let i = 0; i < w.count; i++) {
        const d = (winTarget[i] as number) - (winBright[i] as number);
        if (Math.abs(d) > 0.002) { winBright[i] = (winBright[i] as number) + d * k; moving = true; }
        else if (d !== 0) { winBright[i] = winTarget[i] as number; moving = true; }
      }
      if (!moving) return;
      lastWinNight = n;
      darkC.copy(glass).lerp(unlit, 0.35 + n * 0.65);
      for (let i = 0; i < w.count; i++) {
        const br = winBright[i] as number;
        if (br < 0.003) { w.setColorAt(i, darkC); continue; }
        litC.setHex(((city.windowSeed[i] as number) * 7) % 1 < 0.2 ? 0xfff1cf : 0xffcf7a);
        w.setColorAt(i, tmp.copy(darkC).lerp(litC, br).multiplyScalar(1 + br * 1.05)); // above 1 so lit windows bloom
      }
      if (w.instanceColor) w.instanceColor.needsUpdate = true;
    },
    render(camDist) {
      if (!view.fx) { renderer.render(scene, camera); return; }
      grade.uniforms.tilt!.value = THREE.MathUtils.smoothstep(camDist, 30, 95) * 0.85;
      composer.render();
    },
    setFx(on) { view.fx = on; },
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
      composer.setSize(w, h);
      const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
      grade.uniforms.resolution!.value.copy(buf);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },
  };
  return view;
}
