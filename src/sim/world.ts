// City generation and the door-to-door route cache.
import { CFG } from './config';
import { type Rng, randInt, rand } from './rng';
import {
  type Building, type BuildingKind, type Decor, type World,
  TILE_GRASS, TILE_LOT, TILE_PARK, TILE_ROAD,
} from './types';

const ROAD_LINES = [4, 15, 26, 37, 48, 59];
const BLOCK = 10;

// Zoning template, [row][col]. H housing, S school, C commerce, V civic, A apartments + office,
// F factory, R farm, P park, W woods, D pond, L fields, M cemetery.
const ZONES = [
  'WHHHW',
  'HHSHL',
  'HCVAF',
  'HHPHR',
  'DHHMW',
];

const STREETS = ['Mill Lane', 'Chapel Street', 'High Street', 'Market Street', 'Orchard Road', 'Canal Row'];

const ICONS: Record<BuildingKind, string> = {
  house: '🏠', apartment: '🏢', school: '🏫', clinic: '🏥', police: '🚓', townhall: '🏛️',
  grocery: '🛒', store: '🛍️', cafe: '☕', restaurant: '🍝', bar: '🍺',
  factory: '🏭', office: '💼', farm: '🌾', park: '🌳',
};

const NAMES: Partial<Record<BuildingKind, string>> = {
  school: 'Hundred School', clinic: 'Town Clinic', police: 'Police Station', townhall: 'Town Hall',
  grocery: 'Greenleaf Grocery', store: 'General Store', cafe: 'Corner Café', restaurant: "Luca's Kitchen",
  bar: 'The Tap Room', factory: 'Brightworks Factory', office: 'Meridian Office', farm: 'Eastfield Farm',
  park: 'Centenary Park',
};

function blockOrigin(i: number): number {
  return 5 + i * 11;
}

