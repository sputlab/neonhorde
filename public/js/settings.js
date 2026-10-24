// =====================================================================
// settings.js — impostazioni utente persistenti (audio, controlli,
// lingua, modalità daltonici, effetti avanzati)
// =====================================================================

const STORAGE_KEY = 'nh_settings';
const SUPPORTED_LANGUAGES = ['it', 'en', 'es', 'fr', 'de', 'sl', 'ru'];

export const isMobile = (() => {
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return uaMobile || coarsePointer;
})();

function detectDefaultLanguage() {
  const nav = ((navigator.language || navigator.userLanguage || 'en') + '').slice(0, 2).toLowerCase();
  return SUPPORTED_LANGUAGES.includes(nav) ? nav : 'en';
}

function defaults() {
  return {
    // Nota: la chiave si chiama ancora "audioEnabled" per compatibilità
    // con le impostazioni già salvate da versioni precedenti (dove
    // controllava l'unico interruttore audio esistente) — ora
    // rappresenta specificamente l'attivazione degli EFFETTI SONORI,
    // distinta dalla musica (vedi musicEnabled sotto).
    audioEnabled: true,
    sfxVolume: 1,          // 0..1
    musicEnabled: true,
    musicVolume: 0.6,      // 0..1 — un po' più bassa di default rispetto agli effetti, per non coprirli
    controlScheme: isMobile ? 'touch' : 'keyboard', // 'touch' | 'tilt' | 'dpad' | 'keyboard' | 'mouse'
    language: detectDefaultLanguage(),
    colorblindMode: false,
    enhancedFx: true,
    playerPosition: 'bottom', // 'bottom' (classico, personaggio verso il basso) | 'center'
    pointerSpeedMode: 'constant', // 'constant' (velocità piena sempre) | 'proportional' (scala con la distanza)
    dpadSide: 'left',    // 'left' | 'right'
    dpadSize: 'medium',  // 'small' | 'medium' | 'large'
    // Punto neutro dei sensori di movimento, catturato dal modale di
    // calibrazione (js/sensors.js). Coordinate GIÀ corrette per
    // l'orientamento schermo corrente al momento della calibrazione
    // (non beta/gamma grezzi del telaio fisico) — v1.15.0, vedi
    // sensors.js per il perché di questa correzione.
    tiltCalibration: { x: 0, y: 45 },
    // Skin equipaggiata (es. 'skin_ninja'), o null per l'aspetto di
    // default. Applicata solo se effettivamente posseduta (verificato
    // in Game.constructor) — qui è solo la preferenza scelta dall'utente.
    equippedSkin: null,
    // v1.27.0 — arma con cui iniziare la run (es. 'laser'), o null per
    // la pistola di default. Applicata solo se effettivamente
    // posseduta/sbloccata (verificato in Game.constructor).
    startingWeapon: null,
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { stored = {}; }
  cache = { ...defaults(), ...stored };
  return cache;
}

export function getSettings() {
  return load();
}

export function saveSettings(partial) {
  const current = load();
  cache = { ...current, ...partial };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); } catch { /* storage non disponibile: ignora */ }
  return cache;
}

export function availableControlSchemes() {
  return isMobile
    ? [
        { value: 'touch', labelKey: 'settings.control_touch' },
        { value: 'tilt', labelKey: 'settings.control_tilt' },
        { value: 'dpad', labelKey: 'settings.control_dpad' },
      ]
    : [{ value: 'keyboard', labelKey: 'settings.control_keyboard' }, { value: 'mouse', labelKey: 'settings.control_mouse' }];
}

export { SUPPORTED_LANGUAGES };
