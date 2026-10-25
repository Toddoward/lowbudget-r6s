import { emptyInput, type SoldierInput } from '../game/Soldier.ts';
import { Stance } from '../game/types.ts';

/** Keyboard + mouse (pointer lock) → SoldierInput. R6-style bindings. */
export class Input {
  keys = new Set<string>();
  private pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  mouseL = false;
  mouseR = false;
  private mouseLPressed = false;
  sensitivity = 0.0022;
  invertY = false;
  locked = false;
  private wantStance: Stance = Stance.Stand;
  enabled = true;
  onToggle: (key: string) => void = () => {};

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (['Tab', 'Space', 'KeyQ', 'KeyE'].includes(e.code) && this.locked) e.preventDefault();
      if (e.code === 'Tab') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['KeyT', 'KeyB', 'KeyL', 'Escape', 'Enter', 'KeyM', 'KeyH'].includes(e.code)) this.onToggle(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseL = this.mouseR = false; });
    el.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouseL = true; this.mouseLPressed = true; }
      if (e.button === 2) this.mouseR = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseL = false;
      if (e.button === 2) this.mouseR = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === this.el; });
  }

  lock() {
    if (!this.locked) {
      try {
        const r = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
        r?.catch?.(() => {});
      } catch { /* not allowed in this context */ }
    }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  wasPressed(code: string) { return this.pressed.has(code); }

  resetStance(s: Stance = Stance.Stand) { this.wantStance = s; }

  /** build this frame's input; consumes edge-triggered presses */
  sample(rappelling: boolean): SoldierInput {
    const k = this.keys;
    const inp = emptyInput();
    if (!this.enabled) { this.flush(); return inp; }
    inp.moveF = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    inp.moveR = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    inp.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    inp.fire = this.mouseL;
    inp.firePressed = this.mouseLPressed;
    inp.ads = this.mouseR;
    inp.reload = this.pressed.has('KeyR');
    inp.melee = this.pressed.has('KeyV');
    inp.interact = k.has('KeyF');
    inp.interactPressed = this.pressed.has('KeyF');
    inp.alt = this.pressed.has('KeyG');
    inp.jump = this.pressed.has('Space');
    inp.lean = k.has('KeyQ') ? -1 : k.has('KeyE') ? 1 : 0;
    if (this.pressed.has('Digit1')) inp.slot = 0;
    if (this.pressed.has('Digit2')) inp.slot = 1;
    if (this.pressed.has('Digit3')) inp.slot = 2;
    if (this.pressed.has('Digit4')) inp.slot = 3;
    if (rappelling) {
      inp.invert = this.pressed.has('KeyC') || this.pressed.has('ControlLeft');
    } else {
      if (this.pressed.has('KeyC') || this.pressed.has('ControlLeft')) this.wantStance = this.wantStance === Stance.Crouch ? Stance.Stand : Stance.Crouch;
      if (this.pressed.has('KeyZ')) this.wantStance = this.wantStance === Stance.Prone ? Stance.Stand : Stance.Prone;
      if (inp.sprint && inp.moveF > 0 && this.wantStance === Stance.Crouch) this.wantStance = Stance.Stand;
      inp.stance = this.wantStance;
    }
    inp.lookDYaw = -this.mouseDX * this.sensitivity;
    inp.lookDPitch = -this.mouseDY * this.sensitivity * (this.invertY ? -1 : 1);
    this.flush();
    return inp;
  }

  private flush() {
    this.mouseDX = this.mouseDY = 0;
    this.pressed.clear();
    this.mouseLPressed = false;
  }
}
