// =====================================================================
// boss.js — istanza boss attivo + macchina a stati dei pattern d'attacco
// =====================================================================
import { pick, angleTo } from './utils.js';
import { CONFIG } from './config.js';

const ATTACK_COOLDOWN_MS = { charge: 3200, fan_shot: 2600, summon: 5200, radial_burst: 4200 };
// v1.29.0 — quanto i cooldown si accorciano dal primo boss (tier 0)
// all'ultimo (tier 19): fino al 40% più frequenti, per rendere i boss
// più tardivi genuinamente più impegnativi da schivare, non solo da
// abbattere (prima la frequenza d'attacco era identica per tutti i
// boss, cambiavano solo HP/danno). Tetto al 40% per restare difficile
// ma leggibile, mai al punto di sembrare ingiusto.
const COOLDOWN_MULT_PER_TIER = 0.021;
const COOLDOWN_MULT_CAP = 0.4;
// Tempo di preavviso ("telegraph") prima che l'attacco parta davvero:
// si riduce leggermente coi tier più alti (meno margine di reazione),
// ma mai sotto una soglia che lo renderebbe illeggibile.
const TELEGRAPH_BASE_MS = 500;
const TELEGRAPH_MS_PER_TIER = 8;
const TELEGRAPH_MIN_MS = 350;

export class Boss {
  constructor(def, difficultyMods, x, y) {
    this.def = def;
    this.x = x; this.y = y;
    this.radius = def.radius;
    this.maxHp = def.hp * difficultyMods.enemyHp;
    this.hp = this.maxHp;
    this.speed = def.speed;
    this.dmg = def.dmg * difficultyMods.enemyDmg;
    this.score = def.score;

    // v1.29.0 — moltiplicatore di cooldown e durata del telegraph
    // derivati dal tier del boss (0 = primo, 19 = finale): calcolati una
    // volta qui invece che ricalcolati ad ogni attacco.
    const tier = def.tier || 0;
    this.cooldownMult = 1 - Math.min(COOLDOWN_MULT_CAP, tier * COOLDOWN_MULT_PER_TIER);
    this.telegraphMs = Math.max(TELEGRAPH_MIN_MS, TELEGRAPH_BASE_MS - tier * TELEGRAPH_MS_PER_TIER);

    // Aspetto: anelli poligonali + satelliti orbitanti (vedi _renderBoss
    // in js/game.js). `age` alimenta la rotazione di anelli/satelliti e,
    // per il boss finale, anche il ciclo continuo del colore (hue).
    this.hue = def.hue;
    this.ringSides = def.ringSides;
    this.satelliteCount = def.satelliteCount;
    this.isFinal = def.isFinal;
    this.age = 0;

    this.state = 'chase';       // chase | telegraph | attacking | recover
    this.stateMs = 0;
    this.currentAttack = null;
    this.attackCooldowns = {};
    def.attacks.forEach(a => { this.attackCooldowns[a] = rand_start(); });

    this.chargeDX = 0; this.chargeDY = 0;
    this.hitFlashMs = 0;
    this.telegraphTargetX = 0;
    this.telegraphTargetY = 0;
  }

  /** Colore corrente del boss in HSL: fisso per i boss regolari, in
   *  continua rotazione per il boss finale (aspetto "che cambia colore"). */
  currentHue() {
    if (!this.isFinal) return this.hue;
    return (this.age * CONFIG.BOSS_FINAL_HUE_CYCLE_SPEED) % 360;
  }

  takeDamage(amount) {
    this.hp -= amount;
    this.hitFlashMs = 90;
    return this.hp <= 0;
  }

