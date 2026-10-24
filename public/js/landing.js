// =====================================================================
// landing.js — logica della landing page (nessuna dipendenza dai
// moduli del gioco: pagina volutamente autonoma e leggera). Include un
// piccolo sistema di traduzione IT/EN dedicato, che condivide però la
// stessa chiave di localStorage delle impostazioni del gioco ('nh_settings')
// per restare coerente: se scegli una lingua qui, resta impostata anche
// quando poi clicchi "GIOCA ORA".
// =====================================================================

const SETTINGS_STORAGE_KEY = 'nh_settings';

// ---------------------------------------------------------------------
// Dizionario di traduzione (solo IT/EN: la landing page non replica
// tutte le 7 lingue del gioco, che restano relative alla sola UI di
// gioco vera e propria).
// ---------------------------------------------------------------------
const DICTS = {
  it: {
    nav: { changelog: 'Changelog', leaderboard: 'Classifica', contact: 'Contatti', manual: 'Manuale' },
    hero: {
      tagline: 'Sopravvivi. Spara. Evolvi.',
      subtitle: 'Un horde shooter verticale gratuito, direttamente nel browser. Nessuna pubblicità, nessun acquisto che dia vantaggi in-game.',
      play: 'GIOCA ORA',
      leaderboard: 'CLASSIFICA',
      scroll_hint: 'Scorri per saperne di più',
    },
    about: {
      title: 'Un\'orda non ti dà tregua',
      lead: 'Il tuo personaggio spara automaticamente verso il nemico più vicino: il tuo compito è muoverti, sopravvivere e scegliere con cura ogni potenziamento. Ogni ondata è più densa, più veloce, più letale — e coi minuti la posta si alza da entrambe le parti: anche i nemici diventano progressivamente più forti, non solo tu.',
    },
    feature: {
      wave: { title: 'Ondate infinite', desc: 'Nemici che puntano dritti verso di te, sempre più numerosi e aggressivi col passare del tempo.' },
      bosses: { title: '20 boss', desc: 'Anelli poligonali rotanti con satelliti orbitanti, pattern d\'attacco unici, e un boss finale che cambia colore e attacca a 360°.' },
      upgrades: { title: 'Potenziamenti progressivi', desc: '5 armi, 5 modalità di tiro e 9 passivi, tutti livellabili in-game. Nessuna scelta è mai definitiva o sprecata.' },
      bomb: { title: 'Bomba EMP', desc: 'Un jolly da usare a piacimento per ripulire lo schermo quando la situazione degenera — inefficace sui boss, per tenerti sulla corda.' },
      controls: { title: 'Controlli su misura', desc: 'Touch, D-pad, inclinazione del dispositivo su mobile; tastiera o mouse su desktop. Tutto configurabile.' },
      langs: { title: '7 lingue, installabile', desc: 'Interfaccia completa in italiano, inglese, spagnolo, francese, tedesco, sloveno e russo. Installabile come app su Android e iOS.' },
    },
    stats: { boss: 'Boss', weapons: 'Armi', upgrades: 'Potenziamenti', langs: 'Lingue', cost: 'Costo' },
    support: {
      badge: '◆ Supporta il progetto',
      title: 'NEON HORDE resta gratis grazie a te',
      lead: 'Nessuna pubblicità. Nessun acquisto che dia vantaggi in-game. Nessun abbonamento. NEON HORDE è sviluppato da un solo sviluppatore indipendente nel tempo libero, e lo resterà — ma hosting, dominio e ore di sviluppo hanno un costo reale. Se ti sei divertito, una donazione libera è l\'unico modo con cui il progetto si sostiene.',
      reason1: 'Copre i costi di hosting e dominio, sempre online',
      reason2: 'Finanzia nuovi boss, armi e funzionalità future',
      reason3: 'Nessuna pressione: anche solo giocare e passaparola è già un aiuto enorme',
      cta: '◆ SOSTIENI IL PROGETTO',
      footnote: 'Ogni cifra è benvenuta. Grazie di cuore a chi lo farà. 💚',
    },
    footer: {
      tagline: 'Un progetto Sputlab.',
      play: 'Gioca',
      contact: 'Contattami',
      donate: 'Dona',
      privacy: 'Privacy Policy',
    },
    leaderboard: {
      title: 'Classifica Globale',
      loading: 'Caricamento…',
      empty: 'Nessun risultato ancora.',
      error: 'Impossibile caricare la classifica al momento.',
      wave: 'Ondata',
    },
    difficulty: { easy: 'Facile', normal: 'Normale', hard: 'Difficile', inferno: 'Inferno' },
    common: { close: 'CHIUDI' },
  },

  en: {
    nav: { changelog: 'Changelog', leaderboard: 'Leaderboard', contact: 'Contact', manual: 'Manual' },
    hero: {
      tagline: 'Survive. Shoot. Evolve.',
      subtitle: 'A free vertical horde shooter, straight in your browser. No ads, no purchases that give in-game advantages.',
      play: 'PLAY NOW',
      leaderboard: 'LEADERBOARD',
      scroll_hint: 'Scroll to learn more',
    },
    about: {
      title: 'A horde that never lets up',
      lead: 'Your character fires automatically at the nearest enemy: your job is to move, survive, and carefully choose every upgrade. Every wave is denser, faster, deadlier — and as the minutes pass the stakes rise on both sides: enemies get progressively stronger too, not just you.',
    },
    feature: {
      wave: { title: 'Endless waves', desc: 'Enemies charging straight at you, growing more numerous and aggressive over time.' },
      bosses: { title: '20 bosses', desc: 'Rotating polygon rings with orbiting satellites, unique attack patterns, and a final boss that shifts color and attacks in 360°.' },
      upgrades: { title: 'Progressive upgrades', desc: '5 weapons, 5 fire modes and 9 passives, all levelable in-game. No choice is ever final or wasted.' },
      bomb: { title: 'EMP Bomb', desc: 'A wildcard to use whenever things get out of hand — useless against bosses, to keep you on your toes.' },
      controls: { title: 'Controls your way', desc: 'Touch, D-pad, device tilt on mobile; keyboard or mouse on desktop. Fully configurable.' },
      langs: { title: '7 languages, installable', desc: 'Full interface in Italian, English, Spanish, French, German, Slovenian and Russian. Installable as an app on Android and iOS.' },
    },
    stats: { boss: 'Bosses', weapons: 'Weapons', upgrades: 'Upgrades', langs: 'Languages', cost: 'Cost' },
    support: {
      badge: '◆ Support the project',
      title: 'NEON HORDE stays free thanks to you',
      lead: 'No ads. No purchases that give in-game advantages. No subscriptions. NEON HORDE is built by a single independent developer in their spare time, and it will stay that way — but hosting, domain and development hours have a real cost. If you had fun, a free donation is the only way the project sustains itself.',
      reason1: 'Covers hosting and domain costs, always online',
      reason2: 'Funds new bosses, weapons and future features',
      reason3: 'No pressure: even just playing and word of mouth is already a huge help',
      cta: '◆ SUPPORT THE PROJECT',
      footnote: 'Every amount is welcome. Heartfelt thanks to anyone who does. 💚',
    },
    footer: {
      tagline: 'A Sputlab project.',
      play: 'Play',
      contact: 'Contact me',
      donate: 'Donate',
      privacy: 'Privacy Policy',
    },
    leaderboard: {
      title: 'Global Leaderboard',
      loading: 'Loading…',
      empty: 'No results yet.',
      error: 'Could not load the leaderboard right now.',
      wave: 'Wave',
    },
    difficulty: { easy: 'Easy', normal: 'Normal', hard: 'Hard', inferno: 'Inferno' },
    common: { close: 'CLOSE' },
  },
};

