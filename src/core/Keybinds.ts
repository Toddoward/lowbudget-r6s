import { getLang, t } from '../ui/i18n.ts';

/**
 * Rebindable controls. Everything sits within reach of WASD and nothing uses
 * Ctrl/Alt/Meta (the one-shot bound crouch to Ctrl, so Ctrl+W/T/N fired
 * browser shortcuts mid-match). Mouse buttons are bindable as Mouse0..Mouse4.
 */
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'crouch' | 'prone' | 'leanL' | 'leanR' | 'vault'
  | 'fire' | 'ads' | 'reload' | 'melee' | 'primary' | 'secondary'
  | 'interact' | 'gadget' | 'gadget2' | 'observe' | 'ping' | 'flashlight'
  | 'score' | 'help' | 'xray' | 'overlay';

export interface ActionDef { id: Action; group: 'move' | 'combat' | 'gear' | 'ui'; qa?: boolean }
export const ACTIONS: ActionDef[] = [
  { id: 'forward', group: 'move' }, { id: 'back', group: 'move' }, { id: 'left', group: 'move' }, { id: 'right', group: 'move' },
  { id: 'sprint', group: 'move' }, { id: 'crouch', group: 'move' }, { id: 'prone', group: 'move' },
  { id: 'leanL', group: 'move' }, { id: 'leanR', group: 'move' }, { id: 'vault', group: 'move' },
  { id: 'fire', group: 'combat' }, { id: 'ads', group: 'combat' }, { id: 'reload', group: 'combat' }, { id: 'melee', group: 'combat' },
  { id: 'primary', group: 'combat' }, { id: 'secondary', group: 'combat' },
  { id: 'interact', group: 'gear' }, { id: 'gadget', group: 'gear' }, { id: 'gadget2', group: 'gear' },
  { id: 'observe', group: 'gear' }, { id: 'ping', group: 'gear' }, { id: 'flashlight', group: 'gear' },
  { id: 'score', group: 'ui' }, { id: 'help', group: 'ui' },
  { id: 'xray', group: 'ui', qa: true }, { id: 'overlay', group: 'ui', qa: true },
];

export type Binding = [string | null, string | null];
export const DEFAULT_BINDS: Record<Action, Binding> = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', null], crouch: ['KeyC', null], prone: ['KeyZ', null],
  leanL: ['KeyQ', null], leanR: ['KeyE', null], vault: ['Space', null],
  fire: ['Mouse0', null], ads: ['Mouse2', null], reload: ['KeyR', null], melee: ['KeyV', null],
  primary: ['Digit1', null], secondary: ['Digit2', null],
  interact: ['KeyF', null], gadget: ['KeyG', null], gadget2: ['KeyX', null],
  observe: ['Digit3', null], ping: ['KeyB', 'Mouse1'], flashlight: ['KeyT', null],
  score: ['Tab', null], help: ['F1', null], xray: ['KeyK', null], overlay: ['KeyO', null],
};

export type HoldMode = 'hold' | 'toggle';
export interface ControlPrefs { lean: HoldMode; crouch: HoldMode; ads: HoldMode }
const PREF_DEFAULTS: ControlPrefs = { lean: 'hold', crouch: 'toggle', ads: 'hold' };

const STORE = 'r6.binds.v2';
const STORE_PREFS = 'r6.controlPrefs';

export class Keybinds {
  binds: Record<Action, Binding>;
  prefs: ControlPrefs;
  private byCode = new Map<string, Action[]>();

  constructor() {
    this.binds = cloneBinds(DEFAULT_BINDS);
    this.prefs = { ...PREF_DEFAULTS };
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Record<Action, Binding>>;
        for (const a of ACTIONS) if (saved[a.id]) this.binds[a.id] = saved[a.id]!;
      }
      const rp = localStorage.getItem(STORE_PREFS);
      if (rp) this.prefs = { ...PREF_DEFAULTS, ...(JSON.parse(rp) as Partial<ControlPrefs>) };
    } catch { /* corrupted / blocked storage → defaults */ }
    this.index();
  }

  private index() {
    this.byCode.clear();
    for (const a of ACTIONS) for (const c of this.binds[a.id]) if (c) this.byCode.set(c, [...(this.byCode.get(c) ?? []), a.id]);
  }

  save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.binds));
      localStorage.setItem(STORE_PREFS, JSON.stringify(this.prefs));
    } catch { /* ignore */ }
  }

  actionsFor(code: string): Action[] { return this.byCode.get(code) ?? []; }
  isBound(code: string) { return this.byCode.has(code); }

  /** bind `code` to slot 0/1 of `action`; returns the action that lost it (conflict) */
  set(action: Action, slot: 0 | 1, code: string | null): Action | null {
    let lost: Action | null = null;
    if (code) {
      for (const a of ACTIONS) {
        if (a.id === action) continue;
        const b = this.binds[a.id];
        for (const i of [0, 1] as const) if (b[i] === code) { b[i] = null; lost = a.id; }
      }
    }
    const b: Binding = [...this.binds[action]] as Binding;
    b[slot] = code;
    if (b[slot] && b[1 - slot] === b[slot]) b[1 - slot] = null;
    this.binds[action] = b;
    this.index();
    this.save();
    return lost;
  }

  reset() {
    this.binds = cloneBinds(DEFAULT_BINDS);
    this.prefs = { ...PREF_DEFAULTS };
    this.index();
    this.save();
  }

  /** short key-cap label for HUD prompts ("F", "LMB", "Space") */
  cap(action: Action | string): string {
    const b = this.binds[action as Action];
    if (!b) return String(action);
    return codeLabel(b[0] ?? b[1]);
  }
}

function cloneBinds(b: Record<Action, Binding>): Record<Action, Binding> {
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, [...v] as Binding])) as Record<Action, Binding>;
}

export function codeLabel(code: string | null): string {
  if (!code) return t('key.none');
  const ko = getLang() === 'ko';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num${code.slice(6)}`;
  const mouse: Record<string, [string, string]> = {
    Mouse0: ['좌클릭', 'LMB'], Mouse1: ['휠 클릭', 'MMB'], Mouse2: ['우클릭', 'RMB'], Mouse3: ['마우스4', 'M4'], Mouse4: ['마우스5', 'M5'],
  };
  if (mouse[code]) return mouse[code][ko ? 0 : 1];
  const named: Record<string, [string, string]> = {
    Space: ['스페이스', 'Space'], ShiftLeft: ['Shift', 'Shift'], ShiftRight: ['R-Shift', 'R-Shift'], Tab: ['Tab', 'Tab'], CapsLock: ['Caps', 'Caps'],
    ArrowUp: ['↑', '↑'], ArrowDown: ['↓', '↓'], ArrowLeft: ['←', '←'], ArrowRight: ['→', '→'], Backquote: ['`', '`'], Enter: ['Enter', 'Enter'],
  };
  if (named[code]) return named[code][ko ? 0 : 1];
  return code;
}

/** keys we never let the page / browser act on while playing */
export const RESERVED_BROWSER_KEYS = new Set(['Tab', 'Space', 'F1', 'Quote', 'Slash', 'Backspace']);
