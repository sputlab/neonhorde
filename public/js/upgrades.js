// =====================================================================
// upgrades.js — pool di potenziamenti offerti a fine wave / level up,
// e logica di applicazione al player.
//
// Sistema progressivo: ogni potenziamento (tranne il cambio arma) è
// livellabile fino a un massimo (FIRE_MODES[key].maxLevel /
// PASSIVES[key].maxLevel in js/config.js), non più acquisibile una
// tantum. Ogni scelta include `level` (il livello che si otterrebbe
// scegliendola ORA) e `maxLevel`, usati dalla UI per mostrare un
// indicatore "Lv. X/Y" sulla card.
// =====================================================================
import { WEAPONS, FIRE_MODES, PASSIVES, LIFESTEAL_BUFF_DURATION_SEC, LIFESTEAL_RATIO_PER_LEVEL, CONFIG } from './config.js';
import { sampleUnique } from './utils.js';

const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'laser', 'flamethrower', 'boomerang', 'chainlightning', 'railgun', 'drone'];

/** Prossima arma nella progressione che il player possiede il diritto di
 *  usare (pistol/smg sempre; le altre solo se sbloccate dal negozio —
 *  vedi player.unlockedWeapons, popolato in Game.constructor). Salta le
 *  armi non sbloccate invece di bloccare la progressione: chi ha
 *  comprato solo il Laser (senza Shotgun) riceve comunque il Laser
 *  quando gli tocca, non resta bloccato allo Shotgun che non possiede. */
function nextWeapon(player) {
  const idx = WEAPON_ORDER.indexOf(player.weaponKey);
  for (let i = idx + 1; i < WEAPON_ORDER.length; i++) {
    const candidate = WEAPON_ORDER[i];
    if (player.unlockedWeapons.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Costruisce il pool di opzioni disponibili in questo momento e ne
 * estrae 3 senza ripetizioni. Ogni opzione ha una `kind` che indica
 * come applicarla: 'weapon' | 'firemode' | 'passive'.
 */
export function rollUpgradeChoices(player) {
  const pool = [];

  const weaponUpgrade = nextWeapon(player);
  if (weaponUpgrade) {
    pool.push({ kind: 'weapon', key: weaponUpgrade, icon: WEAPONS[weaponUpgrade].icon });
  }

  for (const key in FIRE_MODES) {
    const def = FIRE_MODES[key];
    const level = player.fireModeLevels[key] || 0;
    if (level < def.maxLevel) {
      pool.push({ kind: 'firemode', key, icon: def.icon, level: level + 1, maxLevel: def.maxLevel });
    }
  }

  for (const key in PASSIVES) {
    const def = PASSIVES[key];
    const level = player.passiveStacks[key] || 0;
    if (level < def.maxLevel) {
      pool.push({ kind: 'passive', key, icon: def.icon, level: level + 1, maxLevel: def.maxLevel });
    }
  }

  // Bomba EMP: non ha "livelli" in senso stretto, solo cariche accumulabili
  // fino al tetto massimo — offerta nel pool solo se non si è già al max.
  if (player.bombCharges < CONFIG.BOMB_MAX_CHARGES) {
    pool.push({ kind: 'bomb', key: 'bomb', icon: '💣', level: player.bombCharges + 1, maxLevel: CONFIG.BOMB_MAX_CHARGES });
  }

  return sampleUnique(pool, 3);
}

export function applyUpgradeChoice(player, choice) {
  if (choice.kind === 'weapon') {
    player.weaponKey = choice.key;
  } else if (choice.kind === 'bomb') {
    player.bombCharges = Math.min(CONFIG.BOMB_MAX_CHARGES, player.bombCharges + 1);
  } else if (choice.kind === 'firemode') {
    player.fireModeLevels[choice.key] = (player.fireModeLevels[choice.key] || 0) + 1;
  } else if (choice.kind === 'passive') {
    const level = (player.passiveStacks[choice.key] || 0) + 1;
    if (choice.key === 'lifesteal') {
      // Temporaneo per design: invece di accumularsi per sempre, ogni
      // scelta (ri)attiva una finestra di durata fissa con il rateo del
      // livello raggiunto; scaduta la finestra, la cura torna a 0 finché
      // non si risceglie il potenziamento. Vedi Player.update() per il
      // conto alla rovescia.
      player.stats.lifestealRatio = LIFESTEAL_RATIO_PER_LEVEL * level;
      player.lifestealTimer = LIFESTEAL_BUFF_DURATION_SEC;
    } else {
      PASSIVES[choice.key].apply(player.stats);
    }
    player.passiveStacks[choice.key] = level;
  }
}
