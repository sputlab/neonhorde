// =====================================================================
// music.js — colonna sonora procedurale (dark/hard techno per le
// tracce standard, drum'n'bass per i boss), generata interamente via
// Web Audio API, coerentemente con la filosofia "zero asset esterni"
// già seguita per gli effetti sonori in audio.js.
//
// IMPORTANTE — natura di questo sistema: non sono 40 brani preregistrati
// (non esiste uno strumento di generazione musicale/audio in questo
// ambiente), ma un vero sequencer/sintetizzatore procedurale: 20
// combinazioni di parametri musicali distinte (tonalità, scala, tempo,
// giro di accordi, pattern ritmico, timbriche) per le tracce standard e
// altrettante per i boss, suonate da un motore condiviso. Ogni "traccia"
// dura 128 battute (a 4/4, 16 step per battuta = 2048 step) e si ripete
// in loop finché non scade o non viene interrotta da un cambio (boss che
// appare/muore).
//
// I due generi differiscono non solo per tempo/tonalità ma nel PATTERN
// RITMICO stesso: le tracce standard usano cassa in levare regolare
// (four-on-the-floor, tipica del techno), quelle dei boss un pattern
// sincopato stile breakbeat con hi-hat molto più fitti — vedi
// TECHNO_BASE/DNB_BASE più sotto.
//
// Architettura:
// - Teoria musicale minima: scale modali, accordi diatonici di settima.
// - Sintesi: pad/stab (oscillatori accordati/scordati), basso pulsante,
//   arpeggio/lead, batteria (kick/snare/hihat sintetici), un riverbero
//   leggero condiviso (convolutore con impulso generato).
// - Scheduler a "lookahead" (pattern standard Web Audio per timing
//   preciso, indipendente dal jitter del timer JS).
// - API pubblica: initMusic, setMusicEnabled, setMusicVolume,
//   startAmbientRotation, playBossTrack, returnToAmbient, stopMusic.
// =====================================================================
import { audio } from './audio.js';

const FADE_TIME = 2.2;       // secondi, dissolvenza tra tracce ambient
const BOSS_FADE_TIME = 1.4;  // secondi, cambio verso/da traccia boss (un po' più rapido, per dare peso all'arrivo del boss)
const STEPS_PER_BAR = 16;    // risoluzione: sedicesimi
const TOTAL_BARS = 128;
const TOTAL_STEPS = STEPS_PER_BAR * TOTAL_BARS;

// ---------------------------------------------------------------------
// Teoria musicale
// ---------------------------------------------------------------------
const SEMITONE_RATIO = Math.pow(2, 1 / 12);

function noteFreq(rootFreq, semitones) {
  return rootFreq * Math.pow(SEMITONE_RATIO, semitones);
}

// Intervalli (in semitoni dalla fondamentale) di ciascuna scala modale.
const SCALES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],       // minore naturale — malinconico, vaporwave classico
  dorian: [0, 2, 3, 5, 7, 9, 10],        // minore ma "aperto", sognante
  phrygian: [0, 1, 3, 5, 7, 8, 10],      // scuro, teso — boss
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11], // esotico, drammatico — boss
  mixolydian: [0, 2, 4, 5, 7, 9, 10],    // dominante, dreamy synthwave
  lydian: [0, 2, 4, 6, 7, 9, 11],        // fluttuante, eterea
};

/** Accordo di settima diatonico: impila terze nella scala a partire dal
 *  grado indicato (1-based). Ritorna semitoni dalla fondamentale. */
function diatonicChord(scaleIntervals, degree, extend = 4) {
  const notes = [];
  for (let i = 0; i < extend; i++) {
    const idx = (degree - 1) + i * 2;
    const octaveShift = Math.floor(idx / scaleIntervals.length) * 12;
    const scaleIdx = ((idx % scaleIntervals.length) + scaleIntervals.length) % scaleIntervals.length;
    notes.push(scaleIntervals[scaleIdx] + octaveShift);
  }
  return notes;
}

// Frequenze delle fondamentali usate (ottave 2-3, registro caldo/basso
// tipico del synth vaporwave).
const ROOT = {
  C2: 65.41, D2: 73.42, E2: 82.41, F2: 87.31, G2: 98.00, A2: 110.00, B2: 123.47,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
};

