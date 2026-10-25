import type { Rect } from './houseLayout.ts';

export function rectOverlap(a: Rect, b: Rect) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
}

/** base minus holes → list of non-overlapping rectangles */
export function subtractRects(base: Rect, holes: Rect[]): Rect[] {
  let out: Rect[] = [base];
  for (const h of holes) {
    const next: Rect[] = [];
    for (const r of out) {
      if (!rectOverlap(r, h)) { next.push(r); continue; }
      const ix0 = Math.max(r.x0, h.x0), ix1 = Math.min(r.x1, h.x1);
      const iz0 = Math.max(r.z0, h.z0), iz1 = Math.min(r.z1, h.z1);
      if (r.x0 < ix0) next.push({ x0: r.x0, z0: r.z0, x1: ix0, z1: r.z1 });
      if (ix1 < r.x1) next.push({ x0: ix1, z0: r.z0, x1: r.x1, z1: r.z1 });
      if (r.z0 < iz0) next.push({ x0: ix0, z0: r.z0, x1: ix1, z1: iz0 });
      if (iz1 < r.z1) next.push({ x0: ix0, z0: iz1, x1: ix1, z1: r.z1 });
    }
    out = next;
  }
  return out.filter((r) => r.x1 - r.x0 > 1e-3 && r.z1 - r.z0 > 1e-3);
}

export function inRect(r: Rect, x: number, z: number, pad = 0) {
  return x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
}
