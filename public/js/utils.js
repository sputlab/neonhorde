// =====================================================================
// utils.js — matematica, RNG, spatial hashing per collisioni efficienti
// =====================================================================

export function rand(min, max) { return min + Math.random() * (max - min); }
export function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }
export function lerp(a, b, t) { return a + (b - a) * t; }

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}
export function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }

export function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }

/** Differenza angolare minima tra due angoli (radianti), sempre in
 *  [0, PI] — usata per il nemico "Corazzato" (v1.24.0) per capire se un
 *  colpo arriva dal lato scudato o da quello scoperto, indipendentemente
 *  da come i due angoli sono stati espressi (es. uno vicino a 0 e
 *  l'altro vicino a 2*PI vanno comunque considerati "vicini"). */
export function angleDiff(a, b) {
  let diff = Math.abs(a - b) % (Math.PI * 2);
  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

export function circlesOverlap(ax, ay, ar, bx, by, br) {
  const r = ar + br;
  return dist2(ax, ay, bx, by) <= r * r;
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Weighted random pick: table = [{ item, weight }, ...]
 */
export function weightedPick(table) {
  const total = table.reduce((sum, t) => sum + t.weight, 0);
  let r = Math.random() * total;
  for (const t of table) {
    if (r < t.weight) return t.item;
    r -= t.weight;
  }
  return table[table.length - 1].item;
}

/**
 * Sceglie n elementi distinti da un array (senza ripetizioni), utile
 * per la schermata "scegli 1 di 3".
 */
export function sampleUnique(arr, n) {
  const pool = [...arr];
  const result = [];
  n = Math.min(n, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = randInt(0, pool.length - 1);
    result.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return result;
}

// ---------------------------------------------------------------------
// Spatial Hash Grid — per collisioni O(n) invece di O(n^2) con
// centinaia di entità simultanee (proiettili, nemici, particelle).
// ---------------------------------------------------------------------
export class SpatialHash {
  constructor(cellSize = 64) {
    this.cellSize = cellSize;
    this.map = new Map();
  }

  _key(cx, cy) { return `${cx},${cy}`; }

  clear() { this.map.clear(); }

  insert(entity) {
    const cx = Math.floor(entity.x / this.cellSize);
    const cy = Math.floor(entity.y / this.cellSize);
    const key = this._key(cx, cy);
    let bucket = this.map.get(key);
    if (!bucket) { bucket = []; this.map.set(key, bucket); }
    bucket.push(entity);
  }

  /** Restituisce tutte le entità nelle celle adiacenti a (x,y) entro `radius`. */
  queryRadius(x, y, radius) {
    const result = [];
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.map.get(this._key(cx, cy));
        if (bucket) result.push(...bucket);
      }
    }
    return result;
  }
}

// ---------------------------------------------------------------------
// Object pool generico — evita GC pressure per proiettili/particelle
// ---------------------------------------------------------------------
export class ObjectPool {
  constructor(factory, reset, initialSize = 64) {
    this.factory = factory;
    this.reset = reset;
    this.pool = [];
    for (let i = 0; i < initialSize; i++) this.pool.push(factory());
  }

  acquire() {
    const obj = this.pool.pop() || this.factory();
    obj.active = true;
    return obj;
  }

  release(obj) {
    obj.active = false;
    this.reset(obj);
    this.pool.push(obj);
  }
}
