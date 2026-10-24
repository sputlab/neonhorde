<?php
declare(strict_types=1);
require __DIR__ . '/config.php';

/**
 * GET /api/achievements
 * Tutti i tier dei Traguardi (progressione permanente, mai resettata a
 * differenza delle missioni giornaliere), raggruppati per categoria,
 * col progresso e stato di riscatto dell'utente corrente — a
 * differenza di missions.php, qui il progresso non vive in una tabella
 * "per utente per tier" separata: si ricava direttamente dalle
 * statistiche a vita già su nh_users (lifetime_kills ecc.), aggiornate
 * ad ogni run in api/run/submit.php. Solo il RISCATTO (claim) è
 * tracciato a parte, in nh_user_achievements.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_error('Metodo non consentito', 405);
}

$user = current_user();
$pdo  = db();

$stmt = $pdo->prepare(
    'SELECT lifetime_kills, lifetime_runs, lifetime_bosses_killed, lifetime_damage_dealt,
            best_survival_sec, longest_streak
     FROM nh_users WHERE id = :u'
);
$stmt->execute(['u' => $user['id']]);
$stats = $stmt->fetch();

// Mappa categoria -> valore di progresso corrente dell'utente. Tenuta
// qui (non in una funzione condivisa) perché è l'unico punto che ne ha
// bisogno; se in futuro servisse altrove vale la pena spostarla in
// config.php.
$progressByCategory = [
    'kills_total'   => (int) $stats['lifetime_kills'],
    'runs_total'    => (int) $stats['lifetime_runs'],
    'survival_best' => (int) $stats['best_survival_sec'],
    'streak_best'   => (int) $stats['longest_streak'],
    'bosses_total'  => (int) $stats['lifetime_bosses_killed'],
    'damage_total'  => (int) $stats['lifetime_damage_dealt'],
];

$tiers = $pdo->query(
    'SELECT t.id, t.category, t.tier_order, t.target, t.reward_gems, t.reward_shop_item_id,
            si.effect_key AS reward_skin_key
     FROM nh_achievement_tiers t
     LEFT JOIN nh_shop_items si ON si.id = t.reward_shop_item_id
     ORDER BY t.category ASC, t.tier_order ASC'
)->fetchAll();

$claimedStmt = $pdo->prepare('SELECT tier_id FROM nh_user_achievements WHERE user_id = :u');
$claimedStmt->execute(['u' => $user['id']]);
$claimedIds = array_map('intval', $claimedStmt->fetchAll(PDO::FETCH_COLUMN));
$claimedSet = array_flip($claimedIds);

$categories = [];
foreach ($tiers as $t) {
    $cat = $t['category'];
    $progress = $progressByCategory[$cat] ?? 0;
    $target = (int) $t['target'];
    $categories[$cat][] = [
        'id'              => (int) $t['id'],
        'tier_order'      => (int) $t['tier_order'],
        'target'          => $target,
        'reward_gems'     => (int) $t['reward_gems'],
        'reward_skin_key' => $t['reward_skin_key'], // null se il tier non dà una skin
        'progress'        => min($progress, $target),
        'completed'       => $progress >= $target,
        'claimed'         => isset($claimedSet[(int) $t['id']]),
    ];
}

json_response(['ok' => true, 'categories' => $categories]);
