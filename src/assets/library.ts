import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { patchInterior, vcMaterial } from '../render/palette.ts';
import { dataDir } from '../data/index.ts';

/**
 * Models linked from the data (`model.glb` in data/weapons, data/operators, data/gadgets): hand-made GLBs under
 * public/assets/models/, keyed by the spec id they replace (`weapon_<id>`, `operator_<id>`, `gadget_<id>`).
 */
export function linkedModels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [dir, prefix] of [['weapons', 'weapon'], ['operators', 'operator'], ['gadgets', 'gadget']] as const) {
    for (const [id, d] of Object.entries(dataDir<{ model?: { glb?: string } }>(dir))) if (d.model?.glb) out[`${prefix}_${id}`] = d.model.glb;
  }
  return out;
}

/**
 * GLB assets produced by the CLI-Anything → Blender pipeline
 * (tools/cli-anything/pipeline.py → public/assets/models/manifest.json).
 * When present they replace the in-browser procedural meshes 1:1 (same spec,
 * same proportions, per-bone nodes); otherwise build.ts falls back silently.
 */
const cache = new Map<string, THREE.Object3D>();
export let glbStats = { loaded: 0, available: 0, source: 'procedural' as 'procedural' | 'cli-anything-blender' };

export async function preloadGlbAssets(categories = ['weapon', 'operator', 'gadget'], base = `${import.meta.env.BASE_URL}assets/models/`): Promise<void> {
  try {
    const res = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return;
    const manifest = (await res.json()) as { assets: Record<string, { file: string; category: string }> };
    // the data's hand-made models replace the pipeline's bakes of the same id
    const links = linkedModels();
    const linked = Object.entries(links).map(([id, file]) => [id, { file, category: id.split('_')[0] }] as const);
    const entries = [...Object.entries(manifest.assets).filter(([id]) => !(id in links)), ...linked].filter(([, a]) => categories.includes(a.category));
    glbStats.available = entries.length;
    const loader = new GLTFLoader();
    await Promise.all(entries.map(async ([id, a]) => {
      try {
        const gltf = await loader.loadAsync(`${base}${a.file}`);
        cache.set(id, bake(gltf.scene));
      } catch (err) {
        console.warn(`[assets] ${a.file} failed, using procedural mesh`, err);
      }
    }));
    glbStats = { loaded: cache.size, available: entries.length, source: cache.size ? 'cli-anything-blender' : 'procedural' };
  } catch {
    /* offline / no manifest → procedural */
  }
}

/**
 * A GLB part's name as the game knows it: Blender's ".001" dropped, a model prefix dropped (`l85_body` → `body`,
 * `l85_body_glow` → `body_glow`, `sledge_armL` → `armL`), `.L` / `_L` side suffixes → `L`.
 */
const PARTS = ['body_glow', 'body', 'mag', 'hips', 'spine', 'chest', 'head', 'armL', 'armR', 'foreL', 'foreR', 'handL', 'handR', 'thighL', 'thighR', 'legL', 'legR', 'torso'];
export function partName(raw: string): string {
  const n = raw.replace(/\.\d{3}$/, '').replace(/[._ ](L|R)$/, '$1');
  for (const p of [...PARTS].sort((a, b) => b.length - a.length)) {
    if (n === p || n.endsWith(`_${p}`) || n.endsWith(`_${p}_glow`.replace('_glow_glow', '_glow'))) return n.endsWith('_glow') && !p.endsWith('_glow') ? `${p}_glow` : p;
    if (n.endsWith(`${p}_glow`)) return `${p}_glow`;
  }
  return n;
}
/** anchor names a model can carry as empties (Blender: Empty objects, exported with the meshes) */
export const ANCHOR_NAMES = ['sight', 'lens', 'muzzle', 'grip', 'fore'] as const;
/** a loaded model with every mesh's node transforms baked into its geometry (so un-applied transforms don't matter) */
function bake(scene: THREE.Object3D): THREE.Object3D {
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    m.geometry = m.geometry.clone().applyMatrix4(m.matrixWorld);
    m.userData.baked = true;
  });
  return scene;
}
/** the model's anchors from its empties (`sight`, `lens` …, prefixes allowed), world positions in the model's frame */
export function glbAnchors(id: string): Partial<Record<(typeof ANCHOR_NAMES)[number], [number, number, number]>> {
  const src = cache.get(id);
  const out: Partial<Record<(typeof ANCHOR_NAMES)[number], [number, number, number]>> = {};
  if (!src) return out;
  src.updateMatrixWorld(true);
  src.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) return;
    const n = o.name.replace(/\.\d{3}$/, '');
    const a = ANCHOR_NAMES.find((k) => n === k || n.endsWith(`_${k}`));
    if (a) { const p = o.getWorldPosition(new THREE.Vector3()); out[a] = [p.x, p.y, p.z].map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number]; }
  });
  return out;
}

/** load (or replace) one model in the cache — the editor, after importing a GLB */
export async function loadGlb(id: string, url: string): Promise<void> {
  const gltf = await new GLTFLoader().loadAsync(url);
  cache.set(id, bake(gltf.scene));
}
/** forget a model (the editor unlinked it): the procedural mesh is used again */
export function dropGlb(id: string) { cache.delete(id); }

/** Per-bone meshes from a pipeline GLB (bone '' = unboned body), or null. */
export function glbBones(id: string): Map<string, THREE.Mesh> | null {
  const src = cache.get(id);
  if (!src) return null;
  const out = new Map<string, THREE.Mesh>();
  const glows: THREE.Mesh[] = [];
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mesh = new THREE.Mesh(m.geometry, m.material);
    const hasColor = !!m.geometry.getAttribute('color');
    const name = partName(m.name);
    const glow = name.endsWith('_glow');
    if (glow) mesh.material = new THREE.MeshBasicMaterial({ vertexColors: hasColor, color: hasColor ? 0xffffff : (m.material as THREE.MeshStandardMaterial).color, toneMapped: false });
    else if (hasColor) mesh.material = vcMaterial();
    else {
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.flatShading = true;
      mesh.material = patchInterior(mat);
    }
    mesh.castShadow = !glow;
    mesh.receiveShadow = !glow;
    const bone = name.replace(/_glow$/, '').replace(/^body$/, '');
    mesh.name = glow ? `${bone}_glow` : bone || id;
    if (glow) glows.push(mesh);
    else out.set(bone, mesh);
  });
  for (const g of glows) {
    const host = out.get(g.name.replace(/_glow$/, ''));
    if (host) host.add(g);
    else out.set(g.name, g);
  }
  return out.size ? out : null;
}
