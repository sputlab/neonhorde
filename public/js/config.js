// =====================================================================
// config.js — costanti globali di bilanciamento e configurazione
// =====================================================================

export const API_BASE = 'api';
// ^ Percorso relativo alla posizione di game.html (il file che carica
//   questo script): funziona sia se il gioco è pubblicato nella root
//   del dominio, sia in una sottocartella (es. sputlab.com/webapp/
//   neonhorde/) senza dover modificare nulla.

// Versione dell'app, mostrata nel footer del menu titolo (utile per
// verificare a colpo d'occhio quale build è effettivamente in esecuzione
// dopo un deploy, sia in locale che sul server).
export const APP_VERSION = '1.37.1';

export const CONFIG = {
  // Mondo / rendering
  WORLD_PADDING: 60,          // margine oltre lo schermo dove i nemici possono spawnare

  // Player
  PLAYER_BASE_HP: 100,
  PLAYER_BASE_SPEED: 220,     // px/sec
  PLAYER_RADIUS: 16,
  PLAYER_PICKUP_RADIUS: 46,   // raggio magnetismo base
  PLAYER_INVULN_MS: 500,      // invulnerabilità dopo un colpo subito
  POINTER_MAX_SPEED_DISTANCE: 220, // distanza (px) oltre la quale la modalità proporzionale raggiunge il 100% velocità

  // Scaling per livello dei potenziamenti non numerici (homing/esplosivo),
  // il cui effetto non è un semplice "+N" come per pierce/multishot/bounce.
  HOMING_BASE_TURN_RATE: 4,        // rad/sec al livello 1
  HOMING_TURN_RATE_PER_LEVEL: 2,   // rad/sec aggiunti per ogni livello oltre il 1°
  EXPLOSIVE_BASE_RADIUS: 60,       // px al livello 1
  EXPLOSIVE_RADIUS_PER_LEVEL: 20,  // px aggiunti per ogni livello oltre il 1°
  EXPLOSIVE_BASE_DAMAGE_MULT: 0.55,      // frazione del danno del proiettile al livello 1
  EXPLOSIVE_DAMAGE_MULT_PER_LEVEL: 0.12, // aggiunta per ogni livello oltre il 1°
  CRIT_DAMAGE_MULT: 2.0,           // moltiplicatore danno su colpo critico

  // Bomba EMP: potenziamento accumulabile (scelta a level-up o pickup a
  // terra) che azzera tutti i nemici regolari visibili a schermo ma è
  // del tutto inefficace sui boss. Attivabile a piacimento (tasto E su
  // desktop, pulsante dedicato su schermo).
  BOMB_MAX_CHARGES: 2,
  BOMB_DROP_CHANCE: 0.006,       // probabilità che un nemico ucciso lasci cadere una bomba
  BOMB_FLASH_DURATION_MS: 400,   // durata del flash visivo quando si usa una bomba

  // Boss: velocità di rotazione degli anelli poligonali e dei satelliti
  // orbitanti (rad/sec), e parametri del nuovo attacco "radial_burst"
  // (raffica di proiettili a 360°, esclusiva del boss finale).
  BOSS_RING_ROTATION_SPEED: 0.6,
  BOSS_SATELLITE_ORBIT_SPEED: 1.1,
  BOSS_SATELLITE_ORBIT_RADIUS_MULT: 1.8, // moltiplicato per il raggio del boss
  BOSS_FINAL_HUE_CYCLE_SPEED: 40,        // gradi/secondo di rotazione colore
  RADIAL_BURST_PROJECTILE_COUNT: 16,
  RADIAL_BURST_PROJECTILE_SPEED: 240,

  // Durata massima di vita di un proiettile (in secondi) prima che inizi
  // a svanire, e durata della dissolvenza stessa (ms). Rete di sicurezza
  // soprattutto per i proiettili homing: senza un tetto, un proiettile
  // che non trova mai un bersaglio da colpire (o lo perde) potrebbe
  // vagare per lo schermo a tempo indeterminato.
  PROJECTILE_MAX_LIFETIME_SEC: 3.5,
  PROJECTILE_FADE_DURATION_MS: 500,
  // v1.22.0 — i proiettili homing hanno una vita massima RIDOTTA
  // rispetto a quella normale: agganciati a un bersaglio fisso e capaci
  // di virare aggressivamente verso di esso (vedi HOMING_BASE_TURN_RATE
  // sotto), se lasciati vivere quanto un proiettile normale possono
  // "cacciare" più nemici in sequenza per l'intera durata (specialmente
  // con la perforazione), diventando efficaci quasi da soli con un
  // impegno minimo da parte del giocatore. Una vita più corta li tiene
  // un potenziamento forte senza farli diventare una soluzione
  // automatica per ripulire lo schermo.
  PROJECTILE_HOMING_MAX_LIFETIME_SEC: 1.6,

  // Wave / spawner
  WAVE_DURATION_SEC: 75,          // durata media di un'ondata prima del prossimo step di difficoltà
  BOSS_INTERVAL_SEC: 75,          // ogni quanto arriva un boss (60-90s richiesto → 75s medio)
  SPAWN_BASE_INTERVAL_MS: 900,    // intervallo iniziale tra spawn
  SPAWN_MIN_INTERVAL_MS: 140,     // intervallo minimo (cap difficoltà)
  MAX_ENEMIES_ON_SCREEN: 220,

  // Difficoltà (moltiplicatori applicati a HP/danno/velocità nemici e a
  // ricompense). v1.17.0 — aggiunta la difficoltà "easy" e ammorbidita
  // "normal": il gioco risultava troppo punitivo già nelle prime ondate.
  // Ogni livello ha ora anche il proprio ritmo di scaling temporale
  // (timeScaleRampSec/timeScaleMaxBonus, prima erano costanti globali
  // uguali per tutti) e bonus diretti al player (playerHpBonus/
  // playerDmgBonus/playerRegenBonus, semantica additiva come i bonus
  // del negozio: 0.35 = +35%) — così a "easy" il giocatore non solo
  // affronta nemici più deboli, ma è lui stesso più forte e resistente.
  //
  // "easy" è tarato perché la difficoltà percepita all'ondata 20 sia
  // paragonabile a quella dell'ondata 10 su "normal": lo scaling
  // temporale è disteso su 700s (contro 320s di "normal") così il tetto
  // massimo (+200%) viene raggiunto solo verso l'ondata 20 invece che
  // già verso l'ondata 9, dando una curva di crescita molto più lunga e
  // graduale invece di appiattirsi presto.
  DIFFICULTY: {
    easy: {
      enemyHp: 0.55, enemyDmg: 0.5, spawnRate: 0.68, rewardMult: 0.75,
      timeScaleRampSec: 700, timeScaleMaxBonus: 2.0, spawnRampSec: 480,
      // playerHpBonus è un valore FLAT (come i bonus HP del negozio, non
      // percentuale come playerDmgBonus) — vedi Player.applyMetaUpgrades()
      // in entities.js, che tratta base_hp e base_dmg con semantiche
      // diverse: +40 qui equivale a +40% degli HP base (100).
      playerHpBonus: 40, playerDmgBonus: 0.3, playerRegenBonus: 0.4,
    },
    normal: {
      enemyHp: 0.8, enemyDmg: 0.8, spawnRate: 0.88, rewardMult: 1.0,
      timeScaleRampSec: 320, timeScaleMaxBonus: 2.0, spawnRampSec: 300,
      playerHpBonus: 0, playerDmgBonus: 0, playerRegenBonus: 0,
    },
    hard: {
      enemyHp: 1.5, enemyDmg: 1.3, spawnRate: 1.25, rewardMult: 1.5,
      timeScaleRampSec: 300, timeScaleMaxBonus: 2.0, spawnRampSec: 300,
      playerHpBonus: 0, playerDmgBonus: 0, playerRegenBonus: 0,
    },
    inferno: {
      enemyHp: 2.3, enemyDmg: 1.7, spawnRate: 1.55, rewardMult: 2.2,
      timeScaleRampSec: 260, timeScaleMaxBonus: 2.2, spawnRampSec: 260,
      playerHpBonus: 0, playerDmgBonus: 0, playerRegenBonus: 0,
    },
  },

  // Scaling nel tempo di HP/danno dei nemici (boss inclusi), applicato
  // SOPRA il moltiplicatore di difficoltà scelto a inizio run. Cresce
  // linearmente con l'elapsed della run fino a un tetto, per contrastare
  // la crescita di potenza del player dovuta ai potenziamenti stackati:
  // senza questo contrappeso, dopo alcuni minuti qualunque difficoltà
  // diventa banale perché i nemici restano sempre della stessa forza
  // mentre il player continua a scalare (bug di bilanciamento risolto
  // in v1.6.0). v1.17.0 — i parametri di questo scaling (ramp/tetto)
  // sono ora specifici per ogni difficoltà (timeScaleRampSec/
  // timeScaleMaxBonus in DIFFICULTY sopra), non più costanti globali
  // uguali per tutti: vedi spawner.js `timeScaleMult`.

  // XP / livelli
  XP_ORB_VALUE: 1,
  XP_TO_LEVEL_BASE: 10,
  XP_TO_LEVEL_GROWTH: 1.18, // ogni livello richiede il 18% di XP in più del precedente

  // Colori (coerenti con la palette CSS)
  COLORS: {
    player: '#35e0c1',
    enemyBasic: '#e0546b',
    enemyFast: '#ffdd57',
    enemyTank: '#7c8797',
    enemyRanged: '#ff8f4d',
    enemySwarm: '#e05fd0',
    enemySplitter: '#7ed957',
    enemyShielded: '#4d8fff',
    enemyTeleporter: '#a239ff',
    enemySummoner: '#5c8a8a',
    boss: '#ffb020',
    projectilePlayer: '#9df7ea',
    projectileEnemy: '#ff6b6b',
    xpOrb: '#b98aff',
    coin: '#ffd24d',
    background: '#0a0d12',
  },

  // Palette alternativa per la modalità Daltonici: evita di affidare
  // distinzioni di gameplay (player/nemici/proiettili) solo a coppie
  // rosso/verde o rosso/arancione difficili da distinguere per i tipi
  // più comuni di daltonismo (protanopia/deuteranopia). Usa una scala
  // blu-giallo-viola, molto più sicura, mantenendo comunque l'atmosfera
  // neon del gioco.
  COLORS_COLORBLIND: {
    player: '#4fc3ff',
    enemyBasic: '#ffb703',
    enemyFast: '#fff275',
    enemyTank: '#8d99ae',
    enemyRanged: '#ff8fa3',
    enemySwarm: '#c77dff',
    enemySplitter: '#06d6a0',
    enemyShielded: '#219ebc',
    enemyTeleporter: '#7b2cbf',
    enemySummoner: '#adb5bd',
    boss: '#ffd166',
    projectilePlayer: '#caf0f8',
    projectileEnemy: '#ff8fa3',
    xpOrb: '#c77dff',
    coin: '#ffd166',
    background: '#0a0d12',
  },

  // Nemici speciali (v1.24.0)
  SHIELDED_ROTATION_SPEED: 1.3,   // rad/sec di rotazione dello scudo del Corazzato
  SHIELDED_ARC_WIDTH: 1.9,        // ampiezza (radianti, ~109°) dell'arco scudato
  SHIELDED_BLOCK_RATIO: 0.85,     // frazione di danno bloccata se colpito dal lato scudato
  TELEPORTER_INTERVAL_MS: 3600,   // ogni quanto il Teletrasportatore si sposta
  TELEPORTER_MIN_DIST: 140,       // distanza minima dal player dopo il teletrasporto
  TELEPORTER_MAX_DIST: 240,       // distanza massima dal player dopo il teletrasporto
  SUMMONER_INTERVAL_MS: 5000,     // ogni quanto l'Evocatore genera un minion

  // Audio
  MASTER_VOLUME: 0.35,
};

