import * as THREE from 'three';
import { buildBones } from '../assets/build.ts';
import { operatorSpec } from '../assets/operatorModels.ts';
import { OPERATORS } from '../game/operators.ts';
import { buildAsset } from '../assets/build.ts';
import { weaponSpec } from '../game/weapons.ts';
import { Stance } from '../game/types.ts';

/**
 * Third-person operator rig. Pivots (relative to the feet origin, facing -Z):
 *   hips  (0, 0.95)  → torso (pelvis) → head (0, 0.5 above pelvis)
 *   armL/armR at shoulders, legL/legR at hip joints
 * Poses: stand / crouch / prone / rappel (upright against the wall) /
 * rappel-inverted (flipped, head down) + lean roll + aim pitch + walk cycle.
 */
export class Rig {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private gun: THREE.Group | null = null;
  private walk = 0;
  private stanceBlend = 0;
  dead = false;
  private deathT = 0;
  readonly nameTag: THREE.Sprite | null = null;

  constructor(operatorId: string, weaponId: string | null, label?: string, labelColor = '#ffffff') {
    const def = OPERATORS[operatorId] ?? OPERATORS.recruit;
    const bones = buildBones(operatorSpec(def));
    const attach = (name: string, g: THREE.Group) => {
      const m = bones.get(name);
      if (m) g.add(m);
    };
    attach('hips', this.hips);
    attach('torso', this.torso);
    attach('head', this.head);
    attach('armL', this.armL);
    attach('armR', this.armR);
    attach('legL', this.legL);
    attach('legR', this.legR);
    this.root.add(this.hips);
    this.hips.position.set(0, 0.95, 0);
    this.hips.add(this.torso);
    this.torso.add(this.head);
    this.head.position.set(0, 0.5, 0);
    this.torso.add(this.armL, this.armR);
    this.armL.position.set(-0.21, 0.45, 0);
    this.armR.position.set(0.21, 0.45, 0);
    this.hips.add(this.legL, this.legR);
    this.legL.position.set(-0.09, -0.02, 0);
    this.legR.position.set(0.09, -0.02, 0);
    if (weaponId) this.setWeapon(weaponId);
    if (label) {
      const sprite = makeLabel(label, labelColor);
      sprite.position.set(0, 2.15, 0);
      this.root.add(sprite);
      (this as { nameTag: THREE.Sprite | null }).nameTag = sprite;
    }
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
  }

  setWeapon(id: string | null) {
    if (this.gun) this.torso.remove(this.gun);
    this.gun = null;
    if (!id) return;
    this.gun = buildAsset(weaponSpec(id));
    this.gun.position.set(0.12, 0.33, -0.25);
    this.torso.add(this.gun);
  }

  /**
   * @param pitch aim pitch (rad, + up)  @param lean -1..1 (+ right)  @param speed horizontal m/s
   */
  pose(dt: number, stance: Stance, pitch: number, lean: number, speed: number, inverted = false) {
    if (this.dead) {
      this.deathT = Math.min(1, this.deathT + dt * 2.2);
      const e = 1 - (1 - this.deathT) ** 3;
      this.hips.position.y = THREE.MathUtils.lerp(0.95, 0.18, e);
      this.hips.rotation.x = THREE.MathUtils.lerp(0, Math.PI / 2, e);
      this.armL.rotation.x = this.armR.rotation.x = -e * 1.2;
      return;
    }
    const prone = stance === Stance.Prone;
    const crouch = stance === Stance.Crouch;
    const rappel = stance === Stance.Rappel;
    const target = prone ? 2 : crouch ? 1 : 0;
    this.stanceBlend += (target - this.stanceBlend) * Math.min(1, dt * 10);
    const sb = this.stanceBlend;
    this.walk += dt * speed * (prone ? 2.5 : 5);
    const swing = Math.sin(this.walk) * Math.min(1, speed / 3) * (prone ? 0.25 : 0.6);

    this.root.rotation.z = inverted ? Math.PI : 0;
    if (rappel) {
      this.hips.position.set(0, 0.95, 0);
      this.hips.rotation.set(0, 0, 0);
      this.legL.rotation.x = this.legR.rotation.x = -1.2 + swing * 0.3;
      this.torso.rotation.set(0.15, 0, 0);
    } else if (sb > 1) {
      // crouch → prone
      const k = sb - 1;
      this.hips.position.set(0, THREE.MathUtils.lerp(0.62, 0.22, k), THREE.MathUtils.lerp(0, 0.35, k));
      this.hips.rotation.x = THREE.MathUtils.lerp(0, -Math.PI / 2 + 0.08, k);
      this.legL.rotation.x = THREE.MathUtils.lerp(-0.86, 0, k) + swing;
      this.legR.rotation.x = THREE.MathUtils.lerp(0.86, 0, k) - swing;
      this.torso.rotation.set(0, 0, lean * 0.15);
    } else {
      // crouch: one knee forward, one back so both feet stay on the floor (leg ≈ 0.95 m, hips at 0.62 → 49°)
      this.hips.position.set(0, THREE.MathUtils.lerp(0.95, 0.62, sb), 0);
      this.hips.rotation.x = 0;
      this.legL.rotation.x = -0.86 * sb + swing;
      this.legR.rotation.x = 0.86 * sb - swing;
      this.torso.rotation.set(sb * 0.25, 0, -lean * 0.35);
    }
    // aim: arms + head follow pitch, gun stays between hands
    const aim = prone ? pitch * 0.5 + Math.PI / 2 - 0.1 : pitch;
    this.head.rotation.x = THREE.MathUtils.clamp(prone ? pitch * 0.5 + Math.PI / 2 - 0.15 : pitch * 0.6, -1, 1.6);
    this.armR.rotation.set(-1.25 - aim * 0.9, 0, 0.1);
    this.armL.rotation.set(-1.35 - aim * 0.9, 0, -0.45);
    if (this.gun) this.gun.rotation.x = aim;
  }

  setDead(dead: boolean) {
    this.dead = dead;
    if (!dead) {
      this.deathT = 0;
      this.hips.rotation.set(0, 0, 0);
    }
    if (this.nameTag) this.nameTag.visible = !dead;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}

function makeLabel(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '600 30px "Rajdhani", "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(text, 128, 32);
  g.fillStyle = color;
  g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  s.scale.set(1.1, 0.28, 1);
  s.renderOrder = 10;
  return s;
}
