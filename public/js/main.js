// =====================================================================
// main.js — entry point: wiring UI <-> API <-> Game <-> Impostazioni
// =====================================================================
import * as UI from './ui.js';
import { Api, isLoggedIn, getStoredUser, setSession, clearSession, getToken } from './api.js';
import { Game, computeMetaBonuses } from './game.js';
import { audio } from './audio.js';
import { setMusicEnabled, setMusicVolume, startAmbientRotation } from './music.js';
import { APP_VERSION } from './config.js';
import { t, tServerError, applyStaticTranslations } from './i18n.js';
import { getSettings, saveSettings, isMobile, availableControlSchemes } from './settings.js';
import { initTiltListener, requestTiltPermission, needsExplicitTiltPermission, calibrateTilt, tiltState, isLandscapeOrientation } from './sensors.js';

const canvas = document.getElementById('game-canvas');
let currentGame = null;
let selectedDifficulty = 'normal';
// Ricorda da dove è stata aperta la schermata Impostazioni, per far
// tornare il pulsante "indietro" al posto giusto (titolo o pausa).
let settingsReturnScreen = 'title';
let rotatePromptDismissed = false;

// ---------------------------------------------------------------------
// Bootstrap iniziale
// ---------------------------------------------------------------------
async function boot() {
  const versionEl = document.getElementById('app-version');
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;

  initTiltListener();
  applyAudioSetting();
  // iOS sospende forzatamente l'AudioContext quando l'app va in
  // background (schermo bloccato, cambio app) e — a differenza di
  // altre piattaforme — non lo riprende da solo al ritorno in primo
  // piano: musica ed effetti restavano muti fino al riavvio della
  // pagina. audio.unlock() richiama ctx.resume() se sospeso, quindi
  // riattiva l'audio non appena l'app torna visibile.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') audio.unlock();
  });

  // Musica di sottofondo già dal menu principale, non solo in partita:
  // i browser bloccano l'audio finché non c'è un'interazione dell'utente
  // (autoplay policy), quindi la avviamo al primo tocco/click ovunque
  // sulla pagina invece che al caricamento — poi il listener si rimuove
  // da solo, serve una sola volta.
  const startMenuMusicOnce = () => {
    audio.unlock();
    startAmbientRotation();
    document.removeEventListener('pointerdown', startMenuMusicOnce);
    document.removeEventListener('keydown', startMenuMusicOnce);
  };
  document.addEventListener('pointerdown', startMenuMusicOnce);
  document.addEventListener('keydown', startMenuMusicOnce);
  applyColorblindSetting();
  applyTranslations();

  if (!isLoggedIn()) {
    // Auto-crea un account ospite silenzioso al primo avvio, così il
    // giocatore può subito giocare senza passare dalla schermata account.
    // v1.20.0: NESSUN nickname auto-generato (niente più "Player1234")
    // — l'utente resta anonimo finché non ne sceglie uno esplicitamente.
    // Le sue run non verranno salvate finché resta in questo stato (vedi
    // api/run/submit.php), quindi nicknameSet è coerentemente false.
    const res = await Api.registerGuest();
    if (res && res.ok) setSession(res.token, { ...res.user, nicknameSet: false });
  }

  refreshGemsBadge();
  wireTitleScreen();
  wireDifficultyScreen();
  wirePauseScreen();
  wireGameOverScreen();
  wireShopScreen();
  wireMissionsScreen();
  wireLeaderboardScreen();
  wireAccountScreen();
  wireSettingsScreen();
  wireChangelogModal();
  wireQuickRegisterModal();
  wireGuestProtectNicknameModal();
  wireDeleteAccountModal();
  wirePrivacyModal();
  wireTiltCalibrationModal();
  startOnlinePresence();

  UI.showScreen('title');
}

// ---------------------------------------------------------------------
// Presenza online: invia un heartbeat periodico (finché l'app resta
// aperta e visibile) e aggiorna il conteggio "online adesso" mostrato
// in schermata titolo. Non è un conteggio realtime esatto (nessun
// websocket, solo un heartbeat ogni 45s + finestra di 90s lato server),
// ma dà un'indicazione ragionevole senza bisogno di infrastruttura
// aggiuntiva.
// ---------------------------------------------------------------------
const HEARTBEAT_INTERVAL_MS = 45_000;
const ONLINE_COUNT_INTERVAL_MS = 30_000;

function startOnlinePresence() {
  const sendHeartbeat = () => {
    // Non invia heartbeat se la scheda è in background: non ha senso
    // contarsi come "online" se l'app non è nemmeno visibile, ed evita
    // di sprecare richieste inutili quando il telefono è in tasca.
    if (document.visibilityState !== 'visible') return;
    Api.heartbeat().catch(() => { /* fallimento silenzioso: non critico */ });
  };
  const refreshOnlineCount = async () => {
    const res = await Api.onlineCount();
    const el = document.getElementById('online-count');
    if (el && res && res.ok) el.textContent = res.online;
  };

  sendHeartbeat();
  refreshOnlineCount();
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  setInterval(refreshOnlineCount, ONLINE_COUNT_INTERVAL_MS);
  // Al ritorno in primo piano, un heartbeat immediato invece di aspettare
  // il prossimo giro programmato, così lo stato "online" si aggiorna subito.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sendHeartbeat();
  });
}

function refreshGemsBadge() {
  const user = getStoredUser();
  const gems = user ? (user.gems ?? 0) : 0;
  document.getElementById('title-gems').textContent = gems;
  const streakBadge = document.getElementById('title-streak-badge');
  const streak = user ? (user.streak ?? 0) : 0;
  document.getElementById('title-streak').textContent = streak;
  streakBadge.classList.toggle('hidden', streak <= 0);
  refreshAccountStatus();
}

function refreshAccountStatus() {
  const user = getStoredUser();
  const el = document.getElementById('account-status');
  if (!user) { el.textContent = ''; return; }
  if (user.is_guest && !user.nickname) {
    // Ospite che non ha ancora scelto un nickname: prima della v1.20.0
    // qui comparirebbe un nome auto-generato tipo "Guest1234", ora non
    // viene più assegnato nessun nome finché l'utente non ne sceglie
    // uno esplicitamente (vedi anche api/auth/register.php).
    el.textContent = t('account.status_guest_anon');
  } else {
    el.textContent = t(user.is_guest ? 'account.status_guest' : 'account.status_logged_in', { nickname: user.nickname });
  }
}

/** Riapplica tutte le traduzioni statiche + quelle generate dinamicamente
 *  (etichette difficoltà con segnaposto {mult}). Va richiamata al boot
 *  e ogni volta che l'utente cambia lingua. */
function applyTranslations() {
  applyStaticTranslations();
  UI.refreshDifficultyLabels();
}

function applyAudioSetting() {
  const s = getSettings();
  audio.setMuted(!s.audioEnabled);
  audio.setSfxVolume(s.sfxVolume);
  setMusicEnabled(s.musicEnabled);
  setMusicVolume(s.musicVolume);
}

function applyColorblindSetting() {
  document.body.classList.toggle('colorblind', getSettings().colorblindMode);
}

