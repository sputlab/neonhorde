// =====================================================================
// entities.js — definizioni delle entità di gioco (dati + update logico,
// il rendering vero e proprio è delegato al modulo render dentro game.js)
// =====================================================================
import { CONFIG } from './config.js';
import { clamp, angleDiff } from './utils.js';

// ---------------------------------------------------------------------
// PLAYER
// ---------------------------------------------------------------------
export class Player {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.radius = CONFIG.PLAYER_RADIUS;

    this.maxHp = CONFIG.PLAYER_BASE_HP;
    this.hp = this.maxHp;
    this.level = 1;
    this.xp = 0;
    this.xpToNext = CONFIG.XP_TO_LEVEL_BASE;

    this.weaponKey = 'pistol';
    // Armi che il player può ricevere come potenziamento durante la run:
    // pistol/smg sono sempre disponibili (progressione base gratuita),
    // le altre richiedono lo sblocco dal negozio (vedi
    // Game.constructor, che le popola da metaBonuses.unlockedWeapons).
    this.unlockedWeapons = new Set(['pistol', 'smg']);
    // Skin per le armi possedute (v1.27.0, es. 'laser' se si possiede
    // "weaponskin_laser"): ricolora i proiettili di quell'arma quando
    // equipaggiata — vedi buildPlayerShots() in weapons.js.
    this.weaponSkins = new Set();
    // Skin equipaggiata (stringa tipo 'skin_ninja') o null per l'aspetto
    // di default — vedi Game._renderPlayer().
    this.skin = null;
    this.fireModeLevels = {};    // es. { multishot: 2, pierce: 1 } — livello raggiunto per ogni modalità di tiro
    this.passiveStacks = {};      // { damage: 2, firerate: 1, ... }

    // Moltiplicatori derivati dai passivi accumulati durante la run
    this.stats = {
      damageMult: 1,
      fireRateMult: 1,
      speedMult: 1,
      pickupRadiusMult: 1,
      regenPerSec: 0,
      shieldCharges: 0,
      maxHpBonus: 0,
      critChance: 0,       // 0..1, probabilità di infliggere danno critico
      lifestealRatio: 0,   // 0..1, frazione del danno inflitto recuperata come HP
      // v1.23.0 — 4 nuovi passivi:
      thornsRatio: 0,          // 0..1, frazione del danno subito riflessa ai nemici vicini
      secondWindReady: false,  // sopravvive a un colpo letale una volta a partita
      slowFieldRadius: 0,      // px entro cui i nemici sono rallentati (0 = non posseduto)
      slowFieldStrength: 0,    // 0..1, frazione di velocità sottratta ai nemici nel raggio
      // v1.32.0 — "Magnete" unificato (era diviso in due passivi separati
      // e ridondanti, vedi PASSIVES.magnet in config.js): magnetStage
      // tiene traccia dello stage raggiunto (1..4, 0 = non posseduto),
      // magnetPullSpeedBase è la velocità di richiamo dei pickup usata
      // da Pickup.update() al posto del valore fisso di prima.
      magnetStage: 0,
      magnetPullSpeedBase: 0,
    };

    this.regenAccumulator = 0;
    this.fireCooldown = 0;
    this.invulnMs = 0;
    this.shieldFlashMs = 0;
    this.lifestealTimer = 0; // secondi rimanenti di vampirismo attivo (0 = non attivo)
    this.bombCharges = 0;    // bombe EMP accumulate (max CONFIG.BOMB_MAX_CHARGES)
    this.secondWindFlashMs = 0;    // finestra per l'effetto visivo (bagliore) quando scatta il secondo fiato
    // true per un solo frame quando il secondo fiato salva la vita:
    // segnale separato da secondWindFlashMs (che dura più a lungo, solo
    // per l'effetto visivo) per evitare che un colpo successivo ricevuto
    // mentre il bagliore è ancora attivo faccia scattare di nuovo per
    // errore il toast/suono dedicato in game.js.
    this.secondWindJustTriggered = false;