const SUPPORTED = ['it', 'en'];

// ---------------------------------------------------------------------
// Stato lingua corrente, condiviso con le impostazioni del gioco
// ---------------------------------------------------------------------
function readStoredLanguage() {
  try {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
    if (SUPPORTED.includes(settings.language)) return settings.language;
  } catch { /* localStorage non disponibile o dato corrotto: ignora */ }
  const nav = ((navigator.language || 'en') + '').slice(0, 2).toLowerCase();
  return SUPPORTED.includes(nav) ? nav : 'en';
}

function persistLanguage(lang) {
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}'); }
  catch { settings = {}; }
  settings.language = lang;
  try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)); }
  catch { /* storage non disponibile: la scelta vale solo per questa visita */ }
}

let currentLang = readStoredLanguage();

function t(key) {
  const path = key.split('.');
  let value = path.reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), DICTS[currentLang]);
  if (value === undefined) {
    value = path.reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), DICTS.it);
  }
  return value !== undefined ? value : key;
}

function applyTranslations() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  const switchBtn = document.getElementById('lang-switch');
  if (switchBtn) switchBtn.textContent = currentLang === 'it' ? 'EN' : 'IT';
}

function setLanguage(lang) {
  if (!SUPPORTED.includes(lang)) return;
  currentLang = lang;
  persistLanguage(lang);
  applyTranslations();
  updateChangelogLanguageBlocks();
  updateManualLanguageBlocks();
}

function updateChangelogLanguageBlocks() {
  const isItalian = currentLang === 'it';
  const itBlock = document.getElementById('changelog-body-it');
  const enBlock = document.getElementById('changelog-body-en');
  if (itBlock) itBlock.classList.toggle('hidden', !isItalian);
  if (enBlock) enBlock.classList.toggle('hidden', isItalian);
}

// v1.36.0 — stesso meccanismo di updateChangelogLanguageBlocks() sopra,
// per i due blocchi (IT/EN) del manuale: tenuta come funzione separata
// invece di generalizzarle in una sola, per non dover passare via
// parametro coppie di ID ogni volta — la duplicazione qui è minima e
// il codice resta più leggibile così.
function updateManualLanguageBlocks() {
  const isItalian = currentLang === 'it';
  const itBlock = document.getElementById('manual-body-it');
  const enBlock = document.getElementById('manual-body-en');
  if (itBlock) itBlock.classList.toggle('hidden', !isItalian);
  if (enBlock) enBlock.classList.toggle('hidden', isItalian);
}

