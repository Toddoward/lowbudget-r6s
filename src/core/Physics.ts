import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

/** Collision-group bits. Bullets & vision rays query WORLD|GADGET; characters collide with WORLD|CHAR. */
export const G_WORLD = 0x0001;
export const G_CHAR = 0x0002;
export const G_GADGET = 0x0004;
export const G_CLIP = 0x0008; // invisible player clip (map bounds) — blocks movement, not bullets
export const groups = (membership: number, filter: number) => ((membership & 0xffff) << 16) | (filter & 0xffff);

export type SurfaceMaterial = 'concrete' | 'plaster' | 'wood' | 'metal' | 'glass' | 'dirt' | 'water' | 'fabric' | 'vehicle';

export type ColliderTag =
  | { kind: 'static'; mat: SurfaceMaterial; exterior?: boolean }
  | { kind: 'panel'; panelId: number }
  | { kind: 'char'; actorId: string }
  | { kind: 'gadget'; gadgetId: string };

export interface RayHit {
  dist: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  tag: ColliderTag | undefined;
  collider: RAPIER.Collider;
}

export class Physics {
  readonly world: RAPIER.World;
  readonly R = RAPIER;
  private tags = new Map<number, ColliderTag>();
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
  }

  addBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, tag: ColliderTag, rot?: THREE.Quaternion, group = G_WORLD): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(Math.max(hx, 0.005), Math.max(hy, 0.005), Math.max(hz, 0.005))
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(groups(group, 0xffff));
    if (rot) desc.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    const c = this.world.createCollider(desc);
    this.tags.set(c.handle, tag);
    return c;
  }

  addCylinder(cx: number, cy: number, cz: number, halfHeight: number, r: number, tag: ColliderTag, group = G_WORLD, rot?: THREE.Quaternion): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, r).setTranslation(cx, cy, cz).setCollisionGroups(groups(group, 0xffff));
    if (rot) desc.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    const c = this.world.createCollider(desc);
    this.tags.set(c.handle, tag);
    return c;
  }

  /** static triangle mesh (smooth ramps under stepped visuals) */
  addTrimesh(vertices: Float32Array, indices: Uint32Array, tag: ColliderTag, group = G_WORLD): RAPIER.Collider {
    const c = this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setCollisionGroups(groups(group, 0xffff)));
    this.tags.set(c.handle, tag);
    return c;
  }

  /** static convex hull of the given points (roof solids) — null if the points are degenerate */
  addConvexHull(points: Float32Array, tag: ColliderTag, group = G_WORLD): RAPIER.Collider | null {
    const desc = RAPIER.ColliderDesc.convexHull(points);
    if (!desc) return null;
    const c = this.world.createCollider(desc.setCollisionGroups(groups(group, 0xffff)));
    this.tags.set(c.handle, tag);
    return c;
  }

  addCapsule(cx: number, cy: number, cz: number, halfHeight: number, radius: number, tag: ColliderTag, group = G_CHAR, filter = G_WORLD | G_CHAR | G_CLIP): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.capsule(halfHeight, radius).setTranslation(cx, cy, cz).setCollisionGroups(groups(group, filter));
    const c = this.world.createCollider(desc);
    this.tags.set(c.handle, tag);
    return c;
  }

  addBall(cx: number, cy: number, cz: number, r: number, tag: ColliderTag, group = G_GADGET): RAPIER.Collider {
    const c = this.world.createCollider(RAPIER.ColliderDesc.ball(r).setTranslation(cx, cy, cz).setCollisionGroups(groups(group, 0xffff)));
    this.tags.set(c.handle, tag);
    return c;
  }

  remove(c: RAPIER.Collider | null | undefined) {
    if (!c) return;
    this.tags.delete(c.handle);
    this.world.removeCollider(c, false);
  }

  tagOf(c: RAPIER.Collider): ColliderTag | undefined {
    return this.tags.get(c.handle);
  }

  /** Raycast returning first hit with its tag. `mask` = groups the ray collides with. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, mask = G_WORLD | G_GADGET, exclude?: (tag: ColliderTag | undefined, c: RAPIER.Collider) => boolean): RayHit | null {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const pred = exclude ? (c: RAPIER.Collider) => !exclude(this.tags.get(c.handle), c) : undefined;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, groups(0xffff, mask), undefined, undefined, pred);
    if (!hit) return null;
    const dist = hit.timeOfImpact;
    return {
      dist,
      point: new THREE.Vector3(origin.x + dir.x * dist, origin.y + dir.y * dist, origin.z + dir.z * dist),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      tag: this.tags.get(hit.collider.handle),
      collider: hit.collider,
    };
  }

  /** Line-of-sight between two points against WORLD (holes in panels let sight through). */
  clearLine(a: THREE.Vector3, b: THREE.Vector3, ignorePanels?: Set<number>): boolean {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return true;
    d.multiplyScalar(1 / len);
    const hit = this.raycast(a, d, len - 0.05, G_WORLD, ignorePanels ? (t) => t?.kind === 'panel' && ignorePanels.has(t.panelId) : undefined);
    return !hit;
  }

  /** Is a ball of radius r at p overlapping world geometry? */
  overlapsWorld(p: THREE.Vector3, r: number, mask = G_WORLD): boolean {
    return !!this.world.intersectionWithShape({ x: p.x, y: p.y, z: p.z }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(r), undefined, groups(0xffff, mask));
  }

  step() {
    this.world.step();
  }
}
