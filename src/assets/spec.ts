/**
 * Shared low-poly asset description.
 *
 * The SAME spec drives (a) the in-browser procedural builder (`build.ts`) and
 * (b) the CLI-Anything → Blender pipeline (tools/cli-anything) which turns
 * each spec into `cli-anything-blender object add …` commands, bakes it in
 * Blender and exports GLB to public/assets/models/. At runtime a GLB (if
 * present in the manifest) replaces the procedural mesh with identical
 * proportions, so the game works with or without the Blender step.
 *
 * Coordinates are Three.js Y-up metres; weapons point down -Z.
 */
export type Shape = 'box' | 'cyl' | 'cone' | 'sphere' | 'wedge';
export interface PartSpec {
  shape: Shape;
  /** centre */
  p: [number, number, number];
  /** box: size xyz ; cyl/cone: [radius, height, radius] ; sphere: [r, r, r] */
  s: [number, number, number];
  /** Euler XYZ in degrees */
  r?: [number, number, number];
  c: string;
  seg?: number;
  /** bone / sub-node (operator rigs: head torso hips legL legR armL armR ; weapons: body mag) */
  bone?: string;
  emissive?: boolean;
}
export interface AssetSpec {
  id: string;
  category: 'weapon' | 'operator' | 'prop' | 'gadget' | 'vehicle' | 'module';
  parts: PartSpec[];
  /** named points (muzzle, sight, grip …) */
  anchors?: Record<string, [number, number, number]>;
}

export const box = (p: [number, number, number], s: [number, number, number], c: string, extra: Partial<PartSpec> = {}): PartSpec => ({ shape: 'box', p, s, c, ...extra });
export const cyl = (p: [number, number, number], radius: number, h: number, c: string, extra: Partial<PartSpec> = {}): PartSpec => ({ shape: 'cyl', p, s: [radius, h, radius], c, seg: 8, ...extra });
export const cone = (p: [number, number, number], radius: number, h: number, c: string, extra: Partial<PartSpec> = {}): PartSpec => ({ shape: 'cone', p, s: [radius, h, radius], c, seg: 8, ...extra });
export const sph = (p: [number, number, number], r: number, c: string, extra: Partial<PartSpec> = {}): PartSpec => ({ shape: 'sphere', p, s: [r, r, r], c, seg: 8, ...extra });
/** cylinder lying along Z (barrels) */
export const barrel = (p: [number, number, number], radius: number, len: number, c: string, extra: Partial<PartSpec> = {}): PartSpec => ({ shape: 'cyl', p, s: [radius, len, radius], r: [90, 0, 0], c, seg: 8, ...extra });
