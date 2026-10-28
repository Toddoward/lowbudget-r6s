import type { OperatorId } from '../../shared/constants.ts';
import { dataDir } from '../data/index.ts';

export type GadgetId =
  | 'hammer' | 'ash_round' | 'thermite' | 'emp' | 'cluster' | 'scanner' | 'shield_ext' | 'flash_shield'
  | 'gas' | 'jammer' | 'castle' | 'heartbeat' | 'ads' | 'battery' | 'edd' | 'turret' | 'none';
export type Role = 'breacher' | 'hardBreacher' | 'support' | 'intel' | 'fragger' | 'anchor' | 'trapper' | 'antiGadget' | 'shield' | 'flank';
export type UniversalId = 'breach' | 'barricade' | 'none';

export interface OperatorDef {
  id: OperatorId;
  name: string;
  team: 'attack' | 'defend' | 'terrorist' | 'hostage';
  unit: string;
  armor: 1 | 2 | 3;
  speed: 1 | 2 | 3;
  primary: string;
  secondary: string;
  gadget: GadgetId;
  gadgetName: string;
  gadgetCount: number;
  universal: UniversalId;
  universalCount: number;
  desc: string;
  /** Korean description */
  descKo?: string;
  /** squad role(s) — menus group & explain operators by role */
  roles?: Role[];
  /** carries a ballistic shield in the left hand (Montagne, Blitz) */
  shield?: boolean;
  headgear: string;
  cloth: string;
  accent: string;
}

/** data/operators/<id>.json */
interface OperatorData {
  id: OperatorId; name: string; team: OperatorDef['team']; unit: string; roles?: Role[];
  armor: OperatorDef['armor']; speed: OperatorDef['speed'];
  loadout: Pick<OperatorDef, 'primary' | 'secondary' | 'gadget' | 'gadgetName' | 'gadgetCount' | 'universal' | 'universalCount' | 'shield'>;
  description: { en: string; ko?: string };
  look: Pick<OperatorDef, 'headgear' | 'cloth' | 'accent'>;
  model: { glb?: string };
}
const fromData = (d: OperatorData): OperatorDef => ({
  id: d.id, name: d.name, team: d.team, unit: d.unit, armor: d.armor, speed: d.speed,
  ...d.loadout,
  desc: d.description.en, ...(d.description.ko ? { descKo: d.description.ko } : {}),
  ...(d.roles ? { roles: d.roles } : {}),
  ...d.look,
});
/** every operator, from data/operators/*.json (menu order = `order`) */
export const OPERATORS: Record<string, OperatorDef> = {};
/** (re)build OPERATORS from the data, in place (the editor calls this after an edit) */
export function reloadOperators() {
  const fresh = dataDir<OperatorData>('operators');
  for (const id of Object.keys(OPERATORS)) if (!(id in fresh)) delete OPERATORS[id];
  for (const [id, d] of Object.entries(fresh)) OPERATORS[id] = Object.assign(OPERATORS[id] ?? {}, fromData(d));
}
reloadOperators();

export const ARMOR_MUL = { 1: 1.0, 2: 0.9, 3: 0.8 } as const;
export const SPEED_MUL = { 1: 0.9, 2: 1.0, 3: 1.1 } as const;
export const MAX_HP = 100;
export const REINFORCEMENTS_PER_ROUND = 2;