    this.moveDX = 0; // input normalizzato -1..1
    this.moveDY = 0;
  }

  get speed() { return CONFIG.PLAYER_BASE_SPEED * this.stats.speedMult; }
  get pickupRadius() { return CONFIG.PLAYER_PICKUP_RADIUS * this.stats.pickupRadiusMult; }
  get effectiveMaxHp() { return this.maxHp + this.stats.maxHpBonus; }

  applyMetaUpgrades(meta) {
    // meta = { base_hp, base_dmg, base_speed } derivati dagli acquisti permanenti nel negozio
    this.maxHp = CONFIG.PLAYER_BASE_HP + (meta.base_hp || 0);
    this.hp = this.maxHp;
    this._metaDamageMult = 1 + (meta.base_dmg || 0);
    this._metaSpeedMult = 1 + (meta.base_speed || 0);
  }

  update(dt, worldBounds) {
    // Movimento
    const len = Math.hypot(this.moveDX, this.moveDY) || 1;
    const nx = this.moveDX / len, ny = this.moveDY / len;
    const mag = Math.min(1, Math.hypot(this.moveDX, this.moveDY));
    this.x += nx * mag * this.speed * (this._metaSpeedMult || 1) * dt;
    this.y += ny * mag * this.speed * (this._metaSpeedMult || 1) * dt;

    this.x = clamp(this.x, worldBounds.minX, worldBounds.maxX);
    this.y = clamp(this.y, worldBounds.minY, worldBounds.maxY);

    // Rigenerazione
    if (this.stats.regenPerSec > 0 && this.hp < this.effectiveMaxHp) {
      this.regenAccumulator += this.stats.regenPerSec * dt;
      if (this.regenAccumulator >= 1) {
        const whole = Math.floor(this.regenAccumulator);
        this.hp = Math.min(this.effectiveMaxHp, this.hp + whole);
        this.regenAccumulator -= whole;
      }
    }

    if (this.invulnMs > 0) this.invulnMs -= dt * 1000;
    if (this.shieldFlashMs > 0) this.shieldFlashMs -= dt * 1000;
    if (this.fireCooldown > 0) this.fireCooldown -= dt * 1000;

    // Vampirismo: effetto temporaneo, non permanente. Allo scadere del
    // timer il rateo di cura torna a 0 finché non si risceglie il
    // potenziamento (che rinnova la durata e aggiorna il rateo).
    if (this.lifestealTimer > 0) {
      this.lifestealTimer -= dt;
      if (this.lifestealTimer <= 0) {
        this.lifestealTimer = 0;
        this.stats.lifestealRatio = 0;
      }
    }

    // Impulso magnetico periodico rimosso in v1.32.0 — unificato nel
    // passivo "magnet" (raggio crescente per stage, vedi PASSIVES.magnet
    // in config.js), niente più timer/trigger separato da gestire qui.

    if (this.secondWindFlashMs > 0) this.secondWindFlashMs -= dt * 1000;
  }

  gainXp(amount) {
    this.xp += amount;
    let leveledUp = false;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.xpToNext = Math.round(this.xpToNext * CONFIG.XP_TO_LEVEL_GROWTH);
      this.level++;
      leveledUp = true;
    }
    return leveledUp;
  }

  takeDamage(amount) {
    if (this.invulnMs > 0) return false;

    if (this.stats.shieldCharges > 0) {
      this.stats.shieldCharges--;
      this.shieldFlashMs = 300;
      this.invulnMs = CONFIG.PLAYER_INVULN_MS;
      return false;
    }

    // Secondo Fiato: se questo colpo sarebbe letale e il player ne ha
    // ancora diritto in questa run, lo consuma e sopravvive con 1 HP
    // invece di morire. Si riattiva solo alla run successiva (non c'è
    // modo di "ricaricarlo" nella stessa run, per design).
    const wouldBeLethal = (this.hp - amount) <= 0;
    if (wouldBeLethal && this.stats.secondWindReady) {
      this.stats.secondWindReady = false;
      this.hp = 1;
      this.invulnMs = CONFIG.PLAYER_INVULN_MS;
      this.secondWindFlashMs = 1200;
      this.secondWindJustTriggered = true;
      return true;
    }

    this.hp = Math.max(0, this.hp - amount);
    this.invulnMs = CONFIG.PLAYER_INVULN_MS;
    return true; // colpo effettivamente subito
  }

  get isDead() { return this.hp <= 0; }
}

