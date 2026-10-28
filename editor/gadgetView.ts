import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Ctx, EditorView } from './main.ts';
import { files, uploadModel } from './store.ts';
import { loadGlb } from '../src/assets/library.ts';

/** Gadgets: the tuning values in the form, and the hand-made model (if any) in the view; a dropped GLB becomes it. */
export class GadgetView implements EditorView {
  private path = '';
  private id = '';
  private bust = 0;
  constructor(private ctx: Ctx) {}

  open(path: string) {
    this.path = path;
    this.id = path.slice(8, -5);
    this.build();
  }
  close() { this.ctx.view3d.clear(); }
  refresh() { /* values only: nothing to redraw */ }

  private async build() {
    const v = this.ctx.view3d;
    v.clear();
    const f = files[this.path] as { model: { glb?: string } };
    this.ctx.hint.textContent = f.model.glb
      ? '가젯 모델: 원점이 설치·투척된 위치(바닥·벽에 닿는 점)이고, 1인칭에서는 원점을 손에 쥡니다.'
      : '이 가젯은 절차적 모델을 씁니다. 오른쪽에서 GLB를 가져오면 바뀝니다. 수치(설치 시간·신관·폭발 반경 등)는 오른쪽 폼에서 편집하세요.';
    if (!f.model.glb) return;
    const gltf = await new GLTFLoader().loadAsync(`/assets/models/${f.model.glb}?v=${this.bust}`);
    v.root.add(gltf.scene);
    v.frameOn(gltf.scene, 1.2);
    v.addHandle({ id: 'origin', at: new THREE.Vector3(), color: '#f0e060', label: '원점' });
  }

  panel(): HTMLElement {
    const box = document.createElement('div');
    const drop = document.createElement('div');
    drop.className = 'drop';
    drop.textContent = '여기에 .glb를 끌어다 놓거나 클릭해서 이 가젯의 모델로 가져오기';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb';
    input.style.display = 'none';
    const take = async (file: File) => {
      try {
        drop.textContent = '올리는 중…';
        const glb = await uploadModel(`gadget_${this.id}.glb`, await file.arrayBuffer());
        (files[this.path] as { model: { glb?: string } }).model.glb = glb;
        this.bust++;
        await loadGlb(`gadget_${this.id}`, `/assets/models/${glb}?v=${this.bust}`);
        this.ctx.changed(this.path);
        this.build();
        this.ctx.inspect();
      } catch (e) { drop.textContent = `실패: ${(e as Error).message}`; }
    };
    drop.onclick = () => input.click();
    input.onchange = () => input.files?.[0] && take(input.files[0]);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const file = e.dataTransfer?.files[0]; if (file) take(file); };
    box.append(drop, input);
    return box;
  }
}
