// Orbit camera: pan, rotate, zoom. Tilt follows zoom: near top-down from afar, near eye
// level up close. Can follow a moving point.
import * as THREE from 'three';

export interface CameraRig {
  target: THREE.Vector3;
  dist: number;
  yaw: number;
  /** Called with client coordinates when the user clicks without dragging. */
  onClick: (x: number, y: number) => void;
  onHover: (x: number, y: number) => void;
  /** Called on any manual pan, so follow mode can be released. */
  onUserPan: () => void;
  autoOrbit: boolean;
  update(dt: number): void;
  flyTo(x: number, z: number, dist?: number): void;
  follow(x: number, z: number, dt: number): void;
}

export function createCameraRig(camera: THREE.PerspectiveCamera, dom: HTMLElement): CameraRig {
  const want = { x: 0, z: 0, dist: 78, yaw: 0.6 };
  const rig: CameraRig = {
    target: new THREE.Vector3(0, 0, 0), dist: 78, yaw: 0.6,
    onClick: () => {}, onHover: () => {}, onUserPan: () => {}, autoOrbit: true,
    update, flyTo, follow,
  };
  const keys = new Set<string>();
  const LIMIT = 44;

  function flyTo(x: number, z: number, dist?: number): void {
    // Non-finite input would poison the smoothed target permanently, so drop it.
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    want.x = x; want.z = z;
    if (dist !== undefined && Number.isFinite(dist)) want.dist = dist;
  }
  function follow(x: number, z: number, dt: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(dt)) return;
    const k = Math.min(1, dt * 5);
    want.x += (x - want.x) * k; want.z += (z - want.z) * k;
  }
  function pan(dx: number, dz: number): void {
    // Screen-space drag mapped onto the ground plane, relative to the current heading.
    const c = Math.cos(rig.yaw), s = Math.sin(rig.yaw);
    want.x = THREE.MathUtils.clamp(want.x + dx * c + dz * s, -LIMIT, LIMIT);
    want.z = THREE.MathUtils.clamp(want.z - dx * s + dz * c, -LIMIT, LIMIT);
    rig.onUserPan();
  }
  function zoom(f: number): void {
    want.dist = THREE.MathUtils.clamp(want.dist * f, 3.2, 130);
  }

  let down = false, moved = 0, button = 0, lx = 0, ly = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0, pinchAngle = 0;
  dom.addEventListener('contextmenu', (e) => e.preventDefault());
  dom.addEventListener('pointerdown', (e) => {
    dom.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    down = true; moved = 0; button = e.button; lx = e.clientX; ly = e.clientY;
    rig.autoOrbit = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch = Math.hypot(a.x - b.x, a.y - b.y); pinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
    }
  });
  dom.addEventListener('pointermove', (e) => {
    if (!down) { rig.onHover(e.clientX, e.clientY); return; }
    const p = pointers.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (pinch > 0) zoom(pinch / Math.max(1, d));
      want.yaw -= ang - pinchAngle;
      pinch = d; pinchAngle = ang; moved += 10;
      return;
    }
    const dx = e.clientX - lx, dy = e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (button === 2 || button === 1 || e.shiftKey || e.ctrlKey || e.metaKey) {
      want.yaw -= dx * 0.006;
      zoom(1 + dy * 0.004);
    } else {
      const k = rig.dist * 0.0016;
      pan(-dx * k, -dy * k * 1.25);
    }
  });
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (!down) return;
    if (pointers.size === 0) down = false;
    if (moved < 6 && e.button === 0) rig.onClick(e.clientX, e.clientY);
  };
  dom.addEventListener('pointerup', up);
  dom.addEventListener('pointercancel', up);
  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    rig.autoOrbit = false;
    if (e.ctrlKey) zoom(Math.exp(e.deltaY * 0.01)); // trackpad pinch
    else zoom(Math.exp(e.deltaY * 0.0012));
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    keys.add(e.key.toLowerCase());
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  function update(dt: number): void {
    if (!Number.isFinite(dt)) return;
    if (![want.x, want.z, want.dist, want.yaw, rig.target.x, rig.target.z, rig.dist, rig.yaw].every(Number.isFinite)) {
      want.x = 0; want.z = 0; want.dist = 70; want.yaw = 0.6;
      rig.target.set(0, 0, 0); rig.dist = 70; rig.yaw = 0.6;
    }
    const sp = rig.dist * 0.9 * dt;
    let kx = 0, kz = 0;
    if (keys.has('w') || keys.has('arrowup')) kz -= 1;
    if (keys.has('s') || keys.has('arrowdown')) kz += 1;
    if (keys.has('a') || keys.has('arrowleft')) kx -= 1;
    if (keys.has('d') || keys.has('arrowright')) kx += 1;
    if (kx || kz) { rig.autoOrbit = false; pan(kx * sp, kz * sp); }
    if (keys.has('q')) { want.yaw += dt * 1.4; rig.autoOrbit = false; }
    if (keys.has('e')) { want.yaw -= dt * 1.4; rig.autoOrbit = false; }
    if (keys.has('=') || keys.has('+')) zoom(1 - dt * 1.5);
    if (keys.has('-')) zoom(1 + dt * 1.5);
    if (rig.autoOrbit) want.yaw += dt * 0.05;

    const k = Math.min(1, dt * 7);
    rig.target.x += (want.x - rig.target.x) * k;
    rig.target.z += (want.z - rig.target.z) * k;
    rig.dist += (want.dist - rig.dist) * k;
    rig.yaw += (want.yaw - rig.yaw) * k;

    // Tilt follows zoom.
    const t = THREE.MathUtils.smoothstep(rig.dist, 5, 95);
    const el = THREE.MathUtils.degToRad(9 + t * 56);
    const lift = 0.45 * (1 - t);
    const cy = Math.cos(el), sy = Math.sin(el);
    camera.position.set(
      rig.target.x + Math.sin(rig.yaw) * cy * rig.dist,
      Math.max(0.35, lift + sy * rig.dist),
      rig.target.z + Math.cos(rig.yaw) * cy * rig.dist,
    );
    camera.lookAt(rig.target.x, lift, rig.target.z);
  }

  return rig;
}