  /**
   * Aggiorna la macchina a stati del boss. Restituisce un array di
   * "effetti" da applicare nel game loop: spawn proiettili, evocazioni,
   * danno da carica, ecc. Il game loop resta l'unica fonte di verità
   * sulle entità effettive (proiettili/nemici), il boss chiede solo.
   */
  update(dt, targetX, targetY) {
    this.age += dt;
    if (this.hitFlashMs > 0) this.hitFlashMs -= dt * 1000;
    this.stateMs += dt * 1000;

    const effects = [];

    for (const key in this.attackCooldowns) this.attackCooldowns[key] -= dt * 1000;

    if (this.state === 'chase') {
      const dx = targetX - this.x, dy = targetY - this.y;
      const d = Math.hypot(dx, dy) || 1;
      this.x += (dx / d) * this.speed * dt;
      this.y += (dy / d) * this.speed * dt;

      const ready = this.def.attacks.filter(a => this.attackCooldowns[a] <= 0);
      if (ready.length > 0 && this.stateMs > 600) {
        this.currentAttack = pick(ready);
        this.state = 'telegraph';
        this.stateMs = 0;
        this.telegraphTargetX = targetX;
        this.telegraphTargetY = targetY;
        effects.push({ type: 'telegraph', attack: this.currentAttack });
      }
    } else if (this.state === 'telegraph') {
      // Breve pausa "carica l'attacco" (leggibilità per il player) — la
      // durata si accorcia leggermente per i boss di tier più alto
      // (this.telegraphMs, calcolato nel costruttore), mai sotto la
      // soglia minima di leggibilità.
      if (this.stateMs >= this.telegraphMs) {
        this.state = 'attacking';
        this.stateMs = 0;
        effects.push(...this._beginAttack());
      }
    } else if (this.state === 'attacking') {
      effects.push(...this._duringAttack(dt, targetX, targetY));
      if (this._attackFinished()) {
        this.state = 'recover';
        this.stateMs = 0;
        this.attackCooldowns[this.currentAttack] = ATTACK_COOLDOWN_MS[this.currentAttack] * this.cooldownMult;
      }
    } else if (this.state === 'recover') {
      if (this.stateMs > 500) {
        this.state = 'chase';
        this.stateMs = 0;
        this.currentAttack = null;
      }
    }

    return effects;
  }

  _beginAttack() {
    // Flag "già sparato" per QUESTA istanza d'attacco, invece di un
    // controllo a finestra temporale (stateMs < 10ms): a 60Hz un singolo
    // frame dura ~16.7ms, quindi quella finestra non si apriva quasi mai
    // — fan_shot/summon/radial_burst rischiavano di non scattare MAI in
    // pratica su un display standard (bug scoperto in v1.29.0, non solo
    // teorico: verificato che si riproduce con un dt realistico a 60Hz).
    this.attackFired = false;
    if (this.currentAttack === 'charge') {
      const ang = angleTo(this.x, this.y, this.telegraphTargetX, this.telegraphTargetY);
      this.chargeDX = Math.cos(ang);
      this.chargeDY = Math.sin(ang);
    }
    return [];
  }

  _duringAttack(dt, targetX, targetY) {
    const effects = [];
    if (this.currentAttack === 'charge') {
      const chargeSpeed = this.speed * 6;
      this.x += this.chargeDX * chargeSpeed * dt;
      this.y += this.chargeDY * chargeSpeed * dt;
      effects.push({ type: 'charge_tick' });
    } else if (this.currentAttack === 'fan_shot') {
      if (!this.attackFired) { // esegue una sola volta all'ingresso dello stato
        this.attackFired = true;
        const baseAngle = angleTo(this.x, this.y, targetX, targetY);
        const bulletCount = 9;
        const spread = Math.PI * 0.7;
        for (let i = 0; i < bulletCount; i++) {
          const a = baseAngle - spread / 2 + (spread / (bulletCount - 1)) * i;
          effects.push({ type: 'spawn_projectile', angle: a });
        }
      }
    } else if (this.currentAttack === 'summon') {
      if (!this.attackFired) {
        this.attackFired = true;
        const count = 4;
        for (let i = 0; i < count; i++) {
          const a = (Math.PI * 2 * i) / count;
          effects.push({ type: 'summon_minion', offsetAngle: a });
        }
      }
    } else if (this.currentAttack === 'radial_burst') {
      // Esclusiva del boss finale: raffica di proiettili distribuiti su
      // tutti i 360°, non solo verso il player (a differenza di fan_shot).
      if (!this.attackFired) {
        this.attackFired = true;
        const count = CONFIG.RADIAL_BURST_PROJECTILE_COUNT;
        for (let i = 0; i < count; i++) {
          const a = (Math.PI * 2 * i) / count;
          effects.push({ type: 'spawn_projectile', angle: a, speed: CONFIG.RADIAL_BURST_PROJECTILE_SPEED });
        }
      }
    }
    return effects;
  }

  _attackFinished() {
    const durations = { charge: 700, fan_shot: 260, summon: 260, radial_burst: 260 };
    return this.stateMs >= (durations[this.currentAttack] || 300);
  }
}

function rand_start() { return Math.random() * 1500; }