// ---------------------------------------------------------------------
// ENEMY
// ---------------------------------------------------------------------
// Contatore globale per identificare in modo univoco ogni nemico
// "spawnato", anche quando l'oggetto Enemy viene riciclato dal pool per
// un nemico successivo (vedi Game._resolveHomingTarget in game.js: senza
// questo ID, un proiettile homing che ha agganciato un nemico morto e
// riciclato per uno nuovo lo scambierebbe per lo stesso bersaglio).
let nextEnemySpawnId = 1;

export class Enemy {
  constructor() { this.active = false; }

  spawn(typeKey, def, x, y, difficultyMods) {
    this.active = true;
    this.spawnId = nextEnemySpawnId++;
    this.typeKey = typeKey;
    this.x = x; this.y = y;
    this.radius = def.radius;
    this.maxHp = def.hp * difficultyMods.enemyHp;
    this.hp = this.maxHp;
    this.speed = def.speed;
    this.dmg = def.dmg * difficultyMods.enemyDmg;
    this.xp = def.xp;
    this.coinChance = def.coinChance;
    this.colorKey = def.colorKey;
    this.score = def.score;
    this.fireRateMs = def.fireRateMs || null;
    this.projectileSpeed = def.projectileSpeed || null;
    this.fireCooldown = this.fireRateMs ? Math.random() * this.fireRateMs : null;
    this.hitFlashMs = 0;
    this.knockDX = 0; this.knockDY = 0; this.knockMs = 0;

    // v1.24.0 — comportamenti speciali (tutti opzionali, un nemico
    // "normale" come 'basic' non ne attiva nessuno: i campi restano ai
    // valori di default che li disattivano).
    this.splitsInto = def.splitsInto || null;
    this.splitCount = def.splitCount || 0;

    this.shielded = !!def.shielded;
    this.shieldAngle = Math.random() * Math.PI * 2; // orientamento iniziale casuale
    this.shieldBlockFlashMs = 0; // per un feedback visivo distinto da hitFlashMs quando un colpo viene bloccato

    this.teleports = !!def.teleports;
    this.teleportCooldown = this.teleports ? CONFIG.TELEPORTER_INTERVAL_MS * (0.5 + Math.random() * 0.5) : null;
    this.teleportFlashMs = 0;

    this.summons = !!def.summons;
    this.keepsDistance = !!def.keepsDistance;
    this.summonCooldown = this.summons ? CONFIG.SUMMONER_INTERVAL_MS * (0.4 + Math.random() * 0.6) : null;
    // true per un solo tick quando è il momento di generare un minion:
    // letto e azzerato da Game._updateEnemies, che è l'unico posto con
    // accesso alla lista nemici globale per poterne aggiungere uno nuovo.
    this.summonReady = false;
  }

  /** @param hitFromAngle radianti — direzione da cui è arrivato il colpo
   *  (solo per il nemico "Corazzato": se cade nell'arco scudato, il
   *  danno viene fortemente ridotto). Omesso o null per danni che non
   *  hanno una direzione fisica (es. Spine Ritorsive) — in quel caso lo
   *  scudo non si applica, il colpo passa per intero. */
  takeDamage(amount, hitFromAngle = null) {
    let finalAmount = amount;
    if (this.shielded && hitFromAngle !== null) {
      const diff = angleDiff(hitFromAngle, this.shieldAngle);
      if (diff < CONFIG.SHIELDED_ARC_WIDTH / 2) {
        finalAmount = amount * (1 - CONFIG.SHIELDED_BLOCK_RATIO);
        this.shieldBlockFlashMs = 150;
      }
    }
    this.hp -= finalAmount;
    this.hitFlashMs = 90;
    return this.hp <= 0;
  }