// ---------------------------------------------------------------------
// Titolo
// ---------------------------------------------------------------------
function wireTitleScreen() {
  document.querySelectorAll('#screen-title [data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      audio.uiClick();
      const action = btn.dataset.action;
      if (action === 'play') maybeShowGuestProtectNicknamePrompt();
      else if (action === 'open-shop') openShop();
      else if (action === 'open-missions') openMissions();
      else if (action === 'open-leaderboard') openLeaderboard();
      else if (action === 'open-account') openAccount();
      else if (action === 'open-settings') openSettings('title');
    });
  });
}

const GUEST_PROMPT_DISMISS_KEY = 'nh_guest_prompt_dismissed';

/**
 * v1.37.0 — dopo "Gioca", prima della scelta difficoltà: solo per chi
 * sta giocando da ospite, spiega perché conviene registrarsi PRIMA che
 * si trovi in un conflitto reale di nickname, invece di scoprirlo solo
 * in quel momento. Disattivabile in modo permanente (localStorage) con
 * la casella nel modale — persiste tra le sessioni sullo stesso
 * dispositivo, non richiede un account per essere ricordata.
 */
function maybeShowGuestProtectNicknamePrompt() {
  const user = getStoredUser();
  const isGuest = !!(user && user.is_guest);
  const dismissed = localStorage.getItem(GUEST_PROMPT_DISMISS_KEY) === '1';
  if (!isGuest || dismissed) {
    UI.showScreen('difficulty');
    return;
  }
  document.getElementById('guest-protect-nickname-modal').classList.remove('hidden');
}

function wireGuestProtectNicknameModal() {
  const modal = document.getElementById('guest-protect-nickname-modal');
  const checkbox = document.getElementById('guest-prompt-dont-show');

  const persistDismissIfChecked = () => {
    if (checkbox.checked) localStorage.setItem(GUEST_PROMPT_DISMISS_KEY, '1');
  };

  document.getElementById('guest-prompt-continue-btn').addEventListener('click', () => {
    audio.uiClick();
    persistDismissIfChecked();
    modal.classList.add('hidden');
    UI.showScreen('difficulty');
  });

  document.getElementById('guest-prompt-register-btn').addEventListener('click', () => {
    audio.uiClick();
    persistDismissIfChecked();
    modal.classList.add('hidden');
    // A differenza dell'apertura da game over, qui c'è un "dopo" da
    // completare: se la registrazione va a buon fine, si prosegue
    // automaticamente alla scelta difficoltà invece di restare fermi
    // sul titolo, dando continuità al "Gioca" che l'ha originato.
    openQuickRegisterModal(() => UI.showScreen('difficulty'));
  });

  // Click sul fondo semi-trasparente: equivale a "continua come
  // ospite", ma senza forzare la spunta "non mostrare più" (che va
  // scelta esplicitamente, non a un click accidentale sul backdrop).
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
      UI.showScreen('difficulty');
    }
  });
}

// ---------------------------------------------------------------------
// Difficoltà -> avvio partita
// ---------------------------------------------------------------------
function wireDifficultyScreen() {
  document.querySelectorAll('#screen-difficulty [data-difficulty]').forEach(btn => {
    btn.addEventListener('click', async () => {
      audio.uiClick();
      selectedDifficulty = btn.dataset.difficulty;
      await startRun();
    });
  });
  wireBackButtons('#screen-difficulty');
}

async function startRun() {
  // v1.35.0 — rimosso il prompt nickname pre-partita: chiederlo sia
  // prima sia dopo la run era ridondante, e prima ancora di sapere se
  // il giocatore vuole investirsi nel gioco gli si chiedeva già un
  // impegno. Resta solo quello a fine partita (vedi
  // showGameOverNicknamePromptIfGuest), quando il giocatore ha già
  // visto il proprio risultato ed è più motivato a salvarlo con un nome.

  // Il prompt di rotazione ha senso solo qui, subito prima della sessione
  // di gioco vera e propria: i menu restano pensati per il verticale e
  // non devono mai mostrarlo.
  await maybeWaitForRotate();

  const shopRes = await Api.shopList();
  const meta = computeMetaBonuses(shopRes && shopRes.ok ? shopRes.items : []);

  UI.showScreen(null);
  currentGame = new Game(canvas, selectedDifficulty, meta);
  currentGame._onEnd = () => {
    // Sincronizza gems/streak dell'utente memorizzato col risultato reale
    // del submit — senza questo, il badge gemme in titolo restava
    // "congelato" al valore precedente la run finché non veniva rifatto
    // un acquisto in negozio (unico altro punto che lo aggiornava).
    const result = currentGame.lastRunResult;
    // Catturati PRIMA di azzerare currentGame: servono per la card
    // condivisibile e per collegare il feedback alla run appena finita.
    const recapData = {
      wave: currentGame.spawner.wave,
      kills: currentGame.kills,
      timeSec: Math.round(currentGame.elapsed),
      score: Math.round(currentGame.score),
      difficulty: currentGame.difficultyKey,
    };
    currentGame = null;
    if (result) {
      const user = getStoredUser();
      if (user) {
        user.gems = result.gems_total;
        user.streak = result.streak;
        user.streakLongest = result.streak_longest;
        setSession(getToken(), user);
      }
    }
    refreshGemsBadge();
    showGameOverNicknamePromptIfGuest(result ? result.leaderboard_rank : null);
    setupPostRunActions(recapData, result ? result.run_id : null);
  };
  await currentGame.start();
}

function showGameOverNicknamePromptIfGuest(leaderboardRank = null) {
  const user = getStoredUser();
  const panel = document.getElementById('gameover-nickname-panel');
  // Mostra il prompt solo se non è loggato un account vero E non ha
  // ancora impostato un nickname scelto da lui (nickname auto-generato
  // alla registrazione ospite silenziosa, mai personalizzato finora).
  const shouldPromptNickname = !!(user && user.is_guest && !user.nicknameSet);
  panel.classList.toggle('hidden', !shouldPromptNickname);
  if (shouldPromptNickname) {
    document.getElementById('gameover-nickname-input').value = '';
    document.getElementById('gameover-nickname-msg').textContent = '';
  }

  // v1.35.0 — l'invito a registrarsi con un account è indipendente da
  // quello sopra: riguarda chiunque stia ancora giocando da ospite,
  // abbia già scelto un nickname personalizzato o no.
  const shouldPromptAccount = !!(user && user.is_guest);
  const accountBtn = document.getElementById('btn-save-account-prompt');
  accountBtn.classList.toggle('hidden', !shouldPromptAccount);
  if (shouldPromptAccount) {
    // Proposta #4: se questa run è entrata in una posizione alta di
    // classifica (top 50), un invito specifico e più motivante invece
    // del generico "salva i tuoi progressi" — il momento in cui la
    // spinta a non perdere il risultato appena ottenuto è più forte.
    const inTopRanks = leaderboardRank !== null && leaderboardRank <= 50;
    accountBtn.textContent = inTopRanks
      ? t('gameover.save_account_cta_topranks', { rank: leaderboardRank })
      : t('gameover.save_account_cta');
  }
}

// ---------------------------------------------------------------------
// Azioni post-partita: feedback rapido 👍/👎 e card punteggio condivisibile
// ---------------------------------------------------------------------
function setupPostRunActions(recapData, runId) {
  wireFeedbackRow(runId);
  wireShareButton(recapData);
}

