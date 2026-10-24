// =====================================================================
// sensors.js — controllo "inclinazione dispositivo" (tilt) per mobile,
// con calibrazione del punto neutro. Stato condiviso letto da game.js
// quando lo schema di controllo attivo è 'tilt'; il listener resta
// attivo in background indipendentemente dallo schema scelto (costo
// trascurabile, evita dover riattaccare listener ad ogni cambio di
// impostazione).
//
// IMPORTANTE — correzione orientamento schermo (v1.15.0): i valori
// beta/gamma di DeviceOrientationEvent sono relativi al TELAIO FISICO
// del dispositivo, non allo schermo attualmente visualizzato. Se calibri
// in verticale e poi ruoti in orizzontale per giocare (o viceversa), gli
// assi "sinistra/destra" e "avanti/indietro" si scambiano fisicamente,
// rendendo i controlli inutilizzabili senza questa correzione. Prima di
// ogni uso, i valori grezzi vengono ruotati in base all'orientamento
// corrente dello schermo (screen.orientation.angle), così la
// calibrazione e il gioco restano coerenti indipendentemente
// dall'orientamento in cui sono avvenuti.
// =====================================================================
import { getSettings, saveSettings } from './settings.js';

export const tiltState = {
  x: 0, y: 0,                 // output finale, normalizzato -1..1, già calibrato
  rawBeta: 45, rawGamma: 0,   // ultima lettura grezza del sensore (telaio fisico, per diagnostica)
  screenX: 0, screenY: 45,    // lettura grezza già corretta per l'orientamento schermo, NON calibrata (usata per catturare il nuovo zero)
  permissionGranted: null,
  supported: false,
};

let listenerAttached = false;

/** Angolo di rotazione corrente dello schermo (0/90/180/270), con
 *  fallback per Safari/iOS meno recenti che non espongono screen.orientation. */
function getScreenAngle() {
  if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') {
    return screen.orientation.angle;
  }
  if (typeof window !== 'undefined' && typeof window.orientation === 'number') {
    return window.orientation; // valori tipici: -90, 0, 90, 180
  }
  return 0;
}

/**
 * Converte beta/gamma "grezzi" (riferiti al telaio fisico) in coordinate
 * relative allo schermo CORRENTE, così tenere il dispositivo inclinato
 * "a sinistra" significa sempre la stessa cosa sullo schermo, sia in
 * verticale che in orizzontale. Approssimazione 2D standard usata nei
 * controlli a inclinazione per giochi (non una trasformazione 3D
 * completa, ma sufficiente per uno schema di movimento su due assi).
 */
function toScreenRelative(beta, gamma, angleDeg) {
  const angle = ((angleDeg % 360) + 360) % 360; // normalizza a 0..359
  if (angle === 90) return { x: beta, y: -gamma };
  if (angle === 180) return { x: -gamma, y: -beta };
  if (angle === 270) return { x: -beta, y: gamma };
  return { x: gamma, y: beta }; // 0° (verticale, orientamento di default)
}

function handleOrientation(e) {
  if (e.beta === null && e.gamma === null) return;
  const beta = e.beta || 0;   // inclinazione avanti/indietro (telaio fisico), -180..180
  const gamma = e.gamma || 0; // inclinazione sinistra/destra (telaio fisico), -90..90

  tiltState.rawBeta = beta;
  tiltState.rawGamma = gamma;

  const screenRel = toScreenRelative(beta, gamma, getScreenAngle());
  tiltState.screenX = screenRel.x;
  tiltState.screenY = screenRel.y;

  // Retrocompatibilità: una calibrazione salvata da versioni precedenti
  // a questa correzione ha forma {beta, gamma} invece di {x, y} — in tal
  // caso si ignora (valori undefined) e si ricade sui default, finché
  // l'utente non ricalibra una volta con la versione corretta.
  const cal = getSettings().tiltCalibration || {};
  const calX = typeof cal.x === 'number' ? cal.x : 0;
  const calY = typeof cal.y === 'number' ? cal.y : 45;

  const clampAxis = (v, max) => Math.max(-1, Math.min(1, v / max));
  tiltState.x = clampAxis(screenRel.x - calX, 28);
  tiltState.y = clampAxis(screenRel.y - calY, 28);
}

export function initTiltListener() {
  if (listenerAttached) return;
  tiltState.supported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  if (!tiltState.supported) return;
  window.addEventListener('deviceorientation', handleOrientation);
  listenerAttached = true;
}

/**
 * Su iOS 13+ i sensori di movimento richiedono un permesso esplicito
 * richiesto da un gesto utente (tap su un bottone). Su Android e la
 * maggior parte degli altri browser non serve: la funzione gestisce
 * entrambi i casi in modo trasparente.
 */
export async function requestTiltPermission() {
  const DOE = typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined;

  if (DOE && typeof DOE.requestPermission === 'function') {
    try {
      const result = await DOE.requestPermission();
      tiltState.permissionGranted = result === 'granted';
    } catch {
      tiltState.permissionGranted = false;
    }
  } else {
    // Nessun permesso esplicito richiesto da questa piattaforma
    tiltState.permissionGranted = tiltState.supported;
  }

  initTiltListener();
  return tiltState.permissionGranted;
}

export function needsExplicitTiltPermission() {
  const DOE = typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined;
  return !!(DOE && typeof DOE.requestPermission === 'function');
}

/** True se lo schermo è attualmente in orientamento orizzontale
 *  (90°/270°) — usato dal modale di calibrazione per suggerire di
 *  calibrare nello stesso orientamento in cui si giocherà davvero. */
export function isLandscapeOrientation() {
  const angle = ((getScreenAngle() % 360) + 360) % 360;
  return angle === 90 || angle === 270;
}

/**
 * Calibra il punto neutro: cattura l'ultima lettura grezza del sensore
 * GIÀ corretta per l'orientamento schermo corrente (screenX/screenY)
 * come nuovo "zero", e la salva nelle impostazioni (persistita tra le
 * sessioni). Da richiamare quando l'utente preme "Imposta punto zero"
 * nel modale di calibrazione, tenendo il dispositivo nella posizione e
 * nell'orientamento (verticale/orizzontale) che userà davvero in gioco.
 */
export function calibrateTilt() {
  const calibration = { x: tiltState.screenX, y: tiltState.screenY };
  saveSettings({ tiltCalibration: calibration });
  return calibration;
}