  applyKnockback(dx, dy, force) {
    this.knockDX = dx * force;
    this.knockDY = dy * force;
    this.knockMs = 140;
  }

  update(dt, targetX, targetY, slowMult = 1) {
    if (this.hitFlashMs > 0) this.hitFlashMs -= dt * 1000;
    if (this.shieldBlockFlashMs > 0) this.shieldBlockFlashMs -= dt * 1000;

    if (this.shielded) {
      this.shieldAngle += CONFIG.SHIELDED_ROTATION_SPEED * dt;
    }

    if (this.teleports) {
      this.teleportCooldown -= dt * 1000;
      if (this.teleportCooldown <= 0) {
        this.teleportCooldown = CONFIG.TELEPORTER_INTERVAL_MS;
        const ang = Math.random() * Math.PI * 2;
        const dist = CONFIG.TELEPORTER_MIN_DIST + Math.random() * (CONFIG.TELEPORTER_MAX_DIST - CONFIG.TELEPORTER_MIN_DIST);
        this.x = targetX + Math.cos(ang) * dist;
        this.y = targetY + Math.sin(ang) * dist;
        this.teleportFlashMs = 260;
        // Il teletrasporto interrompe qualunque spinta da knockback in
        // corso: continuare ad applicarla dopo un salto di posizione
        // non avrebbe più senso rispetto al nuovo punto di arrivo.
        this.knockMs = 0;
      }
    }
    if (this.teleportFlashMs > 0) this.teleportFlashMs -= dt * 1000;

    if (this.summons) {
      this.summonCooldown -= dt * 1000;
      if (this.summonCooldown <= 0) {
        this.summonCooldown = CONFIG.SUMMONER_INTERVAL_MS;
        this.summonReady = true;
      }
    }

    let vx = 0, vy = 0;
    if (this.knockMs > 0) {
      this.knockMs -= dt * 1000;
      vx += this.knockDX;
      vy += this.knockDY;
    }

    const dx = targetX - this.x, dy = targetY - this.y;
    const d = Math.hypot(dx, dy) || 1;
    // I nemici "ranged" ed "Evocatori" (keepsDistance) mantengono le
    // distanze una volta a tiro, invece di continuare ad avvicinarsi.
    const keepDistance = (this.fireRateMs || this.keepsDistance) && d < 260;
    const dirMult = keepDistance ? -0.4 : 1;
    const effectiveSpeed = this.speed * slowMult;
    vx += (dx / d) * effectiveSpeed * dirMult;
    vy += (dy / d) * effectiveSpeed * dirMult;

    this.x += vx * dt;
    this.y += vy * dt;
  }
}

// ---------------------------------------------------------------------
// PROJECTILE (sia del player che dei nemici)
// ---------------------------------------------------------------------
export class Projectile {
  constructor() { this.active = false; }

