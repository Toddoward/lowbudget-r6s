import * as THREE from 'three';
import type { Ctx, EditorView } from './main.ts';
import { files, uploadModel } from './store.ts';
import { loadGlb } from '../src/assets/library.ts';
import { OPERATORS } from '../src/game/operators.ts';
import { reloadSkeleton, restPivots, Rig } from '../src/render/Rig.ts';
import { Stance } from '../src/game/types.ts';

type V3 = [number, number, number];
interface Skeleton { hips: V3; head: V3; shoulderL: V3; shoulderR: V3; armUpper: number; armFore: number; legL: V3; legR: V3 }
const JOINTS: [keyof ReturnType<typeof restPivots>, string, string][] = [
  ['hips', '#f0e060', 'hips 골반'], ['head', '#5fe08a', 'head 목'], ['armL', '#5ad0f0', 'shoulderL 왼어깨'], ['armR', '#5ad0f0', 'shoulderR 오른어깨'],
  ['foreL', '#e070e0', '왼팔꿈치'], ['foreR', '#e070e0', '오른팔꿈치'], ['legL', '#f0a050', 'legL 왼고관절'], ['legR', '#f0a050', 'legR 오른고관절'],
];
const round = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * Operators, the skeleton and the 3P animation: an operator's rig (procedural or its hand-made GLB) posed live — stance,
 * aim pitch, lean, walk, ADS, sprint, reload, death — with the weapon in hand. Opened on the skeleton, the joints show and
 * can be dragged (the rig is rebuilt); the animation file's values apply as you type.
 */
export class RigView implements EditorView {
  private path = '';
  private op = 'sledge';
  private rig: Rig | null = null;
  private pose = { stance: Stance.Stand as Stance, pitch: 0, lean: 0, speed: 0, ads: 0, sprint: false, reload: -1, reloadLoop: false, dead: false, rest: false };
  private t = 0;

  constructor(private ctx: Ctx) {}

  open(path: string) {
    this.path = path;
    if (path.startsWith('operators/')) this.op = path.slice(10, -5);
    this.pose.rest = path === 'rig/skeleton.json';
    this.toolbar();
    this.build();
  }
  close() { this.ctx.view3d.clear(); this.rig?.dispose(); this.rig = null; }

  private toolbar() {
    const tb = this.ctx.toolbar;
    tb.innerHTML = '';
    const p = this.pose;
    const add = (el: HTMLElement) => tb.append(el);
    if (!this.path.startsWith('operators/')) {
      const l = document.createElement('label');
      const sel = document.createElement('select');
      for (const o of Object.values(OPERATORS)) { const x = document.createElement('option'); x.value = o.id; x.textContent = o.name; sel.append(x); }
      sel.value = this.op;
      sel.onchange = () => { this.op = sel.value; this.build(); };
      l.append('오퍼레이터: ', sel);
      add(l);
    }
    const stances: [Stance, string][] = [[Stance.Stand, '서기'], [Stance.Crouch, '앉기'], [Stance.Prone, '엎드리기'], [Stance.Rappel, '레펠']];
    for (const [st, name] of stances) {
      const b = document.createElement('button');
      b.textContent = name;
      b.className = p.stance === st && !p.dead ? 'on' : '';
      b.onclick = () => { p.stance = st; p.dead = false; this.rig?.setDead(false); this.toolbar(); };
      add(b);
    }
    const slider = (name: string, key: 'pitch' | 'lean' | 'speed' | 'ads', min: number, max: number) => {
      const l = document.createElement('label');
      const r = document.createElement('input');
      r.type = 'range'; r.min = String(min); r.max = String(max); r.step = '0.01'; r.value = String(p[key]);
      r.oninput = () => { p[key] = Number(r.value); };
      l.append(name, r);
      add(l);
    };
    slider('상하', 'pitch', -1.2, 1.2);
    slider('기울기', 'lean', -1, 1);
    slider('걷기 m/s', 'speed', 0, 6);
    slider('조준', 'ads', 0, 1);
    const toggle = (name: string, get: () => boolean, set: (v: boolean) => void) => {
      const b = document.createElement('button');
      b.textContent = name;
      b.className = get() ? 'on' : '';
      b.onclick = () => { set(!get()); this.toolbar(); };
      add(b);
    };
    toggle('달리기', () => p.sprint, (v) => { p.sprint = v; });
    toggle('재장전 반복', () => p.reloadLoop, (v) => { p.reloadLoop = v; if (!v) p.reload = -1; });
    toggle('사망', () => p.dead, (v) => { p.dead = v; this.rig?.setDead(v, false, 0.3); });
  }

