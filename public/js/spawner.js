// =====================================================================
// spawner.js — gestione ondate, densità/velocità crescente, trigger boss
// =====================================================================
import { CONFIG, ENEMY_TYPES } from './config.js';
import { rand, randInt, weightedPick } from './utils.js';

export class Spawner {
  constructor(difficultyKey) {
    this.difficultyKey = difficultyKey;
    this.mods = CONFIG.DIFFICULTY[difficultyKey];
    this.elapsed = 0;
    this.wave = 1;
    this.spawnTimer = 0;
    this.bossTimer = 0;
    this.bossPending = false;
  }

  /** Tabella pesata dei tipi di nemico sbloccati progressivamente nel tempo. */
  _enemyWeights() {
    const t = this.elapsed;
    const table = [{ item: 'basic', weight: 10 }];
    if (t > 15) table.push({ item: 'fast', weight: 8 });
    if (t > 35) table.push({ item: 'swarm', weight: 9 });
    if (t > 55) table.push({ item: 'ranged', weight: 6 });
    if (t > 80) table.push({ item: 'tank', weight: 5 });
    // v1.24.0 — 4 nuovi tipi, sbloccati progressivamente più tardi
    // (comportamenti più complessi da leggere/affrontare, introdotti
    // quando il giocatore ha già un minimo di build sviluppata).
    if (t > 110) table.push({ item: 'splitter', weight: 5 });
    if (t > 140) table.push({ item: 'teleporter', weight: 4 });
    if (t > 170) table.push({ item: 'shielded', weight: 4 });
    if (t > 200) table.push({ item: 'summoner', weight: 3 });
    return table;
  }

  /**
   * Moltiplicatore aggiuntivo (>= 1) da applicare a HP/danno dei nemici,
   * crescente nel tempo per contrastare l'aumento di potenza del player
   * dovuto ai potenziamenti stackati durante la run. Va MOLTIPLICATO
   * sopra ai mods di difficoltà, non li sostituisce. Ramp e tetto sono
   * specifici della difficoltà scelta (v1.17.0), non più uguali per tutti.
   */
  get timeScaleMult() {
    return 1 + Math.min(this.mods.timeScaleMaxBonus, this.elapsed / this.mods.timeScaleRampSec);
  }

  /** mods di difficoltà con lo scaling temporale già applicato, pronti
   *  per essere passati a Enemy.spawn()/Boss(). */
  get scaledMods() {
    const t = this.timeScaleMult;
    return {
      ...this.mods,
      enemyHp: this.mods.enemyHp * t,
      enemyDmg: this.mods.enemyDmg * t,
    };
  }

  _currentSpawnIntervalMs() {
    // Scala da SPAWN_BASE_INTERVAL_MS a SPAWN_MIN_INTERVAL_MS nell'arco
    // di spawnRampSec (specifico della difficoltà, v1.17.0 — prima erano
    // sempre 5 minuti fissi per tutti), poi resta al minimo. Diviso per
    // lo spawnRate di difficoltà.
    const progress = Math.min(1, this.elapsed / this.mods.spawnRampSec);
    const base = CONFIG.SPAWN_BASE_INTERVAL_MS - (CONFIG.SPAWN_BASE_INTERVAL_MS - CONFIG.SPAWN_MIN_INTERVAL_MS) * progress;
    return base / this.mods.spawnRate;
  }

  /** Quanti nemici spawnare insieme per "raffica" (aumenta con il tempo). */
  _burstSize() {
    if (this.elapsed < 40) return 1;
    if (this.elapsed < 100) return randInt(1, 2);
    if (this.elapsed < 200) return randInt(2, 3);
    return randInt(2, 4);
  }

  /**
   * Avanza la simulazione dello spawner. Restituisce una lista di
   * "richieste di spawn" da evadere nel game loop:
   * { type: 'enemy', enemyType, x, y } oppure { type: 'boss' }
   *
   * @param bossAlive true se un boss è attualmente vivo (v1.28.0): in
   *   tal caso lo spawner "blinda" l'ondata — non genera nuovi nemici
   *   regolari (quelli già presenti restano, semplicemente non se ne
   *   aggiungono altri) e il conto alla rovescia verso il prossimo boss
   *   resta in pausa, riprendendo solo dopo che quello attuale muore.
   *   Senza questo, i nemici regolari continuavano ad accumularsi sopra
   *   il boss stesso durante il combattimento, fino a diventare
   *   ingestibili anche con le bombe.
   */
  update(dt, currentEnemyCount, worldBounds, bossAlive = false) {
    this.elapsed += dt;
    this.wave = 1 + Math.floor(this.elapsed / CONFIG.WAVE_DURATION_SEC);

    const requests = [];

    // --- Spawn nemici regolari (sospeso durante un combattimento boss) ---
    if (!bossAlive) {
      this.spawnTimer -= dt * 1000;
      if (this.spawnTimer <= 0 && currentEnemyCount < CONFIG.MAX_ENEMIES_ON_SCREEN) {
        this.spawnTimer = this._currentSpawnIntervalMs();
        const burst = this._burstSize();
        const weights = this._enemyWeights();
        for (let i = 0; i < burst; i++) {
          const enemyType = weightedPick(weights);
          const pos = this._edgeSpawnPosition(worldBounds);
          requests.push({ type: 'enemy', enemyType, x: pos.x, y: pos.y });
        }
      }
    }

    // --- Trigger boss ogni BOSS_INTERVAL_SEC (il conto riparte solo a
    //     boss precedente sconfitto, non durante il combattimento) ---
    if (!bossAlive) {
      this.bossTimer += dt;
      if (this.bossTimer >= CONFIG.BOSS_INTERVAL_SEC) {
        this.bossTimer = 0;
        requests.push({ type: 'boss' });
      }
    }

    return requests;
  }

  /** Genera una posizione lungo il bordo superiore/laterale, fuori schermo. */
  _edgeSpawnPosition(worldBounds) {
    const pad = CONFIG.WORLD_PADDING;
    const side = randInt(0, 2); // 0=top, 1=left, 2=right (bordo inferiore escluso: il player guarda in alto)
    if (side === 0) {
      return { x: rand(worldBounds.minX, worldBounds.maxX), y: worldBounds.minY - pad };
    } else if (side === 1) {
      return { x: worldBounds.minX - pad, y: rand(worldBounds.minY, worldBounds.maxY) };
    } else {
      return { x: worldBounds.maxX + pad, y: rand(worldBounds.minY, worldBounds.maxY) };
    }
  }
}

export { ENEMY_TYPES };