  spawn({ x, y, vx, vy, damage, pierce = 0, isEnemy = false, homing = false, explosive = false, bounce = false,
          homingLevel = 0, explosiveLevel = 0, bounceLevel = 0, radius = 5, range = null, color, isCrit = false,
          chainLightning = false, boomerang = false, orbital = false }) {
    this.active = true;
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.pierce = pierce;
    // Numero totale di nemici che questo proiettile può colpire prima di
    // essere consumato: 1 (impatto base) + pierce + tanti quanto il
    // livello di "bounce" (ogni livello aggiunge un nemico extra colpito).
    // Il Drone Orbitale (orbital=true) passa un pierce enorme dall'esterno
    // per non essere mai "consumato" nella sua durata pratica.
    this.hitsRemaining = 1 + pierce + bounceLevel;
    this.hitList = new Set();
    this.isEnemy = isEnemy;
    this.homing = homing;
    this.homingLevel = homingLevel;
    this.explosive = explosive;
    this.explosiveLevel = explosiveLevel;
    this.bounce = bounce;
    this.bounced = false;
    this.radius = radius;
    this.range = range;
    this.traveled = 0;
    this.color = color;
    this.isCrit = isCrit;

    // v1.25.0 — armi con comportamento speciale:
    this.chainLightning = chainLightning; // vedi Game._collisions: dopo un impatto salta al nemico non ancora colpito più vicino
    this.boomerang = boomerang;           // vedi Game._updateProjectiles: invertito invece di rimosso al primo outOfRange
    this.returning = false;               // true dopo la prima inversione: un boomerang inverte una volta sola
    this.orbital = orbital;               // vedi Game._handleOrbitalDrone: posizione impostata direttamente ogni frame, non per velocità
    this.orbitAngle = 0;
    this.orbitalHitResetMs = 0;

    // Bersaglio agganciato dall'homing (se applicabile): fissato una
    // volta e mantenuto per tutta la vita del proiettile, invece di
    // essere ricalcolato ogni frame — vedi Game._resolveHomingTarget()
    // in game.js per il perché (senza aggancio fisso, con bersagli in
    // movimento il "nemico più vicino" cambia in continuazione e il
    // proiettile ondeggia senza mai convergere su nessuno).
    this.homingLockedRef = null;
    this.homingLockedSpawnId = null;
    this.homingLockedIsBoss = false;

    // Durata massima di vita: superata, il proiettile inizia a svanire
    // (vedi fadeAlpha) e viene rimosso poco dopo — rete di sicurezza
    // contro proiettili (soprattutto homing) che altrimenti potrebbero
    // vagare indefinitamente per lo schermo senza mai colpire nulla.
    this.age = 0;
  }

  /**
   * @param dt secondi trascorsi dall'ultimo frame
   * @param homingTargetPos {x,y} del bersaglio già risolto/agganciato da
   *        Game._resolveHomingTarget(), oppure null se non applicabile o
   *        nessun bersaglio disponibile. Questo metodo si limita a
   *        sterzare verso la posizione ricevuta: non cerca da solo il
   *        bersaglio, per non reintrodurre il bug del "cambio bersaglio
   *        ad ogni frame".
   */
  update(dt, homingTargetPos) {
    this.age += dt;

    if (this.homing && !this.isEnemy && homingTargetPos) {
      const dx = homingTargetPos.x - this.x, dy = homingTargetPos.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const speed = Math.hypot(this.vx, this.vy);
      // Il tasso di virata cresce con il livello: ai livelli alti i
      // proiettili "agganciano" i nemici in modo molto più aggressivo.
      const turnRate = CONFIG.HOMING_BASE_TURN_RATE + Math.max(0, this.homingLevel - 1) * CONFIG.HOMING_TURN_RATE_PER_LEVEL;
      this.vx += (dx / d) * speed * turnRate * dt;
      this.vy += (dy / d) * speed * turnRate * dt;
      const newSpeed = Math.hypot(this.vx, this.vy) || 1;
      this.vx = (this.vx / newSpeed) * speed;
      this.vy = (this.vy / newSpeed) * speed;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const stepDist = Math.hypot(this.vx, this.vy) * dt;
    this.traveled += stepDist;
  }

  get outOfRange() { return this.range !== null && this.traveled >= this.range; }

  /** Durata massima di vita per QUESTO proiettile: quelli homing ne
   *  hanno una ridotta (v1.22.0) — agganciati a un bersaglio fisso e
   *  capaci di virare aggressivamente verso di esso, se lasciati vivere
   *  quanto un proiettile normale possono "cacciare" più nemici in
   *  sequenza (soprattutto con la perforazione) per l'intera durata,
   *  diventando efficaci quasi da soli con un impegno minimo da parte
   *  del giocatore. Una vita più corta li mantiene un potenziamento
   *  forte senza farli diventare una soluzione automatica allo schermo.
   *  Il Drone Orbitale (v1.25.0) non scade mai finché resta equipaggiato
   *  — è un satellite persistente, non un colpo sparato una tantum. */
  get maxLifetimeSec() {
    if (this.orbital) return Infinity;
    return (this.homing && !this.isEnemy)
      ? CONFIG.PROJECTILE_HOMING_MAX_LIFETIME_SEC
      : CONFIG.PROJECTILE_MAX_LIFETIME_SEC;
  }

  /** True una volta superata la durata massima di vita: da qui in poi il
   *  proiettile è "in dissolvenza" e non deve più poter colpire nulla. */
  get isExpiring() { return this.age >= this.maxLifetimeSec; }

  /** Opacità di rendering: 1 finché nei limiti di vita normali, poi
   *  scende linearmente a 0 nell'arco di PROJECTILE_FADE_DURATION_MS
   *  (uguale per tutti i proiettili, homing incluso — solo la durata
   *  "piena" prima di iniziare a svanire cambia). */
  get fadeAlpha() {
    if (!this.isExpiring) return 1;
    const t = (this.age - this.maxLifetimeSec) / (CONFIG.PROJECTILE_FADE_DURATION_MS / 1000);
    return Math.max(0, 1 - t);
  }

  /** True quando la dissolvenza è completata: il proiettile va rimosso. */
  get isFullyExpired() {
    return this.age >= this.maxLifetimeSec + CONFIG.PROJECTILE_FADE_DURATION_MS / 1000;
  }
}

// ---------------------------------------------------------------------
// PARTICLE (juicy feedback: esplosioni, scintille)
// ---------------------------------------------------------------------
export class Particle {
  constructor() { this.active = false; }

