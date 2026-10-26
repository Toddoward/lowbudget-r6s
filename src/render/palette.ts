import * as THREE from 'three';

/**
 * Tactical low-poly palette. Destruction tiers are colour-coded the way the
 * brief asks (soft = red family, semi = yellow family, solid = white family)
 * but kept muted so the E3-2014 chiaroscuro lighting carries the mood.
 * Press [T] in-game for the saturated "tier X-ray" overlay.
 */
export const PAL = {
  softWall: new THREE.Color('#9e675d'),
  softCore: new THREE.Color('#e6dccb'),
  semiWall: new THREE.Color('#bb9b60'),
  semiCore: new THREE.Color('#8a6a3c'),
  stud: new THREE.Color('#6d5232'),
  solidWall: new THREE.Color('#e4e0d6'),
  solidExt: new THREE.Color('#d7d2c6'),
  concrete: new THREE.Color('#8f8c86'),
  concreteDark: new THREE.Color('#5d5b57'),
  woodFloor: new THREE.Color('#a77d4c'),
  woodDark: new THREE.Color('#5e4128'),
  roof: new THREE.Color('#4a4a4f'),
  hatch: new THREE.Color('#9a6b3d'),
  reinforced: new THREE.Color('#6f747a'),
  barricade: new THREE.Color('#b08a55'),
  castle: new THREE.Color('#3d4a3c'),
  shutter: new THREE.Color('#8c9196'),
  grass: new THREE.Color('#5d6b3e'),
  dirt: new THREE.Color('#7b6a52'),
  asphalt: new THREE.Color('#3a3b3e'),
  sidewalk: new THREE.Color('#9a978f'),
  water: new THREE.Color('#2f4a55'),
  metal: new THREE.Color('#5b6067'),
  darkMetal: new THREE.Color('#2b2e33'),
  glass: new THREE.Color('#9fc3d0'),
  attackerCloth: new THREE.Color('#6b6a4b'),
  defenderCloth: new THREE.Color('#2f3742'),
  terroristCloth: new THREE.Color('#7a6650'),
};

export const TIER_XRAY = {
  soft: new THREE.Color('#ff3b2f'),
  semi: new THREE.Color('#ffd23a'),
  solid: new THREE.Color('#ffffff'),
};

const matCache = new Map<string, THREE.Material>();

/**
 * Interior exposure: indirect (ambient/hemisphere) light is attenuated inside
 * the House volume so rooms read dark against the bright exterior — the
 * E3 2014 "dark interior, hard sun shafts through windows" look. Direct
 * sun/moon light still enters through windows and breach holes via the
 * shadow map, so a fresh hole literally lets light in.
 */
export const INTERIOR = { uInteriorAmb: { value: 0.32 } };
export function patchInterior<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uInteriorAmb = INTERIOR.uInteriorAmb;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef USE_INSTANCING\nvWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uInteriorAmb;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          vec3 dIn = min(vWPos - vec3(-8.0, -3.1, -7.0), vec3(8.0, 5.85, 7.0) - vWPos);
          float inside = smoothstep(0.0, 0.3, min(min(dIn.x, dIn.y), dIn.z));
          reflectedLight.indirectDiffuse *= mix(1.0, uInteriorAmb, inside);
          reflectedLight.indirectSpecular *= mix(1.0, uInteriorAmb, inside);
        }`);
  };
  m.customProgramCacheKey = () => 'interior-v1';
  return m;
}

/** Shared flat-shaded vertex-colour material (one per flag set) — keeps draw state tiny. */
export function vcMaterial(opts: { emissive?: boolean; transparent?: boolean; side?: THREE.Side; metal?: number; rough?: number } = {}): THREE.MeshStandardMaterial {
  const key = JSON.stringify(opts);
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: opts.rough ?? 0.86,
      metalness: opts.metal ?? 0.02,
      transparent: !!opts.transparent,
      opacity: opts.transparent ? 0.45 : 1,
      side: opts.side ?? THREE.FrontSide,
    });
    if (opts.emissive) {
      m.emissive = new THREE.Color('#ffffff');
      m.emissiveIntensity = 0;
    }
    patchInterior(m);
    matCache.set(key, m);
  }
  return m;
}

export function colorMat(color: THREE.ColorRepresentation, opts: { rough?: number; metal?: number; emissive?: THREE.ColorRepresentation; emissiveIntensity?: number; transparent?: number } = {}) {
  const key = `c:${new THREE.Color(color).getHexString()}:${JSON.stringify(opts)}`;
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: opts.rough ?? 0.8,
      metalness: opts.metal ?? 0.05,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : undefined,
      emissiveIntensity: opts.emissiveIntensity ?? (opts.emissive ? 1 : 0),
      transparent: opts.transparent !== undefined,
      opacity: opts.transparent ?? 1,
      depthWrite: opts.transparent === undefined,
    });
    patchInterior(m);
    matCache.set(key, m);
  }
  return m;
}