export const ENEMY_TYPES = {
  basic:  { hp: 18,  speed: 70,  dmg: 8,  radius: 14, xp: 1, coinChance: 0.05, colorKey: 'enemyBasic',  score: 10 },
  fast:   { hp: 10,  speed: 145, dmg: 6,  radius: 11, xp: 1, coinChance: 0.05, colorKey: 'enemyFast',   score: 12 },
  tank:   { hp: 90,  speed: 42,  dmg: 14, radius: 22, xp: 3, coinChance: 0.15, colorKey: 'enemyTank',   score: 30 },
  ranged: { hp: 22,  speed: 60,  dmg: 10, radius: 14, xp: 2, coinChance: 0.10, colorKey: 'enemyRanged', score: 20, fireRateMs: 1400, projectileSpeed: 220 },
  swarm:  { hp: 6,   speed: 100, dmg: 4,  radius: 9,  xp: 1, coinChance: 0.02, colorKey: 'enemySwarm',  score: 8 },

  // v1.24.0 — 4 nuovi tipi di nemico, ciascuno con un comportamento
  // distintivo oltre a HP/danno/velocità (vedi entities.js Enemy e
  // game.js per la logica di ciascuno):
  //  - splitter: alla morte si divide in `splitCount` copie del tipo
  //    `splitsInto` (che a sua volta NON deve avere splitsInto, per non
  //    creare una catena infinita).
  //  - shielded: ha uno scudo che copre solo un arco (SHIELDED_ARC_WIDTH)
  //    e ruota nel tempo; i colpi che arrivano da quel lato vengono
  //    ridotti di SHIELDED_BLOCK_RATIO.
  //  - teleports: si teletrasporta periodicamente a distanza dal player.
  //  - summons: mantiene le distanze (come i nemici "ranged") e genera
  //    periodicamente un nemico 'swarm' come minion.
  splitter:      { hp: 26, speed: 62, dmg: 8,  radius: 17, xp: 2, coinChance: 0.08, colorKey: 'enemySplitter',   score: 18, splitsInto: 'splitterChild', splitCount: 2 },
  splitterChild: { hp: 8,  speed: 95, dmg: 4,  radius: 10, xp: 1, coinChance: 0,    colorKey: 'enemySplitter',   score: 6 },
  shielded:      { hp: 55, speed: 46, dmg: 11, radius: 18, xp: 3, coinChance: 0.12, colorKey: 'enemyShielded',   score: 26, shielded: true },
  teleporter:    { hp: 20, speed: 55, dmg: 9,  radius: 13, xp: 2, coinChance: 0.08, colorKey: 'enemyTeleporter', score: 18, teleports: true },
  summoner:      { hp: 34, speed: 40, dmg: 6,  radius: 15, xp: 3, coinChance: 0.10, colorKey: 'enemySummoner',   score: 24, summons: true, keepsDistance: true },
};

