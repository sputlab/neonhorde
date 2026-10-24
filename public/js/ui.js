// =====================================================================
// ui.js — gestione DOM: schermate, HUD, liste dinamiche, impostazioni
// =====================================================================
import { formatTime } from './utils.js';
import { t, tServerError, AVAILABLE_LANGUAGES } from './i18n.js';
import { PASSIVES } from './config.js';
import { isRegistered } from './api.js';

const screens = {};
['title', 'difficulty', 'upgrade', 'pause', 'gameover', 'shop', 'missions', 'leaderboard', 'account', 'settings']
  .forEach(name => { screens[name] = document.getElementById(`screen-${name}`); });

export function showScreen(name) {
  Object.values(screens).forEach(s => s && s.classList.add('hidden'));
  if (name && screens[name]) screens[name].classList.remove('hidden');
}

export function hideAllScreens() {
  Object.values(screens).forEach(s => s && s.classList.add('hidden'));
}

// ---------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------
const hud = document.getElementById('hud');
const hudTime = document.getElementById('hud-time');
const hudWave = document.getElementById('hud-wave');
const hudKills = document.getElementById('hud-kills');
const hpFill = document.getElementById('hp-fill');
const hpLabel = document.getElementById('hp-label');
const xpFill = document.getElementById('xp-fill');
const bossBar = document.getElementById('boss-bar');
const bossName = document.getElementById('boss-name');
const bossHpFill = document.getElementById('boss-hp-fill');

export function setHudVisible(visible) {
  hud.classList.toggle('hidden', !visible);
}

export function updateHud({ time, wave, kills, hp, maxHp, xpRatio }) {
  hudTime.textContent = formatTime(time);
  hudWave.textContent = wave;
  hudKills.textContent = kills;
  hpFill.style.width = `${Math.max(0, (hp / maxHp) * 100)}%`;
  hpLabel.textContent = `${Math.max(0, Math.round(hp))}/${Math.round(maxHp)}`;
  xpFill.style.width = `${Math.max(0, Math.min(100, xpRatio * 100))}%`;
}

export function setBossBar(visible, name = '', hpRatio = 1) {
  bossBar.classList.toggle('hidden', !visible);
  if (visible) {
    bossName.textContent = name;
    bossHpFill.style.width = `${Math.max(0, hpRatio * 100)}%`;
  }
}

const bombButton = document.getElementById('btn-bomb');
export function updateBombButton(charges) {
  if (!bombButton) return;
  bombButton.querySelector('.bomb-count').textContent = charges;
  bombButton.disabled = charges <= 0;
}

// ---------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------
const toastEl = document.getElementById('toast');
let toastTimer = null;
export function toast(message, duration = 2200) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), duration);
}

/** Mostra un errore di risposta API, traducendo i messaggi noti del server. */
export function toastApiError(res, fallbackKey = 'account.error_generic') {
  toast(res && res.error ? tServerError(res.error, fallbackKey) : t(fallbackKey));
}

// ---------------------------------------------------------------------
// Schermata upgrade (scegli 1 di 3)
// ---------------------------------------------------------------------
const upgradeChoicesEl = document.getElementById('upgrade-choices');

// v1.32.0 — come formattare il numero "grezzo" restituito da
// PASSIVES[key].previewAtLevel(n) per ciascun passivo: la maggior parte
// sono percentuali, alcuni sono valori assoluti (HP, cariche). Tenuto
// qui (non in config.js) perché è puramente presentazione, non logica
// di gioco — config.js resta la fonte di verità sui NUMERI, ui.js su
// come mostrarli.
const PASSIVE_VALUE_FORMAT = {
  maxhp: (v) => `+${Math.round(v)} HP`,
  regen: (v) => `+${v.toFixed(1)} HP/s`,
  shield: (v) => `+${Math.round(v)}`,
};
function formatPassiveValue(key, value) {
  const fmt = PASSIVE_VALUE_FORMAT[key];
  return fmt ? fmt(value) : `+${Math.round(value * 100)}%`;
}

/** Costruisce la descrizione di una carta "scegli potenziamento" per un
 *  passivo LIVELLABILE (con previewAtLevel): mostra sempre insieme il
 *  totale attuale, quello che si otterrebbe scegliendo questa carta, e
 *  il massimo raggiungibile — non più un singolo numero statico che
 *  rischiava di disallinearsi dal valore reale applicato in game (bug
 *  scoperto in v1.32.0 su danno/cadenza/magnete). */
