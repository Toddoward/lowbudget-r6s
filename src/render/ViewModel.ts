import * as THREE from 'three';
import { buildAsset } from '../assets/build.ts';
import { chargeSpec, deviceSpec, hammerSpec, launcherSpec, pulseSensorSpec, throwableSpec } from '../assets/weaponModels.ts';
import { weaponSpec, WEAPONS } from '../game/weapons.ts';
import type { ShieldPose, Soldier } from '../game/Soldier.ts';
import type { AssetSpec } from '../assets/spec.ts';
import { vcMaterial } from './palette.ts';
import { BoxBatch } from '../world/BoxBatch.ts';
import { extraGadgetSpec } from '../assets/gadgetModels.ts';

type Reticle = 'dot' | 'holo' | 'acog' | 'none';
interface VmModel { g: THREE.Group; spec: AssetSpec; mag: THREE.Object3D | null; reticle: Reticle; lens: THREE.Mesh | null; tint: THREE.Mesh | null; eyeRelief: number }

const FWD = new THREE.Vector3(0, 0, -1);

/**
 * First-person weapon / gadget + hands, rendered in its own scene & camera on
 * top of the world (no clipping into walls).
 *
 *  - ADS pivots around the optic: the `sight` anchor is pinned to the eye axis
 *    whatever the sway / recoil / lean rotation is, so the sight never drifts
 *    off the line of fire (one-shot bug: rotating about the grip moved it).
 *  - Leaning does NOT roll the gun inside the view (the world camera rolls;
 *    gun + reticle stay put on screen).
 *  - Red dots / holo rings / ACOG chevrons are COLLIMATED: drawn at infinity
 *    along the bore and only visible through the lens (stencil mask). The
 *    angular bore offset is exported (`boreYaw/Pitch`) so the shot follows the
 *    reticle exactly.
 *  - Hands grip the weapon's `grip` / `fore` anchors; equip, reload (mag drop),
 *    melee, gadget-placement and sprint poses animate both.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.01, 12);
  private holder = new THREE.Group();
  private models = new Map<string, VmModel>();
  private current: string | null = null;
  private sway = new THREE.Vector2();
  private kick = 0;
  private bob = 0;
  private lastMag = -1;
  private handR: THREE.Group;
  private handL: THREE.Group;
  private sleeveMeshes: THREE.Mesh[] = [];
  readonly sun = new THREE.DirectionalLight('#ffffff', 2);
  readonly fill = new THREE.HemisphereLight('#aab8c8', '#3a3128', 0.8);
  private flash: THREE.Mesh;
  private reticle: THREE.Mesh;
  private reticleTex: Record<Exclude<Reticle, 'none'>, THREE.Texture>;
  private equipFrom = 0;
  /** angular offset of the bore from the camera axis (radians) → shots follow the reticle */
  boreYaw = 0;
  borePitch = 0;
  private qTmp = new THREE.Quaternion();
  private eTmp = new THREE.Euler(0, 0, 0, 'YXZ');
  /** shield operators: the shield (left hand on its handle), posed per ShieldPose */
  private shield: THREE.Group | null = null;
  private shieldKey = '';
  private shieldHand: THREE.Group;

  constructor() {
    this.scene.add(this.camera, this.sun, this.fill);
    this.sun.position.set(1, 2, 1);
    this.camera.add(this.holder);
    this.handR = this.buildHand(true);
    this.handL = this.buildHand(false);
    this.holder.add(this.handR, this.handL);
    this.shieldHand = this.buildHand(false);
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshBasicMaterial({ color: '#ffd28a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.holder.add(this.flash);
    this.reticleTex = { dot: reticleTexture('dot'), holo: reticleTexture('holo'), acog: reticleTexture('acog') };
    this.reticle = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.reticleTex.dot, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp,
    }));
    this.reticle.renderOrder = 30;
    this.reticle.frustumCulled = false;
    this.camera.add(this.reticle);
  }

  /** a gloved hand + forearm + sleeve, built from small boxes (fingers wrap a grip along -Z) */
  private buildHand(right: boolean): THREE.Group {
    const g = new THREE.Group();
    const b = new BoxBatch();
    const sleeve = new BoxBatch();
    const glove = new THREE.Color('#1d1c1a');
    const knuckle = new THREE.Color('#2a2826');
    const s = right ? 1 : -1;
    // palm
    b.box([-0.022, -0.035, -0.03], [0.022, 0.012, 0.03], glove);
    // four fingers curled around the grip (in front of the palm, on the far side)
    for (let i = 0; i < 4; i++) {
      const y = -0.03 + i * 0.011;
      b.box([-s * 0.03 - 0.008, y - 0.005, -0.012], [-s * 0.03 + 0.008, y + 0.005, 0.016], knuckle);
      b.box([-s * 0.022 - 0.006, y - 0.005, -0.03], [-s * 0.022 + 0.006, y + 0.005, -0.012], glove);
    }
    // thumb over the top
    b.box([s * 0.006 - 0.007, 0.006, -0.036], [s * 0.006 + 0.007, 0.018, 0.0], glove);
    // wrist + forearm (going back and down toward the elbow)
    sleeve.box([-0.026, -0.04, 0.02], [0.026, 0.014, 0.12], new THREE.Color('#ffffff'));
    sleeve.box([-0.03, -0.05, 0.12], [0.03, 0.012, 0.36], new THREE.Color('#ffffff'));
    const hand = new THREE.Mesh(b.build(), vcMaterial());
    const sl = new THREE.Mesh(sleeve.build(), vcMaterial());
    sl.rotation.x = -0.32;
    this.sleeveMeshes.push(sl);
    g.add(hand, sl);
    return g;
  }

  setCloth(color: string) {
    const c = new THREE.Color(color);
    for (const m of this.sleeveMeshes) {
      const col = m.geometry.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < col.count; i++) col.setXYZ(i, c.r, c.g, c.b);
      col.needsUpdate = true;
    }
  }

  private model(key: string): VmModel {
    let m = this.models.get(key);
    if (m) return m;
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
    } as Record<string, () => AssetSpec>)[key]?.() ?? extraGadgetSpec(key) ?? throwableSpec('vm_none', '#444');
    // always the procedural build here: the exact optic geometry matters more than the baked GLB
    const g = buildAsset({ ...spec, id: `vm_${spec.id}` });
    g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
    const mag = g.children.find((c) => c.name === 'mag') ?? null;
    const optic = WEAPONS[key]?.style.optic;
    const reticle: Reticle = optic === 'acog' ? 'acog' : optic === 'holo' ? 'holo' : optic === 'reflex' ? 'dot' : 'none';
    let lens: THREE.Mesh | null = null;
    let tint: THREE.Mesh | null = null;
    const la = spec.anchors?.lens;
    if (la && reticle !== 'none') {
      const [w, h] = reticle === 'acog' ? [0.042, 0.042] : reticle === 'holo' ? [0.036, 0.042] : [0.025, 0.03];
      const geo = reticle === 'acog' ? new THREE.CircleGeometry(w / 2, 20) : new THREE.PlaneGeometry(w, h);
      lens = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        colorWrite: false, depthWrite: false, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
      }));
      lens.position.set(...la);
      lens.renderOrder = 10;
      g.add(lens);
      tint = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: reticle === 'acog' ? '#2a4a3a' : '#5a7a90', transparent: true, opacity: reticle === 'acog' ? 0.18 : 0.1, depthWrite: false }));
      tint.position.set(la[0], la[1], la[2] + 0.001);
      tint.renderOrder = 11;
      g.add(tint);
    }
    const eyeRelief = reticle === 'acog' ? 0.06 : reticle === 'none' ? (WEAPONS[key]?.cls === 'Pistol' ? 0.2 : 0.09) : 0.12;
    m = { g, spec, mag, reticle, lens, tint, eyeRelief };
    this.models.set(key, m);
    return m;
  }

  update(dt: number, s: Soldier, lookD: { x: number; y: number }, fired: boolean, sprinting: boolean, aspect: number, interiorDim: number) {
    this.camera.aspect = aspect;
    const key = s.slot < 2 ? s.weapon!.def.id : s.slot === 2 ? s.op.gadget : s.op.universal;
    if (key !== this.current) {
      if (this.current) this.holder.remove(this.models.get(this.current)!.g);
      this.current = key;
      this.holder.add(this.model(key).g);
      this.equipFrom = 1;
    }
    const m = this.model(key);
    const isGun = s.slot < 2 && !!s.weapon;
    const anchors = m.spec.anchors ?? {};
    const sight = new THREE.Vector3(...(anchors.sight ?? [0, 0.1, -0.1]));
    const ads = isGun ? s.ads : 0;

    // --- rotation: sway (mouse), recoil kick, sprint, reload, melee, equip, placing
    this.sway.x += (THREE.MathUtils.clamp(-lookD.x * 0.6, -0.05, 0.05) - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += (THREE.MathUtils.clamp(lookD.y * 0.6, -0.05, 0.05) - this.sway.y) * Math.min(1, dt * 8);
    const speed = Math.hypot(s.vel.x, s.vel.z);
    this.bob += dt * speed * 2.2;
    const bobAmt = Math.min(1, speed / 4) * (1 - ads * 0.9);
    if (fired) this.kick = Math.min(1, this.kick + 0.55);
    this.kick *= Math.exp(-dt * 16);
    this.equipFrom = Math.max(0, this.equipFrom - dt / 0.45);
    const equip = Math.max(this.equipFrom, s.equipT > 0 ? s.equipT / 0.45 : 0);
    const reloadK = s.reloading && isGun ? 1 - s.reloadT / Math.max(0.1, s.reloadDur) : -1;
    const dip = reloadK >= 0 ? Math.sin(Math.min(1, reloadK) * Math.PI) : 0;
    const meleeK = s.meleeCd > 0.45 ? Math.sin(((0.75 - s.meleeCd) / 0.3) * Math.PI) : 0;
    const placing = s.interactProgress > 0 && s.slot >= 2 ? Math.min(1, s.interactProgress * 1.5) : 0;
    const sw = (1 - ads * 0.85);
    const rx = this.kick * 0.05 * (1 - ads * 0.6) + this.sway.y * 0.6 * sw - (sprinting ? 0.55 : 0) - dip * 0.35 - equip * 0.9 - meleeK * 0.4 - placing * 0.5;
    const ry = -this.sway.x * 0.6 * sw + (sprinting ? 0.65 : 0) + meleeK * 0.3;
    const rz = (sprinting ? 0.25 : 0) + dip * 0.45 + Math.cos(this.bob) * 0.01 * bobAmt;
    this.eTmp.set(rx, ry, rz, 'YXZ');
    this.qTmp.setFromEuler(this.eTmp);
    this.holder.quaternion.slerp(this.qTmp, Math.min(1, dt * 18));

    // --- position: hip pose vs ADS pose (pin the sight anchor to the eye axis)
    const hip = new THREE.Vector3(0.18, -0.19, -0.4);
    if (!isGun) hip.set(0.16, -0.2, -0.36);
    hip.x += Math.cos(this.bob) * 0.008 * bobAmt;
    hip.y += Math.abs(Math.sin(this.bob)) * 0.01 * bobAmt - equip * 0.35 - dip * 0.06 - placing * 0.08;
    hip.z += this.kick * 0.045 + meleeK * -0.2 + placing * -0.12;
    // shield up: the pistol is held one-handed off to the right; extended: lowered behind the shield
    const sp = s.shieldPose;
    if (sp && sp !== 'back' && isGun) { hip.x += 0.04; hip.y -= sp === 'ext' ? 0.3 : 0.02; }
    const sightNow = sight.clone().applyQuaternion(this.holder.quaternion);
    const adsPos = new THREE.Vector3(0, 0, -m.eyeRelief).sub(sightNow);
    adsPos.z += this.kick * 0.03;
    const pos = hip.lerp(adsPos, ads);
    this.holder.position.lerp(pos, Math.min(1, dt * 22));

    // --- reload: mag out and back
    if (m.mag) m.mag.position.y = reloadK >= 0 ? (reloadK < 0.5 ? -reloadK * 0.6 : -(1 - reloadK) * 0.6) : 0;

    // --- hands on the weapon
    const grip = new THREE.Vector3(...(anchors.grip ?? [0, -0.03, 0]));
    const fore = new THREE.Vector3(...(anchors.fore ?? (isGun && s.weapon!.def.cls === 'Pistol' ? [0, -0.035, 0.005] : [-0.05, -0.02, -0.12])));
    this.handR.position.copy(grip).add(new THREE.Vector3(0.01, 0.0, 0.0));
    this.handR.rotation.set(-0.25, 0, 0);
    if (isGun && s.weapon!.def.cls === 'Pistol') {
      this.handL.position.copy(fore).add(new THREE.Vector3(-0.022, -0.008, 0.01));
      this.handL.rotation.set(-0.2, 0.25, 0.2);
    } else {
      this.handL.position.copy(fore).add(new THREE.Vector3(-0.012, -0.018, 0));
      this.handL.rotation.set(-0.1, 0.1, -0.35);
    }
    if (reloadK >= 0 && m.mag) {
      // left hand dives to the magazine well
      const magPos = m.mag.getWorldPosition(new THREE.Vector3());
      this.holder.worldToLocal(magPos);
      this.handL.position.lerp(magPos.add(new THREE.Vector3(-0.02, -0.06, 0)), dip);
    }
    if (!isGun) { this.handL.position.set(-0.08, -0.04, -0.05 - placing * 0.05); this.handL.rotation.set(-0.3, 0.3, -0.2); }
    const pose = s.shieldPose;
    this.handL.visible = !(pose && pose !== 'back' && isGun);
    this.updateShield(dt, s, pose, equip);

    // --- muzzle flash
    const mz = anchors.muzzle;
    const flashMat = this.flash.material as THREE.MeshBasicMaterial;
    if (fired && mz && isGun && !s.weapon!.def.style.suppressor) {
      this.flash.position.set(mz[0], mz[1], mz[2] - 0.05);
      this.flash.rotation.z = Math.random() * Math.PI;
      flashMat.opacity = 1;
    } else flashMat.opacity *= Math.exp(-dt * 40);
    this.lastMag = s.weapon?.mag ?? -1;

    // --- collimated reticle: at infinity along the bore, clipped by the lens stencil
    const bore = FWD.clone().applyQuaternion(this.holder.quaternion);
    const rm = this.reticle.material as THREE.MeshBasicMaterial;
    this.reticle.visible = isGun && m.reticle !== 'none' && !sprinting;
    if (this.reticle.visible) {
      rm.map = this.reticleTex[m.reticle as Exclude<Reticle, 'none'>];
      const D = 8;
      const angular = m.reticle === 'acog' ? 0.05 : m.reticle === 'holo' ? 0.06 : 0.02; // radians across the texture
      this.reticle.position.copy(bore).multiplyScalar(D);
      // plane normal (+Z) must face the eye: the holder's +Z axis is exactly -bore
      this.reticle.quaternion.copy(this.holder.quaternion);
      this.reticle.scale.setScalar(2 * D * Math.tan(angular / 2));
      rm.opacity = 1;
    }
    this.boreYaw = Math.atan2(-bore.x, -bore.z);
    this.borePitch = Math.asin(THREE.MathUtils.clamp(bore.y, -1, 1));

    // lighting roughly matches surroundings
    this.sun.intensity = 2.6 * interiorDim;
    this.fill.intensity = 1.4 * interiorDim + 0.6;
    this.camera.fov = THREE.MathUtils.lerp(58, m.reticle === 'acog' ? 34 : 50, ads);
    this.camera.updateProjectionMatrix();
  }

  /**
   * front: lower-left of the view, viewport low · ads: swung out to the left edge, edge-on (the pistol aims past it)
   * · ext: Montagne's extension across the view · back: not in view
   */
  private updateShield(dt: number, s: Soldier, pose: ShieldPose | null, equip: number) {
    const key = pose ? (s.op.gadget === 'flash_shield' ? 'flash_shield' : 'shield') : '';
    if (key !== this.shieldKey) {
      if (this.shield) this.camera.remove(this.shield);
      this.shield = null;
      this.shieldKey = key;
      if (key) {
        const sh = buildAsset({ ...extraGadgetSpec(key)!, id: `vm_${key}` });
        sh.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
        this.shield = sh;
        this.camera.add(sh, this.shieldHand);
      } else this.camera.remove(this.shieldHand);
    }
    const sh = this.shield;
    if (!sh || !pose) return;
    // shield-local plate centre is (-0.12, 0, -0.42): place the group so the plate lands where it should
    const T = {
      front: { p: [-0.32, -0.36, -0.12], ry: 0.12, sc: [1, 1, 1] },
      ads: { p: [-0.3, -0.24, -0.28], ry: 1.15, sc: [1, 1, 1] },
      // the viewport slit (plate y +0.2 × 1.85) at eye level
      ext: { p: [0.16, -0.31, -0.04], ry: 0, sc: [1.35, 1.85, 1] },
      back: { p: [-0.3, -0.9, 0.1], ry: 0.4, sc: [1, 1, 1] },
    }[pose];
    const k = Math.min(1, dt * 12);
    sh.position.lerp(new THREE.Vector3(T.p[0], T.p[1] - equip * 0.25, T.p[2]), k);
    sh.rotation.y += (T.ry - sh.rotation.y) * k;
    sh.scale.lerp(new THREE.Vector3(...T.sc), k);
    sh.visible = !(pose === 'back' && sh.position.y < -0.8);
    // the left hand on the handle (shield-local (-0.12, -0.02, -0.39)) in camera space, forearm back and down out of
    // the view whichever way the shield is turned (parented to the shield, the forearm swept across the screen in ADS)
    sh.updateMatrix();
    this.shieldHand.position.set(-0.12, -0.03, -0.37).applyMatrix4(sh.matrix);
    this.shieldHand.rotation.set(-0.35, 0.45, -0.25);
    this.shieldHand.visible = sh.visible;
  }

  get lastMagCount() { return this.lastMag; }

  setTimeOfDay(day: boolean) {
    this.sun.color.set(day ? '#ffe2b8' : '#9fb4ff');
    this.fill.color.set(day ? '#aab8c8' : '#3a4a6a');
  }
}

