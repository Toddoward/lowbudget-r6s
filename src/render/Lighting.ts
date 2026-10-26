import * as THREE from 'three';
import { INTERIOR } from './palette.ts';
import type { Opening } from '../map/MapBuilder.ts';
import type { LampDef } from '../map/MapBuilder.ts';
import type { StreetLight, SuburbWorld } from '../map/Suburb.ts';
import type { TimeOfDay } from '../../shared/constants.ts';

/**
 * E3 2014 trailer lighting: one hard, low key light (warm morning sun or cold
 * moon) with real-time shadows, very little fill, interiors exposed darker
 * than the exterior (see palette.patchInterior), volumetric shafts through the
 * key-lit windows, practical lights (street lamps, police bars, interior
 * lamps) and an operator tactical flashlight at night.
 */
export class Lighting {
  readonly key = new THREE.DirectionalLight('#ffffff', 3);
  readonly hemi = new THREE.HemisphereLight('#9db7d0', '#3d342a', 0.4);
  readonly flashlight = new THREE.SpotLight('#e9f1ff', 0, 34, 0.42, 0.45, 1.6);
  private practical: THREE.PointLight[] = [];
  private police: { light: THREE.PointLight; phase: number }[] = [];
  private shafts = new THREE.Group();
  private shaftMat: THREE.ShaderMaterial;
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private t = 0;
  tod: TimeOfDay = 'day';
  flashlightOn = false;
  flashlightShadows = true;
  private shaftOpenings: { mesh: THREE.Mesh; opening: Opening }[] = [];

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, private suburb: SuburbWorld, private lamps: LampDef[], private openings: Opening[]) {
    this.key.castShadow = true;
    const sc = this.key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 140;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.00035;
    this.key.shadow.normalBias = 0.035;
    scene.add(this.key, this.key.target, this.hemi);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.bias = -0.0008;
    this.flashlight.shadow.camera.near = 0.3;
    scene.add(this.flashlight, this.flashlight.target);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color() }, sunSize: { value: 0.9995 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunSize; varying vec3 vDir;
        void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, pow(-h, 0.4));
          float s = dot(normalize(vDir), sunDir); c += sunCol * (smoothstep(sunSize, 1.0, s) * 4.0 + pow(max(s, 0.0), 24.0) * 0.35);
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.shaftMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { color: { value: new THREE.Color('#ffd9a0') }, strength: { value: 0.12 }, time: { value: 0 } },
      vertexShader: 'attribute float along; attribute vec2 edge; varying float vAlong; varying vec2 vEdge; varying vec3 vW; void main(){ vAlong = along; vEdge = edge; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform vec3 color; uniform float strength; uniform float time; varying float vAlong; varying vec2 vEdge; varying vec3 vW;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        void main(){ float e = (1.0 - abs(vEdge.x)) * (1.0 - abs(vEdge.y)); float a = strength * pow(max(1.0 - vAlong, 0.0), 1.6) * smoothstep(0.0, 0.35, e);
          float n = 0.85 + 0.15 * sin(vW.x * 3.1 + vW.y * 2.3 + time * 0.6) * sin(vW.z * 2.7 - time * 0.4);
          gl_FragColor = vec4(color * a * n, 1.0); }`,
    });
    scene.add(this.shafts);
  }

  /** Apply the round's time of day. */
  apply(tod: TimeOfDay, seed = 0) {
    this.tod = tod;
    const r = this.renderer;
    for (const l of this.practical) this.scene.remove(l);
    for (const p of this.police) this.scene.remove(p.light);
    this.practical = [];
    this.police = [];
    const day = tod === 'day';
    // key light
    const sunDir = day ? new THREE.Vector3(0.82, 0.42, 0.38).normalize() : new THREE.Vector3(-0.55, 0.62, -0.56).normalize();
    this.key.color.set(day ? '#ffd7a3' : '#93a9ff');
    this.key.intensity = day ? 3.6 : 0.55;
    this.key.position.copy(sunDir).multiplyScalar(60);
    this.key.target.position.set(0, 0, 0);
    this.hemi.color.set(day ? '#a9c0d6' : '#22304e');
    this.hemi.groundColor.set(day ? '#4a3d2e' : '#0b0c10');
    this.hemi.intensity = day ? 1.25 : 0.5;
    INTERIOR.uInteriorAmb.value = day ? 0.5 : 0.75;
    r.toneMappingExposure = day ? 1.05 : 1.5;
    this.scene.fog = day ? new THREE.FogExp2('#c7c0b1', 0.0085) : new THREE.FogExp2('#0a0f19', 0.018);
    this.scene.background = null;
    this.skyMat.uniforms.top.value.set(day ? '#5d86b0' : '#03060d');
    this.skyMat.uniforms.horizon.value.set(day ? '#e9d2ad' : '#1a2336');
    this.skyMat.uniforms.bottom.value.set(day ? '#6b6052' : '#05070b');
    this.skyMat.uniforms.sunDir.value.copy(sunDir);
    this.skyMat.uniforms.sunCol.value.set(day ? '#fff1d0' : '#c9d6ff');
    this.skyMat.uniforms.sunSize.value = day ? 0.9993 : 0.99975;
    // practical lights (night)
    (this.suburb.windowGlow.material as THREE.MeshBasicMaterial).color.setScalar(day ? 0.25 : 1);
    if (!day) {
      const lamps = this.suburb.lights.filter((l) => l.kind === 'lamp' || l.kind === 'flood').slice(0, 6);
      for (const s of lamps) this.addPractical(s);
      let rs = seed || 1;
      const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
      const lit = this.lamps.filter(() => rnd() < 0.45).slice(0, 6);
      for (const l of lit) {
        const pl = new THREE.PointLight('#ffcf8a', 5.5, 8, 1.8);
        pl.position.copy(l.pos).add(new THREE.Vector3(0, -0.15, 0));
        this.scene.add(pl);
        this.practical.push(pl);
      }
      for (const s of this.suburb.lights.filter((l) => l.kind === 'police').slice(0, 2)) {
        const pl = new THREE.PointLight('#ff2030', 18, 16, 1.6);
        pl.position.copy(s.pos);
        this.scene.add(pl);
        this.police.push({ light: pl, phase: Math.random() * 6 });
      }
    }
    // daytime bounce: soft warm fill inside each floor (light bouncing off sunlit floors)
    if (day) {
      for (const [x, y, z] of [[-4, -1.2, 0], [4, -1.2, 0], [-4, 1.8, -3], [4, 1.8, 2], [-4, 4.8, 2], [3, 4.8, -3]]) {
        const pl = new THREE.PointLight('#ffe2c0', 4.5, 11, 1.4);
        pl.position.set(x, y, z);
        this.scene.add(pl);
        this.practical.push(pl);
      }
    }
    this.flashlightOn = !day;
    this.buildShafts(sunDir, day);
  }

  private addPractical(s: StreetLight) {
    const pl = new THREE.PointLight(s.color, s.kind === 'flood' ? 60 : 26, s.kind === 'flood' ? 30 : 18, 1.7);
    pl.position.copy(s.pos);
    this.scene.add(pl);
    this.practical.push(pl);
  }

  /** Light shafts: sweep each key-lit window rectangle along the light direction into the house. */
  private buildShafts(sunDir: THREE.Vector3, day: boolean) {
    for (const s of this.shaftOpenings) { s.mesh.geometry.dispose(); this.shafts.remove(s.mesh); }
    this.shaftOpenings = [];
    this.shaftMat.uniforms.color.value.set(day ? '#ffd39a' : '#7f97d8');
    this.shaftMat.uniforms.strength.value = day ? 0.16 : 0.07;
    const travel = sunDir.clone().negate();
    for (const op of this.openings) {
      if (!op.exterior || op.kind === 'shutter') continue;
      // outward normal: side without a room
      const n = op.run === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      if (op.rooms[1] !== null && op.rooms[0] === null) n.negate();
      if (n.dot(sunDir) < 0.12) continue;
      const L = 7;
      const u = op.run === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const c = op.center;
      const hw = op.w / 2, hh = op.h / 2;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => c.clone().addScaledVector(u, a * hw).add(new THREE.Vector3(0, b * hh, 0)));
      const pos: number[] = [];
      const along: number[] = [];
      const edge: number[] = [];
      const quad = (a: THREE.Vector3, b: THREE.Vector3, ea: [number, number], eb: [number, number]) => {
        const a2 = a.clone().addScaledVector(travel, L);
        const b2 = b.clone().addScaledVector(travel, L);
        const vs = [a, b, b2, a, b2, a2];
        const al = [0, 0, 1, 0, 1, 1];
        const ed = [ea, eb, eb, ea, eb, ea];
        for (let i = 0; i < 6; i++) { pos.push(vs[i].x, vs[i].y, vs[i].z); along.push(al[i]); edge.push(ed[i][0], ed[i][1]); }
      };
      quad(corners[0], corners[1], [-1, -1], [1, -1]);
      quad(corners[1], corners[2], [1, -1], [1, 1]);
      quad(corners[2], corners[3], [1, 1], [-1, 1]);
      quad(corners[3], corners[0], [-1, 1], [-1, -1]);
      // centre sheets for volume
      quad(c.clone().addScaledVector(u, -hw), c.clone().addScaledVector(u, hw), [-1, 0], [1, 0]);
      quad(c.clone().add(new THREE.Vector3(0, -hh, 0)), c.clone().add(new THREE.Vector3(0, hh, 0)), [0, -1], [0, 1]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
      g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 2));
      const mesh = new THREE.Mesh(g, this.shaftMat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.shafts.add(mesh);
      this.shaftOpenings.push({ mesh, opening: op });
    }
  }

  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3) {
    this.t += dt;
    this.shaftMat.uniforms.time.value = this.t;
    this.sky.position.copy(camera.position);
    // keep shadow frustum centred around the player (snapped to texels to avoid swimming)
    const snap = 52 / 2048;
    const fx = Math.round(focus.x / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    const dir = this.key.position.clone().sub(this.key.target.position).normalize();
    this.key.target.position.set(fx * 0.6, 0, fz * 0.6);
    this.key.position.copy(this.key.target.position).addScaledVector(dir, 60);
    for (const s of this.shaftOpenings) s.mesh.visible = s.opening.barricadePanel === null;
    for (const p of this.police) {
      const k = Math.sin((this.t + p.phase) * 9);
      p.light.color.set(k > 0 ? '#ff2030' : '#2046ff');
      p.light.intensity = 10 + Math.abs(k) * 22;
    }
    for (const bar of this.suburb.policeBars) bar.rotation.y = Math.sin(this.t * 9) > 0 ? 0 : Math.PI;
    this.flashlight.intensity = this.flashlightOn ? 38 : 0;
    this.flashlight.castShadow = this.flashlightOn && this.flashlightShadows;
  }

  /** Position the weapon flashlight from the camera. */
  aimFlashlight(camera: THREE.PerspectiveCamera) {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    this.flashlight.position.copy(camera.position).addScaledVector(r, 0.18).add(new THREE.Vector3(0, -0.12, 0));
    this.flashlight.target.position.copy(camera.position).addScaledVector(f, 12);
  }
}
