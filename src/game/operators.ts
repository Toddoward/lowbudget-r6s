import type { OperatorId } from '../../shared/constants.ts';

export type GadgetId =
  | 'hammer' | 'ash_round' | 'thermite' | 'emp' | 'cluster'
  | 'gas' | 'jammer' | 'castle' | 'heartbeat' | 'ads' | 'battery' | 'none';
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
  headgear: string;
  cloth: string;
  accent: string;
}

export const OPERATORS: Record<string, OperatorDef> = {
  sledge: { id: 'sledge', name: 'Sledge', team: 'attack', unit: 'SAS', armor: 2, speed: 2, primary: 'l85a2', secondary: 'p226', gadget: 'hammer', gadgetName: 'Tactical Breaching Hammer', gadgetCount: 25, universal: 'breach', universalCount: 2, desc: 'Smashes soft walls, floors, hatches and barricades from up close. Silent-ish, no setup.', headgear: 'balaclava', cloth: '#5d6046', accent: '#3b3d2e' },
  ash: { id: 'ash', name: 'Ash', team: 'attack', unit: 'FBI SWAT', armor: 1, speed: 3, primary: 'r4c', secondary: 'usg57', gadget: 'ash_round', gadgetName: 'M120 CREM Breaching Round', gadgetCount: 2, universal: 'breach', universalCount: 2, desc: 'Launches remote breaching rounds that stick and detonate after 1.5 s — opens soft walls, barricades and hatches at range.', headgear: 'cap', cloth: '#5b5a4a', accent: '#8a6b47' },
  thermite: { id: 'thermite', name: 'Thermite', team: 'attack', unit: 'FBI SWAT', armor: 2, speed: 2, primary: '556xi', secondary: 'usg57', gadget: 'thermite', gadgetName: 'Exothermic Charge', gadgetCount: 2, universal: 'breach', universalCount: 1, desc: 'The only way through REINFORCED walls and hatches (unless Bandit electrifies them).', headgear: 'helmet_goggles', cloth: '#56584b', accent: '#2d2f2a' },
  thatcher: { id: 'thatcher', name: 'Thatcher', team: 'attack', unit: 'SAS', armor: 2, speed: 2, primary: 'ar33', secondary: 'p226', gadget: 'emp', gadgetName: 'EG Mk0-EMP Grenade', gadgetCount: 3, universal: 'breach', universalCount: 2, desc: 'EMP disables electronics in 5 m for 12 s: Mute jammers, Bandit batteries, Jäger ADS, Pulse sensors.', headgear: 'gasmask_beanie', cloth: '#5f5b47', accent: '#40402f' },
  fuze: { id: 'fuze', name: 'Fuze', team: 'attack', unit: 'Spetsnaz', armor: 3, speed: 1, primary: 'ak12', secondary: 'pmm', gadget: 'cluster', gadgetName: 'APM-6 Cluster Charge', gadgetCount: 3, universal: 'breach', universalCount: 1, desc: 'Plant on a soft wall/floor: fires 5 grenades into the room behind. WARNING: kills hostages too.', headgear: 'altyn', cloth: '#4f5546', accent: '#2e3329' },
  smoke: { id: 'smoke', name: 'Smoke', team: 'defend', unit: 'SAS', armor: 2, speed: 2, primary: 'fmg9', secondary: 'p226', gadget: 'gas', gadgetName: 'Remote Gas Grenade', gadgetCount: 3, universal: 'barricade', universalCount: 99, desc: 'Throw, then detonate remotely [G]: toxic cloud (r 3 m, 10 s) that denies plants and pushes.', headgear: 'gasmask_hood', cloth: '#2f3640', accent: '#4b5260' },
  mute: { id: 'mute', name: 'Mute', team: 'defend', unit: 'SAS', armor: 2, speed: 2, primary: 'mp5k', secondary: 'p226', gadget: 'jammer', gadgetName: 'GC90 Signal Disruptor', gadgetCount: 4, universal: 'barricade', universalCount: 99, desc: 'Jams drones, breach charges and remote gadgets within 2.5 m.', headgear: 'mask_comms', cloth: '#2b323b', accent: '#1e2228' },
  castle: { id: 'castle', name: 'Castle', team: 'defend', unit: 'FBI SWAT', armor: 3, speed: 1, primary: 'ump45', secondary: 'usg57', gadget: 'castle', gadgetName: 'Armor Panel', gadgetCount: 3, universal: 'barricade', universalCount: 99, desc: 'Bullet-proof barricades on doors/windows. Melee 8× or explosives to break.', headgear: 'castle_helmet', cloth: '#2c3540', accent: '#1f262f' },
  pulse: { id: 'pulse', name: 'Pulse', team: 'defend', unit: 'FBI SWAT', armor: 2, speed: 2, primary: 'ump45', secondary: 'usg57', gadget: 'heartbeat', gadgetName: 'Cardiac Sensor', gadgetCount: 1, universal: 'barricade', universalCount: 99, desc: 'Hold [3]: detects heartbeats through walls & floors within 9 m.', headgear: 'cap_headset', cloth: '#323a44', accent: '#58616d' },
  jager: { id: 'jager', name: 'Jäger', team: 'defend', unit: 'GSG 9', armor: 2, speed: 2, primary: '416c', secondary: 'p12', gadget: 'ads', gadgetName: 'ADS-MK IV "Magpie"', gadgetCount: 3, universal: 'barricade', universalCount: 99, desc: 'Active Defense System: shoots down 2 thrown/launched projectiles each (grenades, Ash rounds, cluster bomblets).', headgear: 'helmet_headset', cloth: '#30363c', accent: '#4a4f45' },
  bandit: { id: 'bandit', name: 'Bandit', team: 'defend', unit: 'GSG 9', armor: 1, speed: 3, primary: 'mp7', secondary: 'p12', gadget: 'battery', gadgetName: 'CED-1 Shock Wire', gadgetCount: 4, universal: 'barricade', universalCount: 99, desc: 'Electrifies reinforced walls / barricades: destroys Thermite charges & gadgets, shocks melee.', headgear: 'beanie_goggles', cloth: '#2e3338', accent: '#3d3a34' },
  terrorist: { id: 'terrorist', name: 'White Masks', team: 'terrorist', unit: 'White Masks', armor: 2, speed: 2, primary: 'ak47t', secondary: 'p226', gadget: 'none', gadgetName: '—', gadgetCount: 0, universal: 'none', universalCount: 0, desc: 'Terrorist Hunt hostile.', headgear: 'whitemask', cloth: '#6e6150', accent: '#3d3830' },
  hostage: { id: 'hostage', name: 'Hostage', team: 'hostage', unit: 'Civilian', armor: 1, speed: 1, primary: 'p226', secondary: 'p226', gadget: 'none', gadgetName: '—', gadgetCount: 0, universal: 'none', universalCount: 0, desc: 'Keep alive. Escort to the extraction zone.', headgear: 'civilian', cloth: '#6a7f96', accent: '#3d3d3d' },
  recruit: { id: 'recruit', name: 'Recruit', team: 'attack', unit: 'Recruit', armor: 2, speed: 2, primary: 'r4c', secondary: 'p226', gadget: 'none', gadgetName: '—', gadgetCount: 0, universal: 'breach', universalCount: 2, desc: 'Generic.', headgear: 'helmet_goggles', cloth: '#5a5a50', accent: '#333' },
};

export const ARMOR_MUL = { 1: 1.0, 2: 0.9, 3: 0.8 } as const;
export const SPEED_MUL = { 1: 0.9, 2: 1.0, 3: 1.1 } as const;
export const MAX_HP = 100;
export const REINFORCEMENTS_PER_ROUND = 2;
