import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Ctx, EditorView } from './main.ts';
import { files, uploadModel } from './store.ts';
import { buildAsset } from '../src/assets/build.ts';
import { loadGlb } from '../src/assets/library.ts';
import { adsFovOf, OPTICS, weaponSpec, WEAPONS, type OpticDef } from '../src/game/weapons.ts';
import { OPERATORS } from '../src/game/operators.ts';
import { Rig } from '../src/render/Rig.ts';
import { Stance } from '../src/game/types.ts';

type V3 = [number, number, number];
type Mode = 'model' | 'ads' | 'hip' | '3p';
interface WeaponFile { id: string; optic: string; class: string; model: { glb?: string; eyeRelief?: number; anchors: Record<string, V3> } }
interface Hold { hip: V3; rot: V3 }

const ANCHORS: [string, string, string][] = [
  ['sight', '#5fe08a', 'sight 접안부'], ['lens', '#5ad0f0', 'lens 렌즈'], ['muzzle', '#f0a050', 'muzzle 총구'], ['grip', '#f0e060', 'grip 오른손'], ['fore', '#e070e0', 'fore 왼손'],
];
const round = (v: THREE.Vector3): V3 => [Math.round(v.x * 1e4) / 1e4, Math.round(v.y * 1e4) / 1e4, Math.round(v.z * 1e4) / 1e4];
/** three (x, y, z) → Blender (x, −z, y) */
const blender = (v: V3) => `(${v[0].toFixed(3)}, ${(-v[2]).toFixed(3)}, ${v[1].toFixed(3)})`;

/**
 * Weapons, optics and the first-person holds: the model with its anchors (drag them), the aimed (ADS) and hip views as
 * the game draws them (world at the world FOV, the gun at the view-model FOV, reticle in the lens), and the gun in a 3P
 * rig's hands. A GLB dropped on the panel becomes the weapon's hand-made model.
 */
