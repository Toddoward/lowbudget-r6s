import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { patchInterior, vcMaterial } from '../render/palette.ts';

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
    const entries = Object.entries(manifest.assets).filter(([, a]) => categories.includes(a.category));
    glbStats.available = entries.length;
    const loader = new GLTFLoader();
    await Promise.all(entries.map(async ([id, a]) => {
      try {
        const gltf = await loader.loadAsync(`${base}${a.file}`);
        cache.set(id, gltf.scene);
      } catch (err) {
        console.warn(`[assets] ${a.file} failed, using procedural mesh`, err);
      }
    }));
    glbStats = { loaded: cache.size, available: entries.length, source: cache.size ? 'cli-anything-blender' : 'procedural' };
  } catch {
    /* offline / no manifest → procedural */
  }
}

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
    const glow = m.name.endsWith('_glow');
    if (glow) mesh.material = new THREE.MeshBasicMaterial({ vertexColors: hasColor, color: hasColor ? 0xffffff : (m.material as THREE.MeshStandardMaterial).color, toneMapped: false });
    else if (hasColor) mesh.material = vcMaterial();
    else {
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.flatShading = true;
      mesh.material = patchInterior(mat);
    }
    mesh.castShadow = !glow;
    mesh.receiveShadow = !glow;
    const bone = m.name.replace(/_glow$/, '').replace(/^body$/, '');
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