  private build() {
    const v = this.ctx.view3d;
    v.clear();
    this.rig?.dispose();
    reloadSkeleton();
    const def = OPERATORS[this.op];
    this.rig = new Rig(this.op, def.shield ? def.secondary : def.primary);
    v.root.add(this.rig.root);
    v.orbit.target.set(0, 0.95, 0);
    if (v.camera.position.length() < 2.5) v.camera.position.set(2.2, 1.6, -2.4);
    const sk = files['rig/skeleton.json'] as unknown as Skeleton;
    const bones = this.rig as unknown as Record<string, THREE.Object3D>;
    if (this.pose.rest) {
      // the skeleton: joints at their pivots (dragging moves the pivot, relative to the hips for the others)
      for (const [name, color, label] of JOINTS) {
        const at = bones[name].getWorldPosition(new THREE.Vector3());
        const movable = !name.startsWith('fore');
        v.addHandle({ id: name, at, color, label, size: 0.025, onMove: movable ? (pt) => this.moveJoint(name, pt, sk) : undefined });
      }
    }
    v.beforeRender = (dt) => {
      const p = this.pose;
      this.t += dt;
      if (p.reloadLoop) p.reload = (this.t % 2.4) / 2.4;
      this.rig?.pose(dt, p.stance, p.pitch, p.lean, p.speed, false, { ads: p.ads, sprint: p.sprint, reload: p.reload });
      if (p.rest && !v.gizmo.dragging) for (const [name] of JOINTS) if (v.selected !== name) v.moveHandle(name, bones[name].getWorldPosition(new THREE.Vector3()));
    };
    this.ctx.hint.textContent = this.pose.rest
      ? '골격: 관절(점)을 클릭해 화살표로 옮기면 data/rig/skeleton.json이 바뀌고 리그가 다시 만들어집니다 (어깨·머리·고관절은 골반 기준). 팔 길이는 오른쪽 폼에서.'
      : this.path === 'rig/animation.json'
        ? '애니메이션: 오른쪽 값을 바꾸면 바로 반영됩니다 (m, rad). 위 버튼·슬라이더로 자세를 바꿔 보세요.'
        : `${def.name}: 위 버튼·슬라이더로 자세를 확인하세요. 모델은 오른쪽에서 GLB로 바꿀 수 있습니다.`;
  }

  private moveJoint(name: string, pt: THREE.Vector3, sk: Skeleton) {
    const hips = new THREE.Vector3(...sk.hips);
    const rel = (p: THREE.Vector3): V3 => [round(p.x - hips.x), round(p.y - hips.y), round(p.z - hips.z)];
    if (name === 'hips') sk.hips = [round(pt.x), round(pt.y), round(pt.z)];
    if (name === 'head') sk.head = rel(pt);
    if (name === 'armL') sk.shoulderL = rel(pt);
    if (name === 'armR') sk.shoulderR = rel(pt);
    if (name === 'legL') sk.legL = rel(pt);
    if (name === 'legR') sk.legR = rel(pt);
    this.ctx.changed('rig/skeleton.json');
  }

  refresh() {
    // skeleton / operator changes need a new rig; animation values are read every frame
    if (this.path !== 'rig/animation.json' && !this.ctx.view3d.gizmo.dragging) this.build();
    else if (this.path === 'rig/skeleton.json') { reloadSkeleton(); }
  }

  panel(): HTMLElement | null {
    if (!this.path.startsWith('operators/')) return null;
    const box = document.createElement('div');
    const f = files[this.path] as { model: { glb?: string } };
    const help = document.createElement('div');
    help.className = 'help';
    help.textContent = `모델: ${f.model.glb ? `public/assets/models/${f.model.glb}` : '절차적 모델 (GLB 없음)'}
오퍼레이터 GLB 규칙: 발이 원점, −Z(Blender +Y)를 보고, 팔은 아래로 곧게 내린 자세로 통째로 모델링하고, 뼈대별로 오브젝트를 나눠 이름을 붙이세요: hips · torso · head · armL · armR (위팔) · foreL · foreR (아래팔+손) · legL · legR. 각 부분은 게임이 골격(data/rig/skeleton.json)의 관절 위치로 옮깁니다 — 관절이 맞는지는 '리그 › skeleton'에서 확인·조정하세요. 트랜스폼 적용, +Y Up, Draco 끔, 버텍스 컬러.`;
    const drop = document.createElement('div');
    drop.className = 'drop';
    drop.textContent = '여기에 .glb를 끌어다 놓거나 클릭해서 이 오퍼레이터의 모델로 가져오기';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb';
    input.style.display = 'none';
    const take = async (file: File) => {
      try {
        drop.textContent = '올리는 중…';
        const glb = await uploadModel(`operator_${this.op}.glb`, await file.arrayBuffer());
        f.model.glb = glb;
        await loadGlb(`operator_${this.op}`, `/assets/models/${glb}?v=${Date.now()}`);
        this.ctx.changed(this.path);
        this.ctx.inspect();
      } catch (e) { drop.textContent = `실패: ${(e as Error).message}`; }
    };
    drop.onclick = () => input.click();
    input.onchange = () => input.files?.[0] && take(input.files[0]);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const file = e.dataTransfer?.files[0]; if (file) take(file); };
    box.append(help, drop, input);
    return box;
  }
}