function buildPassiveDescription(choice) {
  const def = PASSIVES[choice.key];

  // Magnete: progressione a stage con comportamento diverso ad ogni
  // stage (raggio + velocità), non una singola percentuale che cresce
  // — descrizione dedicata per stage invece del formato generico.
  if (choice.key === 'magnet') {
    return t(`passive.magnet_stage${choice.level}_desc`);
  }

  // Passivi senza progressione numerica da mostrare (secondwind: un
  // solo livello, effetto binario) — resta la descrizione statica.
  if (!def || !def.previewAtLevel) return t(`passive.${choice.key}_desc`);

  const nextLevel = choice.level;          // livello che si otterrebbe scegliendo questa carta
  const currentLevel = nextLevel - 1;      // livello già posseduto (0 se prima scelta)
  const currentTotal = formatPassiveValue(choice.key, def.previewAtLevel(currentLevel));
  const nextTotal = formatPassiveValue(choice.key, def.previewAtLevel(nextLevel));
  const maxTotal = formatPassiveValue(choice.key, def.previewAtLevel(def.maxLevel));

  const mainLine = currentLevel === 0 ? nextTotal : `${currentTotal} → ${nextTotal}`;
  const maxLine = nextLevel === def.maxLevel
    ? t('upgrade.maxed_label')
    : t('upgrade.max_label', { value: maxTotal, level: def.maxLevel });

  // Il Vampirismo è anche temporaneo (si rinnova ad ogni scelta, non
  // resta attivo per sempre): l'avviso esistente resta in coda, oltre
  // ai numeri ora sempre corretti.
  const caveat = choice.key === 'lifesteal' ? ` <span class="upgrade-desc-sub">${t('passive.lifesteal_caveat')}</span>` : '';

  return `${mainLine}<br><span class="upgrade-desc-sub">${maxLine}</span>${caveat}`;
}

/** Ricava nome/descrizione tradotti di una scelta di potenziamento a partire da kind+key. */
function translateUpgradeChoice(choice) {
  if (choice.kind === 'weapon') {
    return { name: t(`weapon.${choice.key}`), desc: t('weapon.new_equipped') };
  }
  if (choice.kind === 'bomb') {
    return { name: t('bomb.name'), desc: t('bomb.desc', { max: choice.maxLevel }) };
  }
  if (choice.kind === 'firemode') {
    return { name: t(`firemode.${choice.key}`), desc: t(`firemode.${choice.key}_desc`, { level: choice.level }) };
  }
  return { name: t(`passive.${choice.key}`), desc: buildPassiveDescription(choice) };
}

export function showUpgradeChoices(choices, onPick) {
  upgradeChoicesEl.innerHTML = '';
  choices.forEach(choice => {
    const { name, desc } = translateUpgradeChoice(choice);
    // Il cambio arma non ha livelli (un solo equip alla volta): il
    // badge "Lv. X/Y" si mostra solo per fire mode/passivi livellabili.
    const levelBadge = choice.level
      ? `<span class="upgrade-level">${t('upgrade.level_badge', { next: choice.level, max: choice.maxLevel })}</span>`
      : '';
    const btn = document.createElement('button');
    btn.className = 'upgrade-card';
    btn.innerHTML = `
      <span class="upgrade-icon">${choice.icon}</span>
      <span class="upgrade-name">${name}</span>
      ${levelBadge}
      <span class="upgrade-desc">${desc}</span>
    `;
    btn.addEventListener('click', () => onPick(choice));
    upgradeChoicesEl.appendChild(btn);
  });
  showScreen('upgrade');
}

// ---------------------------------------------------------------------
// Traguardi (missioni a progressione permanente, v1.33.0)
// ---------------------------------------------------------------------
const ACHIEVEMENT_CATEGORY_META = {
  kills_total:   { icon: '💀' },
  runs_total:    { icon: '🏃' },
  survival_best: { icon: '⏱️' },
  streak_best:   { icon: '🔥' },
  bosses_total:  { icon: '👑' },
  damage_total:  { icon: '💥' },
};
const ACHIEVEMENT_CATEGORY_ORDER = ['kills_total', 'runs_total', 'survival_best', 'streak_best', 'bosses_total', 'damage_total'];

