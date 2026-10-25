import * as THREE from 'three';
import type { SoundEvent } from '../game/World.ts';

/**
 * Procedural positional audio (no asset files): noise bursts + filtered
 * oscillators through HRTF PannerNodes. Sounds without line of sight get a
 * low-pass "through the wall" filter, sounds on another floor are muffled more.
 */
export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  volume = 0.7;
  private lastFoot = 0;
  occluded: (p: THREE.Vector3) => boolean = () => false;

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setListener(cam: THREE.Camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = cam.position;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
      l.upX.value = u.x; l.upY.value = u.y; l.upZ.value = u.z;
    }
  }

  private chain(pos: THREE.Vector3 | null, gain: number, listenerPos: THREE.Vector3): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    let out: AudioNode = g;
    if (pos) {
      const occl = this.occluded(pos);
      const floors = Math.round(Math.abs(pos.y - listenerPos.y) / 3);
      if (occl || floors) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = floors ? 500 : 1400;
        g.connect(lp);
        out = lp;
        g.gain.value *= floors ? 0.6 : 0.75;
      }
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF';
      pan.distanceModel = 'inverse';
      pan.refDistance = 2.5;
      pan.rolloffFactor = 1.1;
      pan.maxDistance = 120;
      pan.positionX.value = pos.x; pan.positionY.value = pos.y; pan.positionZ.value = pos.z;
      out.connect(pan);
      out = pan;
    }
    out.connect(this.master);
    return g;
  }

  private burst(dest: AudioNode, dur: number, f0: number, type: BiquadFilterType, q = 1, attack = 0.002) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = type;
    bp.frequency.value = f0;
    bp.Q.value = q;
    const env = ctx.createGain();
    const t = ctx.currentTime;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + attack);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp).connect(env).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(dest: AudioNode, f0: number, f1: number, dur: number, type: OscillatorType = 'sine', vol = 1) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(env).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(e: SoundEvent, listener: THREE.Vector3, isSelf: boolean) {
    if (!this.ctx) return;
    const pos = isSelf ? null : e.pos;
    const d = e.pos.distanceTo(listener);
    if (d > e.radius * 2.2 && !isSelf) return;
    switch (e.type) {
      case 'gunshot': {
        const c = this.chain(pos, isSelf ? 0.55 : 0.9, listener);
        this.burst(c, 0.16, 1800, 'bandpass', 0.7, 0.001);
        this.burst(c, 0.35, 300, 'lowpass', 1);
        this.tone(c, 140, 45, 0.18, 'triangle', 0.8);
        break;
      }
      case 'suppressed': {
        const c = this.chain(pos, isSelf ? 0.35 : 0.5, listener);
        this.burst(c, 0.07, 2600, 'bandpass', 1.5);
        break;
      }
      case 'explosion': {
        const c = this.chain(pos, e.label === 'emp' ? 0.6 : 1.4, listener);
        if (e.label === 'emp') { this.tone(c, 1200, 80, 0.6, 'sawtooth', 0.4); break; }
        this.burst(c, 1.6, 180, 'lowpass', 0.8, 0.004);
        this.burst(c, 0.5, 900, 'bandpass', 0.5);
        this.tone(c, 90, 28, 1.1, 'sine', 1);
        break;
      }
      case 'breach': case 'barricade': {
        const c = this.chain(pos, 0.8, listener);
        this.burst(c, 0.35, e.label === 'hammer' ? 400 : 1200, 'bandpass', 0.8);
        this.burst(c, 0.6, 2500, 'highpass', 0.5, 0.01);
        if (e.label === 'hammer') this.tone(c, 110, 50, 0.25, 'triangle', 0.8);
        break;
      }
      case 'footstep': {
        if (isSelf && performance.now() - this.lastFoot < 120) return;
        this.lastFoot = performance.now();
        const c = this.chain(pos, isSelf ? 0.12 : 0.35 * e.intensity + 0.1, listener);
        this.burst(c, 0.06, 700 + Math.random() * 300, 'bandpass', 2);
        break;
      }
      case 'impact': {
        const c = this.chain(pos, 0.4, listener);
        this.burst(c, 0.12, 600, 'bandpass', 1);
        break;
      }
      case 'gadget': {
        const c = this.chain(pos, 0.35, listener);
        if (e.label === 'thermite') this.burst(c, 0.25, 3000, 'highpass', 0.6);
        else if (e.label === 'reinforce') { this.tone(c, 220, 180, 0.4, 'square', 0.25); this.burst(c, 0.3, 800, 'bandpass', 3); }
        else if (e.label === 'zap' || e.label === 'ads') this.tone(c, 1800, 300, 0.15, 'sawtooth', 0.4);
        else this.tone(c, 1500, 1500, 0.06, 'square', 0.2);
        break;
      }
      case 'voice': {
        if (e.label === 'contact' && Math.random() > 0.15) return;
        const c = this.chain(pos, 0.25, listener);
        this.tone(c, 320, 240, 0.25, 'sawtooth', 0.35);
        break;
      }
    }
  }

  ui(kind: 'hit' | 'kill' | 'tick' | 'round') {
    if (!this.ctx) return;
    const c = this.chain(null, 0.25, new THREE.Vector3());
    if (kind === 'hit') this.tone(c, 1800, 1400, 0.05, 'square', 0.3);
    else if (kind === 'kill') { this.tone(c, 900, 1800, 0.12, 'square', 0.35); }
    else if (kind === 'tick') this.tone(c, 1000, 1000, 0.04, 'sine', 0.3);
    else this.tone(c, 300, 600, 0.6, 'triangle', 0.5);
  }
}