// ---------------------------------------------------------------------
// BOSS: 19 boss regolari + 1 boss finale, generati proceduralmente da un
// "roster" che fissa solo chiave e combinazione di attacchi — hp/danno/
// velocità/raggio/punteggio crescono da una formula (facile da ritarare
// tutta insieme cambiando le costanti qui sotto, invece di 20 numeri
// scritti a mano). Nome mostrato in-game da js/i18n.js (chiave boss.<key>).
//
// Aspetto visivo (vedi _renderBoss in js/game.js): non più un pallino
// colorato, ma anelli poligonali concentrici in rotazione + satelliti
// triangolari orbitanti (stesso linguaggio visivo dei nemici normali).
// `hue` distribuisce automaticamente colori ben distinti anche con 20
// boss usando l'angolo aureo (137.5°) — la vera differenziazione visiva
// tra un boss e l'altro è affidata soprattutto a `ringSides` (numero di
// lati dell'anello esterno) e `satelliteCount`, non al colore, per
// restare leggibile anche in modalità Daltonici.
// ---------------------------------------------------------------------
// v1.29.0 — ogni boss ha ora almeno 'fan_shot' nel proprio elenco di
// attacchi: prima 7 boss su 19 (brute, wraith, colossus, warden,
// behemoth, tyrant, devourer) non sparavano mai proiettili, limitandosi
// a caricare e/o evocare — un boss "che si rispetti" deve sempre poter
// sparare. Gli attacchi preesistenti restano tutti, fan_shot si
// aggiunge al loro repertorio invece di sostituirli.
const BOSS_ROSTER = [
  { key: 'brute',      attacks: ['charge', 'summon', 'fan_shot'] },
  { key: 'sorcerer',   attacks: ['fan_shot', 'summon'] },
  { key: 'juggernaut', attacks: ['charge', 'fan_shot'] },
  { key: 'sentinel',   attacks: ['fan_shot'] },
  { key: 'wraith',     attacks: ['charge', 'fan_shot'] },
  { key: 'colossus',   attacks: ['summon', 'fan_shot'] },
  { key: 'hive',       attacks: ['summon', 'fan_shot'] },
  { key: 'reaper',     attacks: ['charge', 'fan_shot'] },
  { key: 'warden',     attacks: ['charge', 'summon', 'fan_shot'] },
  { key: 'leviathan',  attacks: ['fan_shot', 'summon', 'charge'] },
  { key: 'specter',    attacks: ['charge', 'fan_shot'] },
  { key: 'behemoth',   attacks: ['charge', 'summon', 'fan_shot'] },
  { key: 'oracle',     attacks: ['fan_shot', 'summon'] },
  { key: 'harbinger',  attacks: ['charge', 'fan_shot', 'summon'] },
  { key: 'tyrant',     attacks: ['charge', 'summon', 'fan_shot'] },
  { key: 'nemesis',    attacks: ['fan_shot', 'charge'] },
  { key: 'devourer',   attacks: ['summon', 'charge', 'fan_shot'] },
  { key: 'warlord',    attacks: ['charge', 'fan_shot', 'summon'] },
  { key: 'eclipse',    attacks: ['fan_shot', 'summon', 'charge'] },
];