function formatAchievementValue(category, value) {
  return category === 'survival_best' ? formatTime(value) : value.toLocaleString();
}

/** @param viewMode 'next' (un solo tier per categoria, il prossimo da
 *  completare — vista di default) o 'overview' (quanti tier già
 *  riscattati su quanti totali, per categoria, senza dettaglio). */
export function renderAchievements(categories, viewMode, onClaim) {
  const list = document.getElementById('achievements-list');
  list.innerHTML = '';

  ACHIEVEMENT_CATEGORY_ORDER.forEach(cat => {
    const tiers = categories[cat] || [];
    if (tiers.length === 0) return;
    const meta = ACHIEVEMENT_CATEGORY_META[cat];
    const catName = t(`achievements.category_${cat}`);
    const row = document.createElement('div');
    row.className = 'mission-item';

    if (viewMode === 'overview') {
      const claimedCount = tiers.filter(tr => tr.claimed).length;
      row.innerHTML = `
        <div class="mission-info">
          <span class="mission-desc">${meta.icon} ${catName}</span>
          <span class="mission-progress">${t('achievements.tier_progress', { done: claimedCount, total: tiers.length })}</span>
        </div>
      `;
      list.appendChild(row);
      return;
    }

    // Vista "next": il primo tier NON ancora riscattato di questa
    // categoria — se non ce n'è più nessuno, la categoria è completa.
    const nextTier = tiers.find(tr => !tr.claimed);
    if (!nextTier) {
      row.innerHTML = `
        <div class="mission-info">
          <span class="mission-desc">${meta.icon} ${catName}</span>
          <span class="mission-progress">${t('achievements.category_maxed')}</span>
        </div>
        <button class="mission-claim-btn" disabled>✓</button>
      `;
      list.appendChild(row);
      return;
    }

    const pct = Math.min(100, Math.round((nextTier.progress / nextTier.target) * 100));
    const skinNote = nextTier.reward_skin_key ? ` + ${t('achievements.skin_reward')}` : '';
    const needsRegistration = nextTier.completed && !nextTier.claimed && !isRegistered();
    row.innerHTML = `
      <div class="mission-info">
        <span class="mission-desc">${meta.icon} ${catName} — ${t('achievements.tier_label', { n: nextTier.tier_order })}</span>
        <span class="mission-progress">${formatAchievementValue(cat, Math.min(nextTier.progress, nextTier.target))}/${formatAchievementValue(cat, nextTier.target)} — ${nextTier.reward_gems} ◆${skinNote}</span>
      </div>
      <button class="mission-claim-btn ${needsRegistration ? 'mission-claim-btn-locked' : ''}" ${(!nextTier.completed || nextTier.claimed) ? 'disabled' : ''}>
        ${nextTier.completed ? t('missions.claim_button') : pct + '%'}
      </button>
    `;
    if (nextTier.completed && !nextTier.claimed) {
      const btn = row.querySelector('.mission-claim-btn');
      if (needsRegistration) {
        btn.addEventListener('click', () => toast(t('missions.register_to_claim')));
      } else {
        btn.addEventListener('click', () => onClaim(nextTier.id));
      }
    }
    list.appendChild(row);
  });
}