// ---------------------------------------------------------------------
// Definizione delle 40 tracce: 20 "standard" dark/hard techno + 20
// specifiche dei boss in stile drum'n'bass (una per ciascuno dei 20
// boss del roster, stesso ordine/indice di BOSS_TYPES in config.js così
// la mappatura è diretta e prevedibile).
//
// Differenza chiave tra i due generi, non solo nel tempo ma nel
// PATTERN RITMICO stesso (vedi playDrumStep più sotto):
// - techno: cassa in levare su ogni quarto (four-on-the-floor),
//   hi-hat sui controtempi, incalzante e ipnotico, basso pulsante.
// - drum'n'bass: cassa/rullante sincopati stile breakbeat (non in
//   levare regolare), hi-hat fittissimi, basso spezzato e aggressivo —
//   molta più energia e imprevedibilità ritmica.
// ---------------------------------------------------------------------
const TECHNO_BASE = {
  padWave: 'sawtooth', bassWave: 'sawtooth', arpWave: 'square',
  chordBars: 4, drumIntensity: 0.85, filterCutoff: 950, reverbMix: 0.16,
  drumStyle: 'techno',
  kickSteps: [0, 4, 8, 12],           // four-on-the-floor
  snareSteps: [12],                    // accento/clap in levare
  hatSteps: [2, 6, 10, 14],            // controtempi classici techno
  bassSteps: [0, 2, 4, 6, 8, 10, 12, 14], // basso pulsante a ottavi, incalzante
  arpSteps: [0, 4, 8, 12],             // stab ritmico secco, non arpeggio fluido
  arpPattern: 'up',
};

const DNB_BASE = {
  padWave: 'sawtooth', bassWave: 'sine', arpWave: 'sawtooth',
  chordBars: 2, drumIntensity: 1.0, filterCutoff: 1500, reverbMix: 0.2,
  drumStyle: 'dnb',
  kickSteps: [0, 10],                  // cassa sincopata stile breakbeat
  snareSteps: [4, 12],                 // rullante sul 2 e 4, ma "spezzato"
  hatSteps: [0, 2, 4, 6, 8, 10, 12, 14], // hi-hat fittissimi, energia continua
  bassSteps: [0, 3, 6, 8, 10, 13],     // basso sincopato/irregolare, mai prevedibile
  arpSteps: [0, 6, 8, 14],
  arpPattern: 'random',
};

const TECHNO_TRACKS = [
  { name: 'Concrete Pulse', root: ROOT.A2, scale: 'phrygian', bpm: 138, progression: [1, 2, 1, 7] },
  { name: 'Iron Grid', root: ROOT.D2, scale: 'aeolian', bpm: 142, progression: [1, 7, 6, 7] },
  { name: 'Subterranean', root: ROOT.E2, scale: 'phrygian', bpm: 136, progression: [1, 7, 1, 2] },
  { name: 'Rust Belt', root: ROOT.C2, scale: 'harmonicMinor', bpm: 146, progression: [1, 4, 1, 5] },
  { name: 'Black Ice', root: ROOT.G2, scale: 'phrygian', bpm: 140, progression: [1, 2, 7, 1] },
  { name: 'Vantablack', root: ROOT.A2, scale: 'aeolian', bpm: 148, progression: [1, 6, 7, 1] },
  { name: 'Hydraulic Press', root: ROOT.B2, scale: 'phrygian', bpm: 134, progression: [1, 7, 6, 1] },
  { name: 'Acid Rain', root: ROOT.D2, scale: 'harmonicMinor', bpm: 144, progression: [1, 4, 5, 1] },
  { name: 'Warehouse 9', root: ROOT.F2, scale: 'aeolian', bpm: 132, progression: [1, 6, 4, 7] },
  { name: 'Nightshift', root: ROOT.E2, scale: 'phrygian', bpm: 150, progression: [1, 2, 1, 4] },
  { name: 'Riot Gear', root: ROOT.C3, scale: 'harmonicMinor', bpm: 137, progression: [1, 7, 4, 1] },
  { name: 'Static Charge', root: ROOT.G2, scale: 'aeolian', bpm: 143, progression: [1, 4, 1, 7] },
  { name: 'Tunnel Vision', root: ROOT.A2, scale: 'phrygian', bpm: 139, progression: [1, 7, 1, 6] },
  { name: 'Hard Reset', root: ROOT.B2, scale: 'harmonicMinor', bpm: 145, progression: [1, 6, 7, 1] },
  { name: 'Bunker', root: ROOT.D3, scale: 'phrygian', bpm: 133, progression: [1, 4, 5, 4] },
  { name: 'Cold Steel', root: ROOT.F2, scale: 'aeolian', bpm: 149, progression: [1, 2, 1, 4] },
  { name: 'Distortion Field', root: ROOT.C2, scale: 'harmonicMinor', bpm: 141, progression: [1, 7, 6, 5] },
  { name: 'Underpass', root: ROOT.E2, scale: 'phrygian', bpm: 135, progression: [1, 6, 4, 7] },
  { name: 'Voltage Drop', root: ROOT.A2, scale: 'aeolian', bpm: 147, progression: [1, 4, 7, 6] },
  { name: 'Machine Prayer', root: ROOT.G2, scale: 'harmonicMinor', bpm: 151, progression: [1, 2, 5, 1] },
].map((t) => ({ ...TECHNO_BASE, ...t, id: `techno-${t.name}` }));

