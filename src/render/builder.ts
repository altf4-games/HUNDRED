// Accumulates many small coloured shapes and merges them into one mesh, so the whole
// static city costs a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const tmpColor = new THREE.Color();

export class Builder {
  private parts: THREE.BufferGeometry[] = [];
  /** Local-to-world transform applied to everything added until it changes. */
  readonly xf = new THREE.Matrix4();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();

  setOrigin(x: number, y: number, z: number, rotY = 0): void {
    this.xf.makeRotationY(rotY).setPosition(x, y, z);
  }

  private push(g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, shade = 0): void {
    const geo = g.index ? g.toNonIndexed() : g;
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(1, 1, 1)).premultiply(this.xf);
    geo.applyMatrix4(this.m);
    geo.deleteAttribute('uv');
    const n = geo.attributes.position!.count;
    const colors = new Float32Array(n * 3);
    tmpColor.set(color);
    for (let i = 0; i < n; i++) {
      // A touch of per-face variation keeps large flat surfaces from looking like plastic.
      const k = 1 + shade * (((i / 6) | 0) % 2 === 0 ? 1 : -1);
      colors[i * 3] = tmpColor.r * k; colors[i * 3 + 1] = tmpColor.g * k; colors[i * 3 + 2] = tmpColor.b * k;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(geo);
  }

  /** Box centred on x/z, sitting on y. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: number, ry = 0, shade = 0): void {
    this.push(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z, 0, ry, 0, shade);
  }

  /** Box with arbitrary rotation, centred at the given point. */
  slab(x: number, y: number, z: number, w: number, h: number, d: number, color: number, rx = 0, ry = 0, rz = 0): void {
    this.push(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
  }

  cylinder(x: number, y: number, z: number, rTop: number, rBottom: number, h: number, color: number, seg = 8, rx = 0, rz = 0): void {
    this.push(new THREE.CylinderGeometry(rTop, rBottom, h, seg), color, x, y + (rx || rz ? 0 : h / 2), z, rx, 0, rz);
  }

  cone(x: number, y: number, z: number, r: number, h: number, color: number, seg = 7): void {
    this.push(new THREE.ConeGeometry(r, h, seg), color, x, y + h / 2, z);
  }

  blob(x: number, y: number, z: number, r: number, color: number, sy = 1, detail = 0): void {
    const g = new THREE.IcosahedronGeometry(r, detail);
    g.scale(1, sy, 1);
    this.push(g, color, x, y, z, 0, x * 7.3 + z * 3.1, 0);
  }

  /** Gable roof: ridge runs along local x. Sits on y. */
  gable(x: number, y: number, z: number, w: number, h: number, d: number, color: number, ry = 0): void {
    const hw = w / 2, hd = d / 2;
    const v = [
      // two slopes
      -hw, 0, hd, hw, 0, hd, hw, h, 0, -hw, 0, hd, hw, h, 0, -hw, h, 0,
      hw, 0, -hd, -hw, 0, -hd, -hw, h, 0, hw, 0, -hd, -hw, h, 0, hw, h, 0,
      // gable ends
      -hw, 0, -hd, -hw, 0, hd, -hw, h, 0,
      hw, 0, hd, hw, 0, -hd, hw, h, 0,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    g.computeVertexNormals();
    this.push(g, color, x, y, z, 0, ry, 0);
  }

  /** Flat quad lying on the ground. */
  ground(x: number, y: number, z: number, w: number, d: number, color: number, ry = 0): void {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    this.push(g, color, x, y, z, 0, ry, 0);
  }

  disc(x: number, y: number, z: number, r: number, color: number, seg = 20): void {
    const g = new THREE.CircleGeometry(r, seg);
    g.rotateX(-Math.PI / 2);
    this.push(g, color, x, y, z);
  }

  build(material: THREE.Material, shadows = true): THREE.Mesh {
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    merged.computeVertexNormals();
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}
