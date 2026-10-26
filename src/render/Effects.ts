import * as THREE from 'three';
import type { SurfaceMaterial } from '../core/Physics.ts';

/**
 * GPU-cheap FX: CPU-simulated point sprites (smoke, dust, sparks, toxic gas,
 * fireballs), instanced debris chunks with gravity/bounce, instanced bullet-hole
 * decals, tracers and a pooled muzzle-flash light. Floating dust motes drift
 * around the camera so the window light shafts read as volumetric.
 */
const MAX_P = 6000;

class ParticlePool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel = new Float32Array(MAX_P * 3);
  private life = new Float32Array(MAX_P);
  private maxLife = new Float32Array(MAX_P);
  private grow = new Float32Array(MAX_P);
  private drag = new Float32Array(MAX_P);
  private grav = new Float32Array(MAX_P);
  private alpha0 = new Float32Array(MAX_P);
  private fadeIn = new Float32Array(MAX_P);
  private next = 0;
  private geo: THREE.BufferGeometry;

  constructor(additive: boolean) {
    this.pos = new Float32Array(MAX_P * 3);
    this.col = new Float32Array(MAX_P * 4);
    this.size = new Float32Array(MAX_P);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute vec4 pcolor; attribute float psize; uniform float scale; varying vec4 vC;
        void main(){ vC = pcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = psize * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0) discard; float a = vC.a * (1.0 - r) * (1.0 - r); gl_FragColor = vec4(vC.rgb, a); }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 7 : 6;
  }

  setScale(s: number) { (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = s; }

  spawn(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, alpha: number, size: number, life: number, opts: { grow?: number; drag?: number; grav?: number; fadeIn?: number } = {}) {
    const i = this.next;
    this.next = (this.next + 1) % MAX_P;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 4] = color.r; this.col[i * 4 + 1] = color.g; this.col[i * 4 + 2] = color.b; this.col[i * 4 + 3] = 0;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i] = opts.grow ?? 0;
    this.drag[i] = opts.drag ?? 1.5;
    this.grav[i] = opts.grav ?? 0;
    this.alpha0[i] = alpha;
    this.fadeIn[i] = opts.fadeIn ?? 0.05;
  }

  update(dt: number) {
    for (let i = 0; i < MAX_P; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const age = this.maxLife[i] - this.life[i];
      const fin = Math.min(1, age / this.fadeIn[i]);
      const fout = Math.min(1, this.life[i] / (this.maxLife[i] * 0.5));
      this.col[i * 4 + 3] = this.alpha0[i] * fin * fout;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.pcolor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.psize as THREE.BufferAttribute).needsUpdate = true;
  }
}

const MAT_DUST: Record<SurfaceMaterial, string> = {
  concrete: '#a39f97', plaster: '#ddd4c4', wood: '#9c7a52', metal: '#8a8f96', glass: '#c9dde3', dirt: '#806c52', water: '#9fb7c2', fabric: '#8d8070', vehicle: '#6d7278',
};

interface Debris { mesh: number; p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; life: number; floor: number; s: number }

export class Effects {
  readonly group = new THREE.Group();
  private normal = new ParticlePool(false);
  private add = new ParticlePool(true);
  private flash = new THREE.PointLight('#ffcf8a', 0, 9, 2);
  private flashT = 0;
  private boom = new THREE.PointLight('#ff9a4a', 0, 26, 1.6);
  private boomT = 0;
  private debris: Debris[] = [];
  private debrisMesh: THREE.InstancedMesh;
  private decals: THREE.InstancedMesh;
  private decalNext = 0;
  private decalOwner: (string | null)[] = [];
  private tracers: THREE.LineSegments;
  private tracerLife: Float32Array;
  private tracerNext = 0;
  private gasEmitters: { p: THREE.Vector3; r: number; until: number; t: number; color: THREE.Color }[] = [];
  private time = 0;
  private dummy = new THREE.Object3D();
  private tmpV = new THREE.Vector3();
  private tmpC = new THREE.Color();
  motes = true;