// Crescita per tier (indice 0-based): valori moderati perché si
// sommano moltiplicativamente allo scaling nel tempo della run
// (Spawner.timeScaleMult) — un boss tier 19 tardo in una run lunga è
// già naturalmente molto più tosto di uno tier 1 incontrato subito.
const BOSS_TIER_GROWTH = { hp: 1.09, dmg: 1.06, speed: 1.015, score: 1.08 };
// v1.30.0 — dopo aver affrontato tutti e 20 i boss, il roster ricomincia
// da capo (vedi Game._spawnBoss) ma con questa crescita aggiuntiva "per
// giro completo": molto più dolce di BOSS_TIER_GROWTH sopra (che si
// applica boss per boss ALL'INTERNO di un singolo giro, quindi
// composto su 20 boss cresce molto più in fretta) — dà comunque un
// motivo concreto per spingersi oltre il ventesimo, senza far esplodere
// i numeri nel giro di poche run.
export const BOSS_CYCLE_GROWTH = { hp: 1.12, dmg: 1.08, score: 1.10 };
const BOSS_BASE = { hp: 1200, dmg: 22, speed: 45, radius: 40, score: 500 };
const GOLDEN_ANGLE = 137.5;

export const BOSS_TYPES = BOSS_ROSTER.map((entry, i) => ({
  key: entry.key,
  attacks: entry.attacks,
  hp: Math.round(BOSS_BASE.hp * Math.pow(BOSS_TIER_GROWTH.hp, i)),
  dmg: Math.round(BOSS_BASE.dmg * Math.pow(BOSS_TIER_GROWTH.dmg, i)),
  speed: Math.round(BOSS_BASE.speed * Math.pow(BOSS_TIER_GROWTH.speed, i)),
  radius: Math.round(BOSS_BASE.radius + i * 1.3),
  score: Math.round(BOSS_BASE.score * Math.pow(BOSS_TIER_GROWTH.score, i)),
  hue: Math.round((i * GOLDEN_ANGLE) % 360),
  ringSides: 3 + (i % 6),              // da triangolo a ottagono, ciclico
  satelliteCount: 3 + Math.floor(i / 4), // 3..7 satelliti, crescente
  isFinal: false,
  tier: i, // v1.29.0 — usato in boss.js per scalare frequenza d'attacco/telegraph
}));

