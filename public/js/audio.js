// =====================================================================
// audio.js — SFX/jingle sintetizzati via Web Audio API (no asset esterni)
// =====================================================================
import { CONFIG } from './config.js';

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.sfxVolume = 1; // 0..1, moltiplicatore applicato sopra CONFIG.MASTER_VOLUME
    this.masterGain = null;
  }

  _ensureCtx() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = CONFIG.MASTER_VOLUME;
    this.masterGain.connect(this.ctx.destination);
  }

  /** Da chiamare al primo input utente (autoplay policy dei browser). */
  unlock() {
    this._ensureCtx();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Espone l'AudioContext condiviso ad altri moduli (es. music.js), per
   *  evitare di aprirne uno separato e restare nello stesso grafo audio. */
  getContext() {
    this._ensureCtx();
    return this.ctx;
  }

  setMuted(muted) {
    this.muted = muted;
    this._applyGain();
  }

  /** Volume degli effetti sonori, indipendente dalla musica. */
  setSfxVolume(v) {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    this._applyGain();
  }

  _applyGain() {
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : CONFIG.MASTER_VOLUME * this.sfxVolume;
    }
  }

  _tone({ freq, duration, type = 'sine', gainStart = 0.5, gainEnd = 0.0001, freqEnd = null, delay = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + duration);
    gain.gain.setValueAtTime(gainStart, t0);
    gain.gain.exponentialRampToValueAtTime(gainEnd, t0 + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  _noise({ duration, gainStart = 0.4, filterFreq = 1200, delay = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(gainStart, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  shoot(weaponTier = 0) {
    this._tone({ freq: 620 + weaponTier * 40, freqEnd: 180, duration: 0.08, type: 'square', gainStart: 0.18 });
  }

  hit() {
    this._tone({ freq: 220, freqEnd: 80, duration: 0.06, type: 'sawtooth', gainStart: 0.22 });
  }

  enemyDeath() {
    this._noise({ duration: 0.12, gainStart: 0.25, filterFreq: 900 });
  }

  playerHurt() {
    this._tone({ freq: 160, freqEnd: 60, duration: 0.22, type: 'triangle', gainStart: 0.35 });
  }

  pickup() {
    this._tone({ freq: 720, freqEnd: 1080, duration: 0.09, type: 'sine', gainStart: 0.15 });
  }

  levelUp() {
    [523, 659, 784, 1046].forEach((f, i) => {
      this._tone({ freq: f, duration: 0.16, type: 'triangle', gainStart: 0.25, delay: i * 0.06 });
    });
  }

  bossAppear() {
    this._tone({ freq: 90, freqEnd: 50, duration: 1.1, type: 'sawtooth', gainStart: 0.3 });
    this._tone({ freq: 95, freqEnd: 52, duration: 1.1, type: 'square', gainStart: 0.15, delay: 0.05 });
  }

  bossDeath() {
    [220, 180, 140, 90].forEach((f, i) => {
      this._tone({ freq: f, duration: 0.3, type: 'sawtooth', gainStart: 0.3, delay: i * 0.12 });
    });
  }

  /** Bomba EMP: un boato profondo (rumore filtrato) + un impulso grave sintetizzato. */
  bomb() {
    this._noise({ duration: 0.4, gainStart: 0.4, filterFreq: 500 });
    this._tone({ freq: 130, freqEnd: 40, duration: 0.35, type: 'sawtooth', gainStart: 0.35 });
  }

  gameOver() {
    [400, 340, 260, 180].forEach((f, i) => {
      this._tone({ freq: f, duration: 0.35, type: 'triangle', gainStart: 0.25, delay: i * 0.16 });
    });
  }

  uiClick() {
    this._tone({ freq: 500, freqEnd: 700, duration: 0.05, type: 'square', gainStart: 0.12 });
  }
}

export const audio = new AudioEngine();