  constructor(scene: THREE.Scene) {
    this.group.add(this.normal.points, this.add.points, this.flash, this.boom);
    const dg = new THREE.BoxGeometry(1, 1, 1);
    this.debrisMesh = new THREE.InstancedMesh(dg, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), 600);
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debrisMesh.count = 0;
    this.debrisMesh.castShadow = true;
    this.debrisMesh.frustumCulled = false;
    this.group.add(this.debrisMesh);
    const pg = new THREE.PlaneGeometry(0.06, 0.06);
    this.decals = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ color: '#141210', transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), 500);
    this.decals.count = 500;
    this.decals.frustumCulled = false;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < 500; i++) { this.decals.setMatrixAt(i, this.dummy.matrix); this.decalOwner.push(null); }
    this.group.add(this.decals);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 6), 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(64 * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false;
    this.tracerLife = new Float32Array(64);
    this.group.add(this.tracers);
    scene.add(this.group);
  }

  setViewport(h: number, fovDeg: number) {
    const s = h / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.normal.setScale(s);
    this.add.setScale(s);
  }

  muzzle(p: THREE.Vector3, dir: THREE.Vector3, suppressed = false) {
    if (!suppressed) {
      this.flash.position.copy(p);
      this.flash.intensity = 6;
      this.flashT = 0.05;
    }
    const c = this.tmpC.set(suppressed ? '#c08a50' : '#ffd08a');
    for (let i = 0; i < (suppressed ? 2 : 5); i++) this.add.spawn(p.clone().addScaledVector(dir, 0.04 * i), dir.clone().multiplyScalar(2 + Math.random() * 3), c, suppressed ? 0.4 : 0.9, 0.05 + Math.random() * 0.05, 0.04);
    this.normal.spawn(p, dir.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, 0.3, 0)), this.tmpC.set('#b8b2a8'), 0.08, 0.08, 0.7, { grow: 0.3, drag: 2 });
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3, enemy = false) {
    const i = this.tracerNext;
    this.tracerNext = (this.tracerNext + 1) % 64;
    const pos = this.tracers.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.tracers.geometry.attributes.color as THREE.BufferAttribute;
    // short streak segment near the far end looks better than a full laser
    const d = this.tmpV.subVectors(b, a);
    const len = d.length();
    const start = a.clone().addScaledVector(d, Math.min(1, 1.2 / Math.max(len, 0.01)));
    pos.setXYZ(i * 2, start.x, start.y, start.z);
    pos.setXYZ(i * 2 + 1, b.x, b.y, b.z);
    const c = enemy ? [1, 0.55, 0.35] : [1, 0.85, 0.55];
    col.setXYZ(i * 2, c[0] * 0.2, c[1] * 0.2, c[2] * 0.2);
    col.setXYZ(i * 2 + 1, c[0], c[1], c[2]);
    this.tracerLife[i] = 0.06;
    pos.needsUpdate = col.needsUpdate = true;
  }

  impact(p: THREE.Vector3, n: THREE.Vector3, mat: SurfaceMaterial, owner: string | null = null, decal = true) {
    const c = this.tmpC.set(MAT_DUST[mat] ?? '#999');
    for (let i = 0; i < 6; i++) {
      const v = n.clone().multiplyScalar(0.8 + Math.random() * 1.6).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 0.8, (Math.random() - 0.5) * 1.2));
      this.normal.spawn(p, v, c, 0.35, 0.06 + Math.random() * 0.08, 0.5 + Math.random() * 0.6, { grow: 0.35, drag: 3, grav: 0.4 });
    }
    if (mat === 'metal' || mat === 'vehicle' || mat === 'concrete') {
      for (let i = 0; i < 5; i++) {
        const v = n.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3));
        this.add.spawn(p, v, this.tmpC.set('#ffc070'), 1, 0.025, 0.25 + Math.random() * 0.2, { drag: 1, grav: 9 });
      }
    }
    if (decal) this.decal(p, n, owner);
  }

  decal(p: THREE.Vector3, n: THREE.Vector3, owner: string | null) {
    const i = this.decalNext;
    this.decalNext = (this.decalNext + 1) % 500;
    this.dummy.position.copy(p).addScaledVector(n, 0.004);
    this.dummy.lookAt(this.tmpV.copy(p).add(n));
    this.dummy.rotateZ(Math.random() * Math.PI);
    this.dummy.scale.setScalar(0.7 + Math.random() * 0.6);
    this.dummy.updateMatrix();
    this.decals.setMatrixAt(i, this.dummy.matrix);
    this.decals.instanceMatrix.needsUpdate = true;
    this.decalOwner[i] = owner;
  }

  /** remove decals owned by a broken cell region */
  clearDecals(owner: string) {
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    let changed = false;
    for (let i = 0; i < 500; i++) if (this.decalOwner[i] === owner) { this.decals.setMatrixAt(i, this.dummy.matrix); this.decalOwner[i] = null; changed = true; }
    if (changed) this.decals.instanceMatrix.needsUpdate = true;
  }

  clearAllDecals() {
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < 500; i++) { this.decals.setMatrixAt(i, this.dummy.matrix); this.decalOwner[i] = null; }
    this.decals.instanceMatrix.needsUpdate = true;
    this.debris = [];
    this.gasEmitters = [];
  }

  blood(p: THREE.Vector3, dir: THREE.Vector3) {
    for (let i = 0; i < 8; i++) {
      const v = dir.clone().multiplyScalar(1 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.5, (Math.random() - 0.5)));
      this.normal.spawn(p, v, this.tmpC.set('#7a0d0d'), 0.8, 0.05 + Math.random() * 0.06, 0.4, { grav: 6, drag: 2, grow: 0.1 });
    }
  }

  /** chunks + dust when panel cells break */
  breakCells(points: THREE.Vector3[], color: THREE.Color, mat: SurfaceMaterial, floorY: number, impulse: THREE.Vector3) {
    const dust = this.tmpC.set(MAT_DUST[mat] ?? '#bbb');
    const n = points.length;
    const stride = Math.max(1, Math.floor(n / 40));
    for (let i = 0; i < n; i += stride) {
      const p = points[i];
      if (this.debris.length < 600) {
        const v = impulse.clone().multiplyScalar(0.5 + Math.random()).add(new THREE.Vector3((Math.random() - 0.5) * 2.5, Math.random() * 2, (Math.random() - 0.5) * 2.5));
        this.debris.push({ mesh: 0, p: p.clone(), v, r: new THREE.Euler(Math.random() * 3, Math.random() * 3, 0), w: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10), life: 4 + Math.random() * 3, floor: floorY, s: 0.05 + Math.random() * 0.1 });
      }
      for (let k = 0; k < 2; k++) this.normal.spawn(p, new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 0.6, (Math.random() - 0.5) * 1.2), dust, 0.32, 0.3 + Math.random() * 0.3, 2.5 + Math.random() * 2, { grow: 0.5, drag: 1.6, grav: -0.05, fadeIn: 0.2 });
    }
    (this.debrisMesh.material as THREE.MeshStandardMaterial).color.copy(color);
  }

  explosion(p: THREE.Vector3, r: number, kind: 'frag' | 'breach' | 'thermite' | 'emp' | 'ash' | 'small' = 'frag') {
    const emp = kind === 'emp';
    this.boom.position.copy(p);
    this.boom.color.set(emp ? '#7fb6ff' : kind === 'thermite' ? '#ff7a2a' : '#ffa050');
    this.boom.intensity = emp ? 30 : 90;
    this.boomT = kind === 'thermite' ? 0.6 : 0.18;
    const fire = this.tmpC.set(emp ? '#9fd0ff' : '#ffb060');
    for (let i = 0; i < (kind === 'small' ? 10 : 30); i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(r * (2 + Math.random() * 4));
      this.add.spawn(p, v, fire, 1, r * (0.15 + Math.random() * 0.25), 0.18 + Math.random() * 0.25, { drag: 6, grow: r * 1.2 });
    }
    if (!emp) {
      const smoke = this.tmpC.set('#3a3734');
      for (let i = 0; i < (kind === 'small' ? 8 : 26); i++) {
        const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(r * (0.8 + Math.random() * 1.6));
        this.normal.spawn(p, v, smoke, 0.55, r * (0.4 + Math.random() * 0.4), 4 + Math.random() * 4, { drag: 1.4, grow: r * 0.45, grav: -0.12, fadeIn: 0.12 });
      }
      for (let i = 0; i < 12; i++) {
        const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 1.5, Math.random() - 0.5).multiplyScalar(9);
        this.add.spawn(p, v, this.tmpC.set('#ffd090'), 1, 0.03, 0.6 + Math.random() * 0.5, { drag: 0.8, grav: 9 });
      }
    } else {
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        this.add.spawn(p, new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(r * 3), this.tmpC.set('#a0d8ff'), 0.9, 0.2, 0.35, { drag: 2 });
      }
    }
  }

  thermiteSparks(p: THREE.Vector3, n: THREE.Vector3) {
    for (let i = 0; i < 4; i++) {
      const v = n.clone().multiplyScalar(1 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2));
      this.add.spawn(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.8, (Math.random() - 0.5) * 1.2).multiply(new THREE.Vector3(Math.abs(n.z) + Math.abs(n.y), 1, Math.abs(n.x) + Math.abs(n.y)))), v, this.tmpC.set('#ffb040'), 1, 0.04, 0.6, { grav: 9, drag: 0.5 });
    }
    this.normal.spawn(p, n.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, 0.6, 0)), this.tmpC.set('#e8e0d0'), 0.25, 0.3, 2.5, { grow: 0.6 });
  }

  gas(p: THREE.Vector3, r: number, duration: number, color = '#8fae3a') {
    this.gasEmitters.push({ p: p.clone(), r, until: this.time + duration, t: 0, color: new THREE.Color(color) });
  }

  spark(p: THREE.Vector3, color = '#7fd0ff') {
    for (let i = 0; i < 3; i++) this.add.spawn(p, new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3), this.tmpC.set(color), 1, 0.03, 0.15, { drag: 2, grav: 4 });
    // a short blue-white arc so electrified walls read from across the room
    this.boom.position.copy(p);
    this.boom.color.set(color);
    this.boom.intensity = Math.max(this.boom.intensity, 6);
    this.boomT = Math.max(this.boomT, 0.06);
  }

  /** Blitz flash: a blinding white burst (light + additive sprites) */
  flashBurst(p: THREE.Vector3) {
    this.boom.position.copy(p);
    this.boom.color.set('#ffffff');
    this.boom.intensity = 220;
    this.boomT = 0.12;
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(4);
      this.add.spawn(p, v, this.tmpC.set('#fffbe8'), 1, 0.25, 0.12, { drag: 6, grow: 1.5 });
    }
  }

  /** ambient motes + gas emitters */
  ambient(cam: THREE.Vector3, dt: number) {
    if (this.motes && Math.random() < dt * 30) {
      const p = cam.clone().add(new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.4) * 4, (Math.random() - 0.5) * 10));
      this.normal.spawn(p, new THREE.Vector3((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.08), this.tmpC.set('#fff2d8'), 0.22, 0.012, 6, { drag: 0.1, fadeIn: 1.5 });
    }
    for (const g of this.gasEmitters) {
      g.t += dt;
      const n = Math.floor(g.t * 30);
      g.t -= n / 30;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * g.r;
        this.normal.spawn(g.p.clone().add(new THREE.Vector3(Math.cos(a) * rr, Math.random() * 1.6, Math.sin(a) * rr)), new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.1, (Math.random() - 0.5) * 0.4), g.color, 0.28, 0.8 + Math.random() * 0.6, 2.4, { grow: 0.3, drag: 1, fadeIn: 0.4 });
      }
    }
    this.gasEmitters = this.gasEmitters.filter((g) => g.until > this.time);
  }

  update(dt: number) {
    this.time += dt;
    this.normal.update(dt);
    this.add.update(dt);
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.intensity = 0; }
    if (this.boomT > 0) { this.boomT -= dt; this.boom.intensity *= Math.exp(-dt * 10); if (this.boomT <= 0) this.boom.intensity = 0; }
    let k = 0;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) { this.debris.splice(i, 1); continue; }
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y < d.floor + d.s / 2) { d.p.y = d.floor + d.s / 2; d.v.y *= -0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6); }
      d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
    }
    for (const d of this.debris) {
      this.dummy.position.copy(d.p);
      this.dummy.rotation.copy(d.r);
      this.dummy.scale.setScalar(d.s * Math.min(1, d.life));
      this.dummy.updateMatrix();
      this.debrisMesh.setMatrixAt(k++, this.dummy.matrix);
    }
    this.debrisMesh.count = k;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    const tpos = this.tracers.geometry.attributes.position as THREE.BufferAttribute;
    let tchg = false;
    for (let i = 0; i < 64; i++) {
      if (this.tracerLife[i] > 0) {
        this.tracerLife[i] -= dt;
        if (this.tracerLife[i] <= 0) { tpos.setXYZ(i * 2, 0, -999, 0); tpos.setXYZ(i * 2 + 1, 0, -999, 0); tchg = true; }
      }
    }
    if (tchg) tpos.needsUpdate = true;
  }
}