// Boss finale (20°): il più forte in assoluto, con TUTTI i pattern
// d'attacco inclusi il nuovo "radial_burst" (raffica a 360°), colore
// che cambia continuamente nel tempo (vedi Boss.age in js/boss.js) e
// più satelliti orbitanti di chiunque altro.
BOSS_TYPES.push({
  key: 'singularity',
  attacks: ['charge', 'fan_shot', 'summon', 'radial_burst'],
  hp: Math.round(BOSS_TYPES[BOSS_TYPES.length - 1].hp * 2.2),
  dmg: Math.round(BOSS_TYPES[BOSS_TYPES.length - 1].dmg * 1.6),
  speed: Math.round(BOSS_TYPES[BOSS_TYPES.length - 1].speed * 1.05),
  radius: 85,
  score: 6000,
  hue: 0, // ininfluente: il colore cicla dinamicamente (vedi isFinal)
  ringSides: 12,
  satelliteCount: 8,
  isFinal: true,
  tier: BOSS_TYPES.length, // 19: il più alto, massima frequenza d'attacco
});

export const WEAPONS = {
  pistol: {
    name: 'Pistola', tier: 0, damage: 9, fireRateMs: 420, projectileSpeed: 520,
    pierce: 0, projectiles: 1, spread: 0, icon: '🔫',
  },
  smg: {
    name: 'Mitragliatrice', tier: 1, damage: 6, fireRateMs: 140, projectileSpeed: 560,
    pierce: 0, projectiles: 1, spread: 6, icon: '💥',
  },
  shotgun: {
    name: 'Shotgun', tier: 2, damage: 7, fireRateMs: 700, projectileSpeed: 480,
    pierce: 1, projectiles: 5, spread: 28, icon: '💢',
  },
  laser: {
    name: 'Laser', tier: 3, damage: 22, fireRateMs: 260, projectileSpeed: 900,
    pierce: 3, projectiles: 1, spread: 0, icon: '⚡',
  },
  flamethrower: {
    name: 'Flamethrower', tier: 4, damage: 4, fireRateMs: 60, projectileSpeed: 340,
    pierce: 2, projectiles: 1, spread: 18, range: 220, icon: '🔥',
  },

  // v1.25.0 — 4 nuove armi, tutte sbloccabili dal negozio come le
  // esistenti shotgun/laser/flamethrower (vedi nh_shop_items):
  //  - boomerang: esce, poi torna indietro colpendo di nuovo lungo il
  //    percorso di ritorno (vedi Game._updateProjectiles).
  //  - chainlightning: dopo ogni impatto "salta" al nemico non ancora
  //    colpito più vicino, invece di proseguire in linea retta (vedi
  //    Game._collisions).
  //  - railgun: perforazione altissima (attraversa praticamente
  //    qualunque fila di nemici), cadenza di tiro lentissima.
  //  - drone: non spara proiettili in avanti — un satellite orbita
  //    di continuo attorno al player, colpendo chi vi passa vicino
  //    (vedi Game._handleOrbitalDrone). fireRateMs/projectileSpeed non
  //    si applicano a questa meccanica, restano a 0 per coerenza di
  //    struttura con le altre armi.
  boomerang: {
    name: 'Boomerang', tier: 5, damage: 14, fireRateMs: 620, projectileSpeed: 480,
    pierce: 2, projectiles: 1, spread: 0, range: 260, icon: '🪃', boomerang: true,
  },
  chainlightning: {
    name: 'Fulmine a Catena', tier: 6, damage: 11, fireRateMs: 480, projectileSpeed: 700,
    pierce: 3, projectiles: 1, spread: 0, icon: '🌩️', chainLightning: true,
  },
  railgun: {
    name: 'Railgun', tier: 7, damage: 85, fireRateMs: 1900, projectileSpeed: 1400,
    pierce: 99, projectiles: 1, spread: 0, icon: '🎯',
  },
  drone: {
    name: 'Drone Orbitale', tier: 8, damage: 7, fireRateMs: 0, projectileSpeed: 0,
    pierce: 0, projectiles: 0, spread: 0, icon: '🛰️', orbital: true,
  },
};

