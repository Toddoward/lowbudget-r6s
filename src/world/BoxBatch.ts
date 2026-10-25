import * as THREE from 'three';

/**
 * Accumulates coloured axis-aligned (or transformed) boxes into one
 * non-indexed BufferGeometry with per-face vertex colours. Used for the
 * destructible panels (rebuilt on every damage tick), static architecture and
 * the procedural low-poly asset builder.
 */
export class BoxBatch {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];

  /**
   * @param faceColor colour for faces whose normal is on `primaryAxis` (0/1/2), others get `sideColor`.
   */
  box(min: ArrayLike<number>, max: ArrayLike<number>, faceColor: THREE.Color, sideColor: THREE.Color = faceColor, primaryAxis = -1, skipFaces = 0) {
    const [x0, y0, z0] = [min[0], min[1], min[2]];
    const [x1, y1, z1] = [max[0], max[1], max[2]];
    // faces: +x -x +y -y +z -z
    const faces: [number, number[][]][] = [
      [0, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
      [0, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      [1, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
      [1, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
      [2, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      [2, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    ];
    const normals = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let f = 0; f < 6; f++) {
      if (skipFaces & (1 << f)) continue;
      const [axis, v] = faces[f];
      const c = axis === primaryAxis || primaryAxis < 0 ? faceColor : sideColor;
      const n = normals[f];
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        this.pos.push(v[idx][0], v[idx][1], v[idx][2]);
        this.nor.push(n[0], n[1], n[2]);
        this.col.push(c.r, c.g, c.b);
      }
    }
  }

  /** Box of size (sx,sy,sz) transformed by matrix m. */
  tbox(m: THREE.Matrix4, sx: number, sy: number, sz: number, color: THREE.Color) {
    const start = this.pos.length;
    this.box([-sx / 2, -sy / 2, -sz / 2], [sx / 2, sy / 2, sz / 2], color);
    this.transformFrom(start, m);
  }

  /** Append an arbitrary geometry (e.g. cylinder) with a flat colour, transformed. */
  geom(g: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color) {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.getAttribute('position');
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    // flat normals per triangle
    for (let i = 0; i < p.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m);
      const b = new THREE.Vector3().fromBufferAttribute(p, i + 1).applyMatrix4(m);
      const c = new THREE.Vector3().fromBufferAttribute(p, i + 2).applyMatrix4(m);
      n.subVectors(c, b).cross(v.subVectors(a, b)).normalize();
      for (const q of [a, b, c]) {
        this.pos.push(q.x, q.y, q.z);
        this.nor.push(n.x, n.y, n.z);
        this.col.push(color.r, color.g, color.b);
      }
    }
    void nm;
    if (ng !== g) ng.dispose();
  }

  private transformFrom(start: number, m: THREE.Matrix4) {
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = start; i < this.pos.length; i += 3) {
      v.set(this.pos[i], this.pos[i + 1], this.pos[i + 2]).applyMatrix4(m);
      this.pos[i] = v.x; this.pos[i + 1] = v.y; this.pos[i + 2] = v.z;
      v.set(this.nor[i], this.nor[i + 1], this.nor[i + 2]).applyMatrix3(nm).normalize();
      this.nor[i] = v.x; this.nor[i + 1] = v.y; this.nor[i + 2] = v.z;
    }
  }

  get empty() { return this.pos.length === 0; }

  build(target?: THREE.BufferGeometry): THREE.BufferGeometry {
    const g = target ?? new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