function wireFeedbackRow(runId) {
  const row = document.getElementById('feedback-row');
  const thanks = document.getElementById('feedback-thanks');
  const upBtn = document.getElementById('feedback-up');
  const downBtn = document.getElementById('feedback-down');

  row.classList.remove('hidden');
  thanks.classList.add('hidden');
  upBtn.disabled = false;
  downBtn.disabled = false;

  const send = async (sentiment) => {
    upBtn.disabled = true;
    downBtn.disabled = true;
    row.classList.add('hidden');
    thanks.classList.remove('hidden');
    // Invio "fire and forget": anche se fallisce (rete assente, ecc.)
    // l'utente ha già visto il ringraziamento — un fallimento silenzioso
    // qui è preferibile a un errore su un'azione così minore.
    try { await Api.feedback({ sentiment, run_id: runId }); } catch { /* ignorato volutamente */ }
  };

  // Rimuove eventuali listener di un turno precedente (retry rigenera
  // questa funzione ma i bottoni sono sempre gli stessi elementi DOM).
  const newUp = upBtn.cloneNode(true);
  upBtn.replaceWith(newUp);
  const newDown = downBtn.cloneNode(true);
  downBtn.replaceWith(newDown);
  newUp.addEventListener('click', () => { audio.uiClick(); send('up'); });
  newDown.addEventListener('click', () => { audio.uiClick(); send('down'); });
}

function wireShareButton(recapData) {
  const btn = document.getElementById('btn-share-score');
  const newBtn = btn.cloneNode(true);
  btn.replaceWith(newBtn);
  newBtn.addEventListener('click', async () => {
    audio.uiClick();
    newBtn.disabled = true;
    try {
      await shareScoreCard(recapData);
    } catch {
      UI.toast(t('gameover.share_error'));
    } finally {
      newBtn.disabled = false;
    }
  });
}

/** Genera un'immagine PNG col riepilogo della run (canvas, nessun asset
 *  esterno) e la condivide via Web Share API se disponibile, altrimenti
 *  la scarica. v1.21.0 — canvas e testi ingranditi sensibilmente: alla
 *  dimensione precedente (1200x630, testi "da OG image standard") il
 *  contenuto risultava troppo piccolo per essere letto comodamente
 *  senza zoomare una volta condiviso. */
async function shareScoreCard(recapData) {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 760;
  const ctx = canvas.getContext('2d');

  // Sfondo: stesso nero quasi-puro del gioco, con vignette radiale
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const vignette = ctx.createRadialGradient(600, 280, 40, 600, 340, 760);
  vignette.addColorStop(0, 'rgba(53,224,193,0.16)');
  vignette.addColorStop(1, 'rgba(10,13,18,0)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Esagono decorativo in angolo, stessa identità visiva delle icone PWA
  drawDecorativeHexagon(ctx, 1080, 130, 120);
  drawDecorativeHexagon(ctx, 120, 630, 100);

  // Logo "NEONHORDE" (bicolore)
  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 66px "Chakra Petch", sans-serif';
  const neonW = ctx.measureText('NEON').width;
  const hordeW = ctx.measureText('HORDE').width;
  const logoStartX = (canvas.width - (neonW + hordeW)) / 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8ecf1';
  ctx.fillText('NEON', logoStartX, 110);
  ctx.fillStyle = '#35e0c1';
  ctx.fillText('HORDE', logoStartX + neonW, 110);

  // Punteggio, molto grande e con bagliore — l'elemento visivo dominante
  ctx.textAlign = 'center';
  ctx.font = '700 148px "Space Mono", monospace';
  ctx.fillStyle = '#35e0c1';
  ctx.shadowColor = '#35e0c1';
  ctx.shadowBlur = 36;
  ctx.fillText(String(recapData.score), 600, 320);
  ctx.shadowBlur = 0;

  ctx.font = '400 22px "Space Mono", monospace';
  ctx.fillStyle = '#a9b2c0';
  ctx.fillText(t('gameover.score').toUpperCase(), 600, 360);

  // Riga di statistiche
  const stats = [
    { label: t('gameover.wave'), value: String(recapData.wave) },
    { label: t('gameover.kills'), value: String(recapData.kills) },
    { label: t('gameover.time'), value: formatShareTime(recapData.timeSec) },
    { label: t(`difficulty.${recapData.difficulty}`), value: '' },
  ];
  const boxWidth = 262;
  const boxGap = 22;
  const totalWidth = boxWidth * stats.length + boxGap * (stats.length - 1);
  let boxX = (canvas.width - totalWidth) / 2;
  const boxY = 430;
  const boxHeight = 130;
  stats.forEach((s) => {
    ctx.strokeStyle = '#263042';
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
    ctx.fillStyle = 'rgba(17,22,31,0.6)';
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
    ctx.textAlign = 'center';
    if (s.value) {
      ctx.font = '700 44px "Space Mono", monospace';
      ctx.fillStyle = '#35e0c1';
      ctx.fillText(s.value, boxX + boxWidth / 2, boxY + 62);
      ctx.font = '400 17px "Chakra Petch", sans-serif';
      ctx.fillStyle = '#a9b2c0';
      ctx.fillText(s.label, boxX + boxWidth / 2, boxY + 98);
    } else {
      ctx.font = '700 30px "Chakra Petch", sans-serif';
      ctx.fillStyle = '#e8ecf1';
      ctx.fillText(s.label, boxX + boxWidth / 2, boxY + 76);
    }
    boxX += boxWidth + boxGap;
  });

  // Tagline in calce, grande e in evidenza (non più il piccolo credito
  // testuale di prima): invito esplicito a giocare, con andata a capo
  // automatica dato che il testo tradotto può essere lungo.
  ctx.font = '600 27px "Chakra Petch", sans-serif';
  ctx.fillStyle = '#e8ecf1';
  ctx.textAlign = 'center';
  const taglineLines = wrapCanvasText(ctx, t('gameover.share_tagline'), 980);
  const taglineLineHeight = 38;
  const taglineStartY = 660;
  taglineLines.forEach((line, i) => {
    ctx.fillText(line, 600, taglineStartY + i * taglineLineHeight);
  });

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('canvas toBlob failed');

  const file = new File([blob], 'neon-horde-score.png', { type: 'image/png' });

  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ files: [file], title: 'NEON HORDE' });
    return;
  }

  // Fallback: scarica direttamente il PNG
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'neon-horde-score.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function drawDecorativeHexagon(ctx, cx, cy, radius) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = 'rgba(53, 224, 193, 0.18)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function formatShareTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/** Spezza `text` su più righe in modo che ciascuna, col font già
 *  impostato su `ctx`, non superi `maxWidth` px — usato per la tagline
 *  della card condivisibile, la cui lunghezza varia da lingua a lingua. */
