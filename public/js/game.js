// =====================================================================
// game.js — motore di gioco: loop, rendering, collisioni, integrazione
// di tutti i sistemi (spawner, armi, boss, upgrade, audio, API).
// =====================================================================
import { CONFIG, ENEMY_TYPES, BOSS_TYPES, BOSS_CYCLE_GROWTH, WEAPONS, DRONE_ORBIT_RADIUS, DRONE_ORBIT_SPEED, DRONE_HIT_RESET_MS, CHAIN_LIGHTNING_RANGE } from './config.js';
import { Player, Enemy, Projectile, Particle, Pickup, DamageNumber } from './entities.js';
import { Spawner } from './spawner.js';
import { Boss } from './boss.js';
import { findNearestEnemy, buildPlayerShots, currentFireIntervalMs, WEAPON_SKIN_COLORS } from './weapons.js';
import { rollUpgradeChoices, applyUpgradeChoice } from './upgrades.js';
import { SpatialHash, ObjectPool, circlesOverlap, angleTo, rand, clamp } from './utils.js';
import { audio } from './audio.js';
import { startAmbientRotation, playBossTrack, returnToAmbient, stopMusic, getCurrentBpm } from './music.js';
import * as UI from './ui.js';
import { Api } from './api.js';
import { getSettings } from './settings.js';
import { t, tServerError } from './i18n.js';
import { tiltState } from './sensors.js';

const PLAYER_CLAMP = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };

export class Game {
  constructor(canvas, difficultyKey, metaBonuses) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.difficultyKey = difficultyKey;
    this.metaBonuses = metaBonuses;

    // I bonus di difficoltà (v1.17.0, es. "easy": più HP e più danno)
    // si sommano a quelli permanenti del negozio, stessa semantica
    // additiva (0.35 = +35%) — applicati insieme in un'unica chiamata.
    const diffMods = CONFIG.DIFFICULTY[difficultyKey];
    this.player = new Player();
    this.player.applyMetaUpgrades({
      base_hp: (metaBonuses.base_hp || 0) + (diffMods.playerHpBonus || 0),
      base_dmg: (metaBonuses.base_dmg || 0) + (diffMods.playerDmgBonus || 0),
      base_speed: metaBonuses.base_speed || 0,
    });
    if (diffMods.playerRegenBonus) {
      this.player.stats.regenPerSec += diffMods.playerRegenBonus;
    }

    // Armi sbloccate dal negozio (oltre a pistol/smg, sempre gratuite):
    // prima di questa correzione (v1.21.0) venivano registrate
    // nell'acquisto ma non venivano mai lette da nessuna parte, quindi
    // non avevano alcun effetto in game — vedi upgrades.js `nextWeapon()`.
    for (const w of metaBonuses.unlockedWeapons) this.player.unlockedWeapons.add(w);
    // Skin per le armi possedute (v1.27.0)
    for (const w of metaBonuses.weaponSkins || []) this.player.weaponSkins.add(w);

    // Skin equipaggiata (solo se effettivamente posseduta: una skin
    // scelta nelle impostazioni ma mai acquistata, o acquistata da un
    // account diverso, non viene applicata).
    const equippedSkin = getSettings().equippedSkin;
    if (equippedSkin && metaBonuses.skins.has(equippedSkin)) {
      this.player.skin = equippedSkin;
    }

    // Arma di partenza (v1.27.0): solo se effettivamente sbloccata,
    // stessa cautela della skin sopra. 'pistol'/'smg' sono già sempre
    // in unlockedWeapons, quindi restano scelte valide come chiunque
    // altra arma posseduta.
    const startingWeapon = getSettings().startingWeapon;
    if (startingWeapon && this.player.unlockedWeapons.has(startingWeapon)) {
      this.player.weaponKey = startingWeapon;
    }

    this.spawner = new Spawner(difficultyKey);
    this.boss = null;
    this.bossQueued = false;

    this.enemies = new ObjectPool(() => new Enemy(), (e) => {}, 80);
    this.enemyList = [];
    this.projectiles = new ObjectPool(() => new Projectile(), (p) => {}, 120);
    this.projectileList = [];
    this.particles = new ObjectPool(() => new Particle(), (p) => {}, 200);
    this.particleList = [];
    this.pickups = new ObjectPool(() => new Pickup(), (p) => {}, 80);
    this.pickupList = [];
    this.damageNumbers = new ObjectPool(() => new DamageNumber(), (d) => {}, 40);
    this.damageNumberList = [];

    this.enemyHash = new SpatialHash(64);

    this.camera = { x: 0, y: 0 };
    this.elapsed = 0;
    this.kills = 0;
    this.bossesKilled = 0;
    this.totalDamageDealt = 0; // v1.33.0 — inviato a fine run per i Traguardi (categoria damage_total)
    this.score = 0;
    this.running = false;
    this.paused = false;

    this.shakeMs = 0;
    this.shakeMag = 0;

    // Effetti avanzati (scie, glow): array di posizioni recenti del player
    this.playerTrail = [];

    // Skin "Sovraccarico" (v1.26.0): archi elettrici procedurali che
    // scoccano a intervalli irregolari attorno al player — stato tenuto
    // qui (non su Player) perché è puramente un dettaglio di rendering,
    // rigenerato a ogni run comunque.
    this.overchargeTimer = 0;
    this.overchargeArcs = [];

    this.keyboard = UI.setupKeyboard();

    // Controllo touch/mouse: il player "segue" la posizione del
    // puntatore/dito, convertita da coordinate schermo a coordinate
    // mondo ad ogni frame (la camera si muove, quindi la conversione
    // va fatta al consumo, non alla cattura).
    this.pointerTarget = null;
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerEnd = this._onPointerEnd.bind(this);
    this._onTouchMove = (e) => { if (e.touches[0]) this._onPointerMove(e.touches[0].clientX, e.touches[0].clientY); };
    this._onMouseMove = (e) => this._onPointerMove(e.clientX, e.clientY);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mouseleave', this._onPointerEnd);
    canvas.addEventListener('touchstart', this._onTouchMove, { passive: true });
    canvas.addEventListener('touchmove', this._onTouchMove, { passive: true });
    canvas.addEventListener('touchend', this._onPointerEnd, { passive: true });
    canvas.addEventListener('touchcancel', this._onPointerEnd, { passive: true });

    // Bomba EMP: tasto E su desktop (evento discreto, non stato continuo
    // come il movimento, per non ri-attivarla ad ogni frame se tenuta premuta)
    this.bombFlashMs = 0;
    this._onKeyDown = (e) => { if (e.code === 'KeyE') this.useBomb(); };
    window.addEventListener('keydown', this._onKeyDown);

    // D-pad virtuale (schema di controllo "dpad"): il riferimento per il
    // drag è sempre il centro geometrico del D-pad stesso (ricalcolato ad
    // ogni tocco/trascinamento dalla bounding box reale, che tiene conto
    // di lato/dimensione scelti nelle impostazioni), non il punto di
    // primo tocco — così il dito resta nell'angolo, mai al centro schermo.
    this.dpadDX = 0;
    this.dpadDY = 0;
    this._dpadZoneEl = document.getElementById('dpad-zone');
    this._dpadBaseEl = document.getElementById('dpad-base');
    this._dpadStickEl = document.getElementById('dpad-stick');
    this._dpadActive = false;

    this._updateDpadFromClient = (clientX, clientY) => {
      const rect = this._dpadBaseEl.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      let dx = clientX - centerX;
      let dy = clientY - centerY;
      const maxRadius = rect.width / 2;
      const dist = Math.hypot(dx, dy);
      if (dist > maxRadius && dist > 0) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }
      this.dpadDX = maxRadius > 0 ? dx / maxRadius : 0;
      this.dpadDY = maxRadius > 0 ? dy / maxRadius : 0;
      this._dpadStickEl.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    this._onDpadStart = (e) => {
      this._dpadActive = true;
      const t = e.touches ? e.touches[0] : e;
      this._updateDpadFromClient(t.clientX, t.clientY);
      e.preventDefault();
    };
    this._onDpadMove = (e) => {
      if (!this._dpadActive) return;
      const t = e.touches ? e.touches[0] : e;
      this._updateDpadFromClient(t.clientX, t.clientY);
      e.preventDefault();
    };
    this._onDpadEnd = () => {
      this._dpadActive = false;
      this.dpadDX = 0;
      this.dpadDY = 0;
      this._dpadStickEl.style.transform = '';
    };

    this._dpadZoneEl.addEventListener('touchstart', this._onDpadStart, { passive: false });
    this._dpadZoneEl.addEventListener('touchmove', this._onDpadMove, { passive: false });
    this._dpadZoneEl.addEventListener('touchend', this._onDpadEnd, { passive: true });
    this._dpadZoneEl.addEventListener('touchcancel', this._onDpadEnd, { passive: true });
    // mousedown/mousemove/mouseup: comodo anche per testare il D-pad da
    // desktop (es. in un emulatore mobile del browser), oltre al touch reale.
    this._dpadZoneEl.addEventListener('mousedown', this._onDpadStart);
    window.addEventListener('mousemove', this._onDpadMove);
    window.addEventListener('mouseup', this._onDpadEnd);

    this.refreshSettings();

    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();