// ---------------------------------------------------------------------
// Recap fine partita
// ---------------------------------------------------------------------
export function fillGameOverRecap({ wave, kills, timeSec, score, gemsEarned, streak = 0, streakBonusGems = 0 }) {
  document.getElementById('recap-wave').textContent = wave;
  document.getElementById('recap-kills').textContent = kills;
  document.getElementById('recap-time').textContent = formatTime(timeSec);
  document.getElementById('recap-score').textContent = score;
  document.getElementById('recap-gems-value').textContent = `+${gemsEarned}`;

  // Formato compatto ("🔥 N", nessuna frase) pensato per stare in
  // un'unica riga assieme a feedback e condivisione — vedi
  // .gameover-social-row in css/style.css. Il "+bonus" eventualmente
  // guadagnato in questa run non viene più scritto per esteso qui (non
  // c'è spazio orizzontale sufficiente in landscape basso), ma resta
  // disponibile nel valore restituito dal server se in futuro serve
  // mostrarlo altrove.
  const streakLine = document.getElementById('recap-streak-line');
  if (streak > 0) {
    streakLine.textContent = `🔥 ${streak}`;
    streakLine.title = streakBonusGems > 0
      ? t('gameover.streak_bonus', { n: streak, bonus: streakBonusGems })
      : t('gameover.streak', { n: streak });
    streakLine.classList.remove('hidden');
  } else {
    streakLine.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------
// Difficoltà (le etichette "xN.N ricompense" vengono composte via i18n)
// ---------------------------------------------------------------------
export function refreshDifficultyLabels() {
  document.querySelectorAll('[data-diff-mult]').forEach(el => {
    el.textContent = t('difficulty.reward', { mult: el.dataset.diffMult });
  });
}

// ---------------------------------------------------------------------
// Negozio
// ---------------------------------------------------------------------
function translateShopItemName(item) {
  return t(`shopitem.${item.effect_key}`) !== `shopitem.${item.effect_key}` ? t(`shopitem.${item.effect_key}`) : item.name;
}

export function renderShop(items, gems, onBuy) {
  document.getElementById('shop-gems').textContent = gems ?? 0;
  const list = document.getElementById('shop-list');
  list.innerHTML = '';

  items.forEach(item => {
    const maxed = item.owned_level >= item.max_level;
    const baseCost = Math.round(item.cost_gems * (1 + 0.15 * item.owned_level));
    // L'offerta del giorno (item.deal_price, calcolata server-side in
    // shop.php) si applica solo finché l'oggetto non è ancora posseduto:
    // è per definizione su oggetti one-shot (non stackabili), quindi non
    // ha senso per livelli successivi al primo.
    const isDeal = item.deal_price != null && item.owned_level === 0;
    const nextCost = isDeal ? item.deal_price : baseCost;
    const levelLabel = item.max_level > 1
      ? t('shop.level', { a: item.owned_level, b: item.max_level })
      : (maxed ? t('shop.owned') : t('shop.not_owned'));
    const row = document.createElement('div');
    row.className = 'shop-item' + (isDeal && !maxed ? ' shop-item-deal' : '');
    row.innerHTML = `
      <div class="shop-item-info">
        <span class="shop-item-name">${translateShopItemName(item)}</span>
        ${isDeal && !maxed ? `<span class="shop-deal-badge">${t('shop.deal_badge')}</span>` : ''}
        <span class="shop-item-level">${levelLabel}</span>
      </div>
      <button class="shop-buy-btn" ${maxed ? 'disabled' : ''}>${maxed ? '✓' : nextCost + ' ◆'}</button>
    `;
    if (!maxed) {
      row.querySelector('.shop-buy-btn').addEventListener('click', () => onBuy(item.id));
    }
    list.appendChild(row);
  });
}

// ---------------------------------------------------------------------
// Missioni
// ---------------------------------------------------------------------
function translateMissionDesc(m) {
  const key = `mission.${m.key}`;
  const translated = t(key);
  return translated !== key ? translated : m.description;
}

export function renderMissions(missions, mode, onClaim) {
  const list = document.getElementById('missions-list');
  list.innerHTML = '';

  // "Attive" mostra tutto ciò che non è ancora stato riscattato
  // (comprese le missioni già completate ma con la ricompensa ancora da
  // prendere, altrimenti sparirebbero prima che il giocatore riesca a
  // riscattarle). "Completate" mostra solo quelle già riscattate: una
  // volta lì, sono archiviate, non tornano più tra le attive.
  const filtered = missions.filter(m => mode === 'completed' ? m.claimed : !m.claimed);

  if (filtered.length === 0 && mode === 'completed') {
    list.innerHTML = `<div class="mission-item"><span class="mission-desc">${t('missions.empty_completed')}</span></div>`;
    return;
  }

  filtered.forEach(m => {
    const row = document.createElement('div');
    row.className = 'mission-item';
    const pct = Math.min(100, Math.round((m.progress / m.target) * 100));
    // v1.35.0 — chi gioca ancora da ospite (nessuna email registrata)
    // vede comunque la missione e il suo stato reale, ma il pulsante
    // "Riscatta" resta bloccato: un clic mostra un avviso invece di
    // incassare la ricompensa, per spingere verso la registrazione nel
    // momento in cui il valore da perdere è già visibile e concreto.
    const needsRegistration = m.completed && !m.claimed && !isRegistered();
    row.innerHTML = `
      <div class="mission-info">
        <span class="mission-desc">${translateMissionDesc(m)}</span>
        <span class="mission-progress">${Math.min(m.progress, m.target)}/${m.target} — ${m.reward_gems} ◆</span>
      </div>
      <button class="mission-claim-btn ${needsRegistration ? 'mission-claim-btn-locked' : ''}" ${(!m.completed || m.claimed) ? 'disabled' : ''}>
        ${m.claimed ? '✓' : (m.completed ? t('missions.claim_button') : pct + '%')}
      </button>
    `;
    if (m.completed && !m.claimed) {
      const btn = row.querySelector('.mission-claim-btn');
      if (needsRegistration) {
        btn.addEventListener('click', () => toast(t('missions.register_to_claim')));
      } else {
        btn.addEventListener('click', () => onClaim(m.id));
      }
    }
    list.appendChild(row);
  });
}

/** Formatta una data MySQL ("2026-09-08 10:23:00") in "8 set" locale
 *  (senza l'anno, non serve per run recenti) — fallback al valore
 *  grezzo se il parsing fallisce per qualunque motivo. */
function formatShortDate(mysqlDatetime) {
  try {
    const d = new Date(mysqlDatetime.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return mysqlDatetime;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  } catch {
    return mysqlDatetime;
  }
}

// ---------------------------------------------------------------------
// Classifica
// ---------------------------------------------------------------------
/**
 * @param rows righe da mostrare (già filtrate per difficoltà se mode==='global')
 * @param mode 'global' | 'personal' — nel personale si mostra anche la
 *        difficoltà di ciascuna run (nel globale è già implicita dal tab attivo)
 */
export function renderLeaderboard(rows, mode) {
  const list = document.getElementById('leaderboard-list');
  list.innerHTML = '';

  if (!rows || rows.length === 0) {
    list.innerHTML = `<div class="lb-row"><span class="lb-name">${t('leaderboard.empty')}</span></div>`;
    return;
  }

  rows.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'lb-row';
    // Globale: mostra il nickname. Personale ("le mie run"): il nickname
    // è sempre il proprio, quindi mostra la data della run — più utile.
    const name = mode === 'global' ? (r.nickname || '—') : formatShortDate(r.created_at);
    const diffBadge = mode === 'personal' ? `<span class="lb-diff-badge lb-diff-${r.difficulty}">${t(`difficulty.${r.difficulty}`)}</span>` : '';
    row.innerHTML = `
      <div class="lb-row-main">
        <span class="lb-rank">#${i + 1}</span>
        <span class="lb-name">${name}</span>
        <span class="lb-score">${r.score}</span>
      </div>
      <div class="lb-row-details">
        <span class="lb-detail">🌊 ${t('gameover.wave')} ${r.wave_reached}</span>
        <span class="lb-detail">💀 ${r.kills}</span>
        <span class="lb-detail">⏱ ${formatTime(r.duration_sec)}</span>
        ${diffBadge}
      </div>
    `;
    list.appendChild(row);
  });
}

// ---------------------------------------------------------------------
// Impostazioni: lingua, schema di controllo, toggle
// ---------------------------------------------------------------------
export function populateLanguageSelect(selectEl, currentLang, onChange) {
  selectEl.innerHTML = '';
  AVAILABLE_LANGUAGES.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === currentLang) opt.selected = true;
    selectEl.appendChild(opt);
  });
  selectEl.onchange = () => onChange(selectEl.value);
}

export function renderControlSchemeOptions(container, schemes, currentScheme, onSelect) {
  container.innerHTML = '';
  schemes.forEach(({ value, labelKey }) => {
    const btn = document.createElement('button');
    btn.className = 'control-scheme-option' + (value === currentScheme ? ' active' : '');
    btn.innerHTML = `<span class="radio-dot"></span><span>${t(labelKey)}</span>`;
    btn.addEventListener('click', () => onSelect(value));
    container.appendChild(btn);
  });
}

export function setToggle(el, on) {
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

// ---------------------------------------------------------------------
// Input da tastiera (WASD / frecce) — restituisce stato corrente
// ---------------------------------------------------------------------
export function setupKeyboard() {
  const state = { up: false, down: false, left: false, right: false };
  const map = {
    KeyW: 'up', ArrowUp: 'up',
    KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
  };
  window.addEventListener('keydown', (e) => { if (map[e.code]) state[map[e.code]] = true; });
  window.addEventListener('keyup', (e) => { if (map[e.code]) state[map[e.code]] = false; });
  return state;
}