export function createWorld(rng: Rng): World {
  const size = CFG.gridSize;
  const tiles = new Uint8Array(size * size).fill(TILE_GRASS);
  const tileBuilding = new Int16Array(size * size).fill(-1);
  const buildings: Building[] = [];
  const decor: Decor[] = [];

  const lo = ROAD_LINES[0] as number;
  const hi = ROAD_LINES[ROAD_LINES.length - 1] as number;
  for (const line of ROAD_LINES) {
    // The two central roads run out to the map edge so the town feels connected to somewhere.
    const through = line === 26 || line === 37;
    const from = through ? 0 : lo;
    const to = through ? size - 1 : hi;
    for (let i = from; i <= to; i++) {
      tiles[line * size + i] = TILE_ROAD;
      tiles[i * size + line] = TILE_ROAD;
    }
  }

  let houseNo = 1;
  const add = (kind: BuildingKind, x: number, y: number, w: number, h: number, north: boolean, homes: number, name?: string): Building => {
    const cx = x + Math.floor(w / 2);
    // Walk from the building's front to the nearest road tile in the facing direction.
    let doorY = north ? y - 1 : y + h;
    while (tiles[doorY * size + cx] !== TILE_ROAD) doorY += north ? -1 : 1;
    const b: Building = {
      id: buildings.length, kind, name: name ?? NAMES[kind] ?? kind, icon: ICONS[kind],
      x, y, w, h, doorX: cx, doorY,
      entryX: cx + 0.5, entryY: north ? y - 0.1 : y + h + 0.1,
      homes, variant: randInt(rng, 0, 999),
    };
    buildings.push(b);
    const tile = kind === 'park' ? TILE_PARK : TILE_LOT;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      tiles[j * size + i] = tile;
      tileBuilding[j * size + i] = b.id;
    }
    return b;
  };

  /** Place a building in one 5x5 quadrant of a block. q: 0 NW, 1 NE, 2 SW, 3 SE. */
  const quad = (ox: number, oy: number, q: number, kind: BuildingKind, w: number, h: number, homes = 0, name?: string) => {
    const north = q < 2;
    const qx = ox + (q % 2) * 5;
    const x = qx + Math.floor((5 - w) / 2);
    const y = north ? oy + 1 : oy + BLOCK - 1 - h;
    return add(kind, x, y, w, h, north, homes, name);
  };

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const zone = (ZONES[row] as string)[col] as string;
      const ox = blockOrigin(col);
      const oy = blockOrigin(row);
      switch (zone) {
        case 'H': {
          const skip = randInt(rng, 0, 3); // one quadrant per block stays a garden
          for (let q = 0; q < 4; q++) {
            if (q === skip) {
              decor.push({ kind: 'garden', x: ox + (q % 2) * 5, y: oy + (q < 2 ? 0 : 5), w: 5, h: 5 });
              continue;
            }
            const street = STREETS[(q < 2 ? row : row + 1) % STREETS.length] as string;
            quad(ox, oy, q, 'house', 3, 3, 1, `${houseNo++} ${street}`);
          }
          break;
        }
        case 'S':
          add('school', ox + 1, oy + 1, 8, 4, true, 0);
          decor.push({ kind: 'garden', x: ox, y: oy + 6, w: 10, h: 4 });
          break;
        case 'C':
          quad(ox, oy, 0, 'grocery', 4, 3);
          quad(ox, oy, 1, 'store', 4, 3);
          quad(ox, oy, 2, 'restaurant', 4, 3);
          quad(ox, oy, 3, 'bar', 4, 3);
          break;
        case 'V':
          quad(ox, oy, 0, 'townhall', 4, 4);
          quad(ox, oy, 1, 'police', 4, 3);
          quad(ox, oy, 2, 'clinic', 4, 3);
          quad(ox, oy, 3, 'cafe', 3, 3);
          break;
        case 'A':
          quad(ox, oy, 0, 'apartment', 4, 4, 4, 'Linden Court');
          quad(ox, oy, 1, 'apartment', 4, 4, 4, 'Rowan House');
          quad(ox, oy, 2, 'apartment', 4, 4, 4, 'Alder Flats');
          quad(ox, oy, 3, 'office', 4, 4);
          break;
        case 'F':
          add('factory', ox + 1, oy + 1, 8, 6, true, 0);
          break;
        case 'R':
          add('farm', ox + 1, oy + 1, 4, 3, true, 0);
          decor.push({ kind: 'field', x: ox, y: oy + 5, w: 10, h: 5 });
          decor.push({ kind: 'field', x: ox + 6, y: oy, w: 4, h: 4 });
          break;
        case 'P':
          add('park', ox, oy, BLOCK, BLOCK, true, 0);
          break;
        case 'W': decor.push({ kind: 'woods', x: ox, y: oy, w: BLOCK, h: BLOCK }); break;
        case 'D': decor.push({ kind: 'pond', x: ox, y: oy, w: BLOCK, h: BLOCK }); break;
        case 'L': decor.push({ kind: 'field', x: ox, y: oy, w: BLOCK, h: BLOCK }); break;
        case 'M': decor.push({ kind: 'cemetery', x: ox, y: oy, w: BLOCK, h: BLOCK }); break;
      }
    }
  }
  rand(rng);
  return { size, tiles, tileBuilding, buildings, decor, roadLines: ROAD_LINES, bfs: new Map(), routes: new Map(), routeLen: new Map() };
}

function bfsFrom(world: World, b: Building): Int16Array {
  let parent = world.bfs.get(b.id);
  if (parent) return parent;
  const n = world.size;
  parent = new Int16Array(n * n).fill(-1);
  const start = b.doorY * n + b.doorX;
  const queue = new Int32Array(n * n);
  let head = 0, tail = 0;
  queue[tail++] = start;
  parent[start] = start;
  // Fixed neighbour order keeps routes deterministic.
  const dx = [1, -1, 0, 0];
  const dy = [0, 0, 1, -1];
  while (head < tail) {
    const cur = queue[head++] as number;
    const cx = cur % n, cy = (cur / n) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + (dx[d] as number), ny = cy + (dy[d] as number);
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const ni = ny * n + nx;
      if (parent[ni] !== -1 || world.tiles[ni] !== TILE_ROAD) continue;
      parent[ni] = cur;
      queue[tail++] = ni;
    }
  }
  world.bfs.set(b.id, parent);
  return parent;
}

