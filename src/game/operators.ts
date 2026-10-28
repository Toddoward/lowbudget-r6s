import type { OperatorId } from '../../shared/constants.ts';

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

export const OPERATORS: Record<string, OperatorDef> = {
  sledge: { id: 'sledge', name: 'Sledge', team: 'attack', unit: 'SAS', armor: 2, speed: 2, primary: 'l85a2', secondary: 'p226', gadget: 'hammer', gadgetName: 'Tactical Breaching Hammer', gadgetCount: 25, universal: 'breach', universalCount: 2, roles: ['breacher'], descKo: '근거리에서 망치로 소프트월·바닥·해치·바리케이드를 부숩니다. 설치 시간이 없습니다.', desc: 'Smashes soft walls, floors, hatches and barricades from up close. Silent-ish, no setup.', headgear: 'balaclava', cloth: '#5d6046', accent: '#3b3d2e' },
  ash: { id: 'ash', name: 'Ash', team: 'attack', unit: 'FBI SWAT', armor: 1, speed: 3, primary: 'r4c', secondary: 'usg57', gadget: 'ash_round', gadgetName: 'M120 CREM Breaching Round', gadgetCount: 2, universal: 'breach', universalCount: 2, roles: ['breacher', 'fragger'], descKo: '원격 브리칭탄을 쏴서 1.5초 후 터뜨립니다. 멀리서 소프트월·바리케이드·해치를 엽니다.', desc: 'Launches remote breaching rounds that stick and detonate after 1.5 s — opens soft walls, barricades and hatches at range.', headgear: 'cap', cloth: '#5b5a4a', accent: '#8a6b47' },
  thermite: { id: 'thermite', name: 'Thermite', team: 'attack', unit: 'FBI SWAT', armor: 2, speed: 2, primary: '556xi', secondary: 'usg57', gadget: 'thermite', gadgetName: 'Exothermic Charge', gadgetCount: 2, universal: 'breach', universalCount: 1, roles: ['hardBreacher'], descKo: '강화벽과 강화 해치를 뚫는 유일한 방법입니다 (밴딧 전기가 흐르면 불가).', desc: 'The only way through REINFORCED walls and hatches (unless Bandit electrifies them).', headgear: 'helmet_goggles', cloth: '#56584b', accent: '#2d2f2a' },
  thatcher: { id: 'thatcher', name: 'Thatcher', team: 'attack', unit: 'SAS', armor: 2, speed: 2, primary: 'l85a2_noglow', secondary: 'p226', gadget: 'emp', gadgetName: 'EG Mk0-EMP Grenade', gadgetCount: 3, universal: 'breach', universalCount: 2, roles: ['support', 'antiGadget'], descKo: 'EMP로 5 m 안 전자장비(교란기·배터리·ADS·펄스 센서)를 무력화합니다.', desc: 'EMP disables electronics in 5 m for 12 s: Mute jammers, Bandit batteries, Jäger ADS, Pulse sensors.', headgear: 'gasmask_beanie', cloth: '#5f5b47', accent: '#40402f' },
  fuze: { id: 'fuze', name: 'Fuze', team: 'attack', unit: 'Spetsnaz', armor: 3, speed: 1, primary: 'ak12', secondary: 'pmm', gadget: 'cluster', gadgetName: 'APM-6 Cluster Charge', gadgetCount: 3, universal: 'breach', universalCount: 1, roles: ['fragger', 'support'], descKo: '소프트월·바닥에 붙이면 뒤쪽 방으로 수류탄 5발을 쏩니다. 인질도 죽을 수 있습니다!', desc: 'Plant on a soft wall/floor: fires 5 grenades into the room behind. WARNING: kills hostages too.', headgear: 'altyn', cloth: '#4f5546', accent: '#2e3329' },
  smoke: { id: 'smoke', name: 'Smoke', team: 'defend', unit: 'SAS', armor: 2, speed: 2, primary: 'fmg9', secondary: 'p226', gadget: 'gas', gadgetName: 'Remote Gas Grenade', gadgetCount: 3, universal: 'barricade', universalCount: 99, roles: ['support', 'anchor'], descKo: '던진 뒤 [G]로 원격 기폭: 3 m, 10초 독가스로 진입·설치를 막습니다.', desc: 'Throw, then detonate remotely [G]: toxic cloud (r 3 m, 10 s) that denies plants and pushes.', headgear: 'gasmask_hood', cloth: '#2f3640', accent: '#4b5260' },
  mute: { id: 'mute', name: 'Mute', team: 'defend', unit: 'SAS', armor: 2, speed: 2, primary: 'mp5k', secondary: 'p226', gadget: 'jammer', gadgetName: 'GC90 Signal Disruptor', gadgetCount: 4, universal: 'barricade', universalCount: 99, roles: ['antiGadget'], descKo: '2.5 m 안 드론·브리칭 차지·원격 가젯을 교란합니다.', desc: 'Jams drones, breach charges and remote gadgets within 2.5 m.', headgear: 'mask_comms', cloth: '#2b323b', accent: '#1e2228' },
  castle: { id: 'castle', name: 'Castle', team: 'defend', unit: 'FBI SWAT', armor: 3, speed: 1, primary: 'ump45', secondary: 'usg57', gadget: 'castle', gadgetName: 'Armor Panel', gadgetCount: 3, universal: 'barricade', universalCount: 99, roles: ['anchor', 'support'], descKo: '문·창문에 방탄 바리케이드를 칩니다. 근접 8회 또는 폭발물로만 부서집니다.', desc: 'Bullet-proof barricades on doors/windows. Melee 8× or explosives to break.', headgear: 'castle_helmet', cloth: '#2c3540', accent: '#1f262f' },
  pulse: { id: 'pulse', name: 'Pulse', team: 'defend', unit: 'FBI SWAT', armor: 2, speed: 2, primary: 'ump45', secondary: 'usg57', gadget: 'heartbeat', gadgetName: 'Cardiac Sensor', gadgetCount: 1, universal: 'barricade', universalCount: 99, roles: ['intel', 'flank'], descKo: '[G]로 센서를 들고 좌클릭 유지: 9 m 안 심장 박동을 벽·바닥 너머로 감지합니다.', desc: 'Hold [3]: detects heartbeats through walls & floors within 9 m.', headgear: 'cap_headset', cloth: '#323a44', accent: '#58616d' },
  jager: { id: 'jager', name: 'Jäger', team: 'defend', unit: 'GSG 9', armor: 2, speed: 2, primary: '416c', secondary: 'p12', gadget: 'ads', gadgetName: 'ADS-MK IV "Magpie"', gadgetCount: 3, universal: 'barricade', universalCount: 99, roles: ['antiGadget'], descKo: 'ADS: 던지거나 쏜 투사체(수류탄·애쉬탄·집속탄)를 2개씩 요격합니다.', desc: 'Active Defense System: shoots down 2 thrown/launched projectiles each (grenades, Ash rounds, cluster bomblets).', headgear: 'helmet_headset', cloth: '#30363c', accent: '#4a4f45' },
  bandit: { id: 'bandit', name: 'Bandit', team: 'defend', unit: 'GSG 9', armor: 1, speed: 3, primary: 'mp7', secondary: 'p12', gadget: 'battery', gadgetName: 'CED-1 Shock Wire', gadgetCount: 4, universal: 'barricade', universalCount: 99, roles: ['antiGadget', 'flank'], descKo: '강화벽·바리케이드에 전기를 흘려 써마이트 폭약과 가젯을 파괴하고 근접을 감전시킵니다.', desc: 'Electrifies reinforced walls / barricades: destroys Thermite charges & gadgets, shocks melee.', headgear: 'beanie_goggles', cloth: '#2e3338', accent: '#3d3a34' },
  montagne: { id: 'montagne', name: 'Montagne', team: 'attack', unit: 'GIGN', armor: 3, speed: 1, primary: 'p9', secondary: 'p9', gadget: 'shield_ext', gadgetName: 'Le Roc Extendable Shield', gadgetCount: 1, universal: 'breach', universalCount: 1, shield: true, roles: ['shield', 'support'], desc: 'Ballistic shield + pistol (always in hand). [1] slings the shield on the back / raises it; RMB swings it aside to aim past its edge; [G] extends it over the whole body (no shooting while extended).', descKo: '방패 + 권총(항상 손에). [1]로 방패를 등에 메거나 앞으로 들고, 우클릭은 방패를 옆으로 돌려 가장자리로 조준합니다. [G]로 방패를 펼치면 전신을 가리지만 사격할 수 없습니다.', headgear: 'montagne_helmet', cloth: '#3a4250', accent: '#20252c' },
  blitz: { id: 'blitz', name: 'Blitz', team: 'attack', unit: 'GSG 9', armor: 2, speed: 2, primary: 'p12', secondary: 'p12', gadget: 'flash_shield', gadgetName: 'G52-Tactical Flash Shield', gadgetCount: 5, universal: 'breach', universalCount: 1, shield: true, roles: ['shield', 'fragger'], desc: 'Flash shield + pistol (always in hand). [1] slings the shield on the back / raises it; RMB swings it aside to aim; [G] blinds every enemy in a 60° cone up to 6 m (5 charges, shield in front).', descKo: '플래시 방패 + 권총(항상 손에). [1]로 방패를 등에 메거나 앞으로 들고, 우클릭은 방패를 옆으로 돌려 조준합니다. [G]로 전방 60°, 6 m 안의 적을 눈부시게 합니다 (5회, 방패를 앞에 들었을 때).', headgear: 'helmet_goggles', cloth: '#45483e', accent: '#2b2d27' },
  iq: { id: 'iq', name: 'IQ', team: 'attack', unit: 'GSG 9', armor: 1, speed: 3, primary: 'aug_a2', secondary: 'p12', gadget: 'scanner', gadgetName: 'RED Mk III Spectre', gadgetCount: 1, universal: 'breach', universalCount: 2, roles: ['intel', 'antiGadget'], desc: '[G] equip the detector, hold LMB: marks enemy electronics (jammers, batteries, ADS, EDDs, cameras, bombs) through walls within 20 m.', descKo: '[G]로 탐지기를 들고 좌클릭 유지: 20 m 안 적 전자장비(교란기·배터리·ADS·EDD·카메라·폭탄)를 벽 너머로 표시합니다.', headgear: 'cap_headset', cloth: '#4a4d42', accent: '#2d2f29' },
  kapkan: { id: 'kapkan', name: 'Kapkan', team: 'defend', unit: 'Spetsnaz', armor: 2, speed: 2, primary: 'vsn9', secondary: 'pmm', gadget: 'edd', gadgetName: 'Entry Denial Device', gadgetCount: 3, universal: 'barricade', universalCount: 99, roles: ['trapper'], desc: 'Hold [G] at a door or window frame: a laser tripwire that explodes on the first attacker through.', descKo: '문·창틀을 보고 [G] 길게: 처음 지나가는 공격자에게 터지는 레이저 트랩을 설치합니다.', headgear: 'ushanka', cloth: '#3b3f35', accent: '#262920' },
  tachanka: { id: 'tachanka', name: 'Tachanka', team: 'defend', unit: 'Spetsnaz', armor: 3, speed: 1, primary: 'vsn9', secondary: 'pmm', gadget: 'turret', gadgetName: 'RP-46 Mounted LMG', gadgetCount: 1, universal: 'barricade', universalCount: 99, roles: ['anchor'], desc: 'Hold [G] to set up a shielded LMG, then [F] behind it to mount. Hard-hitting, slow to turn.', descKo: '[G] 길게: 방패 달린 기관총을 설치하고 뒤에서 [F]로 거치합니다. 위력은 강하지만 회전이 느립니다.', headgear: 'tachanka_helmet', cloth: '#3a4134', accent: '#22261f' },
  terrorist: { id: 'terrorist', name: 'White Masks', team: 'terrorist', unit: 'White Masks', armor: 2, speed: 2, primary: 'ak47t', secondary: 'p226', gadget: 'none', gadgetName: '—', gadgetCount: 0, universal: 'none', universalCount: 0, desc: 'Terrorist Hunt hostile.', headgear: 'whitemask', cloth: '#6e6150', accent: '#3d3830' },
  hostage: { id: 'hostage', name: 'Hostage', team: 'hostage', unit: 'Civilian', armor: 1, speed: 1, primary: 'p226', secondary: 'p226', gadget: 'none', gadgetName: '—', gadgetCount: 0, universal: 'none', universalCount: 0, desc: 'Keep alive. Escort to the extraction zone.', headgear: 'civilian', cloth: '#6a7f96', accent: '#3d3d3d' },
  recruit: { id: 'recruit', name: 'Recruit', team: 'attack', unit: 'Recruit', armor: 2, speed: 2, primary: 'r4c', secondary: 'p226', gadget: 'none', gadgetName: '—', gadgetCount: 0, universal: 'breach', universalCount: 2, desc: 'Generic.', headgear: 'helmet_goggles', cloth: '#5a5a50', accent: '#333' },
};

export const ARMOR_MUL = { 1: 1.0, 2: 0.9, 3: 0.8 } as const;
export const SPEED_MUL = { 1: 0.9, 2: 1.0, 3: 1.1 } as const;
export const MAX_HP = 100;
export const REINFORCEMENTS_PER_ROUND = 2;