// Parametri del Drone Orbitale e del Fulmine a Catena (v1.25.0)
export const DRONE_ORBIT_RADIUS = 76;      // px di distanza dal player
export const DRONE_ORBIT_SPEED = 3.4;      // rad/sec base (scala con la cadenza di tiro posseduta)
export const DRONE_HIT_RESET_MS = 450;     // ogni quanto può ricolpire lo stesso nemico
export const CHAIN_LIGHTNING_RANGE = 220;  // px massimi per un salto della catena

// Modificatori di tiro applicabili sopra l'arma equipaggiata
// Modificatori di tiro applicabili sopra l'arma equipaggiata. A differenza
// delle versioni precedenti, ora sono LIVELLABILI (fino a maxLevel volte):
// ogni livello aggiuntivo rende l'effetto più forte invece di limitarsi a
// sbloccarlo una volta sola. Nome/descrizione vengono da js/i18n.js
// (chiavi firemode.<key> / firemode.<key>_desc), non da qui.
//
// v1.6.0 — maxLevel ridotti rispetto alla v1.5.0: con 8 livelli su danno
// e cadenza combinati a multishot/pierce, il danno complessivo cresceva
// troppo (fino a ~7x la base), rendendo il gioco banale dopo pochi
// minuti anche a difficoltà Normale. Vedi anche il nuovo scaling nel
// tempo dei nemici in js/spawner.js (timeScaleMult), pensato per
// contrastare proprio questa crescita di potenza del player.
export const FIRE_MODES = {
  multishot: { icon: '✦', maxLevel: 3 },  // +1 proiettile per sparo, per livello
  pierce:    { icon: '➤', maxLevel: 3 },  // +1 nemico trapassato, per livello
  bounce:    { icon: '↻', maxLevel: 3 },  // +1 nemico extra colpito in rimbalzo, per livello
  homing:    { icon: '◎', maxLevel: 3 },  // aggancio nemici, più reattivo ai livelli alti
  explosive: { icon: '✺', maxLevel: 3 },  // esplosione ad area, raggio/danno crescono coi livelli
};