// ---------------------------------------------------------------------
// Modale Manuale
// ---------------------------------------------------------------------
function wireManualModal() {
  const modal = document.getElementById('landing-manual-modal');
  const openBtns = [document.getElementById('nav-manual'), document.getElementById('footer-manual')];
  const closeBtn = document.getElementById('landing-manual-close');

  openBtns.forEach(btn => btn && btn.addEventListener('click', () => modal.classList.remove('hidden')));
  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  // I link dell'indice sono ancore interne al modale: senza questo, il
  // browser proverebbe a scrollare l'intera pagina (che è dietro,
  // nascosta) invece del contenuto scrollabile del modale stesso.
  modal.querySelectorAll('.manual-toc a').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = modal.querySelector(link.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// ---------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  applyTranslations();
  updateChangelogLanguageBlocks();
  updateManualLanguageBlocks();
  wireLanguageSwitch();
  wireScrollIndicator();
  wireChangelogModal();
  wireManualModal();
  wireLeaderboardModal();
});

function wireLanguageSwitch() {
  const btn = document.getElementById('lang-switch');
  if (!btn) return;
  btn.addEventListener('click', () => {
    setLanguage(currentLang === 'it' ? 'en' : 'it');
  });
}

// ---------------------------------------------------------------------
// Scroll indicator: porta alla sezione successiva con scroll animato
// ---------------------------------------------------------------------
function wireScrollIndicator() {
  const btn = document.getElementById('scroll-indicator');
  const target = document.getElementById('about');
  if (!btn || !target) return;
  btn.addEventListener('click', () => {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// ---------------------------------------------------------------------
// Modale Changelog (contenuto statico, già nell'HTML in due lingue)
// ---------------------------------------------------------------------
function wireChangelogModal() {
  const modal = document.getElementById('landing-changelog-modal');
  const openBtns = [document.getElementById('nav-changelog'), document.getElementById('footer-changelog')];
  const closeBtn = document.getElementById('landing-changelog-close');

  openBtns.forEach(btn => btn && btn.addEventListener('click', () => modal.classList.remove('hidden')));
  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
}

// ---------------------------------------------------------------------
// Modale Classifica: fetch live dal backend (stesso endpoint del gioco)
// ---------------------------------------------------------------------
function wireLeaderboardModal() {
  const modal = document.getElementById('leaderboard-modal');
  const openBtns = [
    document.getElementById('nav-leaderboard'),
    document.getElementById('hero-leaderboard-btn'),
    document.getElementById('footer-leaderboard'),
  ];
  const closeBtn = document.getElementById('leaderboard-close');
  const diffTabs = document.querySelectorAll('#landing-leaderboard-diff-tabs .tab-small');

  let cachedData = null; // { easy: [...], normal: [...], hard: [...], inferno: [...] }
  let currentDiff = 'normal';

  openBtns.forEach(btn => btn && btn.addEventListener('click', () => {
    modal.classList.remove('hidden');
    if (!cachedData) loadLeaderboard();
  }));
  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  diffTabs.forEach(tab => tab.addEventListener('click', () => {
    diffTabs.forEach(t2 => t2.classList.remove('active'));
    tab.classList.add('active');
    currentDiff = tab.dataset.diffTab;
    if (cachedData) renderRows(cachedData[currentDiff] || []);
  }));

  function formatDuration(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function renderRows(rows) {
    const list = document.getElementById('landing-leaderboard-list');
    if (!rows || rows.length === 0) {
      list.innerHTML = `<div class="lb-row"><span class="lb-name">${t('leaderboard.empty')}</span></div>`;
      return;
    }
    list.innerHTML = '';
    rows.forEach((row, i) => {
      const el = document.createElement('div');
      el.className = 'lb-row';
      el.innerHTML = `
        <div class="lb-row-main">
          <span class="lb-rank">#${i + 1}</span>
          <span class="lb-name">${escapeHtml(row.nickname || '—')}</span>
          <span class="lb-score">${row.score}</span>
        </div>
        <div class="lb-row-details">
          <span class="lb-detail">🌊 ${t('leaderboard.wave')} ${row.wave_reached}</span>
          <span class="lb-detail">💀 ${row.kills}</span>
          <span class="lb-detail">⏱ ${formatDuration(row.duration_sec)}</span>
        </div>
      `;
      list.appendChild(el);
    });
  }

  async function loadLeaderboard() {
    const list = document.getElementById('landing-leaderboard-list');
    try {
      const res = await fetch('api/leaderboard.php');
      const data = await res.json();
      if (!data || !data.ok || !data.global) {
        list.innerHTML = `<div class="lb-row"><span class="lb-name">${t('leaderboard.error')}</span></div>`;
        return;
      }
      cachedData = data.global;
      renderRows(cachedData[currentDiff] || []);
    } catch (err) {
      list.innerHTML = `<div class="lb-row"><span class="lb-name">${t('leaderboard.error')}</span></div>`;
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