const BOSS_TRACKS = [
  { name: 'Breakneck', root: ROOT.A2, scale: 'phrygian', bpm: 172, progression: [1, 2, 1, 7] },
  { name: 'Sub Zero Rush', root: ROOT.D2, scale: 'harmonicMinor', bpm: 176, progression: [1, 6, 7, 1] },
  { name: 'Adrenaline Break', root: ROOT.E2, scale: 'phrygian', bpm: 170, progression: [1, 7, 6, 1] },
  { name: 'Shockwave', root: ROOT.C2, scale: 'harmonicMinor', bpm: 178, progression: [1, 4, 5, 1] },
  { name: 'Fast Forward', root: ROOT.G2, scale: 'phrygian', bpm: 174, progression: [1, 2, 7, 1] },
  { name: 'Redline', root: ROOT.A2, scale: 'aeolian', bpm: 180, progression: [1, 7, 6, 7] },
  { name: 'Hyperdrive', root: ROOT.B2, scale: 'harmonicMinor', bpm: 168, progression: [1, 6, 7, 5] },
  { name: 'Turbo Charge', root: ROOT.D2, scale: 'phrygian', bpm: 175, progression: [1, 4, 7, 1] },
  { name: 'Neural Overload', root: ROOT.F2, scale: 'harmonicMinor', bpm: 177, progression: [1, 2, 1, 5] },
  { name: 'Blast Radius', root: ROOT.E2, scale: 'dorian', bpm: 179, progression: [1, 7, 4, 7] },
  { name: 'Flatline Rush', root: ROOT.C3, scale: 'phrygian', bpm: 169, progression: [1, 6, 2, 1] },
  { name: 'Warp Speed', root: ROOT.G2, scale: 'harmonicMinor', bpm: 173, progression: [1, 4, 1, 7] },
  { name: 'Chaos Engine', root: ROOT.A2, scale: 'phrygian', bpm: 177, progression: [1, 7, 1, 6] },
  { name: 'Riot Break', root: ROOT.B2, scale: 'aeolian', bpm: 181, progression: [1, 6, 7, 1] },
  { name: 'Detonator', root: ROOT.D3, scale: 'harmonicMinor', bpm: 171, progression: [1, 4, 5, 4] },
  { name: 'Afterburner', root: ROOT.F2, scale: 'phrygian', bpm: 175, progression: [1, 2, 1, 4] },
  { name: 'Velocity Loop', root: ROOT.C2, scale: 'dorian', bpm: 179, progression: [1, 7, 6, 5] },
  { name: 'Skip Trace', root: ROOT.E2, scale: 'harmonicMinor', bpm: 167, progression: [1, 6, 4, 7] },
  { name: 'Fracture Point', root: ROOT.A2, scale: 'phrygian', bpm: 176, progression: [1, 4, 7, 6] },
  { name: 'Point of No Return', root: ROOT.G2, scale: 'harmonicMinor', bpm: 182, progression: [1, 2, 5, 1], drumIntensity: 1.1, filterCutoff: 1800 },
].map((t) => ({ ...DNB_BASE, ...t, id: `boss-${t.name}` }));

// ---------------------------------------------------------------------
// Riverbero condiviso (convolutore con impulso generato: nessun asset,
// coerente col resto del progetto)
// ---------------------------------------------------------------------
let reverbNode = null;

function getReverb(ctx) {
  if (reverbNode) return reverbNode;
  const duration = 2.2;
  const decay = 2.5;
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * duration);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  reverbNode = ctx.createConvolver();
  reverbNode.buffer = impulse;
  return reverbNode;
}