  spawn({ x, y, vx, vy, life, color, size = 3, gravity = 0 }) {
    this.active = true;
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.color = color;
    this.size = size;
    this.gravity = gravity;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += this.gravity * dt;
    this.vx *= 0.96;
    this.vy *= 0.96;
    this.life -= dt;
  }

  get alpha() { return clamp(this.life / this.maxLife, 0, 1); }
}

// ---------------------------------------------------------------------
// PICKUP (XP orb / moneta)
// ---------------------------------------------------------------------
export class Pickup {
  constructor() { this.active = false; }

  spawn({ x, y, kind, value }) {
    this.active = true;
    this.x = x; this.y = y;
    this.kind = kind; // 'xp' | 'coin'
    this.value = value;
    this.vx = 0; this.vy = 0;
    this.beingPulled = false;
  }

  update(dt, playerX, playerY, pickupRadius, pullSpeedBase = 420) {
    const dx = playerX - this.x, dy = playerY - this.y;
    const d = Math.hypot(dx, dy);
    if (d < pickupRadius) {
      this.beingPulled = true;
    }
    if (this.beingPulled && d > 1) {
      // v1.32.0 — Math.max(0, ...) impedisce che il termine vada in
      // negativo quando un pickup viene marcato "da attrarre" a una
      // distanza MAGGIORE del raggio (prima poteva succedere con il
      // vecchio Impulso Magnetico, che ignorava del tutto la distanza):
      // una velocità negativa spingeva il pickup VIA dal player invece
      // che verso di lui, invisibile perché schizzava fuori schermo.
      const pullSpeed = Math.min(900, pullSpeedBase + Math.max(0, pickupRadius - d) * 2);
      this.vx = (dx / d) * pullSpeed;
      this.vy = (dy / d) * pullSpeed;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }
    return d < 14; // raccolto
  }
}

// ---------------------------------------------------------------------
// DAMAGE NUMBER (numeri di danno flottanti)
// ---------------------------------------------------------------------
export class DamageNumber {
  constructor() { this.active = false; }

  spawn({ x, y, value, crit = false }) {
    this.active = true;
    this.x = x; this.y = y;
    this.value = value;
    this.crit = crit;
    this.life = 0.6;
    this.maxLife = 0.6;
    this.vy = -40;
  }

  update(dt) {
    this.y += this.vy * dt;
    this.vy *= 0.9;
    this.life -= dt;
  }

  get alpha() { return clamp(this.life / this.maxLife, 0, 1); }
}