// Potenziamenti passivi, anch'essi livellabili fino a maxLevel volte (non
// solo una tantum). apply() viene richiamata una volta per ogni livello
// acquisito, sullo stesso oggetto player.stats: gli effetti moltiplicativi
// (damageMult, fireRateMult, speedMult, pickupRadiusMult) si compongono
// naturalmente ad ogni livello, quelli additivi si sommano. Nome/
// descrizione vengono da js/i18n.js (chiavi passive.<key> / passive.<key>_desc).
//
// Nota su "lifesteal": a differenza degli altri passivi NON è permanente.
// Vedi PLAYER_LIFESTEAL_BUFF_DURATION_SEC più sotto e la gestione dedicata
// in js/upgrades.js + Player.update() — qui c'è solo il rateo per livello.
//
// v1.8.0 — maxLevel leggermente rialzati rispetto alla v1.6.0: insieme
// al nuovo scaling nel tempo dei nemici il taglio era stato eccessivo,
// rendendo il gioco troppo punitivo. Regolazione più fine, non un
// ritorno ai valori originali della v1.5.0.
// Ogni passivo espone anche `previewAtLevel(n)`: restituisce il bonus
// TOTALE accumulato al livello n (non l'incremento del singolo livello),
// usando la STESSA identica formula di apply() — così la UI (vedi
// js/ui.js buildPassiveDescription) può sempre mostrare numeri
// realmente coerenti con l'effetto in game, invece di testo statico
// che rischia di disallinearsi nel tempo (come successo prima di
// v1.32.0 con danno/cadenza/magnete, le cui descrizioni mostravano
// percentuali sbagliate rispetto al codice reale).
export const PASSIVES = {
  // v1.32.0 — valori arrotondati a multipli di 5: 8%→10%, 12%→15% ecc.,
  // e corrette le descrizioni che mostravano percentuali diverse da
  // quelle realmente applicate (danno e cadenza mostravano "+12%" ma
  // applicavano +8%; magnete mostrava "+30%" ma applicava +20%).
  damage:    { icon: '🗡️', maxLevel: 6, apply: (s) => { s.damageMult *= 1.10; }, previewAtLevel: (n) => Math.pow(1.10, n) - 1 },
  firerate:  { icon: '⏱️', maxLevel: 6, apply: (s) => { s.fireRateMult *= 0.90; }, previewAtLevel: (n) => 1 - Math.pow(0.90, n) },
  movespeed: { icon: '👟', maxLevel: 4, apply: (s) => { s.speedMult *= 1.10; }, previewAtLevel: (n) => Math.pow(1.10, n) - 1 },
  regen:     { icon: '❤️', maxLevel: 4, apply: (s) => { s.regenPerSec += 0.2; }, previewAtLevel: (n) => n * 0.2 },
  shield:    { icon: '🛡️', maxLevel: 3, apply: (s) => { s.shieldCharges += 1; }, previewAtLevel: (n) => n },
  maxhp:     { icon: '💗', maxLevel: 6, apply: (s) => { s.maxHpBonus += 15; }, previewAtLevel: (n) => n * 15 },
  crit:      { icon: '💥', maxLevel: 4, apply: (s) => { s.critChance = Math.min(0.6, (s.critChance || 0) + 0.05); }, previewAtLevel: (n) => Math.min(0.6, n * 0.05) },
  // "lifesteal" non ha un apply() qui: viene gestito con logica dedicata
  // in js/upgrades.js perché è temporaneo (timer), non un moltiplicatore
  // permanente come gli altri. maxLevel resta qui per coerenza con il
  // resto del sistema (controllo pool in js/upgrades.js). Rateo per
  // livello arrotondato da 3% a 5% (LIFESTEAL_RATIO_PER_LEVEL sotto).
  lifesteal: { icon: '🩸', maxLevel: 4, previewAtLevel: (n) => n * 0.05 },

  // v1.23.0 — 4 nuovi passivi. Tutti e quattro, a differenza di
  // "lifesteal", si adattano al pattern standard apply(stats) esistente
  // senza bisogno di logica speciale in upgrades.js.
  thorns:      { icon: '🌵', maxLevel: 5, apply: (s) => { s.thornsRatio = Math.min(0.5, (s.thornsRatio || 0) + 0.10); }, previewAtLevel: (n) => Math.min(0.5, n * 0.10) },
  // maxLevel 1: non un moltiplicatore che scala, ma uno sblocco singolo
  // ("hai diritto a un secondo fiato in questa run" — si riattiva solo
  // alla run successiva, non risalendo di livello nella stessa).
  secondwind:  { icon: '💫', maxLevel: 1, apply: (s) => { s.secondWindReady = true; } },
  slowfield:   { icon: '❄️', maxLevel: 4, apply: (s) => { s.slowFieldRadius = 100; s.slowFieldStrength = Math.min(0.6, (s.slowFieldStrength || 0) + 0.15); }, previewAtLevel: (n) => Math.min(0.6, n * 0.15) },

  // v1.32.0 — "Magnete" e "Impulso Magnetico" (v1.23.0) unificati in un
  // solo passivo a 4 stage: erano concettualmente la stessa cosa
  // ("i pickup arrivano da più lontano") con curve diverse, comparire
  // entrambi come scelta nella stessa run risultava ridondante. Il
  // vecchio Impulso Magnetico aveva anche un bug: marcava TUTTI i
  // pickup come "da attrarre" indipendentemente dalla distanza, e la
  // formula di velocità (pensata solo per il caso "sei già vicino")
  // andava in negativo per un pickup lontano, lanciandolo VIA dal
  // player invece che verso di lui — spiega perché su schermi ampi
  // (desktop) alcuni pickup sembravano "sparire". Risolto alla radice
  // qui: raggio crescente per stage invece di un impulso periodico che
  // ignora la distanza (vedi anche il fix della formula di velocità in
  // Pickup.update(), entities.js).
  magnet: {
    icon: '🧲', maxLevel: 4,
    // pickupRadiusMult per stage: 3.0 / 5.5 / 9.0 / 50 (praticamente
    // l'intero schermo e oltre, all'ultimo stage — vedi anche il
    // bagliore pulsante ai bordi invece del cerchio, non più visibile
    // a un raggio così ampio). pullSpeedBase cresce di pari passo,
    // così anche la "frequenza" con cui i pickup vengono raggiunti
    // aumenta stage dopo stage, non solo il raggio.
    apply: (s) => {
      const stage = (s.magnetStage || 0) + 1;
      s.magnetStage = stage;
      const radiusByStage = [3.0, 5.5, 9.0, 50];
      const speedByStage = [420, 480, 550, 650];
      s.pickupRadiusMult = radiusByStage[stage - 1];
      s.magnetPullSpeedBase = speedByStage[stage - 1];
    },
  },
};

// Durata (secondi) della finestra di vampirismo attivo dopo aver scelto
// o ri-scelto il potenziamento "Vampirismo": scaduta, la cura torna a 0
// finché non lo si riprende. Ri-sceglierlo mentre è già attivo rinnova
// la durata (non la somma) e aggiorna il rateo al nuovo livello.
export const LIFESTEAL_BUFF_DURATION_SEC = 12;
export const LIFESTEAL_RATIO_PER_LEVEL = 0.05; // frazione del danno inflitto curata, per livello, mentre attivo (arrotondato da 3% a 5% in v1.32.0)