// ---------------------------------------------------------------------
// Sintesi dei singoli elementi (pad, basso, arpeggio, batteria)
// ---------------------------------------------------------------------
function playPad(ctx, dryDest, wetDest, rootFreq, chordSemis, config, durationSec, time) {
  const padGain = ctx.createGain();
  padGain.gain.setValueAtTime(0, time);
  padGain.gain.linearRampToValueAtTime(0.20, time + durationSec * 0.18);
  padGain.gain.linearRampToValueAtTime(0.14, time + durationSec * 0.65);
  padGain.gain.linearRampToValueAtTime(0, time + durationSec);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = config.filterCutoff;
  filter.Q.value = 0.6;

  const dryGain = ctx.createGain();
  dryGain.gain.value = 1 - config.reverbMix;
  const wetGain = ctx.createGain();
  wetGain.gain.value = config.reverbMix;

  padGain.connect(filter);
  filter.connect(dryGain);
  filter.connect(wetGain);
  dryGain.connect(dryDest);
  wetGain.connect(wetDest);

  chordSemis.forEach((semi) => {
    [-6, 0, 6].forEach((detuneCents) => {
      const osc = ctx.createOscillator();
      osc.type = config.padWave;
      osc.frequency.value = noteFreq(rootFreq, semi);
      osc.detune.value = detuneCents;
      osc.connect(padGain);
      osc.start(time);
      osc.stop(time + durationSec + 0.15);
    });
  });
}

function playBass(ctx, dest, rootFreq, semi, config, time) {
  const dur = 0.42;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.26, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  const osc = ctx.createOscillator();
  osc.type = config.bassWave;
  osc.frequency.value = noteFreq(rootFreq, semi - 12);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + dur + 0.05);
}

function playArpNote(ctx, dryDest, wetDest, rootFreq, chordSemis, noteIdx, config, time) {
  const semi = chordSemis[noteIdx % chordSemis.length] + 12;
  const dur = 0.16;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.09, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  const osc = ctx.createOscillator();
  osc.type = config.arpWave;
  osc.frequency.value = noteFreq(rootFreq, semi);

  const dryGain = ctx.createGain();
  dryGain.gain.value = 1 - config.reverbMix * 0.6;
  const wetGain = ctx.createGain();
  wetGain.gain.value = config.reverbMix * 0.6;
  osc.connect(gain);
  gain.connect(dryGain);
  gain.connect(wetGain);
  dryGain.connect(dryDest);
  wetGain.connect(wetDest);

  osc.start(time);
  osc.stop(time + dur + 0.02);
}

function playKick(ctx, dest, time, intensity) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.5 * intensity, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.24);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, time);
  osc.frequency.exponentialRampToValueAtTime(42, time + 0.2);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + 0.3);
}

function playSnare(ctx, dest, time, intensity) {
  const dur = 0.15;
  const bufferSize = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.28 * intensity, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  src.connect(filter); filter.connect(gain); gain.connect(dest);
  src.start(time); src.stop(time + dur + 0.02);
}

function playHat(ctx, dest, time, intensity) {
  const dur = 0.045;
  const bufferSize = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 7500;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.11 * intensity, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  src.connect(filter); filter.connect(gain); gain.connect(dest);
  src.start(time); src.stop(time + dur + 0.01);
}

function playDrumStep(ctx, dest, stepInBar, config, time) {
  const intensity = config.drumIntensity;
  if (intensity <= 0) return;
  // Pattern ritmico specifico della traccia (techno: cassa in levare
  // regolare; drum'n'bass: cassa/rullante sincopati stile breakbeat) —
  // vedi TECHNO_BASE/DNB_BASE più sopra per i valori concreti.
  if (config.kickSteps.includes(stepInBar)) playKick(ctx, dest, time, intensity);
  if (config.snareSteps.includes(stepInBar)) playSnare(ctx, dest, time, intensity);
  if (config.hatSteps.includes(stepInBar)) playHat(ctx, dest, time, intensity * 0.65);
}