    this._loop = this._loop.bind(this);
    this.lastTs = null;
  }

  /** Rilegge le impostazioni correnti (schema di controllo, palette
   *  colori, effetti avanzati). Va richiamata quando l'utente cambia
   *  qualcosa nel menu Impostazioni mentre una run è attiva. */
  refreshSettings() {
    const s = getSettings();
    this.controlScheme = s.controlScheme;
    this.palette = s.colorblindMode ? CONFIG.COLORS_COLORBLIND : CONFIG.COLORS;
    this.enhancedFx = s.enhancedFx;
    this.anchorRatio = s.playerPosition === 'center' ? 0.5 : 0.7;
    this.pointerSpeedMode = s.pointerSpeedMode;
    if (this.height) this.anchorY = this.height * this.anchorRatio;

    // D-pad: visibilità, lato e dimensione, più lo spostamento del
    // pulsante bomba e il restringimento della barra HP/XP sul lato
    // opposto per non sovrapporsi mai al D-pad, qualunque configurazione
    // di lato/dimensione sia stata scelta.
    const dpadOn = this.controlScheme === 'dpad';
    this._dpadZoneEl.classList.toggle('hidden', !dpadOn || !this.running);
    this._dpadZoneEl.classList.toggle('dpad-side-left', s.dpadSide !== 'right');
    this._dpadZoneEl.classList.toggle('dpad-side-right', s.dpadSide === 'right');
    this._dpadZoneEl.classList.remove('dpad-size-small', 'dpad-size-medium', 'dpad-size-large');
    this._dpadZoneEl.classList.add(`dpad-size-${s.dpadSize || 'medium'}`);

    const bombBtn = document.getElementById('btn-bomb');
    const hudBottom = document.querySelector('.hud-bottom');
    if (dpadOn) {
      const dpadOnLeft = s.dpadSide !== 'right';
      bombBtn.classList.toggle('pos-right', dpadOnLeft);
      hudBottom.classList.toggle('avoid-dpad-left', dpadOnLeft);
      hudBottom.classList.toggle('avoid-dpad-right', !dpadOnLeft);
    } else {
      bombBtn.classList.remove('pos-right');
      hudBottom.classList.remove('avoid-dpad-left', 'avoid-dpad-right');
    }
  }

  _onPointerMove(sx, sy) {
    this.pointerTarget = this._screenToWorld(sx, sy);
  }

  _onPointerEnd() {
    this.pointerTarget = null;
  }

  _screenToWorld(sx, sy) {
    return {
      x: sx - this.width / 2 + this.camera.x,
      y: sy - this.anchorY + this.camera.y,
    };
  }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.anchorY = this.height * (this.anchorRatio ?? 0.7);
  }

  async start() {
    const res = await Api.runStart();
    this.runToken = res && res.ok ? res.run_token : null;
    if (!this.runToken) {
      // Il giocatore può comunque giocare, ma la run non potrà essere
      // inviata a fine partita (niente gemme/punteggio in classifica):
      // meglio avvisarlo subito piuttosto che scoprirlo solo a game over.
      UI.toast(tServerError(res && res.error, 'toast.run_submit_fail'));
    }

    this.running = true;
    this.paused = false;
    this.lastTs = null;
    audio.unlock();
    startAmbientRotation();
    UI.setHudVisible(true);
    this.refreshSettings(); // riapplica visibilità D-pad ecc. ora che running=true
    requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    stopMusic();
    UI.setHudVisible(false);
    this._dpadZoneEl.classList.add('hidden');
    window.removeEventListener('resize', this._resize);
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mouseleave', this._onPointerEnd);
    this.canvas.removeEventListener('touchstart', this._onTouchMove);
    this.canvas.removeEventListener('touchmove', this._onTouchMove);
    this.canvas.removeEventListener('touchend', this._onPointerEnd);
    this.canvas.removeEventListener('touchcancel', this._onPointerEnd);
    window.removeEventListener('keydown', this._onKeyDown);
    this._dpadZoneEl.removeEventListener('touchstart', this._onDpadStart);
    this._dpadZoneEl.removeEventListener('touchmove', this._onDpadMove);
    this._dpadZoneEl.removeEventListener('touchend', this._onDpadEnd);
    this._dpadZoneEl.removeEventListener('touchcancel', this._onDpadEnd);
    this._dpadZoneEl.removeEventListener('mousedown', this._onDpadStart);
    window.removeEventListener('mousemove', this._onDpadMove);
    window.removeEventListener('mouseup', this._onDpadEnd);
  }

  setPaused(paused) { this.paused = paused; }

  triggerShake(ms, mag) {
    this.shakeMs = Math.max(this.shakeMs, ms);
    this.shakeMag = Math.max(this.shakeMag, mag);
  }

  // ---------------------------------------------------------------------
  // LOOP
  // ---------------------------------------------------------------------
  _loop(ts) {
    if (!this.running) return;
    if (this.lastTs === null) this.lastTs = ts;
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    dt = Math.min(dt, 0.05); // evita spirali di morte su tab in background

    if (!this.paused) {
      this._update(dt);
    }
    this._render();

    requestAnimationFrame(this._loop);
  }

  _update(dt) {
    this.elapsed += dt;

    this._readControlInput(dt);
    this.player.update(dt, PLAYER_CLAMP);
    this.camera.x = this.player.x;
    this.camera.y = this.player.y;

    if (this.enhancedFx || this.player.skin === 'skin_spectre') this._updatePlayerTrail(dt);
    if (this.player.skin === 'skin_overcharge') this._updateOverchargeArcs(dt);

    this._updateSpawner(dt);
    this._updateEnemies(dt);
    if (this.boss) this._updateBoss(dt);
    this._updateProjectiles(dt);
    this._updateParticles(dt);
    this._updatePickups(dt);
    this._updateDamageNumbers(dt);
    this._handleShooting(dt);
    this._collisions();

    if (this.shakeMs > 0) this.shakeMs -= dt * 1000;
    if (this.bombFlashMs > 0) this.bombFlashMs -= dt * 1000;

    UI.updateHud({
      time: this.elapsed,
      wave: this.spawner.wave,
      kills: this.kills,
      hp: this.player.hp,
      maxHp: this.player.effectiveMaxHp,
      xpRatio: this.player.xp / this.player.xpToNext,
    });
    UI.updateBombButton(this.player.bombCharges);

    if (this.player.isDead) {
      this._endRun('death');
    }
  }

  _readControlInput(dt) {
    const scheme = this.controlScheme;

    if (scheme === 'touch' || scheme === 'mouse') {
      if (this.pointerTarget) {
        const dx = this.pointerTarget.x - this.player.x;
        const dy = this.pointerTarget.y - this.player.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.5) {
          const nx = dx / d;
          const ny = dy / d;
          let magnitude = 1;
          if (this.pointerSpeedMode === 'proportional') {
            // Velocità proporzionale alla distanza dal player: 0% a
            // distanza 0, 100% da POINTER_MAX_SPEED_DISTANCE in su.
            magnitude = clamp(d / CONFIG.POINTER_MAX_SPEED_DISTANCE, 0, 1);
          }
          // Evita overshoot/oscillazione quando la distanza residua è
          // minore dello spostamento che il player farebbe in un frame
          // a piena velocità: senza questo clamp, vicino al punto di
          // arrivo il player "sfreccerebbe" oltre il target e tornerebbe
          // indietro il frame successivo, oscillando all'infinito invece
          // di fermarsi in modo stabile.
          const maxReachable = this.player.speed * (this.player._metaSpeedMult || 1) * dt;
          if (maxReachable > 0.0001 && d < maxReachable) {
            magnitude = Math.min(magnitude, d / maxReachable);
          }
          this.player.moveDX = nx * magnitude;
          this.player.moveDY = ny * magnitude;
        } else {
          this.player.moveDX = 0;
          this.player.moveDY = 0;
        }
      } else {
        this.player.moveDX = 0;
        this.player.moveDY = 0;
      }
    } else if (scheme === 'tilt') {
      this.player.moveDX = tiltState.x;
      this.player.moveDY = tiltState.y;
    } else if (scheme === 'dpad') {
      this.player.moveDX = this.dpadDX;
      this.player.moveDY = this.dpadDY;
    } else {
      this.player.moveDX = 0;
      this.player.moveDY = 0;
    }

    // La tastiera resta sempre un input di riserva disponibile (comodo
    // su desktop anche quando lo schema attivo è "mouse"): se l'utente
    // preme un tasto di movimento, ha sempre la priorità sul frame corrente.
    const k = this.keyboard;
    let kdx = 0, kdy = 0;
    if (k.left) kdx -= 1;
    if (k.right) kdx += 1;
    if (k.up) kdy -= 1;
    if (k.down) kdy += 1;
    if (kdx !== 0 || kdy !== 0) {
      this.player.moveDX = kdx;
      this.player.moveDY = kdy;
    }
  }

  _updatePlayerTrail(dt) {
    // Skin "Spettro" (v1.26.0): scia più lunga e marcata della normale
    // scia di Effetti Avanzati, per leggersi chiaramente come tratto
    // distintivo della skin anche a Effetti Avanzati disattivati.
    const maxAge = this.player.skin === 'skin_spectre' ? 0.6 : 0.35;
    this.playerTrail.push({ x: this.player.x, y: this.player.y, age: 0 });
    for (let i = this.playerTrail.length - 1; i >= 0; i--) {
      this.playerTrail[i].age += dt;
      if (this.playerTrail[i].age > maxAge) this.playerTrail.splice(i, 1);
    }
  }

  /** Skin "Sovraccarico": rigenera 1-2 archi elettrici procedurali a
   *  intervalli brevi e irregolari, ciascuno un segmento spezzato da un
   *  punto vicino al corpo verso l'esterno — puro dettaglio di
   *  rendering, nessun effetto di gioco. */
  _updateOverchargeArcs(dt) {
    this.overchargeTimer -= dt * 1000;
    if (this.overchargeTimer > 0) return;
    this.overchargeTimer = 90 + Math.random() * 130;
    this.overchargeArcs = [];
    const count = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      this.overchargeArcs.push({
        angle: Math.random() * Math.PI * 2,
        startR: this.player.radius * 0.7,
        endR: this.player.radius * 1.9 + Math.random() * 12,
        jitter: (Math.random() - 0.5) * 0.7,
      });
    }
  }

  _viewBounds() {
    const halfW = this.width / 2;
    return {
      minX: this.camera.x - halfW,
      maxX: this.camera.x + halfW,
      minY: this.camera.y - this.anchorY,
      maxY: this.camera.y + (this.height - this.anchorY),
    };
  }

  _updateSpawner(dt) {
    const requests = this.spawner.update(dt, this.enemyList.length, this._viewBounds(), !!this.boss);
    for (const req of requests) {
      if (req.type === 'enemy') {
        this._spawnEnemy(req.enemyType, req.x, req.y);
      } else if (req.type === 'boss' && !this.boss) {
        this._spawnBoss();
      }
    }
  }

  _spawnEnemy(typeKey, x, y) {
    const def = ENEMY_TYPES[typeKey];
    const e = this.enemies.acquire();
    e.spawn(typeKey, def, x, y, this.spawner.scaledMods);
    this.enemyList.push(e);
  }

  _spawnBoss() {
    const rosterLength = BOSS_TYPES.length;
    const bossIndex = this.bossesKilled % rosterLength;
    // v1.30.0 — modalità infinita ibrida: dopo il ventesimo boss si
    // ricomincia dal primo del roster, ma con una crescita aggiuntiva
    // "per giro completo" (BOSS_CYCLE_GROWTH), più dolce di quella già
    // presente boss-per-boss all'interno di un singolo giro. cycleNumber
    // resta 0 per i primi 20 boss (nessuna modifica), diventa 1 dal 21°
    // al 40°, e così via.
    const cycleNumber = Math.floor(this.bossesKilled / rosterLength);
    const baseDef = BOSS_TYPES[bossIndex];
    const def = cycleNumber === 0 ? baseDef : {
      ...baseDef,
      hp: Math.round(baseDef.hp * Math.pow(BOSS_CYCLE_GROWTH.hp, cycleNumber)),
      dmg: Math.round(baseDef.dmg * Math.pow(BOSS_CYCLE_GROWTH.dmg, cycleNumber)),
      score: Math.round(baseDef.score * Math.pow(BOSS_CYCLE_GROWTH.score, cycleNumber)),
      // tier più alto -> cooldown/telegraph ancora più severi (clampati
      // comunque ai tetti/soglie già esistenti in boss.js, non superano
      // mai i minimi di leggibilità già in vigore per il boss finale).
      tier: baseDef.tier + cycleNumber * rosterLength,
    };
    const bounds = this._viewBounds();
    const x = this.player.x;
    const y = bounds.minY - 80;
    this.boss = new Boss(def, this.spawner.scaledMods, x, y);
    this.boss.cycleNumber = cycleNumber; // per il marcatore "✦N" nella barra, vedi _renderBoss()

    // v1.31.0 — "vero duello": i nemici regolari già presenti (e i loro
    // proiettili ancora in volo) vengono spazzati via all'arrivo del
    // boss, per lasciare spazio al combattimento 1-contro-1 invece che
    // sommarsi al boss stesso — altrimenti l'orda già accumulata nelle
    // ondate precedenti rendeva il combattimento ingestibile a
    // prescindere da quanto fosse forte la build del giocatore. Non
    // contano come uccisioni né droppano ricompense: è una pulizia
    // dell'arena, non un risultato ottenuto dal giocatore.
    for (const e of this.enemyList) {
      this._spawnExplosion(e.x, e.y, this.palette[e.colorKey], 6);
      this.enemies.release(e);
    }
    this.enemyList = [];
    for (let i = this.projectileList.length - 1; i >= 0; i--) {
      if (this.projectileList[i].isEnemy) {
        this.projectiles.release(this.projectileList[i]);
        this.projectileList.splice(i, 1);
      }
    }

    audio.bossAppear();
    playBossTrack(bossIndex);
    UI.toast(t('toast.boss_incoming', { name: t(`boss.${def.key}`) }), 2600);
    this.triggerShake(400, 6);
  }

  _updateEnemies(dt) {
    for (let i = this.enemyList.length - 1; i >= 0; i--) {
      const e = this.enemyList[i];
      // Campo Rallentante: solo entro il raggio del passivo (0 = non
      // posseduto, quindi slowMult resta sempre 1 per chi non lo ha).
      let slowMult = 1;
      if (this.player.stats.slowFieldRadius > 0) {
        const dx = e.x - this.player.x, dy = e.y - this.player.y;
        if (dx * dx + dy * dy <= this.player.stats.slowFieldRadius ** 2) {
          slowMult = 1 - this.player.stats.slowFieldStrength;
        }
      }
      e.update(dt, this.player.x, this.player.y, slowMult);

      // Nemici ranged sparano proiettili verso il player
      if (e.fireRateMs) {
        e.fireCooldown -= dt * 1000;
        if (e.fireCooldown <= 0) {
          e.fireCooldown = e.fireRateMs;
          const ang = angleTo(e.x, e.y, this.player.x, this.player.y);
          const p = this.projectiles.acquire();
          p.spawn({
            x: e.x, y: e.y,
            vx: Math.cos(ang) * e.projectileSpeed, vy: Math.sin(ang) * e.projectileSpeed,
            damage: e.dmg, isEnemy: true, radius: 5,
          });
          this.projectileList.push(p);
        }
      }

      // Evocatore: genera un minion 'swarm' quando il timer scatta.
      // Controllato qui (non dentro Enemy.update) perché serve accesso
      // alla lista nemici globale, che il singolo Enemy non ha.
      if (e.summonReady) {
        e.summonReady = false;
        this._spawnEnemy('swarm', e.x + rand(-16, 16), e.y + rand(-16, 16));
      }
    }

    this.enemyHash.clear();
    for (const e of this.enemyList) this.enemyHash.insert(e);
  }

  _updateBoss(dt) {
    const effects = this.boss.update(dt, this.player.x, this.player.y);
    for (const eff of effects) {
      if (eff.type === 'spawn_projectile') {
        const speed = eff.speed || 260;
        const p = this.projectiles.acquire();
        p.spawn({
          x: this.boss.x, y: this.boss.y,
          vx: Math.cos(eff.angle) * speed, vy: Math.sin(eff.angle) * speed,
          damage: this.boss.dmg * 0.5, isEnemy: true, radius: 7,
        });
        this.projectileList.push(p);
      } else if (eff.type === 'summon_minion') {
        const dist = 90;
        const x = this.boss.x + Math.cos(eff.offsetAngle) * dist;
        const y = this.boss.y + Math.sin(eff.offsetAngle) * dist;
        this._spawnEnemy('swarm', x, y);
      } else if (eff.type === 'telegraph') {
        this.triggerShake(150, 2);
      } else if (eff.type === 'charge_tick') {
        // danno da contatto gestito in _collisions
      }
    }

    if (this.boss.hp <= 0) {
      this._killBoss();
    }
  }

  _killBoss() {
    this._spawnExplosion(this.boss.x, this.boss.y, `hsl(${this.boss.currentHue()}, 85%, 60%)`, 40);
    this.score += this.boss.score;
    this.kills += 1;
    this.bossesKilled += 1;
    audio.bossDeath();
    returnToAmbient();
    this.triggerShake(500, 10);
    UI.toast(t('toast.boss_defeated'), 2000);
    // drop generoso di xp/monete
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = rand(10, 70);
      this._spawnPickup(this.boss.x + Math.cos(a) * d, this.boss.y + Math.sin(a) * d, 'xp', 3);
    }
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = rand(10, 70);
      this._spawnPickup(this.boss.x + Math.cos(a) * d, this.boss.y + Math.sin(a) * d, 'coin', 1);
    }
    this.boss = null;
    UI.setBossBar(false);
  }

  _updateProjectiles(dt) {
    for (let i = this.projectileList.length - 1; i >= 0; i--) {
      const p = this.projectileList[i];

      const homingTargetPos = (p.homing && !p.isEnemy && !p.isExpiring)
        ? this._resolveHomingTarget(p)
        : null;
      p.update(dt, homingTargetPos);

      // Boomerang: al raggiungimento del raggio massimo, invece di
      // essere rimosso torna indietro invertendo la velocità — una
      // volta sola (p.returning), altrimenti continuerebbe a rimbalzare
      // avanti e indietro all'infinito. Il ripristino di hitList e
      // hitsRemaining permette di colpire di nuovo gli stessi nemici
      // (o altri) sul percorso di ritorno, il vero valore di quest'arma.
      if (p.boomerang && p.outOfRange && !p.returning) {
        p.returning = true;
        p.traveled = 0;
        p.vx = -p.vx;
        p.vy = -p.vy;
        p.hitList.clear();
        p.hitsRemaining = 1 + p.pierce;
      }

      const bounds = this._viewBounds();
      const margin = 300;
      const offscreen = p.x < bounds.minX - margin || p.x > bounds.maxX + margin ||
                         p.y < bounds.minY - margin || p.y > bounds.maxY + margin;

      // Un boomerang che ha già invertito e supera di nuovo il raggio
      // (es. è passato oltre il player senza colpire nulla) va rimosso
      // normalmente stavolta, non invertito una seconda volta.
      const boomerangDone = p.boomerang && p.returning && p.outOfRange;

      if (offscreen || (p.outOfRange && !p.boomerang) || boomerangDone || p.isFullyExpired) {
        this.projectiles.release(p);
        this.projectileList.splice(i, 1);
        if (p === this.orbitalProjectile) this.orbitalProjectile = null;
      }
    }
  }

  /**
   * Risolve la posizione del bersaglio per un proiettile homing,
   * mantenendo l'aggancio allo STESSO bersaglio per tutta la sua vita
   * invece di ricalcolare "il nemico più vicino" ogni frame. Con
   * bersagli in movimento, ricalcolare ad ogni frame fa cambiare
   * bersaglio in continuazione (ogni volta che un altro nemico diventa
   * anche solo momentaneamente più vicino), impedendo al proiettile di
   * convergere su chiunque — esattamente il comportamento "ondeggia e
   * non colpisce mai nulla" segnalato.
   *
   * Gestisce anche il caso in cui il bersaglio agganciato sia stato
   * ucciso e il suo oggetto Enemy riciclato dal pool per un nemico
   * successivo: senza il controllo su `spawnId`, il proiettile
   * scambierebbe il nemico riciclato per il suo bersaglio originale.
   */
  _resolveHomingTarget(p) {
    if (p.homingLockedIsBoss) {
      if (this.boss && this.boss === p.homingLockedRef) {
        return { x: this.boss.x, y: this.boss.y };
      }
      p.homingLockedRef = null;
    } else if (p.homingLockedRef) {
      if (p.homingLockedRef.active && p.homingLockedRef.spawnId === p.homingLockedSpawnId) {
        return { x: p.homingLockedRef.x, y: p.homingLockedRef.y };
      }
      p.homingLockedRef = null;
    }

    // Nessun bersaglio agganciato (o non più valido): ne cerca uno nuovo
    // una sola volta e lo blocca per il resto della vita del proiettile.
    const target = findNearestEnemy(p, this.enemyList, this.boss ? [this.boss] : []);
    if (!target) return null;

    if (target === this.boss) {
      p.homingLockedIsBoss = true;
      p.homingLockedRef = target;
    } else {
      p.homingLockedIsBoss = false;
      p.homingLockedRef = target;
      p.homingLockedSpawnId = target.spawnId;
    }
    return { x: target.x, y: target.y };
  }

  _updateParticles(dt) {
    for (let i = this.particleList.length - 1; i >= 0; i--) {
      const pt = this.particleList[i];
      pt.update(dt);
      if (pt.life <= 0) {
        this.particles.release(pt);
        this.particleList.splice(i, 1);
      }
    }
  }

  _updatePickups(dt) {
    // v1.32.0 — l'Impulso Magnetico periodico è stato unificato nel
    // passivo "magnet" (raggio crescente per stage, letto direttamente
    // da pu.update() qui sotto): non serve più nessun trigger a parte
    // per "richiamare tutto" un frame ogni tanto.
    const pullSpeedBase = this.player.stats.magnetPullSpeedBase || 420;
    for (let i = this.pickupList.length - 1; i >= 0; i--) {
      const pu = this.pickupList[i];
      const collected = pu.update(dt, this.player.x, this.player.y, this.player.pickupRadius, pullSpeedBase);
      if (collected) {
        if (pu.kind === 'xp') {
          const leveledUp = this.player.gainXp(pu.value);
          if (leveledUp) this._onLevelUp();
        } else if (pu.kind === 'coin') {
          this.score += 5;
        } else if (pu.kind === 'bomb') {
          this.player.bombCharges = Math.min(CONFIG.BOMB_MAX_CHARGES, this.player.bombCharges + 1);
          UI.updateBombButton(this.player.bombCharges);
        }
        audio.pickup();
        this.pickups.release(pu);
        this.pickupList.splice(i, 1);
      }
    }
  }

  _updateDamageNumbers(dt) {
    for (let i = this.damageNumberList.length - 1; i >= 0; i--) {
      const d = this.damageNumberList[i];
      d.update(dt);
      if (d.life <= 0) {
        this.damageNumbers.release(d);
        this.damageNumberList.splice(i, 1);
      }
    }
  }

  _onLevelUp() {
    audio.levelUp();
    this.paused = true;
    const choices = rollUpgradeChoices(this.player);
    UI.showUpgradeChoices(choices, (choice) => {
      applyUpgradeChoice(this.player, choice);
      UI.showScreen(null);
      this.paused = false;
    });
  }

  _handleShooting(dt) {
    // Drone Orbitale: non "spara" nel senso tradizionale, mantiene un
    // singolo proiettile persistente che orbita attorno al player — vedi
    // _handleOrbitalDrone. Se si passa a un'altra arma, il proiettile
    // orbitale residuo va rilasciato esplicitamente (nessun altro punto
    // del codice lo farebbe: non scade mai da solo, per design).
    if (this.player.weaponKey === 'drone') {
      this._handleOrbitalDrone(dt);
      return;
    }
    if (this.orbitalProjectile) {
      const idx = this.projectileList.indexOf(this.orbitalProjectile);
      if (idx !== -1) this.projectileList.splice(idx, 1);
      this.projectiles.release(this.orbitalProjectile);
      this.orbitalProjectile = null;
    }

    this.player.fireCooldown -= dt * 1000;
    if (this.player.fireCooldown > 0) return;

    const target = findNearestEnemy(this.player, this.enemyList, this.boss ? [this.boss] : [], 520 * 520);
    if (!target) return;

    const angle = angleTo(this.player.x, this.player.y, target.x, target.y);
    const shots = buildPlayerShots(this.player, angle);
    for (const shotDef of shots) {
      const p = this.projectiles.acquire();
      p.spawn(shotDef);
      this.projectileList.push(p);
    }
    audio.shoot(WEAPONS[this.player.weaponKey].tier);
    this.player.fireCooldown = currentFireIntervalMs(this.player);
  }

  /** Mantiene un unico proiettile persistente in orbita attorno al
   *  player, riposizionandolo ogni frame lungo un cerchio — non usa il
   *  movimento per velocità standard di Projectile.update() (che qui
   *  riceve sempre vx=vy=0 e quindi non sposta nulla da solo). La
   *  velocità di rotazione scala con la cadenza di tiro posseduta
   *  (stats.fireRateMult), così il passivo "Cadenza di Tiro" resta
   *  utile anche con questa arma invece di non avere alcun effetto. */
  _handleOrbitalDrone(dt) {
    if (!this.orbitalProjectile) {
      const p = this.projectiles.acquire();
      p.spawn({
        x: this.player.x, y: this.player.y, vx: 0, vy: 0,
        damage: 0, pierce: 999999, isEnemy: false, orbital: true, radius: 9,
        color: this.player.weaponSkins.has('drone') ? WEAPON_SKIN_COLORS.drone : null,
      });
      this.orbitalProjectile = p;
      this.projectileList.push(p);
    }

    const p = this.orbitalProjectile;
    const weapon = WEAPONS.drone;
    p.damage = weapon.damage * this.player.stats.damageMult * (this.player._metaDamageMult || 1);

    const orbitSpeed = DRONE_ORBIT_SPEED / this.player.stats.fireRateMult;
    p.orbitAngle += orbitSpeed * dt;
    p.x = this.player.x + Math.cos(p.orbitAngle) * DRONE_ORBIT_RADIUS;
    p.y = this.player.y + Math.sin(p.orbitAngle) * DRONE_ORBIT_RADIUS;

    p.orbitalHitResetMs -= dt * 1000;
    if (p.orbitalHitResetMs <= 0) {
      p.orbitalHitResetMs = DRONE_HIT_RESET_MS;
      p.hitList.clear();
    }
  }

  // ---------------------------------------------------------------------
  // COLLISIONI
  // ---------------------------------------------------------------------
  _collisions() {
    // Proiettili del player vs nemici/boss
    for (let i = this.projectileList.length - 1; i >= 0; i--) {
      const p = this.projectileList[i];
      if (p.isEnemy) continue;
      // In dissolvenza (durata massima superata): puramente visivo da
      // qui in poi, non deve più poter colpire nulla "a sorpresa".
      if (p.isExpiring) continue;

      let consumed = false;

      // vs nemici regolari (via spatial hash)
      const nearby = this.enemyHash.queryRadius(p.x, p.y, 40);
      for (const e of nearby) {
        if (p.hitList.has(e)) continue;
        if (circlesOverlap(p.x, p.y, p.radius, e.x, e.y, e.radius)) {
          this._damageEnemy(e, p);
          p.hitList.add(e);
          p.hitsRemaining -= 1;
          if (p.hitsRemaining <= 0) { consumed = true; break; }
          if (p.chainLightning) this._chainLightningJump(p, e.x, e.y);
        }
      }

      // vs boss
      if (!consumed && this.boss && !p.hitList.has(this.boss) &&
          circlesOverlap(p.x, p.y, p.radius, this.boss.x, this.boss.y, this.boss.radius)) {
        this._damageBoss(p);
        p.hitList.add(this.boss);
        p.hitsRemaining -= 1;
        if (p.hitsRemaining <= 0) consumed = true;
        else if (p.chainLightning) this._chainLightningJump(p, this.boss.x, this.boss.y);
      }

      if (consumed) {
        this.projectiles.release(p);
        this.projectileList.splice(i, 1);
      }
    }

    // Proiettili nemici vs player
    for (let i = this.projectileList.length - 1; i >= 0; i--) {
      const p = this.projectileList[i];
      if (!p.isEnemy) continue;
      if (p.isExpiring) continue;
      if (circlesOverlap(p.x, p.y, p.radius, this.player.x, this.player.y, this.player.radius)) {
        this._damagePlayer(p.damage);
        this.projectiles.release(p);
        this.projectileList.splice(i, 1);
      }
    }

    // Nemici vs player (contatto diretto)
    for (const e of this.enemyList) {
      if (circlesOverlap(e.x, e.y, e.radius, this.player.x, this.player.y, this.player.radius)) {
        this._damagePlayer(e.dmg * 0.5 * 0.6); // danno da contatto ridotto e mitigato dall'invuln frame
      }
    }

    // Boss vs player (contatto / carica)
    if (this.boss && circlesOverlap(this.boss.x, this.boss.y, this.boss.radius, this.player.x, this.player.y, this.player.radius)) {
      const mult = this.boss.currentAttack === 'charge' ? 1.5 : 0.5;
      this._damagePlayer(this.boss.dmg * mult * 0.4);
    }
  }

  /** Fulmine a Catena: dopo un impatto, reindirizza il proiettile verso
   *  il bersaglio non ancora colpito più vicino entro CHAIN_LIGHTNING_RANGE,
   *  invece di proseguire lungo la traiettoria originale. Se non trova
   *  nessun bersaglio ulteriore, il proiettile continua semplicemente
   *  dritto finché non scade per durata massima — non è un bug, è la
   *  fine naturale della catena. */
  _chainLightningJump(p, fromX, fromY) {
    let nearest = null;
    let nearestD2 = CHAIN_LIGHTNING_RANGE * CHAIN_LIGHTNING_RANGE;

    const candidates = this.enemyHash.queryRadius(fromX, fromY, CHAIN_LIGHTNING_RANGE);
    for (const e of candidates) {
      if (p.hitList.has(e)) continue;
      const dx = e.x - fromX, dy = e.y - fromY;
      const d2 = dx * dx + dy * dy;
      if (d2 < nearestD2) { nearestD2 = d2; nearest = e; }
    }
    if (this.boss && !p.hitList.has(this.boss)) {
      const dx = this.boss.x - fromX, dy = this.boss.y - fromY;
      const d2 = dx * dx + dy * dy;
      if (d2 < nearestD2) { nearestD2 = d2; nearest = this.boss; }
    }
    if (!nearest) return;

    const ang = angleTo(fromX, fromY, nearest.x, nearest.y);
    const speed = Math.hypot(p.vx, p.vy);
    p.x = fromX; p.y = fromY;
    p.vx = Math.cos(ang) * speed;
    p.vy = Math.sin(ang) * speed;
  }

  _damageEnemy(enemy, projectile) {
    const { finalDamage, isCrit } = this._rollDamage(projectile.damage);
    const ang = Math.atan2(projectile.vy, projectile.vx);
    // Direzione da cui è arrivato il colpo (opposta al moto del
    // proiettile) — usata dal nemico "Corazzato" per capire se il colpo
    // ha centrato il lato scudato o quello scoperto (v1.24.0).
    const hitFromAngle = ang + Math.PI;
    const dead = enemy.takeDamage(finalDamage, hitFromAngle);
    this._spawnDamageNumber(enemy.x, enemy.y, Math.round(finalDamage), isCrit);
    this._applyLifesteal(finalDamage);
    audio.hit();

    enemy.applyKnockback(Math.cos(ang), Math.sin(ang), 90);

    if (projectile.explosive) {
      this._triggerExplosion(projectile);
    }

    if (dead) this._killEnemy(enemy);
  }

  _damageBoss(projectile) {
    const { finalDamage, isCrit } = this._rollDamage(projectile.damage);
    const dead = this.boss.takeDamage(finalDamage);
    this._spawnDamageNumber(this.boss.x, this.boss.y - this.boss.radius * 0.5, Math.round(finalDamage), isCrit);
    this._applyLifesteal(finalDamage);
    audio.hit();
    if (projectile.explosive) {
      this._triggerExplosion(projectile);
    }
  }

  /** Applica il roll di colpo critico (passivo "Colpo Critico") a un danno base.
   *  v1.33.0: accumula anche il totale di danno inflitto nella run
   *  (this.totalDamageDealt), inviato a fine partita per alimentare la
   *  categoria "damage_total" dei Traguardi — unico punto per entrambi
   *  _damageEnemy e _damageBoss, che passano sempre da qui. */
  _rollDamage(baseDamage) {
    const critChance = this.player.stats.critChance || 0;
    const result = (critChance > 0 && Math.random() < critChance)
      ? { finalDamage: baseDamage * CONFIG.CRIT_DAMAGE_MULT, isCrit: true }
      : { finalDamage: baseDamage, isCrit: false };
    this.totalDamageDealt += result.finalDamage;
    return result;
  }

  /** Applica la cura da vampirismo (passivo "Vampirismo") in base al danno inflitto. */
  _applyLifesteal(damageDealt) {
    const ratio = this.player.stats.lifestealRatio || 0;
    if (ratio <= 0) return;
    this.player.hp = Math.min(this.player.effectiveMaxHp, this.player.hp + damageDealt * ratio);
  }

  /** Esplosione ad area del potenziamento "Esplosivo": raggio e danno
   *  scalano con il livello raggiunto al momento in cui il proiettile
   *  è stato sparato (livelli acquisiti dopo non influenzano proiettili
   *  già in volo, solo quelli sparati successivamente). */
  _triggerExplosion(projectile) {
    const lvl = Math.max(1, projectile.explosiveLevel || 1);
    const dmgMult = CONFIG.EXPLOSIVE_BASE_DAMAGE_MULT + (lvl - 1) * CONFIG.EXPLOSIVE_DAMAGE_MULT_PER_LEVEL;
    const radius = CONFIG.EXPLOSIVE_BASE_RADIUS + (lvl - 1) * CONFIG.EXPLOSIVE_RADIUS_PER_LEVEL;
    this._explodeAt(projectile.x, projectile.y, projectile.damage * dmgMult, radius);
  }

  _explodeAt(x, y, damage, radius) {
    this._spawnExplosion(x, y, this.palette.projectilePlayer, 10);
    const nearby = this.enemyHash.queryRadius(x, y, radius);
    for (const e of nearby) {
      if (circlesOverlap(x, y, radius, e.x, e.y, e.radius)) {
        const dead = e.takeDamage(damage);
        if (dead) this._killEnemy(e);
      }
    }
  }

  _killEnemy(enemy) {
    const idx = this.enemyList.indexOf(enemy);
    if (idx === -1) return;
    this.enemyList.splice(idx, 1);

    // Divisore: genera le copie PRIMA di rilasciare l'oggetto al pool
    // (serve ancora x/y del genitore per posizionarle attorno a lui).
    if (enemy.splitsInto && enemy.splitCount > 0) {
      for (let i = 0; i < enemy.splitCount; i++) {
        const angle = (Math.PI * 2 * i) / enemy.splitCount + Math.random() * 0.4;
        const offset = enemy.radius * 0.8;
        this._spawnEnemy(enemy.splitsInto, enemy.x + Math.cos(angle) * offset, enemy.y + Math.sin(angle) * offset);
      }
    }

    this.enemies.release(enemy);

    this.kills += 1;
    this.score += enemy.score;
    audio.enemyDeath();
    this._spawnExplosion(enemy.x, enemy.y, this.palette[enemy.colorKey], 8);
    this._spawnPickup(enemy.x, enemy.y, 'xp', enemy.xp);
    if (Math.random() < enemy.coinChance) {
      this._spawnPickup(enemy.x + rand(-8, 8), enemy.y + rand(-8, 8), 'coin', 1);
    }
    if (this.player.bombCharges < CONFIG.BOMB_MAX_CHARGES && Math.random() < CONFIG.BOMB_DROP_CHANCE) {
      this._spawnPickup(enemy.x + rand(-8, 8), enemy.y + rand(-8, 8), 'bomb', 1);
    }
  }

  /**
   * Attiva una bomba EMP se disponibile: azzera tutti i nemici REGOLARI
   * attualmente visibili a schermo (non l'intera mappa), lasciando del
   * tutto illeso il boss — per design, la bomba non è pensata per
   * bypassare i combattimenti contro i boss, solo per "ripulire" le
   * ondate di nemici comuni quando la situazione si fa ingestibile.
   */
  useBomb() {
    if (!this.running || this.paused) return;
    if (this.player.bombCharges <= 0) return;

    this.player.bombCharges -= 1;

    for (let i = this.enemyList.length - 1; i >= 0; i--) {
      const e = this.enemyList[i];
      const { sx, sy } = this._worldToScreen(e.x, e.y);
      if (sx >= -60 && sx <= this.width + 60 && sy >= -60 && sy <= this.height + 60) {
        this._killEnemy(e);
      }
    }

    this.bombFlashMs = CONFIG.BOMB_FLASH_DURATION_MS;
    audio.bomb();
    this.triggerShake(350, 9);
    UI.updateBombButton(this.player.bombCharges);
  }

  _damagePlayer(amount) {
    const hpBefore = this.player.hp;
    const hit = this.player.takeDamage(amount);
    if (hit) {
      audio.playerHurt();
      this.triggerShake(180, 5);
      // Spine Ritorsive: il danno di ritorno è proporzionale al danno
      // EFFETTIVAMENTE subito (hpBefore - hp attuale), non all'importo
      // "amount" richiesto — se uno scudo o l'invulnerabilità avessero
      // assorbito parte del colpo, il riflesso non deve contarla.
      if (this.player.stats.thornsRatio > 0) {
        this._thornsPulse(hpBefore - this.player.hp);
      }
      if (this.player.secondWindJustTriggered) {
        this.player.secondWindJustTriggered = false;
        UI.toast(t('toast.second_wind'), 2200);
        audio.levelUp(); // stesso "ding" di livello, il più adatto tra i suoni esistenti per un salvataggio in extremis
        this.triggerShake(260, 7);
      }
    }
  }

  /** Danno ad area centrato sul player, innescato dal passivo Spine
   *  Ritorsive quando subisce un colpo. Colpisce nemici regolari e boss
   *  entro un raggio fisso, riusando la stessa pipeline di morte/loot
   *  dei danni "normali" per restare coerente (drop oggetti, punteggio,
   *  contatore uccisioni). */
  _thornsPulse(actualDamageTaken) {
    const thornsDamage = actualDamageTaken * this.player.stats.thornsRatio;
    if (thornsDamage <= 0) return;
    const radius = 90;
    const radiusSq = radius * radius;

    for (let i = this.enemyList.length - 1; i >= 0; i--) {
      const e = this.enemyList[i];
      const dx = e.x - this.player.x, dy = e.y - this.player.y;
      if (dx * dx + dy * dy > radiusSq) continue;
      const dead = e.takeDamage(thornsDamage);
      this.totalDamageDealt += thornsDamage; // v1.33.0 — un colpo per ogni nemico raggiunto, non una volta sola
      this._spawnDamageNumber(e.x, e.y, Math.round(thornsDamage), false);
      if (dead) this._killEnemy(e);
    }

    if (this.boss) {
      const dx = this.boss.x - this.player.x, dy = this.boss.y - this.player.y;
      if (dx * dx + dy * dy <= radiusSq) {
        const dead = this.boss.takeDamage(thornsDamage);
        this.totalDamageDealt += thornsDamage;
        this._spawnDamageNumber(this.boss.x, this.boss.y - this.boss.radius * 0.5, Math.round(thornsDamage), false);
        if (dead) this._killBoss();
      }
    }
  }

  _spawnExplosion(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = rand(40, 220);
      const pt = this.particles.acquire();
      pt.spawn({
        x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life: rand(0.25, 0.55), color, size: rand(2, 4),
      });
      this.particleList.push(pt);
    }
  }

  _spawnPickup(x, y, kind, value) {
    const pu = this.pickups.acquire();
    pu.spawn({ x, y, kind, value });
    this.pickupList.push(pu);
  }

  _spawnDamageNumber(x, y, value, crit = false) {
    const d = this.damageNumbers.acquire();
    d.spawn({ x, y, value, crit });
    this.damageNumberList.push(d);
  }

  // ---------------------------------------------------------------------
  // FINE RUN
  // ---------------------------------------------------------------------
  async _endRun(reason) {
    if (!this.running) return;
    this.running = false;
    audio.gameOver();
    UI.setHudVisible(false);
    // Copre anche il caso in cui la run finisca (morte o uscita) mentre
    // un boss è ancora vivo, mai sconfitto tramite _killBoss(): senza
    // questo, la prossima run partirebbe con la barra "sporca" del boss
    // abbandonato, visibile per un istante prima che ne appaia uno nuovo.
    UI.setBossBar(false);

    let gemsEarned = 0;
    this.lastRunResult = null;
    if (this.runToken) {
      const res = await Api.runSubmit({
        run_token: this.runToken,
        score: Math.round(this.score),
        wave_reached: this.spawner.wave,
        kills: this.kills,
        duration_sec: Math.round(this.elapsed),
        difficulty: this.difficultyKey,
        bosses_killed: this.bossesKilled,
        damage_dealt: Math.round(this.totalDamageDealt),
      });
      if (res && res.ok) {
        gemsEarned = res.gems_earned;
        this.lastRunResult = res;
      } else {
        // Senza questo avviso, un submit fallito (token scaduto, run
        // considerata non plausibile dal server, rete assente, ecc.)
        // passava inosservato: la run mostrava semplicemente 0 gemme
        // senza spiegare perché.
        UI.toast(tServerError(res && res.error, 'toast.run_submit_fail'));
      }
    }

    UI.fillGameOverRecap({
      wave: this.spawner.wave,
      kills: this.kills,
      timeSec: Math.round(this.elapsed),
      score: Math.round(this.score),
      gemsEarned,
      streak: this.lastRunResult ? this.lastRunResult.streak : 0,
      streakBonusGems: this.lastRunResult ? this.lastRunResult.streak_bonus_gems : 0,
    });
    UI.showScreen('gameover');

    if (this._onEnd) this._onEnd();
  }

  quit() { this._endRun('quit'); }

  // ---------------------------------------------------------------------
  // RENDERING
  // ---------------------------------------------------------------------
  _worldToScreen(x, y) {
    return {
      sx: x - this.camera.x + this.width / 2,
      sy: y - this.camera.y + this.anchorY,
    };
  }

  _render() {
    const ctx = this.ctx;
    ctx.save();

    if (this.shakeMs > 0) {
      const m = this.shakeMag * (this.shakeMs / 300);
      ctx.translate(rand(-m, m), rand(-m, m));
    }

    ctx.fillStyle = this.palette.background;
    ctx.fillRect(-20, -20, this.width + 40, this.height + 40);

    this._renderBackgroundGrid();
    this._renderPickups();
    this._renderParticles();
    if (this.enhancedFx || this.player.skin === 'skin_spectre') this._renderPlayerTrail();
    this._renderEnemies();
    if (this.boss) this._renderBoss();
    this._renderProjectiles();
    this._renderPlayer();
    this._renderDamageNumbers();
    if (this.enhancedFx) this._renderLowHpVignette();
    if (this.player.stats.magnetStage >= 4) this._renderMagnetGlow();
    if (this.bombFlashMs > 0) this._renderBombFlash();

    ctx.restore();
  }

  /** Flash bianco/ciano a schermo intero quando si usa una bomba EMP, dissolvenza rapida. */
  _renderBombFlash() {
    const ctx = this.ctx;
    const alpha = (this.bombFlashMs / CONFIG.BOMB_FLASH_DURATION_MS) * 0.6;
    ctx.fillStyle = `rgba(157, 247, 234, ${alpha.toFixed(3)})`;
    ctx.fillRect(-20, -20, this.width + 40, this.height + 40);
  }

  _renderBackgroundGrid() {
    const ctx = this.ctx;
    const spacing = 64;
    const offX = ((this.camera.x % spacing) + spacing) % spacing;
    const offY = ((this.camera.y % spacing) + spacing) % spacing;
    ctx.strokeStyle = 'rgba(53, 224, 193, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -offX; x < this.width; x += spacing) {
      ctx.moveTo(x, 0); ctx.lineTo(x, this.height);
    }
    for (let y = -offY; y < this.height; y += spacing) {
      ctx.moveTo(0, y); ctx.lineTo(this.width, y);
    }
    ctx.stroke();
  }

  _renderPlayer() {
    const ctx = this.ctx;
    const { sx, sy } = this._worldToScreen(this.player.x, this.player.y);
    const blinking = this.player.invulnMs > 0 && Math.floor(this.player.invulnMs / 80) % 2 === 0;

    // Indicatore del raggio "Magnete" (stage 1-3): un cerchio tenue che
    // segue il player, mostra fino a dove arriva l'attrazione senza
    // risultare invadente. Allo stage 4 il raggio copre l'intero
    // schermo e oltre — il cerchio finirebbe ben fuori dai bordi,
    // quindi non viene più disegnato (sostituito dal bagliore pulsante
    // ai bordi, vedi _renderMagnetGlow()).
    const magnetStage = this.player.stats.magnetStage || 0;
    if (magnetStage > 0 && magnetStage < 4) {
      ctx.beginPath();
      ctx.arc(sx, sy, this.player.pickupRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(53, 224, 193, 0.14)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const skin = this.player.skin;
    // Skin: dalla v1.26.0 non solo colore diverso, ma un dettaglio
    // visivo distintivo per ciascuna — sempre nello stesso linguaggio
    // minimale del resto del gioco (forme geometriche/glow via canvas,
    // nessun asset esterno). 'skin_ninja' = tono violetto ombroso;
    // 'skin_robot' = tono ambra con anello corazzato; 'skin_pulsecore'
    // = pulsa a tempo con la colonna sonora; 'skin_sentinel' = un
    // piccolo orbe orbitante puramente decorativo (diverso dal Drone
    // Orbitale, che è un'arma con effetto di gioco reale); 'skin_
    // overcharge' = archi elettrici procedurali intermittenti; 'skin_
    // spectre' = scia fantasma marcata (vedi _renderPlayerTrail).
    const skinColors = {
      skin_ninja: '#b98aff', skin_robot: '#ffb020',
      skin_pulsecore: '#ff5fa8', skin_sentinel: '#4fd8ff',
      skin_overcharge: '#fff45c', skin_spectre: '#d8d4f0',
      // v1.33.0 — skin esclusive dei Traguardi (nessun effetto speciale
      // dedicato per restare nei tempi, solo colori distintivi: se in
      // futuro si vuole dar loro lo stesso trattamento delle skin del
      // negozio, questo è il punto da estendere).
      skin_butcher: '#c0392b', skin_veteran: '#8a7530', skin_immortal: '#f0d97a',
      skin_devoted: '#4b3f8f', skin_hunter: '#2f8f5b', skin_destroyer: '#5a6b7a',
    };
    const playerColor = skinColors[skin] || this.palette.player;

    if (this.player.shieldFlashMs > 0) {
      ctx.beginPath();
      ctx.arc(sx, sy, this.player.radius + 8, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(53,224,193,0.8)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    if (skin === 'skin_robot') {
      // Anello esterno "corazzato": una sottile fascia poligonale
      // attorno al corpo, per differenziare la sagoma oltre al colore.
      ctx.beginPath();
      ctx.arc(sx, sy, this.player.radius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,176,32,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (skin === 'skin_overcharge') {
      // Archi elettrici procedurali: segmenti spezzati (2 tratti con un
      // punto di jitter in mezzo) dal bordo del corpo verso l'esterno,
      // rigenerati periodicamente da _updateOverchargeArcs.
      ctx.strokeStyle = playerColor;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = playerColor;
      ctx.shadowBlur = 6;
      for (const arc of this.overchargeArcs) {
        const midR = (arc.startR + arc.endR) / 2;
        const midAngle = arc.angle + arc.jitter;
        const x0 = sx + Math.cos(arc.angle) * arc.startR, y0 = sy + Math.sin(arc.angle) * arc.startR;
        const xm = sx + Math.cos(midAngle) * midR, ym = sy + Math.sin(midAngle) * midR;
        const x1 = sx + Math.cos(arc.angle) * arc.endR, y1 = sy + Math.sin(arc.angle) * arc.endR;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(xm, ym);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    if (skin === 'skin_sentinel') {
      // Orbe decorativo che orbita di continuo attorno al player, con
      // una linea sottile che lo collega — puramente estetico, nessun
      // effetto di gioco (distinto dal Drone Orbitale, arma reale).
      const orbitAngle = this.elapsed * 2.1;
      const orbitRadius = this.player.radius + 20;
      const ox = sx + Math.cos(orbitAngle) * orbitRadius;
      const oy = sy + Math.sin(orbitAngle) * orbitRadius;
      ctx.strokeStyle = 'rgba(79,216,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ox, oy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ox, oy, 4, 0, Math.PI * 2);
      ctx.fillStyle = playerColor;
      ctx.shadowColor = playerColor;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Nucleo Pulsante: raggio e bagliore pulsano a tempo con la traccia
    // musicale attiva (getCurrentBpm da music.js) — un impulso netto ad
    // ogni battito invece di un'onda sinusoidale morbida, per leggersi
    // chiaramente come "battito" e non come respiro generico.
    let radiusMult = 1, glowMult = 1;
    if (skin === 'skin_pulsecore') {
      const beatsPerSec = getCurrentBpm() / 60;
      const phase = (this.elapsed * beatsPerSec) % 1;
      const pulse = Math.pow(1 - phase, 3);
      radiusMult = 1 + pulse * 0.22;
      glowMult = 1 + pulse * 0.9;
    }

    ctx.globalAlpha = blinking ? 0.4 : 1;
    ctx.beginPath();
    ctx.arc(sx, sy, this.player.radius * radiusMult, 0, Math.PI * 2);
    ctx.fillStyle = playerColor;
    ctx.shadowColor = playerColor;
    ctx.shadowBlur = (this.enhancedFx ? 24 : 14) * glowMult;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  /** Effetti Avanzati: scia luminosa che segue il player, dissolvenza rapida. */
  _renderPlayerTrail() {
    const ctx = this.ctx;
    const isSpectre = this.player.skin === 'skin_spectre';
    const color = isSpectre ? '#e8ecf1' : this.palette.player;
    const maxAge = isSpectre ? 0.6 : 0.35;
    const baseAlpha = isSpectre ? 0.4 : 0.25;
    for (const point of this.playerTrail) {
      const { sx, sy } = this._worldToScreen(point.x, point.y);
      const lifeRatio = 1 - point.age / maxAge;
      ctx.globalAlpha = lifeRatio * baseAlpha;
      ctx.beginPath();
      ctx.arc(sx, sy, this.player.radius * lifeRatio, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Effetti Avanzati: leggera vignetta rossa pulsante quando l'HP è basso. */
  _renderLowHpVignette() {
    const ratio = this.player.hp / this.player.effectiveMaxHp;
    if (ratio >= 0.3) return;
    const ctx = this.ctx;
    const pulse = 0.35 + 0.25 * Math.sin(this.elapsed * 6);
    const intensity = (1 - ratio / 0.3) * pulse;
    const grad = ctx.createRadialGradient(
      this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.35,
      this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.7
    );
    grad.addColorStop(0, 'rgba(255,77,94,0)');
    grad.addColorStop(1, `rgba(255,77,94,${intensity.toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /** Stage massimo del passivo "Magnete" (4/4): a quel punto il raggio
   *  di attrazione copre l'intero schermo e oltre, quindi disegnare il
   *  cerchio indicatore non avrebbe più senso (sarebbe ben fuori dai
   *  bordi) — un bagliore tenue e pulsante ai bordi comunica "tutto lo
   *  schermo viene attratto" in modo discreto, non invadente. Non
   *  legato a Effetti Avanzati: è informazione di gameplay, non un
   *  extra puramente estetico.
   */
  _renderMagnetGlow() {
    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 2.2);
    const alpha = 0.05 + pulse * 0.05;
    const grad = ctx.createRadialGradient(
      this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.4,
      this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.75
    );
    grad.addColorStop(0, 'rgba(53,224,193,0)');
    grad.addColorStop(1, `rgba(53,224,193,${alpha.toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  _renderEnemies() {
    const ctx = this.ctx;
    for (const e of this.enemyList) {
      const { sx, sy } = this._worldToScreen(e.x, e.y);
      if (sx < -60 || sx > this.width + 60 || sy < -60 || sy > this.height + 60) continue;

      // Triangolo allungato orientato verso il player (invece del vecchio
      // pallino): la punta indica sempre la direzione di minaccia, più
      // leggibile a colpo d'occhio e più in linea col tema "dardo/caccia".
      const angle = Math.atan2(this.player.y - e.y, this.player.x - e.x);
      const len = e.radius * 2.1;   // lunghezza punta-coda
      const halfWidth = e.radius * 0.85;

      const tipX = sx + Math.cos(angle) * len * 0.62;
      const tipY = sy + Math.sin(angle) * len * 0.62;
      const backAngle1 = angle + Math.PI * 0.8;
      const backAngle2 = angle - Math.PI * 0.8;
      const back1X = sx + Math.cos(backAngle1) * halfWidth;
      const back1Y = sy + Math.sin(backAngle1) * halfWidth;
      const back2X = sx + Math.cos(backAngle2) * halfWidth;
      const back2Y = sy + Math.sin(backAngle2) * halfWidth;

      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(back1X, back1Y);
      ctx.lineTo(back2X, back2Y);
      ctx.closePath();
      ctx.fillStyle = e.hitFlashMs > 0 ? '#ffffff' : this.palette[e.colorKey];
      ctx.fill();

      if (e.maxHp > 30) {
        const ratio = clamp(e.hp / e.maxHp, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(sx - e.radius, sy - e.radius - 8, e.radius * 2, 4);
        ctx.fillStyle = '#ff4d5e';
        ctx.fillRect(sx - e.radius, sy - e.radius - 8, e.radius * 2 * ratio, 4);
      }

      // Corazzato: arco scudato disegnato sopra il corpo, ruota nel
      // tempo (vedi Enemy.update). Lampeggia bianco per un istante
      // quando blocca davvero un colpo, per un feedback immediato e
      // distinto dal normale hitFlash del corpo.
      if (e.shielded) {
        ctx.beginPath();
        ctx.arc(sx, sy, e.radius + 5, e.shieldAngle - CONFIG.SHIELDED_ARC_WIDTH / 2, e.shieldAngle + CONFIG.SHIELDED_ARC_WIDTH / 2);
        ctx.strokeStyle = e.shieldBlockFlashMs > 0 ? '#ffffff' : 'rgba(77,143,255,0.85)';
        ctx.lineWidth = 4;
        ctx.stroke();
      }

      // Teletrasportatore: anello che si espande e sfuma subito dopo un
      // salto di posizione, per rendere chiaro cosa è appena successo
      // invece di far sembrare un errore di rendering.
      if (e.teleportFlashMs > 0) {
        const t = 1 - e.teleportFlashMs / 260;
        ctx.beginPath();
        ctx.arc(sx, sy, e.radius + t * 26, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(162,57,255,${1 - t})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Evocatore: anello pulsante che si intensifica man mano che si
      // avvicina il prossimo minion generato — dà al giocatore un
      // margine per interromperlo, invece di un'evocazione a sorpresa.
      if (e.summons && e.summonCooldown < 900) {
        const pulse = 1 - e.summonCooldown / 900;
        ctx.beginPath();
        ctx.arc(sx, sy, e.radius + 6 + pulse * 5, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(92,138,138,${0.3 + pulse * 0.5})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  _renderBoss() {
    const ctx = this.ctx;
    const b = this.boss;
    const { sx, sy } = this._worldToScreen(b.x, b.y);
    const hue = b.currentHue();
    const hpRatio = clamp(b.hp / b.maxHp, 0, 1);

    if (b.state === 'telegraph') {
      ctx.beginPath();
      ctx.arc(sx, sy, b.radius + 14, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,176,32,0.7)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Anello esterno poligonale: mostra solo una frazione dei lati,
    // proporzionale agli HP residui, dando l'effetto di "spezzarsi"
    // mano a mano che il boss viene danneggiato.
    const outerRadius = b.radius * 1.55;
    const outerRotation = b.age * CONFIG.BOSS_RING_ROTATION_SPEED;
    const outerPts = polygonPoints(sx, sy, outerRadius, b.ringSides, outerRotation);
    const visibleEdges = Math.max(1, Math.round(b.ringSides * hpRatio));
    ctx.strokeStyle = `hsl(${hue}, 80%, 55%)`;
    ctx.lineWidth = 3;
    for (let i = 0; i < visibleEdges; i++) {
      const p1 = outerPts[i];
      const p2 = outerPts[(i + 1) % outerPts.length];
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.stroke();
    }

    // Anello interno: rotazione opposta e più rapida, numero di lati
    // leggermente diverso dall'esterno per un effetto "ingranaggi".
    const innerRadius = b.radius * 1.05;
    const innerRotation = -b.age * CONFIG.BOSS_RING_ROTATION_SPEED * 1.4;
    const innerSides = 3 + (b.ringSides % 4);
    const innerPts = polygonPoints(sx, sy, innerRadius, innerSides, innerRotation);
    ctx.beginPath();
    innerPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
    ctx.closePath();
    ctx.strokeStyle = `hsl(${hue}, 70%, 70%)`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Nucleo centrale
    ctx.beginPath();
    ctx.arc(sx, sy, b.radius * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = b.hitFlashMs > 0 ? '#ffffff' : `hsl(${hue}, 85%, 60%)`;
    ctx.shadowColor = `hsl(${hue}, 85%, 60%)`;
    ctx.shadowBlur = this.enhancedFx ? 28 : 20;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Satelliti orbitanti: piccoli triangoli (stesso linguaggio visivo dei
    // nemici) in orbita continua attorno al boss.
    const orbitRadius = b.radius * CONFIG.BOSS_SATELLITE_ORBIT_RADIUS_MULT;
    const satRadius = Math.max(4, b.radius * 0.18);
    for (let i = 0; i < b.satelliteCount; i++) {
      const a = b.age * CONFIG.BOSS_SATELLITE_ORBIT_SPEED + (i / b.satelliteCount) * Math.PI * 2;
      const satX = sx + Math.cos(a) * orbitRadius;
      const satY = sy + Math.sin(a) * orbitRadius;
      const facing = a + Math.PI / 2; // punta nella direzione del moto orbitale
      const tipX = satX + Math.cos(facing) * satRadius * 1.3;
      const tipY = satY + Math.sin(facing) * satRadius * 1.3;
      const backA1 = facing + Math.PI * 0.8;
      const backA2 = facing - Math.PI * 0.8;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(satX + Math.cos(backA1) * satRadius, satY + Math.sin(backA1) * satRadius);
      ctx.lineTo(satX + Math.cos(backA2) * satRadius, satY + Math.sin(backA2) * satRadius);
      ctx.closePath();
      ctx.fillStyle = `hsl(${hue}, 75%, 65%)`;
      ctx.fill();
    }

    const bossLabel = b.cycleNumber > 0 ? `${t(`boss.${b.def.key}`)} ✦${b.cycleNumber + 1}` : t(`boss.${b.def.key}`);
    UI.setBossBar(true, bossLabel, hpRatio);
  }

  _renderProjectiles() {
    const ctx = this.ctx;
    for (const p of this.projectileList) {
      const { sx, sy } = this._worldToScreen(p.x, p.y);
      const color = p.color || (p.isEnemy ? this.palette.projectileEnemy : this.palette.projectilePlayer);
      const alpha = p.fadeAlpha;

      if (this.enhancedFx) {
        // Scia luminosa nella direzione opposta al moto
        const speed = Math.hypot(p.vx, p.vy) || 1;
        const trailLen = clamp(p.radius * 3.2, 8, 22);
        const tx = sx - (p.vx / speed) * trailLen;
        const ty = sy - (p.vy / speed) * trailLen;
        const grad = ctx.createLinearGradient(sx, sy, tx, ty);
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = grad;
        ctx.lineWidth = Math.max(1.5, p.radius * 0.9);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }

      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      if (this.enhancedFx) { ctx.shadowColor = color; ctx.shadowBlur = 8; }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  _renderParticles() {
    const ctx = this.ctx;
    for (const pt of this.particleList) {
      const { sx, sy } = this._worldToScreen(pt.x, pt.y);
      ctx.globalAlpha = pt.alpha;
      ctx.fillStyle = pt.color;
      ctx.fillRect(sx - pt.size / 2, sy - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
  }

  _renderPickups() {
    const ctx = this.ctx;
    for (const pu of this.pickupList) {
      const { sx, sy } = this._worldToScreen(pu.x, pu.y);
      if (pu.kind === 'bomb') {
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💣', sx, sy);
        continue;
      }
      ctx.fillStyle = pu.kind === 'xp' ? this.palette.xpOrb : this.palette.coin;
      ctx.beginPath();
      ctx.arc(sx, sy, pu.kind === 'xp' ? 4 : 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _renderDamageNumbers() {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    for (const d of this.damageNumberList) {
      const { sx, sy } = this._worldToScreen(d.x, d.y);
      ctx.globalAlpha = d.alpha;
      if (d.crit) {
        ctx.font = '700 19px "Space Mono", monospace';
        ctx.fillStyle = this.palette.boss; // ambra: coerente col colore "warning/critico" già usato altrove
        ctx.fillText(`${d.value}!`, sx, sy);
      } else {
        ctx.font = '700 13px "Space Mono", monospace';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(String(d.value), sx, sy);
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** Vertici di un poligono regolare: usato per gli anelli concentrici dei
 *  boss (_renderBoss). Restituisce un array di [x,y] in coordinate schermo. */
function polygonPoints(cx, cy, radius, sides, rotation) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
  }
  return pts;
}

export function computeMetaBonuses(shopItems) {
  const meta = { base_hp: 0, base_dmg: 0, base_speed: 0, unlockedWeapons: new Set(['pistol']), skins: new Set(), weaponSkins: new Set() };
  for (const item of shopItems) {
    const level = item.owned_level || 0;
    if (level <= 0) continue;
    if (item.effect_key === 'base_hp') meta.base_hp += item.effect_value * level;
    else if (item.effect_key === 'base_dmg') meta.base_dmg += item.effect_value * level;
    else if (item.effect_key === 'base_speed') meta.base_speed += item.effect_value * level;
    // v1.27.0 — skin per le armi (weaponskin_<arma>): prefisso distinto
    // da 'weapon_' (nota la 's' di 'weaponskin' subito dopo 'weapon',
    // niente underscore lì), quindi non collide con lo sblocco armi
    // sotto — ordine dei controlli comunque ininfluente ai fini pratici.
    else if (item.effect_key.startsWith('weaponskin_')) meta.weaponSkins.add(item.effect_key.replace('weaponskin_', ''));
    else if (item.effect_key.startsWith('weapon_')) meta.unlockedWeapons.add(item.effect_key.replace('weapon_', ''));
    else if (item.effect_key.startsWith('skin_')) meta.skins.add(item.effect_key);
    // Le voci 'bundle_*' non hanno un effect_key proprio da applicare
    // qui: l'acquisto di un bundle (vedi api/shop/buy.php) crea
    // direttamente le righe nh_user_upgrades per ciascun oggetto incluso,
    // che vengono già lette dai rami sopra come acquisti normali.
  }
  return meta;
}