/** Polyline (corner points only) from one building's entry to another's. Cached per pair. */
export function route(world: World, from: number, to: number): Float32Array {
  const key = from * 256 + to;
  let r = world.routes.get(key);
  if (r) return r;
  const a = world.buildings[from] as Building;
  const b = world.buildings[to] as Building;
  const n = world.size;
  // BFS runs from the destination so parents lead towards it.
  const parent = bfsFrom(world, b);
  const pts: number[] = [a.entryX, a.entryY];
  let cur = a.doorY * n + a.doorX;
  const goal = b.doorY * n + b.doorX;
  let guard = n * n;
  let pdx = 0, pdy = 0;
  pts.push((cur % n) + 0.5, ((cur / n) | 0) + 0.5);
  while (cur !== goal && guard-- > 0) {
    const next = parent[cur] as number;
    if (next < 0) break; // unreachable; should never happen on this grid
    const ddx = (next % n) - (cur % n), ddy = ((next / n) | 0) - ((cur / n) | 0);
    if (ddx === pdx && ddy === pdy) {
      // Same heading: extend the last segment instead of adding a point.
      pts[pts.length - 2] = (next % n) + 0.5;
      pts[pts.length - 1] = ((next / n) | 0) + 0.5;
    } else {
      pts.push((next % n) + 0.5, ((next / n) | 0) + 0.5);
    }
    pdx = ddx; pdy = ddy;
    cur = next;
  }
  pts.push(b.entryX, b.entryY);
  r = new Float32Array(pts);
  let len = 0;
  for (let i = 2; i < r.length; i += 2) {
    len += Math.hypot((r[i] as number) - (r[i - 2] as number), (r[i + 1] as number) - (r[i - 1] as number));
  }
  world.routes.set(key, r);
  world.routeLen.set(key, len);
  return r;
}

export function routeLength(world: World, from: number, to: number): number {
  if (from === to) return 0;
  route(world, from, to);
  return world.routeLen.get(from * 256 + to) as number;
}

/** Walking time in whole sim minutes. */
export function travelMinutes(world: World, from: number, to: number): number {
  if (from === to) return 0;
  return Math.max(1, Math.ceil(routeLength(world, from, to) / CFG.walkSpeed));
}

/** Point at fraction `f` (0..1) along the route. Writes x, y into out[0], out[1]. */
export function routePoint(world: World, from: number, to: number, f: number, out: Float32Array | number[]): void {
  const r = route(world, from, to);
  const total = world.routeLen.get(from * 256 + to) as number;
  let want = Math.max(0, Math.min(1, f)) * total;
  for (let i = 2; i < r.length; i += 2) {
    const x0 = r[i - 2] as number, y0 = r[i - 1] as number, x1 = r[i] as number, y1 = r[i + 1] as number;
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (want <= seg || i === r.length - 2) {
      const t = seg > 0 ? Math.min(1, want / seg) : 0;
      out[0] = x0 + (x1 - x0) * t;
      out[1] = y0 + (y1 - y0) * t;
      return;
    }
    want -= seg;
  }
  out[0] = r[0] as number;
  out[1] = r[1] as number;
}

export function buildingsOfKind(world: World, kind: BuildingKind): Building[] {
  return world.buildings.filter((b) => b.kind === kind);
}

export function firstOfKind(world: World, kind: BuildingKind): number {
  for (const b of world.buildings) if (b.kind === kind) return b.id;
  return -1;
}
