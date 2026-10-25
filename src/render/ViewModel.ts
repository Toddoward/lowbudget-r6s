import * as THREE from 'three';
import { buildAsset } from '../assets/build.ts';
import { chargeSpec, deviceSpec, hammerSpec, launcherSpec, pulseSensorSpec, throwableSpec } from '../assets/weaponModels.ts';
import { weaponSpec, WEAPONS } from '../game/weapons.ts';
import type { Soldier } from '../game/Soldier.ts';
import type { AssetSpec } from '../assets/spec.ts';
import { vcMaterial } from './palette.ts';
import { BoxBatch } from '../world/BoxBatch.ts';

/**
 * First-person weapon/gadget + arms, rendered in its own scene & camera on
 * top of the world (no clipping into walls). ADS aligns the optic's `sight`
 * anchor with the eye axis; recoil kicks the model back/up, reload drops
 * the mag bone, sprint lowers the weapon, lean rolls it.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
  private holder = new THREE.Group();
  private models = new Map<string, { g: THREE.Group; spec: AssetSpec; mag: THREE.Object3D | null }>();
  private current: string | null = null;
  private sway = new THREE.Vector2();
  private kick = 0;
  private bob = 0;
  private lastMag = -1;
  private arms: THREE.Mesh;
  readonly sun = new THREE.DirectionalLight('#ffffff', 2);
  readonly fill = new THREE.HemisphereLight('#aab8c8', '#3a3128', 0.8);
  private flash: THREE.Mesh;

  constructor() {
    this.scene.add(this.camera, this.sun, this.fill);
    this.sun.position.set(1, 2, 1);
    this.camera.add(this.holder);
    const ab = new BoxBatch();
    const sleeve = new THREE.Color('#3b3d33');
    const glove = new THREE.Color('#1f1e1b');
    // right forearm + hand at grip, left forearm reaching the handguard
    ab.box([0.02, -0.16, 0.0], [0.1, -0.06, 0.32], sleeve);
    ab.box([0.0, -0.09, -0.04], [0.07, -0.01, 0.05], glove);
    ab.box([-0.12, -0.12, -0.42], [-0.04, -0.04, -0.06], sleeve);
    ab.box([-0.06, -0.04, -0.46], [0.03, 0.03, -0.36], glove);
    this.arms = new THREE.Mesh(ab.build(), vcMaterial());
    this.holder.add(this.arms);
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshBasicMaterial({ color: '#ffd28a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.holder.add(this.flash);
  }

  setCloth(color: string) {
    const geo = this.arms.geometry;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color(color);
    for (let i = 0; i < col.count; i++) if (col.getX(i) > 0.15) col.setXYZ(i, c.r, c.g, c.b);
    col.needsUpdate = true;
  }

  private model(key: string): { g: THREE.Group; spec: AssetSpec; mag: THREE.Object3D | null } {
    let m = this.models.get(key);
    if (!m) {
      let spec: AssetSpec;
      if (WEAPONS[key]) spec = weaponSpec(key);
      else spec = ({
        hammer: hammerSpec, ash_round: launcherSpec,
        thermite: () => chargeSpec('vm_thermite', '#7a6a48', 0.22, 0.3),
        breach: () => chargeSpec('vm_breach', '#3f4533', 0.18, 0.26),
        cluster: () => chargeSpec('vm_cluster', '#4a4f3a', 0.18, 0.18),
        emp: () => throwableSpec('vm_emp', '#2c5c8a', true),
        gas: () => throwableSpec('vm_gas', '#6a6f2a', true),
        jammer: () => deviceSpec('vm_jammer', '#1b1d20', '#ff3a3a'),
        ads: () => deviceSpec('vm_ads', '#3c4136'),
        battery: () => deviceSpec('vm_battery', '#d9792a', '#7fd0ff'),
        castle: () => chargeSpec('vm_castle', '#3d4a3c', 0.3, 0.36),
        heartbeat: pulseSensorSpec,
        barricade: () => chargeSpec('vm_barricade', '#b08a55', 0.3, 0.12),
      } as Record<string, () => AssetSpec>)[key]?.() ?? throwableSpec('vm_none', '#444');
      const g = buildAsset(spec);
      g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
      const mag = g.children.find((c) => c.name === 'mag') ?? null;
      m = { g, spec, mag };
      this.models.set(key, m);
    }
    return m;
  }

  update(dt: number, s: Soldier, lookD: { x: number; y: number }, fired: boolean, sprinting: boolean, aspect: number, interiorDim: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const key = s.slot < 2 ? s.weapon!.def.id : s.slot === 2 ? s.op.gadget : s.op.universal;
    if (key !== this.current) {
      if (this.current) this.holder.remove(this.models.get(this.current)!.g);
      this.current = key;
      this.holder.add(this.model(key).g);
    }
    const m = this.model(key);
    const isGun = s.slot < 2;
    const sight = m.spec.anchors?.sight ?? [0, 0.1, -0.1];
    // hip vs ADS pose
    const ads = isGun ? s.ads : 0;
    const hip = new THREE.Vector3(0.19, -0.2, -0.42);
    const adsPos = new THREE.Vector3(-sight[0], -sight[1], -0.2 - sight[2] * 0.6);
    const pos = hip.clone().lerp(adsPos, ads);
    // sway (mouse), bob (move), kick (recoil)
    this.sway.x += (THREE.MathUtils.clamp(-lookD.x * 0.6, -0.04, 0.04) - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += (THREE.MathUtils.clamp(lookD.y * 0.6, -0.04, 0.04) - this.sway.y) * Math.min(1, dt * 8);
    const speed = Math.hypot(s.vel.x, s.vel.z);
    this.bob += dt * speed * 2.2;
    const bobAmt = Math.min(1, speed / 4) * (1 - ads * 0.85);
    if (fired) this.kick = Math.min(1, this.kick + 0.55);
    this.kick *= Math.exp(-dt * 16);
    pos.x += this.sway.x * (1 - ads * 0.7) + Math.cos(this.bob) * 0.008 * bobAmt;
    pos.y += this.sway.y * (1 - ads * 0.7) + Math.abs(Math.sin(this.bob)) * 0.01 * bobAmt;
    pos.z += this.kick * 0.045;
    const rot = new THREE.Euler(this.kick * 0.06 + (sprinting ? -0.5 : 0), sprinting ? 0.6 : 0, s.lean * -0.15 + (sprinting ? 0.2 : 0));
    // reload: dip + mag drop
    if (s.reloading && isGun) {
      const k = 1 - s.reloadT / Math.max(0.1, s.reloadDur);
      const dip = Math.sin(Math.min(1, k) * Math.PI);
      pos.y -= dip * 0.08;
      rot.x -= dip * 0.35;
      rot.z += dip * 0.4;
      if (m.mag) m.mag.position.y = k < 0.5 ? -k * 0.5 : -(1 - k) * 0.5;
    } else if (m.mag) m.mag.position.y = 0;
    // equip
    if (s.equipT > 0) pos.y -= s.equipT * 0.5;
    this.holder.position.lerp(pos, Math.min(1, dt * 18));
    this.holder.rotation.x += (rot.x - this.holder.rotation.x) * Math.min(1, dt * 12);
    this.holder.rotation.y += (rot.y - this.holder.rotation.y) * Math.min(1, dt * 12);
    this.holder.rotation.z += (rot.z - this.holder.rotation.z) * Math.min(1, dt * 12);
    this.arms.visible = true;
    // muzzle flash
    const mz = m.spec.anchors?.muzzle;
    const flashMat = this.flash.material as THREE.MeshBasicMaterial;
    if (fired && mz && isGun && !s.weapon!.def.style.suppressor) {
      this.flash.position.set(mz[0], mz[1], mz[2] - 0.05);
      this.flash.rotation.z = Math.random() * Math.PI;
      flashMat.opacity = 1;
    } else flashMat.opacity *= Math.exp(-dt * 40);
    this.lastMag = s.weapon?.mag ?? -1;
    // lighting roughly matches surroundings
    this.sun.intensity = 2.6 * interiorDim;
    this.fill.intensity = 1.4 * interiorDim + 0.6;
    this.camera.fov = THREE.MathUtils.lerp(58, 50, ads);
    this.camera.updateProjectionMatrix();
  }

  get lastMagCount() { return this.lastMag; }

  setTimeOfDay(day: boolean) {
    this.sun.color.set(day ? '#ffe2b8' : '#9fb4ff');
    this.fill.color.set(day ? '#aab8c8' : '#3a4a6a');
  }
}