export class WeaponView implements EditorView {
  private path = '';
  private id = '';
  private mode: Mode = 'ads';
  private glow = true;
  private model: THREE.Group | null = null;
  private gunScene = new THREE.Scene();
  private worldScene = new THREE.Scene();
  private gunCam = new THREE.PerspectiveCamera(34, 16 / 9, 0.01, 12);
  private worldCam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 400);
  private gunHolder = new THREE.Group();
  private rig: Rig | null = null;
  private ads = 1;
  private pitch = 0;
  private bust = 0;
  private loading = 0;

  constructor(private ctx: Ctx) {
    // a drag ended: the inspector's numbers catch up
    ctx.view3d.gizmo.addEventListener('mouseUp', () => ctx.inspect());
    this.gunScene.add(new THREE.HemisphereLight('#dfe8f0', '#3a3530', 1.4), this.gunHolder);
    const sun = new THREE.DirectionalLight('#ffffff', 2);
    sun.position.set(1, 2, 1);
    this.gunScene.add(sun);
    // a test range for the inset: a back wall at 15 m with a 1 m grid and a 1.8 m figure, a floor
    this.worldScene.background = new THREE.Color('#9fb3c4');
    this.worldScene.add(new THREE.HemisphereLight('#ffffff', '#555', 2));
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#c9c2b4'; g.fillRect(0, 0, 64, 64); g.strokeStyle = '#6d675d'; g.lineWidth = 2; g.strokeRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(30, 12);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), new THREE.MeshLambertMaterial({ map: tex }));
    wall.position.set(0, 4.4, -15);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ color: '#6f6a60' }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.6;
    const man = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3), new THREE.MeshLambertMaterial({ color: '#7a2f2b' }));
    man.position.set(0, -0.7, -14.5);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.25, 0.22), new THREE.MeshLambertMaterial({ color: '#c49a7a' }));
    head.position.set(0, 0.33, -14.5);
    this.worldScene.add(wall, floor, man, head);
  }

  private file(): WeaponFile { return files[`weapons/${this.id}.json`] as unknown as WeaponFile; }
  private optic(): OpticDef { return OPTICS[this.file().optic as keyof typeof OPTICS]; }
  private hold(): Hold {
    const vm = files['rig/viewmodel.json'] as unknown as { holds: Record<string, Hold> };
    return vm.holds[this.file().class === 'Pistol' ? 'pistol' : 'rifle'];
  }

  open(path: string) {
    this.path = path;
    if (path.startsWith('weapons/')) this.id = path.slice(8, -5);
    else {
      const optic = path.startsWith('optics/') ? path.slice(7, -5) : null;
      if (!this.id || (optic && WEAPONS[this.id]?.style.optic !== optic)) this.id = Object.values(WEAPONS).find((w) => !optic || w.style.optic === optic)?.id ?? 'l85a2';
      if (path === 'rig/viewmodel.json') this.mode = 'hip';
    }
    this.toolbar();
    this.build();
  }

  close() {
    this.ctx.view3d.clear();
    this.rig?.dispose();
    this.rig = null;
  }

  private toolbar() {
    const tb = this.ctx.toolbar;
    tb.innerHTML = '';
    const modes: [Mode, string][] = [['ads', '정조준 (1인칭)'], ['hip', '비조준 (1인칭)'], ['model', '모델·앵커만'], ['3p', '3인칭 (손에 든 모습)']];
    for (const [m, t] of modes) {
      const b = document.createElement('button');
      b.textContent = t;
      b.className = m === this.mode ? 'on' : '';
      b.onclick = () => { this.mode = m; this.toolbar(); this.build(); };
      tb.append(b);
    }
    if (!this.path.startsWith('weapons/')) {
      const l = document.createElement('label');
      const sel = document.createElement('select');
      for (const w of Object.values(WEAPONS)) { const o = document.createElement('option'); o.value = w.id; o.textContent = `${w.name} (${w.style.optic})`; sel.append(o); }
      sel.value = this.id;
      sel.onchange = () => { this.id = sel.value; this.build(); this.ctx.inspect(); };
      l.append('총: ', sel);
      tb.append(l);
    }
    const gl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = this.glow;
    cb.onchange = () => { this.glow = cb.checked; this.applyGlow(); };
    gl.append(cb, ' body_glow 보기 (3D 뷰)');
    tb.append(gl);
    if (this.mode === '3p') {
      for (const [name, get, set, min, max] of [['조준', () => this.ads, (v: number) => { this.ads = v; }, 0, 1], ['상하', () => this.pitch, (v: number) => { this.pitch = v; }, -1, 1]] as const) {
        const l = document.createElement('label');
        const r = document.createElement('input');
        r.type = 'range'; r.min = String(min); r.max = String(max); r.step = '0.01'; r.value = String(get());
        r.oninput = () => set(Number(r.value));
        l.append(name, r);
        tb.append(l);
      }
    }
  }

  /** the gun's model as the game builds it: the hand-made GLB (fresh from disk) or the procedural one */
  private async loadModel(): Promise<THREE.Group> {
    const f = this.file();
    if (f.model.glb) {
      const gltf = await new GLTFLoader().loadAsync(`/assets/models/${f.model.glb}?v=${this.bust}`);
      return gltf.scene;
    }
    return buildAsset({ ...weaponSpec(this.id), id: `vm_weapon_${this.id}` });
  }

  private async build() {
    const v = this.ctx.view3d;
    v.clear();
    this.rig?.dispose();
    this.rig = null;
    this.gunHolder.clear();
    const ticket = ++this.loading;
    const model = await this.loadModel();
    if (ticket !== this.loading) return;
    this.model = model;
    if (this.mode === '3p') {
      const op = Object.values(OPERATORS).find((o) => o.primary === this.id || o.secondary === this.id)?.id ?? 'recruit';
      this.rig = new Rig(op, this.id);
      v.root.add(this.rig.root);
      v.beforeRender = (dt) => this.rig?.pose(dt, Stance.Stand, this.pitch, 0, 0, false, { ads: this.ads });
      v.orbit.target.set(0, 1.4, 0);
      v.camera.position.set(1.6, 1.7, -1.2);
      this.ctx.hint.textContent = `${OPERATORS[op].name}의 손 — grip / fore 앵커를 바꾸면 손 위치가 따라갑니다 (모델·앵커 모드에서 편집)`;
      return;
    }
    v.root.add(model);
    this.applyGlow();
    v.frameOn(model, 0.9);
    for (const [k, color, label] of ANCHORS) {
      const a = this.file().model.anchors[k];
      if (!a) continue;
      v.addHandle({ id: k, at: new THREE.Vector3(...a), color, label, onMove: (p) => { this.file().model.anchors[k] = round(p); this.ctx.changed(this.path.startsWith('weapons/') ? this.path : `weapons/${this.id}.json`); } });
    }
    // the inset: the 1P view, drawn like the game
    const gun = model.clone(true);
    gun.traverse((o) => { if (o.name.endsWith('_glow')) o.visible = false; });
    this.gunHolder.add(gun);
    if (this.mode !== 'model') {
      v.inset = { passes: [{ scene: this.worldScene, camera: this.worldCam }, { scene: this.gunScene, camera: this.gunCam }], aspect: 16 / 9, scale: 0.42, overlay: (g, w, h) => this.overlay(g, w, h) };
    }
    this.place();
  }

  private applyGlow() {
    this.model?.traverse((o) => { if (o.name.endsWith('_glow')) o.visible = this.glow; });
  }

  /** where the gun sits in the 1P inset, the cameras' FOVs, the hint text */
  private place() {
    const f = this.file();
    const o = this.optic();
    const sight = new THREE.Vector3(...f.model.anchors.sight);
    const relief = f.model.eyeRelief ?? o.eyeRelief;
    const vm = files['rig/viewmodel.json'] as unknown as { hipFov: number };
    if (this.mode === 'ads') {
      this.gunHolder.rotation.set(0, 0, 0);
      this.gunHolder.position.set(0, 0, -relief).sub(sight);
      this.gunCam.fov = o.viewmodelFov;
      this.worldCam.fov = adsFovOf(75, o.id);
    } else {
      const hold = this.hold();
      this.gunHolder.rotation.set(hold.rot[0], hold.rot[1], hold.rot[2], 'YXZ');
      this.gunHolder.position.set(...hold.hip);
      this.gunCam.fov = vm.hipFov;
      this.worldCam.fov = 75;
    }
    const cam = sight.clone().add(new THREE.Vector3(0, 0, relief));
    this.ctx.hint.textContent = this.mode === 'ads'
      ? `정조준: 눈(카메라)은 sight ${blender(f.model.anchors.sight)}에서 ${relief} m 뒤 = Blender ${blender(round(cam))}, +Y를 봄 · 총 카메라 수직 FOV ${o.viewmodelFov}° (Sensor Fit: Vertical) · 월드 FOV ${this.worldCam.fov.toFixed(1)}° (${o.name} ×${o.zoom}, 설정 75° 기준)\n오른쪽 위: 게임과 같은 1인칭 화면 (16:9). 앵커(점)를 클릭해 화살표로 옮기세요. 좌표는 모델 기준이고 Blender로는 (x, −z, y)입니다.`
      : this.mode === 'hip'
        ? `비조준: 총 원점(grip)이 카메라 기준 [${this.hold().hip.join(', ')}] m에 놓임 · 총 카메라 수직 FOV ${vm.hipFov}° (data/rig/viewmodel.json에서 편집)`
        : '모델과 앵커: 점을 클릭해 화살표로 옮기세요. 좌표는 모델 기준 (m) — Blender로는 (x, −z, y).';
  }

  /** the reticle in the lens and the lens rim, as the game draws them (collimated, clipped to the lens) */
  private overlay(g: CanvasRenderingContext2D, w: number, h: number) {
    const o = this.optic();
    const f = this.file();
    g.fillStyle = '#e8edf2';
    g.font = '11px system-ui';
    g.fillText(this.mode === 'ads' ? `정조준 · ${o.name}` : '비조준', 6, 14);
    if (this.mode !== 'ads' || !o.reticle || !o.lens) {
      if (this.mode === 'ads') { g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(w / 2 - 6, h / 2); g.lineTo(w / 2 + 6, h / 2); g.moveTo(w / 2, h / 2 - 6); g.lineTo(w / 2, h / 2 + 6); g.stroke(); }
      return;
    }
    const t = Math.tan((o.viewmodelFov * Math.PI) / 360);
    const relief = f.model.eyeRelief ?? o.eyeRelief;
    const dz = relief + (f.model.anchors.sight[2] - f.model.anchors.lens[2]);
    const lensR = (o.lens.size[0] / 2 / dz / t) * (h / 2);
    const cx = w / 2, cy = h / 2;
    g.save();
    g.beginPath();
    g.arc(cx, cy, lensR, 0, Math.PI * 2);
    g.fillStyle = o.lens.tint;
    g.globalAlpha = o.lens.tintOpacity;
    g.fill();
    g.globalAlpha = 1;
    g.setLineDash([4, 3]);
    g.strokeStyle = 'rgba(90,208,240,.8)';
    g.stroke();
    g.setLineDash([]);
    g.clip();
    const size = (Math.tan(o.reticle.angle / 2) / t) * h;
    g.strokeStyle = g.fillStyle = '#ff4a3a';
    g.lineWidth = Math.max(1, size * 0.06);
    if (o.reticle.texture === 'dot') { g.beginPath(); g.arc(cx, cy, Math.max(1.5, size * 0.12), 0, Math.PI * 2); g.fill(); }
    if (o.reticle.texture === 'holo') { g.beginPath(); g.arc(cx, cy, size * 0.4, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(cx, cy, Math.max(1.5, size * 0.05), 0, Math.PI * 2); g.fill(); }
    if (o.reticle.texture === 'acog') { g.beginPath(); g.moveTo(cx - size * 0.18, cy + size * 0.12); g.lineTo(cx, cy - size * 0.06); g.lineTo(cx + size * 0.18, cy + size * 0.12); g.stroke(); g.fillRect(cx - 1, cy + size * 0.15, 2, size * 0.3); }
    g.restore();
  }

  refresh() {
    if (!this.model) return;
    if (this.mode === '3p') { this.build(); return; }
    for (const [k] of ANCHORS) {
      const a = this.file().model.anchors[k];
      if (a && this.ctx.view3d.selected !== k) this.ctx.view3d.moveHandle(k, new THREE.Vector3(...a));
    }
    this.place();
  }

  panel(): HTMLElement {
    const box = document.createElement('div');
    const f = this.file();
    const help = document.createElement('div');
    help.className = 'help';
    help.textContent = `모델: ${f.model.glb ? `public/assets/models/${f.model.glb}` : '절차적 모델 (GLB 없음)'}\n규칙: 노드 body · mag (탄창, 재장전 시 움직임) · body_glow (렌즈 캡: 3인칭에서만 보임). 트랜스폼 적용(Ctrl+A), +Y Up, Draco 끔, 버텍스 컬러.`;
    const drop = document.createElement('div');
    drop.className = 'drop';
    drop.textContent = '여기에 .glb를 끌어다 놓거나 클릭해서 이 총의 모델로 가져오기';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb';
    input.style.display = 'none';
    const take = async (file: File) => {
      try {
        drop.textContent = '올리는 중…';
        const glb = await uploadModel(`weapon_${this.id}.glb`, await file.arrayBuffer());
        f.model.glb = glb;
        this.bust++;
        await loadGlb(`weapon_${this.id}`, `/assets/models/${glb}?v=${this.bust}`);
        this.ctx.changed(`weapons/${this.id}.json`);
        this.build();
        this.ctx.inspect();
      } catch (e) { drop.textContent = `실패: ${(e as Error).message}`; }
    };
    drop.onclick = () => input.click();
    input.onchange = () => input.files?.[0] && take(input.files[0]);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const file = e.dataTransfer?.files[0]; if (file) take(file); };
    box.append(help, drop, input);
    if (!this.path.startsWith('weapons/')) {
      const go = document.createElement('button');
      go.textContent = `이 총(${this.id}) 파일 열기`;
      go.onclick = () => this.ctx.open(`weapons/${this.id}.json`);
      box.append(go);
    }
    return box;
  }
}