function wrapCanvasText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0] || '';
  for (let i = 1; i < words.length; i++) {
    const testLine = `${currentLine} ${words[i]}`;
    if (ctx.measureText(testLine).width > maxWidth) {
      lines.push(currentLine);
      currentLine = words[i];
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// ---------------------------------------------------------------------
// Pausa
// ---------------------------------------------------------------------
function wirePauseScreen() {
  document.getElementById('btn-pause').addEventListener('click', () => {
    audio.uiClick();
    if (!currentGame) return;
    currentGame.setPaused(true);
    UI.showScreen('pause');
  });

  document.querySelector('[data-action="resume"]').addEventListener('click', () => {
    audio.uiClick();
    if (!currentGame) return;
    currentGame.setPaused(false);
    UI.showScreen(null);
  });

  document.querySelector('[data-action="open-settings-from-pause"]').addEventListener('click', () => {
    audio.uiClick();
    openSettings('pause');
  });

  document.querySelector('[data-action="quit-run"]').addEventListener('click', () => {
    if (!currentGame) return;
    currentGame.quit();
  });

  document.getElementById('btn-bomb').addEventListener('click', () => {
    if (currentGame) currentGame.useBomb();
  });
}

// ---------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------
function wireGameOverScreen() {
  document.querySelector('#screen-gameover [data-action="retry"]').addEventListener('click', async () => {
    audio.uiClick();
    await startRun();
  });

  document.getElementById('btn-save-nickname').addEventListener('click', async () => {
    const input = document.getElementById('gameover-nickname-input');
    const msgEl = document.getElementById('gameover-nickname-msg');
    const suggestionBtn = document.getElementById('gameover-nickname-suggestion-btn');
    const nickname = input.value.trim();
    msgEl.textContent = '';
    suggestionBtn.classList.add('hidden');
    if (!nickname) { msgEl.textContent = t('account.error_generic'); return; }

    const res = await Api.setNickname(nickname);
    if (res && res.ok) {
      const user = getStoredUser();
      if (user) { user.nickname = res.nickname; user.nicknameSet = true; setSession(getToken(), user); }
      msgEl.className = 'account-success';
      msgEl.textContent = t('gameover.nickname_saved');
      refreshAccountStatus();
    } else {
      msgEl.className = 'account-error';
      if (!tryShowNicknameSuggestion(res, msgEl, suggestionBtn, input)) {
        msgEl.textContent = res && res.error ? tServerError(res.error) : t('account.error_generic');
      }
    }
  });

  // v1.36.0 — apre un modale di registrazione rapida invece di
  // navigare via dalla schermata di game over (che prima scompariva
  // del tutto dietro la schermata Account, dando la sensazione di
  // "perdere" il recap della run appena giocata). Il modale resta
  // sopra lo stesso schermo: nickname/gemme/progressi sono già
  // dell'account corrente, si aggiungono solo email e password.
  document.getElementById('btn-save-account-prompt').addEventListener('click', () => {
    audio.uiClick();
    openQuickRegisterModal();
  });

  wireBackButtons('#screen-gameover');
}

function wireBackButtons(scopeSelector) {
  document.querySelectorAll(`${scopeSelector} [data-action="back-to-title"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      audio.uiClick();
      refreshGemsBadge();
      UI.showScreen('title');
    });
  });
}
// Applica anche ai pulsanti "indietro" fuori da questi scope specifici
document.querySelectorAll('[data-action="back-to-title"]').forEach(btn => {
  btn.addEventListener('click', () => {
    audio.uiClick();
    refreshGemsBadge();
    UI.showScreen('title');
  });
});

// ---------------------------------------------------------------------
// Negozio
// ---------------------------------------------------------------------
async function openShop() {
  UI.showScreen('shop');
  await reloadShop();
}

async function reloadShop() {
  const res = await Api.shopList();
  if (!res || !res.ok) { UI.toastApiError(res, 'toast.shop_load_fail'); return; }
  UI.renderShop(res.items, res.gems, async (itemId) => {
    const buyRes = await Api.shopBuy(itemId);
    if (buyRes && buyRes.ok) {
      UI.toast(t('toast.purchase_ok'));
      const user = getStoredUser();
      if (user) { user.gems = buyRes.gems_total; setSession(getToken(), user); }
      await reloadShop();
      refreshGemsBadge();
    } else {
      UI.toastApiError(buyRes, 'toast.purchase_fail_generic');
    }
  });
}

function wireShopScreen() {
  wireBackButtons('#screen-shop');
}

// ---------------------------------------------------------------------
// Missioni
// ---------------------------------------------------------------------
let currentMissionsTab = 'active';
let currentAchievementsView = 'next';
let cachedMissions = [];
let cachedAchievements = {};

async function openMissions() {
  UI.showScreen('missions');
  await reloadMissions();
}

async function reloadMissions() {
  const res = await Api.missionsList();
  if (!res || !res.ok) { UI.toastApiError(res, 'toast.missions_load_fail'); return; }
  cachedMissions = res.missions;
  if (currentMissionsTab !== 'achievements') renderMissionsTab();
}

async function reloadAchievements() {
  const res = await Api.achievementsList();
  if (!res || !res.ok) { UI.toastApiError(res, 'toast.achievements_load_fail'); return; }
  cachedAchievements = res.categories;
  if (currentMissionsTab === 'achievements') renderAchievementsTab();
}

function renderMissionsTab() {
  UI.renderMissions(cachedMissions, currentMissionsTab, async (missionId) => {
    const claimRes = await Api.missionsClaim(missionId);
    if (claimRes && claimRes.ok) {
      UI.toast(`+${claimRes.gems_earned} ◆`);
      // v1.34.0 — mancava la sincronizzazione della copia locale delle
      // gemme (a differenza del flusso fine-run e acquisto negozio, che
      // la fanno già): senza questo, il negozio (che rilegge sempre dal
      // server) e la schermata principale (che legge questa copia
      // locale non aggiornata) mostravano due numeri diversi finché non
      // succedeva qualcos'altro a risincronizzarli.
      const user = getStoredUser();
      if (user) { user.gems = claimRes.gems_total; setSession(getToken(), user); }
      await reloadMissions();
      refreshGemsBadge();
    } else {
      UI.toastApiError(claimRes, 'toast.mission_claim_fail_generic');
    }
  });
}

function renderAchievementsTab() {
  UI.renderAchievements(cachedAchievements, currentAchievementsView, async (tierId) => {
    const claimRes = await Api.achievementsClaim(tierId);
    if (claimRes && claimRes.ok) {
      UI.toast(`+${claimRes.gems_earned} ◆`);
      if (claimRes.unlocked_skin_key) {
        // Una skin sbloccata è un evento più raro/importante di un
        // semplice riscatto gemme: un secondo toast dedicato invece di
        // infilarlo nello stesso messaggio, che passerebbe inosservato.
        UI.toast(t('achievements.skin_unlocked_toast'), 3000);
      }
      // v1.34.0 — stessa correzione di renderMissionsTab() sopra.
      const user = getStoredUser();
      if (user) { user.gems = claimRes.gems_total; setSession(getToken(), user); }
      await reloadAchievements();
      refreshGemsBadge();
    } else {
      UI.toastApiError(claimRes, 'toast.mission_claim_fail_generic');
    }
  });
}

function wireMissionsScreen() {
  document.querySelectorAll('#screen-missions > .tabs > .tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('#screen-missions > .tabs > .tab').forEach(t2 => t2.classList.remove('active'));
      tab.classList.add('active');
      currentMissionsTab = tab.dataset.missionsTab;

      const isAchievements = currentMissionsTab === 'achievements';
      document.getElementById('missions-list').classList.toggle('hidden', isAchievements);
      document.getElementById('achievements-panel').classList.toggle('hidden', !isAchievements);

      if (isAchievements) {
        if (Object.keys(cachedAchievements).length === 0) await reloadAchievements();
        else renderAchievementsTab();
      } else {
        renderMissionsTab();
      }
    });
  });

  document.querySelectorAll('#achievements-panel .tab-small').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#achievements-panel .tab-small').forEach(t2 => t2.classList.remove('active'));
      tab.classList.add('active');
      currentAchievementsView = tab.dataset.achievementsView;
      renderAchievementsTab();
    });
  });

  wireBackButtons('#screen-missions');
}

// ---------------------------------------------------------------------
// Classifica
// ---------------------------------------------------------------------
let leaderboardData = { global: [], personal: [] };

let currentLeaderboardDiffTab = 'normal';

async function openLeaderboard() {
  UI.showScreen('leaderboard');
  const res = await Api.leaderboard();
  if (res && res.ok) {
    leaderboardData = res;
    UI.renderLeaderboard(res.global[currentLeaderboardDiffTab], 'global');
  } else {
    UI.toastApiError(res, 'toast.leaderboard_load_fail');
  }
}

function wireLeaderboardScreen() {
  document.querySelectorAll('#screen-leaderboard .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#screen-leaderboard .tab').forEach(t2 => t2.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.tab;
      // I tab di difficoltà hanno senso solo per la classifica globale
      // (confrontare punteggi tra difficoltà diverse non lo avrebbe).
      document.getElementById('leaderboard-diff-tabs').classList.toggle('hidden', mode !== 'global');
      const rows = mode === 'global' ? leaderboardData.global[currentLeaderboardDiffTab] : leaderboardData.personal;
      UI.renderLeaderboard(rows, mode);
    });
  });

  document.querySelectorAll('#leaderboard-diff-tabs .tab-small').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#leaderboard-diff-tabs .tab-small').forEach(t2 => t2.classList.remove('active'));
      tab.classList.add('active');
      currentLeaderboardDiffTab = tab.dataset.diffTab;
      UI.renderLeaderboard(leaderboardData.global[currentLeaderboardDiffTab], 'global');
    });
  });

  wireBackButtons('#screen-leaderboard');
}

// ---------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------
function openAccount() {
  UI.showScreen('account');
  updateAccountView();
}

function updateAccountView() {
  const user = getStoredUser();
  const loggedInProper = user && !user.is_guest;
  document.getElementById('account-logged-out').classList.toggle('hidden', loggedInProper);
  document.getElementById('account-logged-in').classList.toggle('hidden', !loggedInProper);
  document.getElementById('account-forgot').classList.add('hidden');
  if (loggedInProper) {
    document.getElementById('acc-current-nickname').textContent = user.nickname;
    document.getElementById('acc-change-nickname-input').value = user.nickname || '';
    document.getElementById('acc-change-nickname-msg').textContent = '';
  }
}

function wireAccountScreen() {
  wireBackButtons('#screen-account');

  document.querySelector('[data-action="guest-login"]').addEventListener('click', async () => {
    const nickname = document.getElementById('acc-nickname').value.trim();
    const res = await Api.registerGuest(nickname);
    handleAuthResult(res);
  });

  document.querySelector('[data-action="do-register"]').addEventListener('click', async () => {
    const nickname = document.getElementById('acc-nickname').value.trim();
    const email = document.getElementById('acc-email').value.trim();
    const password = document.getElementById('acc-password').value;
    const res = await Api.register(email, password, nickname);
    handleAuthResult(res);
  });

  document.querySelector('[data-action="do-login"]').addEventListener('click', async () => {
    const email = document.getElementById('acc-email').value.trim();
    const password = document.getElementById('acc-password').value;
    const res = await Api.login(email, password);
    handleAuthResult(res);
  });

  document.querySelector('[data-action="logout"]').addEventListener('click', () => {
    clearSession();
    updateAccountView();
    refreshGemsBadge();
  });

  // v1.37.0 — cambio nickname per chi è già registrato: riusa lo stesso
  // endpoint già usato per gli ospiti (api/auth/set_nickname.php,
  // funziona identicamente per entrambi), l'unicità ora si applica solo
  // contro altri account REGISTRATI (vedi sql/schema.sql).
  document.getElementById('btn-change-nickname').addEventListener('click', async () => {
    const input = document.getElementById('acc-change-nickname-input');
    const nickname = input.value.trim();
    const msgEl = document.getElementById('acc-change-nickname-msg');
    const suggestionBtn = document.getElementById('acc-change-nickname-suggestion-btn');
    msgEl.textContent = '';
    suggestionBtn.classList.add('hidden');
    if (!nickname) { msgEl.className = 'account-error'; msgEl.textContent = t('account.error_generic'); return; }

    const res = await Api.setNickname(nickname);
    if (res && res.ok) {
      const user = getStoredUser();
      if (user) { user.nickname = res.nickname; setSession(getToken(), user); }
      document.getElementById('acc-current-nickname').textContent = res.nickname;
      msgEl.className = 'account-success';
      msgEl.textContent = t('gameover.nickname_saved');
    } else {
      msgEl.className = 'account-error';
      if (!tryShowNicknameSuggestion(res, msgEl, suggestionBtn, input)) {
        msgEl.textContent = res && res.error ? tServerError(res.error) : t('account.error_generic');
      }
    }
  });

  document.getElementById('btn-open-delete-account').addEventListener('click', () => {
    audio.uiClick();
    document.getElementById('delete-account-password').value = '';
    document.getElementById('delete-account-error').textContent = '';
    document.getElementById('delete-account-modal').classList.remove('hidden');
  });

  // --- Password dimenticata ---
  document.querySelector('[data-action="show-forgot"]').addEventListener('click', () => {
    document.getElementById('account-logged-out').classList.add('hidden');
    document.getElementById('account-forgot').classList.remove('hidden');
    document.getElementById('forgot-error').textContent = '';
    document.getElementById('forgot-success').textContent = '';
  });

  document.querySelector('[data-action="hide-forgot"]').addEventListener('click', () => {
    document.getElementById('account-forgot').classList.add('hidden');
    document.getElementById('account-logged-out').classList.remove('hidden');
  });

  document.querySelector('[data-action="send-reset-code"]').addEventListener('click', async () => {
    const email = document.getElementById('forgot-email').value.trim();
    const errEl = document.getElementById('forgot-error');
    const okEl = document.getElementById('forgot-success');
    errEl.textContent = '';
    okEl.textContent = '';
    const res = await Api.forgotPassword(email);
    if (res && res.ok) {
      okEl.textContent = res.message;
    } else {
      errEl.textContent = res && res.error ? tServerError(res.error) : t('account.error_generic');
    }
  });

  document.querySelector('[data-action="confirm-reset"]').addEventListener('click', async () => {
    const email = document.getElementById('forgot-email').value.trim();
    const code = document.getElementById('forgot-code').value.trim();
    const newPassword = document.getElementById('forgot-new-password').value;
    const errEl = document.getElementById('forgot-error');
    const okEl = document.getElementById('forgot-success');
    errEl.textContent = '';
    okEl.textContent = '';
    const res = await Api.resetPassword(email, code, newPassword);
    if (res && res.ok) {
      okEl.textContent = res.message;
      document.getElementById('forgot-code').value = '';
      document.getElementById('forgot-new-password').value = '';
      audio.uiClick();
    } else {
      errEl.textContent = res && res.error ? tServerError(res.error) : t('account.error_generic');
    }
  });
}

/**
 * v1.37.1 — helper condiviso: se `res` è un rifiuto "nickname_taken"
 * con un suggerimento (vedi nickname_taken_by_registered()/
 * suggest_nickname_variant() in api/config.php), mostra il
 * suggerimento come pulsante cliccabile che precompila il campo
 * indicato, e restituisce true. Altrimenti restituisce false, e chi
 * chiama gestisce l'errore nel modo consueto.
 */
function tryShowNicknameSuggestion(res, errEl, suggestionBtn, inputEl) {
  if (res && res.error === 'nickname_taken' && res.suggested_nickname) {
    errEl.textContent = t('quickregister.nickname_taken');
    suggestionBtn.textContent = t('quickregister.use_suggestion', { suggestion: res.suggested_nickname });
    suggestionBtn.classList.remove('hidden');
    suggestionBtn.onclick = () => {
      inputEl.value = res.suggested_nickname;
      suggestionBtn.classList.add('hidden');
      errEl.textContent = '';
    };
    return true;
  }
  return false;
}

function handleAuthResult(res) {
  const errEl = document.getElementById('account-error');
  const suggestionBtn = document.getElementById('account-suggestion-btn');
  suggestionBtn.classList.add('hidden');
  if (res && res.ok) {
    // nicknameSet: true perché l'utente è passato deliberatamente da
    // questa schermata (login, registrazione, o "gioca come ospite"
    // scegliendo/confermando un nickname), quindi non serve più
    // riproporglielo a fine partita.
    setSession(res.token, { ...res.user, nicknameSet: true });
    errEl.textContent = '';
    updateAccountView();
    refreshGemsBadge();
    UI.toast(t('toast.connected'));
  } else if (!tryShowNicknameSuggestion(res, errEl, suggestionBtn, document.getElementById('acc-nickname'))) {
    errEl.textContent = res && res.error ? tServerError(res.error) : t('account.error_generic');
  }
}

// ---------------------------------------------------------------------
// Impostazioni
// ---------------------------------------------------------------------
function openSettings(fromScreen) {
  settingsReturnScreen = fromScreen;
  refreshSettingsScreen();
  refreshSkinOptions();
  refreshStartingWeaponOptions();
  UI.showScreen('settings');
}

/** Popola il selettore skin con "Predefinita" + le skin effettivamente
 *  possedute (mai skin non acquistate): riga nascosta del tutto se non
 *  se ne possiede nessuna, non c'è nulla da scegliere. */
async function refreshSkinOptions() {
  const row = document.getElementById('skin-row');
  const container = document.getElementById('skin-options');
  const res = await Api.shopList();
  if (!res || !res.ok) { row.classList.add('hidden'); return; }

  const ownedSkins = res.items.filter(i => i.type === 'skin' && i.owned_level > 0);
  if (ownedSkins.length === 0) { row.classList.add('hidden'); return; }

  const current = getSettings().equippedSkin;
  container.innerHTML = '';

  const options = [
    { key: null, label: t('settings.skin_default') },
    ...ownedSkins.map(s => ({ key: s.effect_key, label: s.name })),
  ];
  options.forEach(({ key, label }) => {
    const btn = document.createElement('button');
    btn.className = 'control-scheme-option' + (key === current ? ' active' : '');
    btn.innerHTML = `<span class="radio-dot"></span><span>${label}</span>`;
    btn.addEventListener('click', () => {
      saveSettings({ equippedSkin: key });
      refreshSkinOptions();
    });
    container.appendChild(btn);
  });
  row.classList.remove('hidden');
}

/** Popola il selettore arma di partenza con "Pistola" (sempre
 *  disponibile) + le armi sbloccate dal negozio (weapon_unlock,
 *  owned_level > 0). Sempre visibile (a differenza dello skin
 *  selector) perché "Pistola" è sempre un'opzione valida anche senza
 *  nessuno sblocco — non ha senso nasconderla del tutto. */
async function refreshStartingWeaponOptions() {
  const row = document.getElementById('starting-weapon-row');
  const container = document.getElementById('starting-weapon-options');
  const res = await Api.shopList();
  const ownedWeapons = (res && res.ok)
    ? res.items.filter(i => i.type === 'weapon_unlock' && i.owned_level > 0)
    : [];

  const current = getSettings().startingWeapon;
  container.innerHTML = '';

  const options = [
    { key: null, label: t('weapon.pistol') },
    ...ownedWeapons.map(w => ({ key: w.effect_key.replace('weapon_', ''), label: t(`weapon.${w.effect_key.replace('weapon_', '')}`) })),
  ];
  options.forEach(({ key, label }) => {
    const btn = document.createElement('button');
    btn.className = 'control-scheme-option' + (key === current ? ' active' : '');
    btn.innerHTML = `<span class="radio-dot"></span><span>${label}</span>`;
    btn.addEventListener('click', () => {
      saveSettings({ startingWeapon: key });
      refreshStartingWeaponOptions();
    });
    container.appendChild(btn);
  });
  row.classList.remove('hidden');
}

function refreshSettingsScreen() {
  const s = getSettings();

  UI.setToggle(document.getElementById('setting-sfx-enabled'), s.audioEnabled);
  document.getElementById('setting-sfx-volume').value = Math.round(s.sfxVolume * 100);
  UI.setToggle(document.getElementById('setting-music-enabled'), s.musicEnabled);
  document.getElementById('setting-music-volume').value = Math.round(s.musicVolume * 100);
  UI.setToggle(document.getElementById('setting-colorblind'), s.colorblindMode);
  UI.setToggle(document.getElementById('setting-enhanced-fx'), s.enhancedFx);

  UI.populateLanguageSelect(document.getElementById('setting-language'), s.language, (lang) => {
    saveSettings({ language: lang });
    applyTranslations();
    refreshSettingsScreen(); // rietichetta anche i controlli della stessa schermata Impostazioni
  });

  UI.renderControlSchemeOptions(
    document.getElementById('control-scheme-options'),
    availableControlSchemes(),
    s.controlScheme,
    (scheme) => {
      saveSettings({ controlScheme: scheme });
      if (currentGame) currentGame.refreshSettings();
      refreshSettingsScreen();
    }
  );

  UI.renderControlSchemeOptions(
    document.getElementById('player-position-options'),
    [
      { value: 'bottom', labelKey: 'settings.player_position_bottom' },
      { value: 'center', labelKey: 'settings.player_position_center' },
    ],
    s.playerPosition,
    (pos) => {
      saveSettings({ playerPosition: pos });
      if (currentGame) currentGame.refreshSettings();
      refreshSettingsScreen();
    }
  );

  UI.renderControlSchemeOptions(
    document.getElementById('pointer-speed-options'),
    [
      { value: 'constant', labelKey: 'settings.pointer_speed_constant' },
      { value: 'proportional', labelKey: 'settings.pointer_speed_proportional' },
    ],
    s.pointerSpeedMode,
    (mode) => {
      saveSettings({ pointerSpeedMode: mode });
      if (currentGame) currentGame.refreshSettings();
      refreshSettingsScreen();
    }
  );
  // La velocità del puntatore ha senso solo per gli schemi touch/mouse
  // (segui il dito/puntatore): nascosta per tastiera e inclinazione.
  document.getElementById('pointer-speed-row').classList.toggle(
    'hidden', s.controlScheme !== 'touch' && s.controlScheme !== 'mouse'
  );

  UI.renderControlSchemeOptions(
    document.getElementById('dpad-side-options'),
    [
      { value: 'left', labelKey: 'settings.dpad_side_left' },
      { value: 'right', labelKey: 'settings.dpad_side_right' },
    ],
    s.dpadSide,
    (side) => {
      saveSettings({ dpadSide: side });
      if (currentGame) currentGame.refreshSettings();
      refreshSettingsScreen();
    }
  );
  UI.renderControlSchemeOptions(
    document.getElementById('dpad-size-options'),
    [
      { value: 'small', labelKey: 'settings.dpad_size_small' },
      { value: 'medium', labelKey: 'settings.dpad_size_medium' },
      { value: 'large', labelKey: 'settings.dpad_size_large' },
    ],
    s.dpadSize,
    (size) => {
      saveSettings({ dpadSize: size });
      if (currentGame) currentGame.refreshSettings();
      refreshSettingsScreen();
    }
  );
  const dpadOn = s.controlScheme === 'dpad';
  document.getElementById('dpad-side-row').classList.toggle('hidden', !dpadOn);
  document.getElementById('dpad-size-row').classList.toggle('hidden', !dpadOn);

  const tiltBtn = document.getElementById('btn-tilt-permission');
  const showTiltBtn = isMobile && s.controlScheme === 'tilt' && needsExplicitTiltPermission();
  tiltBtn.classList.toggle('hidden', !showTiltBtn);

  const calibrateBtn = document.getElementById('btn-tilt-calibrate');
  calibrateBtn.classList.toggle('hidden', !(isMobile && s.controlScheme === 'tilt'));
}

function wireSettingsScreen() {
  document.getElementById('setting-sfx-enabled').addEventListener('click', () => {
    const enabled = !getSettings().audioEnabled;
    saveSettings({ audioEnabled: enabled });
    applyAudioSetting();
    UI.setToggle(document.getElementById('setting-sfx-enabled'), enabled);
  });

  document.getElementById('setting-sfx-volume').addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    saveSettings({ sfxVolume: v });
    audio.setSfxVolume(v);
  });

  document.getElementById('setting-music-enabled').addEventListener('click', () => {
    const enabled = !getSettings().musicEnabled;
    saveSettings({ musicEnabled: enabled });
    setMusicEnabled(enabled);
    UI.setToggle(document.getElementById('setting-music-enabled'), enabled);
  });

  document.getElementById('setting-music-volume').addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    saveSettings({ musicVolume: v });
    setMusicVolume(v);
  });

  document.getElementById('setting-colorblind').addEventListener('click', () => {
    const enabled = !getSettings().colorblindMode;
    saveSettings({ colorblindMode: enabled });
    applyColorblindSetting();
    if (currentGame) currentGame.refreshSettings();
    UI.setToggle(document.getElementById('setting-colorblind'), enabled);
  });

  document.getElementById('setting-enhanced-fx').addEventListener('click', () => {
    const enabled = !getSettings().enhancedFx;
    saveSettings({ enhancedFx: enabled });
    if (currentGame) currentGame.refreshSettings();
    UI.setToggle(document.getElementById('setting-enhanced-fx'), enabled);
  });

  document.getElementById('btn-tilt-permission').addEventListener('click', async () => {
    const granted = await requestTiltPermission();
    UI.toast(granted ? t('settings.tilt_permission_granted') : t('settings.tilt_permission_denied'));
  });

  document.getElementById('btn-tilt-calibrate').addEventListener('click', () => {
    audio.uiClick();
    openTiltCalibrationModal();
  });

  document.querySelector('[data-action="close-settings"]').addEventListener('click', () => {
    audio.uiClick();
    UI.showScreen(settingsReturnScreen === 'pause' ? 'pause' : 'title');
    if (settingsReturnScreen === 'title') refreshGemsBadge();
  });
}

// ---------------------------------------------------------------------
// Modale calibrazione sensori (livella virtuale)
// ---------------------------------------------------------------------
let tiltLevelRafId = null;

function openTiltCalibrationModal() {
  const modal = document.getElementById('tilt-calibration-modal');
  document.getElementById('tilt-calibration-msg').textContent = '';
  modal.classList.remove('hidden');
  startTiltLevelLoop();
}

function closeTiltCalibrationModal() {
  document.getElementById('tilt-calibration-modal').classList.add('hidden');
  stopTiltLevelLoop();
}

/** Aggiorna in tempo reale la posizione del pallino della livella
 *  virtuale in base alla lettura corrente dei sensori (già calibrata),
 *  e l'avviso sull'orientamento, finché il modale resta aperto. */
function startTiltLevelLoop() {
  const dot = document.getElementById('tilt-level-dot');
  const level = document.querySelector('.tilt-level');
  const warning = document.getElementById('tilt-orientation-warning');
  const step = () => {
    // Calcolato dalla dimensione REALE dell'elemento (non un valore fisso)
    // per restare corretto anche quando la media query per viewport
    // basse (landscape) rimpicciolisce la livella.
    const maxOffsetPx = level.clientWidth / 2 - 12; // metà cerchio meno il raggio del pallino
    const dx = tiltState.x * maxOffsetPx;
    const dy = tiltState.y * maxOffsetPx;
    dot.style.transform = `translate(${dx}px, ${dy}px)`;
    warning.classList.toggle('hidden', isLandscapeOrientation());
    tiltLevelRafId = requestAnimationFrame(step);
  };
  tiltLevelRafId = requestAnimationFrame(step);
}

function stopTiltLevelLoop() {
  if (tiltLevelRafId !== null) {
    cancelAnimationFrame(tiltLevelRafId);
    tiltLevelRafId = null;
  }
}

/**
 * v1.36.0 — registrazione rapida in un modale, aperto dal pulsante
 * "Salva i tuoi progressi con un account" a fine partita. Riusa
 * l'endpoint di registrazione esistente (Api.register): se chi chiama
 * ha già una sessione ospite, quell'endpoint aggiorna l'account
 * esistente invece di crearne uno nuovo (vedi api/auth/register.php),
 * quindi qui non serve nessuna logica speciale per "non perdere" la
 * run appena giocata — è già la stessa identica riga utente.
 */
let quickRegisterSuccessCallback = null;

function openQuickRegisterModal(onSuccess = null) {
  const user = getStoredUser();
  quickRegisterSuccessCallback = onSuccess;
  document.getElementById('qr-nickname').value = (user && user.nickname) || '';
  document.getElementById('qr-email').value = '';
  document.getElementById('qr-password').value = '';
  document.getElementById('qr-error').textContent = '';
  document.getElementById('qr-success').textContent = '';
  document.getElementById('qr-suggestion-btn').classList.add('hidden');
  document.getElementById('quick-register-modal').classList.remove('hidden');
}

function closeQuickRegisterModal() {
  document.getElementById('quick-register-modal').classList.add('hidden');
}

function wireQuickRegisterModal() {
  const modal = document.getElementById('quick-register-modal');
  const suggestionBtn = document.getElementById('qr-suggestion-btn');

  document.getElementById('qr-submit').addEventListener('click', async () => {
    const nickname = document.getElementById('qr-nickname').value.trim();
    const email = document.getElementById('qr-email').value.trim();
    const password = document.getElementById('qr-password').value;
    const errEl = document.getElementById('qr-error');
    const okEl = document.getElementById('qr-success');
    errEl.textContent = '';
    okEl.textContent = '';
    suggestionBtn.classList.add('hidden');

    const res = await Api.register(email, password, nickname);
    if (res && res.ok) {
      // nicknameSet: true per lo stesso motivo di handleAuthResult()
      // sopra — è passato deliberatamente da un modulo di
      // registrazione, non serve riproporgli il prompt nickname.
      setSession(res.token, { ...res.user, nicknameSet: true });
      okEl.textContent = t('toast.connected');
      audio.uiClick();
      refreshGemsBadge();
      // L'invito "salva i tuoi progressi" non ha più senso: non è più
      // un ospite. Lo nascondo subito, senza aspettare la prossima
      // fine-partita che richiamerebbe showGameOverNicknamePromptIfGuest().
      document.getElementById('btn-save-account-prompt').classList.add('hidden');
      const callback = quickRegisterSuccessCallback;
      quickRegisterSuccessCallback = null;
      setTimeout(() => {
        closeQuickRegisterModal();
        if (callback) callback();
      }, 900); // breve pausa per far leggere il messaggio di successo
    } else if (!tryShowNicknameSuggestion(res, errEl, suggestionBtn, document.getElementById('qr-nickname'))) {
      errEl.textContent = res && res.error ? tServerError(res.error) : t('account.error_generic');
    }
  });

  document.getElementById('qr-close').addEventListener('click', () => {
    audio.uiClick();
    quickRegisterSuccessCallback = null;
    closeQuickRegisterModal();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeQuickRegisterModal();
  });
}

/**
 * v1.37.0 — cancellazione definitiva dell'account: richiede la
 * password corrente come ulteriore conferma (vedi api/account/delete.php),
 * non un semplice popup "sei sicuro?". Un successo qui invalida
 * l'intera sessione: si torna al titolo come un visitatore mai loggato
 * (un nuovo ospite silenzioso verrà creato al prossimo avvio, come da
 * comportamento normale di boot()).
 */
function wireDeleteAccountModal() {
  const modal = document.getElementById('delete-account-modal');

  document.getElementById('delete-account-confirm').addEventListener('click', async () => {
    const password = document.getElementById('delete-account-password').value;
    const errEl = document.getElementById('delete-account-error');
    errEl.textContent = '';
    if (!password) { errEl.textContent = t('account.error_generic'); return; }

    const res = await Api.deleteAccount(password);
    if (res && res.ok) {
      clearSession();
      modal.classList.add('hidden');
      UI.showScreen('title');
      refreshGemsBadge();
      UI.toast(t('account.delete_account_done'));
    } else {
      errEl.textContent = res && res.error ? tServerError(res.error) : t('account.error_generic');
    }
  });

  document.getElementById('delete-account-cancel').addEventListener('click', () => {
    audio.uiClick();
    modal.classList.add('hidden');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
}

function wireTiltCalibrationModal() {
  const modal = document.getElementById('tilt-calibration-modal');

  document.getElementById('tilt-calibrate-btn').addEventListener('click', () => {
    calibrateTilt();
    document.getElementById('tilt-calibration-msg').textContent = t('settings.tilt_calibration_done');
    audio.uiClick();
  });

  document.getElementById('tilt-calibration-close').addEventListener('click', () => {
    audio.uiClick();
    closeTiltCalibrationModal();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeTiltCalibrationModal();
  });
}

// ---------------------------------------------------------------------
// Prompt di rotazione (mobile, mostrato SOLO subito prima di avviare
// una partita — non nei menu, che restano pensati per il verticale).
// ---------------------------------------------------------------------
function isPortrait() {
  return !!(window.matchMedia && window.matchMedia('(orientation: portrait)').matches);
}

/**
 * Se su mobile e attualmente in verticale, mostra il prompt di
 * rotazione e resta in attesa finché l'utente non ruota il dispositivo
 * (rilevato automaticamente) oppure preme "Continua in verticale".
 * Non fa nulla (si risolve subito) se non su mobile, già in
 * orizzontale, o se l'utente ha già scelto di continuare in verticale
 * in precedenza in questa sessione.
 */
function maybeWaitForRotate() {
  if (!isMobile || rotatePromptDismissed || !isPortrait()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const overlay = document.getElementById('rotate-prompt');
    const continueBtn = document.getElementById('rotate-continue');
    overlay.classList.remove('hidden');

    const cleanup = () => {
      overlay.classList.add('hidden');
      window.removeEventListener('resize', onOrientationChange);
      window.removeEventListener('orientationchange', onOrientationChange);
      continueBtn.removeEventListener('click', onContinue);
      resolve();
    };
    const onOrientationChange = () => { if (!isPortrait()) cleanup(); };
    const onContinue = () => {
      audio.uiClick();
      // Valida per il resto della sessione (non persistita su disco):
      // se l'utente ha scelto di restare in verticale, non richiediamo
      // di nuovo la rotazione ad ogni partita successiva in questo avvio
      // dell'app, ma la richiesta ricompare comunque al prossimo avvio.
      rotatePromptDismissed = true;
      cleanup();
    };

    window.addEventListener('resize', onOrientationChange);
    window.addEventListener('orientationchange', onOrientationChange);
    continueBtn.addEventListener('click', onContinue);
  });
}


// ---------------------------------------------------------------------
// Modale Changelog
// ---------------------------------------------------------------------
/** Apre/chiude un modale con contenuto disponibile solo in IT+EN (non
 *  tradotto singolarmente in tutte le lingue): italiano se la lingua
 *  attiva è italiano, inglese per tutte le altre. Riusato sia per il
 *  changelog che per la privacy policy, ognuno apribile da più punti
 *  dell'interfaccia (es. la privacy policy sia dal footer del titolo
 *  che dalla schermata Account). */
function wireLangOnlyModal({ linkIds, closeId, modalId, bodyItId, bodyEnId }) {
  const modal = document.getElementById(modalId);
  const openModal = () => {
    audio.uiClick();
    const isItalian = getSettings().language === 'it';
    document.getElementById(bodyItId).classList.toggle('hidden', !isItalian);
    document.getElementById(bodyEnId).classList.toggle('hidden', isItalian);
    modal.classList.remove('hidden');
  };
  linkIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', openModal);
  });
  document.getElementById(closeId).addEventListener('click', () => {
    audio.uiClick();
    modal.classList.add('hidden');
  });
  // Chiudi anche cliccando fuori dal riquadro
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
}

function wireChangelogModal() {
  wireLangOnlyModal({
    linkIds: ['changelog-link'], closeId: 'changelog-close', modalId: 'changelog-modal',
    bodyItId: 'changelog-body-it', bodyEnId: 'changelog-body-en',
  });
}

function wirePrivacyModal() {
  wireLangOnlyModal({
    linkIds: ['privacy-link', 'account-privacy-link'], closeId: 'privacy-close', modalId: 'privacy-modal',
    bodyItId: 'privacy-body-it', bodyEnId: 'privacy-body-en',
  });
}

// ---------------------------------------------------------------------
// PWA: registrazione Service Worker (cache offline dell'app shell).
// Percorso relativo ("./sw.js") per funzionare sia da root che da
// sottocartella; lo scope del service worker segue automaticamente la
// posizione dello script registrato.
// ---------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Registrazione service worker non riuscita:', err);
    });
  });
}

boot();