// ---------------------------------------------------------------------
// Scheduler a lookahead (pattern standard Web Audio per timing preciso)
// ---------------------------------------------------------------------
class StepScheduler {
  constructor(ctx) {
    this.ctx = ctx;
    this.lookaheadMs = 25;
    this.scheduleAheadSec = 0.12;
    this.timerId = null;
    this.nextStepTime = 0;
    this.currentStep = 0;
    this.stepDur = 0.25;
    this.onStep = null;
  }
  start(stepDur, onStep, startDelaySec = 0.05) {
    this.stepDur = stepDur;
    this.onStep = onStep;
    this.currentStep = 0;
    this.nextStepTime = this.ctx.currentTime + startDelaySec;
    this._tick();
  }
  stop() {
    if (this.timerId !== null) clearTimeout(this.timerId);
    this.timerId = null;
  }
  _tick() {
    while (this.nextStepTime < this.ctx.currentTime + this.scheduleAheadSec) {
      const keepGoing = this.onStep(this.currentStep, this.nextStepTime);
      if (keepGoing === false) { this.stop(); return; }
      this.nextStepTime += this.stepDur;
      this.currentStep++;
    }
    this.timerId = setTimeout(() => this._tick(), this.lookaheadMs);
  }
}

// ---------------------------------------------------------------------
// Riproduzione di una singola traccia (loop di 128 battute)
// ---------------------------------------------------------------------
function playTrack(ctx, musicBus, config, { onNaturalEnd } = {}) {
  const trackGain = ctx.createGain();
  trackGain.gain.value = 0;
  trackGain.connect(musicBus);

  const reverb = getReverb(ctx);
  const reverbGain = ctx.createGain();
  reverbGain.gain.value = 0.5;
  reverb.connect(reverbGain);
  reverbGain.connect(trackGain);

  const now = ctx.currentTime;
  trackGain.gain.linearRampToValueAtTime(1, now + FADE_TIME);

  const scale = SCALES[config.scale];
  const stepDur = 60 / config.bpm / 4; // durata di un sedicesimo

  const scheduler = new StepScheduler(ctx);
  let arpCounter = 0;

  scheduler.start(stepDur, (step, time) => {
    if (step >= TOTAL_STEPS) {
      if (onNaturalEnd) onNaturalEnd();
      return false; // ferma lo scheduler, il loop di 128 battute è finito
    }
    const bar = Math.floor(step / STEPS_PER_BAR);
    const stepInBar = step % STEPS_PER_BAR;
    const chordIdx = Math.floor(bar / config.chordBars) % config.progression.length;
    const degree = config.progression[chordIdx];
    const chordSemis = diatonicChord(scale, degree);

    if (stepInBar === 0 && bar % config.chordBars === 0) {
      playPad(ctx, trackGain, reverb, config.root, chordSemis, config, stepDur * STEPS_PER_BAR * config.chordBars, time);
    }
    if (config.bassSteps.includes(stepInBar)) {
      playBass(ctx, trackGain, config.root, chordSemis[0], config, time);
    }
    if (config.arpSteps.includes(stepInBar)) {
      let noteIdx;
      if (config.arpPattern === 'updown') {
        const cyclePos = arpCounter % (chordSemis.length * 2 - 2 || 1);
        noteIdx = cyclePos < chordSemis.length ? cyclePos : chordSemis.length * 2 - 2 - cyclePos;
      } else if (config.arpPattern === 'random') {
        noteIdx = Math.floor(Math.random() * chordSemis.length);
      } else {
        noteIdx = arpCounter % chordSemis.length;
      }
      playArpNote(ctx, trackGain, reverb, config.root, chordSemis, noteIdx, config, time);
      arpCounter++;
    }
    playDrumStep(ctx, trackGain, stepInBar, config, time);
    return true;
  });

  return {
    config,
    stop(fadeSec = FADE_TIME) {
      scheduler.stop();
      const t = ctx.currentTime;
      trackGain.gain.cancelScheduledValues(t);
      trackGain.gain.setValueAtTime(trackGain.gain.value, t);
      trackGain.gain.linearRampToValueAtTime(0, t + fadeSec);
    },
  };
}

// ---------------------------------------------------------------------
// Stato del motore ed API pubblica
// ---------------------------------------------------------------------
let musicBus = null;   // gain "master" della musica, volume controllato dall'utente
let enabled = true;
let volume = 0.6;
let currentHandle = null;
let mode = 'stopped'; // 'stopped' | 'ambient' | 'boss'
let lastAmbientIndex = -1;
let bossReturnPending = false;
// BPM della traccia attualmente in riproduzione, usato dalla skin
// "Nucleo Pulsante" (v1.26.0) per sincronizzare la pulsazione visiva
// del player al ritmo della colonna sonora — vedi getCurrentBpm().
// Valore di fallback ragionevole se la musica è disattivata (mai
// aggiornato in quel caso, playNextAmbient/playBossTrack non vengono
// chiamate).
let currentBpm = 120;

