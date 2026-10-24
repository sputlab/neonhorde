// =====================================================================
// weapons.js — mira automatica sul nemico più vicino + fabbrica proiettili
// del player, tenendo conto di arma equipaggiata + fire mode + passivi.
// =====================================================================
import { WEAPONS } from './config.js';
import { dist2 } from './utils.js';

// v1.27.0 — colore alternativo dei proiettili quando si possiede la
// skin dedicata per quell'arma (player.weaponSkins, popolato in
// Game.constructor da metaBonuses.weaponSkins). Senza la skin, il
// colore resta null e il renderer usa il teal di default del player.
const WEAPON_SKIN_COLORS = {
  laser: '#c96bff',
  railgun: '#ff4d6d',
  drone: '#ffcf40',
};
export { WEAPON_SKIN_COLORS };

/** Trova il nemico vivo più vicino al player entro un raggio massimo. */
export function findNearestEnemy(player, enemies, bosses, maxRangeSq = Infinity) {
  let nearest = null;
  let nearestD2 = maxRangeSq;

  for (const e of enemies) {
    if (!e.active) continue;
    const d2 = dist2(player.x, player.y, e.x, e.y);
    if (d2 < nearestD2) { nearestD2 = d2; nearest = e; }
  }
  for (const b of bosses) {
    const d2 = dist2(player.x, player.y, b.x, b.y);
    if (d2 < nearestD2) { nearestD2 = d2; nearest = b; }
  }
  return nearest;
}

/**
 * Calcola i parametri di spawn per ogni proiettile che il player deve
 * sparare in questo frame, tenendo conto di arma + fire mode + passivi.
 * Restituisce un array di descrittori pronti per Projectile.spawn().
 */
export function buildPlayerShots(player, targetAngle) {
  const weapon = WEAPONS[player.weaponKey];
  const levels = player.fireModeLevels;

  const multishotLvl = levels.multishot || 0;
  const pierceLvl = levels.pierce || 0;
  const bounceLvl = levels.bounce || 0;
  const homingLvl = levels.homing || 0;
  const explosiveLvl = levels.explosive || 0;

  let projectileCount = weapon.projectiles + multishotLvl;
  let pierce = weapon.pierce + pierceLvl;
  const homing = homingLvl > 0;
  const explosive = explosiveLvl > 0;
  const bounce = bounceLvl > 0;

  const damage = weapon.damage * player.stats.damageMult * (player._metaDamageMult || 1);
  const speed = weapon.projectileSpeed;
  const spreadRad = (weapon.spread * Math.PI) / 180;
  const skinColor = player.weaponSkins.has(player.weaponKey) ? WEAPON_SKIN_COLORS[player.weaponKey] : null;

  const shots = [];
  for (let i = 0; i < projectileCount; i++) {
    const offset = projectileCount > 1
      ? -spreadRad / 2 + (spreadRad / (projectileCount - 1)) * i
      : (Math.random() - 0.5) * spreadRad;
    const angle = targetAngle + offset;
    shots.push({
      x: player.x, y: player.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      damage, pierce, homing, explosive, bounce,
      homingLevel: homingLvl, explosiveLevel: explosiveLvl, bounceLevel: bounceLvl,
      isEnemy: false,
      range: weapon.range || null,
      radius: weapon.tier >= 3 ? 6 : 4,
      color: skinColor, // null = colore di default del renderer; altrimenti tinta della skin arma posseduta
      chainLightning: !!weapon.chainLightning,
      boomerang: !!weapon.boomerang,
    });
  }
  return shots;
}

export function currentFireIntervalMs(player) {
  const weapon = WEAPONS[player.weaponKey];
  return weapon.fireRateMs * player.stats.fireRateMult;
}
