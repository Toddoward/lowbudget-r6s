import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/**
 * The editor's 3D viewport: orbit camera, grid and axes, a translate gizmo for the selected handle, labelled handles
 * (anchors, joints) that can be clicked, and an optional inset camera drawn in a corner (the aimed first-person view).
 */
export interface Handle { id: string; obj: THREE.Object3D; label: string; color: string; onMove?: (p: THREE.Vector3) => void }

export class View3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.005, 400);
  readonly orbit: OrbitControls;
  readonly gizmo: TransformControls;
  readonly root = new THREE.Group();
  private labels = new CSS2DRenderer();
  private handles = new Map<string, Handle>();
  private handleGroup = new THREE.Group();
  private ray = new THREE.Raycaster();
  selected: string | null = null;
  onSelect?: (id: string | null) => void;
  /** a second camera drawn in the lower-right corner (inset), with an overlay painter for the 2D parts (reticle) */
  inset: { passes: { scene: THREE.Scene; camera: THREE.PerspectiveCamera }[]; aspect: number; scale: number; overlay?: (g: CanvasRenderingContext2D, w: number, h: number) => void } | null = null;
  private overlay: HTMLCanvasElement;
  beforeRender?: (dt: number) => void;
  private last = performance.now();

  constructor(readonly el: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.autoClear = false;
    el.appendChild(this.renderer.domElement);
    this.labels.domElement.className = 'labels';
    el.appendChild(this.labels.domElement);
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'inset-overlay';
    el.appendChild(this.overlay);
    this.scene.background = new THREE.Color('#1d2126');
    this.scene.add(new THREE.HemisphereLight('#dfe8f0', '#3a3530', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(2, 4, 3);
    this.scene.add(sun, this.root, this.handleGroup);
    const grid = new THREE.GridHelper(4, 40, '#3c4650', '#2b3239');
    this.scene.add(grid, new THREE.AxesHelper(0.25));
    this.camera.position.set(0.9, 0.5, 0.9);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0.05, -0.15);
    this.orbit.enableDamping = true;
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.7);
    this.gizmo.addEventListener('dragging-changed', (e) => { this.orbit.enabled = !(e as unknown as { value: boolean }).value; });
    this.gizmo.addEventListener('objectChange', () => {
      const h = this.selected ? this.handles.get(this.selected) : null;
      if (h) h.onMove?.(h.obj.position.clone());
    });
    this.scene.add(this.gizmo.getHelper());
    this.renderer.domElement.addEventListener('pointerdown', (e) => this.pick(e));
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    // (an error in one frame is logged; the loop goes on)
    const loop = () => { try { this.frame(); } catch (e) { console.error(e); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.overlay.width = w; this.overlay.height = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear() {
    this.gizmo.detach();
    this.selected = null;
    for (const h of this.handles.values()) h.obj.traverse((o) => { if (o instanceof CSS2DObject) o.element.remove(); });
    this.handles.clear();
    this.handleGroup.clear();
    this.root.clear();
    this.inset = null;
    this.beforeRender = undefined;
  }

  /** a clickable, draggable point with a label */
  addHandle(h: Omit<Handle, 'obj'> & { at: THREE.Vector3; parent?: THREE.Object3D; size?: number }): Handle {
    const obj = new THREE.Mesh(new THREE.SphereGeometry(h.size ?? 0.007, 12, 8), new THREE.MeshBasicMaterial({ color: h.color, depthTest: false, transparent: true, opacity: 0.95 }));
    obj.renderOrder = 50;
    obj.position.copy(h.at);
    obj.userData.handle = h.id;
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = h.label;
    tag.style.borderColor = h.color;
    tag.onclick = () => this.select(h.id);
    const label = new CSS2DObject(tag);
    label.position.set(0, (h.size ?? 0.007) * 2.2, 0);
    obj.add(label);
    (h.parent ?? this.handleGroup).add(obj);
    const handle: Handle = { ...h, obj };
    this.handles.set(h.id, handle);
    return handle;
  }

  moveHandle(id: string, p: THREE.Vector3) { this.handles.get(id)?.obj.position.copy(p); }

  select(id: string | null) {
    this.selected = id;
    const h = id ? this.handles.get(id) : null;
    if (h && h.onMove) this.gizmo.attach(h.obj); else this.gizmo.detach();
    for (const x of this.handles.values()) x.obj.traverse((o) => { if (o instanceof CSS2DObject) o.element.classList.toggle('on', x.id === id); });
    this.onSelect?.(id);
  }

  private pick(e: PointerEvent) {
    if (e.button !== 0 || (this.gizmo as unknown as { dragging: boolean }).dragging) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObjects([...this.handles.values()].map((h) => h.obj), false)[0];
    if (hit) this.select(hit.object.userData.handle as string);
  }

  /** frame the camera on an object */
  frameOn(o: THREE.Object3D, k = 1.6) {
    const box = new THREE.Box3().setFromObject(o);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() * 0.5;
    this.orbit.target.copy(c);
    this.camera.position.copy(c).add(new THREE.Vector3(0.75, 0.45, 0.75).normalize().multiplyScalar(r * k * 2.2));
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.beforeRender?.(dt);
    this.orbit.update();
    const r = this.renderer;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.clear();
    r.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    const g = this.overlay.getContext('2d')!;
    // (a fresh state every frame: an overlay that threw must not leave a clip or a transform behind)
    g.reset();
    g.clearRect(0, 0, w, h);
    if (this.inset) {
      const iw = Math.round(w * this.inset.scale), ih = Math.round(iw / this.inset.aspect);
      const x = w - iw - 12, y = 12;
      r.setScissorTest(true);
      r.setScissor(x, y, iw, ih);
      r.setViewport(x, y, iw, ih);
      r.setClearColor('#7d8a96');
      r.clear();
      r.setClearColor('#000000');
      // like the game: the world at its camera, then the gun over it at the view-model camera (depth cleared between)
      for (const p of this.inset.passes) {
        p.camera.aspect = this.inset.aspect;
        p.camera.updateProjectionMatrix();
        r.clearDepth();
        r.render(p.scene, p.camera);
      }
      r.setScissorTest(false);
      // overlay canvas: y from the top
      g.save();
      g.translate(x, h - y - ih);
      g.strokeStyle = '#e8edf2';
      g.lineWidth = 1;
      g.strokeRect(0.5, 0.5, iw - 1, ih - 1);
      try { this.inset.overlay?.(g, iw, ih); } catch (e) { console.error(e); } finally { g.restore(); }
    }
  }
}