function ensureBus() {
  const ctx = audio.getContext();
  if (!musicBus) {
    musicBus = ctx.createGain();
    musicBus.gain.value = enabled ? volume : 0;
    musicBus.connect(ctx.destination);
  }
  return ctx;
}

function pickRandomAmbientIndex() {
  if (TECHNO_TRACKS.length <= 1) return 0;
  let idx;
  do { idx = Math.floor(Math.random() * TECHNO_TRACKS.length); } while (idx === lastAmbientIndex);
  return idx;
}

function playNextAmbient() {
  if (mode !== 'ambient') return; // se nel frattempo è iniziato un boss, non sovrascrivere
  const ctx = ensureBus();
  lastAmbientIndex = pickRandomAmbientIndex();
  const config = TECHNO_TRACKS[lastAmbientIndex];
  currentBpm = config.bpm;
  const prevHandle = currentHandle;
  currentHandle = playTrack(ctx, musicBus, config, { onNaturalEnd: playNextAmbient });
  if (prevHandle) prevHandle.stop(FADE_TIME);
}

/** Inizializza il bus musicale (silenziosamente se già presente): da
 *  chiamare una volta, tipicamente al primo unlock dell'audio. */
export function initMusic() {
  ensureBus();
}

export function setMusicEnabled(v) {
  enabled = !!v;
  if (musicBus) musicBus.gain.value = enabled ? volume : 0;
  if (!enabled) {
    if (currentHandle) currentHandle.stop(0.3);
    currentHandle = null;
    mode = 'stopped';
  }
}

export function setMusicVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (musicBus && enabled) musicBus.gain.value = volume;
}

/** BPM della traccia attualmente in riproduzione (o l'ultimo valore
 *  noto/di fallback se la musica è disattivata) — usato dalla skin
 *  "Nucleo Pulsante" per sincronizzare la pulsazione visiva del player
 *  al ritmo della colonna sonora. */
export function getCurrentBpm() {
  return currentBpm;
}

/** Avvia (o riprende) la rotazione casuale dei loop ambient. Da chiamare
 *  all'avvio di una run. Non fa nulla se la musica è disattivata. */
export function startAmbientRotation() {
  // Idempotente: se una traccia ambient è già in riproduzione (es.
  // avviata dal menu principale) non la riavvia da capo quando la
  // stessa funzione viene richiamata di nuovo (es. all'inizio di una
  // run) — evita un cambio di traccia brusco proprio nel momento in
  // cui il giocatore preme "Gioca".
  if (mode === 'ambient' && currentHandle) return;
  if (!enabled) { mode = 'ambient'; return; }
  ensureBus();
  mode = 'ambient';
  bossReturnPending = false;
  playNextAmbient();
}

/** Passa alla traccia specifica del boss indicato (stesso indice usato
 *  per scegliere il boss stesso, 0-19: mappatura diretta 1-a-1). */
export function playBossTrack(bossIndex) {
  if (!enabled) { mode = 'boss'; return; }
  const ctx = ensureBus();
  const config = BOSS_TRACKS[((bossIndex % BOSS_TRACKS.length) + BOSS_TRACKS.length) % BOSS_TRACKS.length];
  currentBpm = config.bpm;
  mode = 'boss';
  bossReturnPending = false;
  const prevHandle = currentHandle;
  currentHandle = playTrack(ctx, musicBus, config, {}); // i loop boss non hanno bisogno di un "next" automatico: tipicamente il boss muore prima che finiscano; se il loop termina comunque, resta silenzioso finché non arriva returnToAmbient()
  if (prevHandle) prevHandle.stop(BOSS_FADE_TIME);
}

/** Dissolvenza morbida dalla traccia boss corrente, tornando alla
 *  rotazione ambient casuale. Da chiamare alla morte del boss. */
export function returnToAmbient() {
  if (mode !== 'boss') return;
  mode = 'ambient';
  const prevHandle = currentHandle;
  currentHandle = null;
  if (prevHandle) prevHandle.stop(BOSS_FADE_TIME);
  // Piccolo respiro prima di far ripartire l'ambient, per una
  // transizione più morbida invece di sovrapporre subito due dissolvenze.
  setTimeout(() => { if (mode === 'ambient') playNextAmbient(); }, BOSS_FADE_TIME * 350);
}

/** Ferma completamente la musica (fine/uscita dalla run). */
export function stopMusic() {
  mode = 'stopped';
  if (currentHandle) currentHandle.stop(1.2);
  currentHandle = null;
}