function reticleTexture(kind: 'dot' | 'holo' | 'acog'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 128, 128);
  const glow = (col: string, blur: number) => { g.shadowColor = col; g.shadowBlur = blur; };
  if (kind === 'dot') {
    glow('#ff3b2a', 10);
    g.fillStyle = '#ff5a40';
    g.beginPath(); g.arc(64, 64, 9, 0, Math.PI * 2); g.fill();
  } else if (kind === 'holo') {
    glow('#ff3b2a', 6);
    g.strokeStyle = '#ff5a40';
    g.lineWidth = 4;
    g.beginPath(); g.arc(64, 64, 46, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ff5a40';
    g.beginPath(); g.arc(64, 64, 4.5, 0, Math.PI * 2); g.fill();
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) { g.fillRect(64 + Math.cos(a) * 52 - 2, 64 + Math.sin(a) * 52 - 2, 4, 4); }
  } else {
    // ACOG-style chevron + bullet drop ticks
    glow('#ff3b2a', 6);
    g.strokeStyle = '#ff5a40';
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(44, 84); g.lineTo(64, 62); g.lineTo(84, 84); g.stroke();
    g.fillStyle = '#ff5a40';
    for (let i = 1; i <= 3; i++) g.fillRect(60, 64 + i * 14, 8, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
