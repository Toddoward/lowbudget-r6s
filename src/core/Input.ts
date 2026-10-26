import { emptyInput, type SoldierInput } from '../game/Soldier.ts';
import { Stance } from '../game/types.ts';
import { Keybinds, RESERVED_BROWSER_KEYS, type Action } from './Keybinds.ts';

/** actions that are edge-triggered UI/game events rather than soldier input */
export type UiAction = 'observe' | 'flashlight' | 'help' | 'xray' | 'overlay' | 'ping';

/**
 * Keyboard + mouse (pointer lock) → SoldierInput through the rebindable keymap.
 *
 *  - crouch: tap = toggle crouch, hold ≥ 0.4 s = prone (or hold-to-crouch in "hold" mode)
 *  - lean / aim: hold or toggle (Settings → Controls)
 *  - while a match runs, every bound key has its browser default suppressed, and
 *    in fullscreen the Keyboard Lock API also captures Ctrl+W/T/N, Esc-long etc.
 */
export class Input {
  readonly binds = new Keybinds();
  /** physical codes currently down (keys + Mouse0..4) */
  keys = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  sensitivity = 0.0022;
  adsSensMul = 0.8;
  invertY = false;
  locked = false;
  /** a match is running: swallow browser defaults for bound keys */
  capturing = false;
  private wantStance: Stance = Stance.Stand;
  private crouchDownAt = -1;
  private leanToggle: -1 | 0 | 1 = 0;
  private adsToggled = false;
  enabled = true;
  onUiAction: (a: UiAction) => void = () => {};
  /** any key / click while the game wants the pointer: lets the UI re-acquire pointer lock on a real user gesture */
  onGesture: () => void = () => {};

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [data-capture-keys]')) return;
      const code = e.code;
      if (this.capturing && (this.binds.isBound(code) || RESERVED_BROWSER_KEYS.has(code))) e.preventDefault();
      if (this.capturing && (e.ctrlKey || e.metaKey) && ['KeyW', 'KeyT', 'KeyN', 'KeyR', 'KeyS', 'KeyP', 'KeyF', 'KeyD'].includes(code)) e.preventDefault();
      if (e.repeat) return;
      this.press(code);
      this.onGesture();
    });
    window.addEventListener('keyup', (e) => this.release(e.code));
    window.addEventListener('blur', () => { for (const c of [...this.keys]) this.release(c); });
    el.addEventListener('mousedown', (e) => {
      this.onGesture();
      if (!this.locked) return;
      e.preventDefault();
      this.press(`Mouse${e.button}`);
    });
    window.addEventListener('mouseup', (e) => this.release(`Mouse${e.button}`));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('auxclick', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => { if (this.locked) { this.wheel += Math.sign(e.deltaY); e.preventDefault(); } }, { passive: false });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) for (const c of [...this.keys]) if (c.startsWith('Mouse')) this.release(c);
    });
  }

  private press(code: string) {
    if (!this.keys.has(code)) this.pressed.add(code);
    this.keys.add(code);
    for (const a of this.binds.actionsFor(code)) {
      if (a === 'crouch') this.crouchDownAt = performance.now();
      if (a === 'observe' || a === 'flashlight' || a === 'help' || a === 'xray' || a === 'overlay' || a === 'ping') this.onUiAction(a);
    }
  }

  private release(code: string) {
    if (this.keys.has(code)) this.released.add(code);
    this.keys.delete(code);
  }

  lock() {
    if (this.locked) return;
    try {
      const r = this.el.requestPointerLock({ unadjustedMovement: true } as never) as unknown as Promise<void> | undefined;
      r?.catch?.(() => { try { (this.el.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* not allowed now */ } });
    } catch { /* not allowed in this context */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  /** fullscreen + Keyboard Lock (Chrome): browser shortcuts stop reaching the browser */
  async enterFullscreenLock() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
      const kb = (navigator as unknown as { keyboard?: { lock?: (keys?: string[]) => Promise<void> } }).keyboard;
      await kb?.lock?.();
    } catch { /* user declined / unsupported */ }
  }
  exitFullscreenLock() {
    const kb = (navigator as unknown as { keyboard?: { unlock?: () => void } }).keyboard;
    try { kb?.unlock?.(); } catch { /* ignore */ }
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }

  /** physical-code helpers (UI) */
  wasPressed(code: string) { return this.pressed.has(code); }
  down(a: Action): boolean { const b = this.binds.binds[a]; return (!!b[0] && this.keys.has(b[0])) || (!!b[1] && this.keys.has(b[1])); }
  hit(a: Action): boolean { const b = this.binds.binds[a]; return (!!b[0] && this.pressed.has(b[0])) || (!!b[1] && this.pressed.has(b[1])); }
  up(a: Action): boolean { const b = this.binds.binds[a]; return (!!b[0] && this.released.has(b[0])) || (!!b[1] && this.released.has(b[1])); }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  resetStance(s: Stance = Stance.Stand) { this.wantStance = s; this.leanToggle = 0; this.adsToggled = false; }

  /** build this frame's input; consumes edge-triggered presses */
  sample(rappelling: boolean): SoldierInput {
    const inp = emptyInput();
    if (!this.enabled) { this.flush(); return inp; }
    const P = this.binds.prefs;
    inp.moveF = (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0);
    inp.moveR = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    inp.sprint = this.down('sprint');
    inp.fire = this.down('fire');
    inp.firePressed = this.hit('fire');
    if (P.ads === 'toggle') { if (this.hit('ads')) this.adsToggled = !this.adsToggled; inp.ads = this.adsToggled; }
    else inp.ads = this.down('ads');
    inp.reload = this.hit('reload');
    inp.melee = this.hit('melee');
    inp.interact = this.down('interact');
    inp.interactPressed = this.hit('interact');
    inp.gadget = this.hit('gadget');
    inp.gadgetHeld = this.down('gadget');
    inp.gadget2 = this.hit('gadget2');
    inp.gadget2Held = this.down('gadget2');
    inp.ping = this.hit('ping');
    inp.jump = this.hit('vault');
    if (P.lean === 'toggle') {
      if (this.hit('leanL')) this.leanToggle = this.leanToggle === -1 ? 0 : -1;
      if (this.hit('leanR')) this.leanToggle = this.leanToggle === 1 ? 0 : 1;
      inp.lean = this.leanToggle;
    } else inp.lean = this.down('leanL') ? -1 : this.down('leanR') ? 1 : 0;
    if (this.hit('primary')) inp.slot = 0;
    if (this.hit('secondary')) inp.slot = 1;
    const now = performance.now();
    if (rappelling) {
      inp.invert = this.hit('crouch');
    } else {
      if (P.crouch === 'hold') {
        if (this.hit('prone')) this.wantStance = this.wantStance === Stance.Prone ? Stance.Stand : Stance.Prone;
        if (this.wantStance !== Stance.Prone) this.wantStance = this.down('crouch') ? Stance.Crouch : Stance.Stand;
      } else {
        // tap = toggle crouch · hold = go prone
        if (this.crouchDownAt > 0 && this.down('crouch') && now - this.crouchDownAt > 400 && this.wantStance !== Stance.Prone) {
          this.wantStance = Stance.Prone;
          this.crouchDownAt = -1;
        }
        if (this.up('crouch') && this.crouchDownAt > 0) {
          this.wantStance = this.wantStance === Stance.Crouch ? Stance.Stand : this.wantStance === Stance.Prone ? Stance.Crouch : Stance.Crouch;
          this.crouchDownAt = -1;
        }
        if (this.hit('prone')) this.wantStance = this.wantStance === Stance.Prone ? Stance.Stand : Stance.Prone;
      }
      if (inp.sprint && inp.moveF > 0 && this.wantStance !== Stance.Stand) this.wantStance = Stance.Stand;
      inp.stance = this.wantStance;
    }
    const sens = this.sensitivity * (inp.ads ? this.adsSensMul : 1);
    inp.lookDYaw = -this.mouseDX * sens;
    inp.lookDPitch = -this.mouseDY * sens * (this.invertY ? -1 : 1);
    this.flush();
    return inp;
  }

  private flush() {
    this.mouseDX = this.mouseDY = 0;
    this.pressed.clear();
    this.released.clear();
  }
}
