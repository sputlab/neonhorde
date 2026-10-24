<?php
declare(strict_types=1);
require __DIR__ . '/../config.php';

/**
 * POST /api/achievements/claim
 * body: { tier_id }
 * Riscatta un tier dei Traguardi: verifica che il progresso a vita
 * dell'utente abbia raggiunto il target (ricalcolato qui server-side,
 * mai fidandosi di un "completed" inviato dal client), accredita le
 * gemme e, se il tier include una skin esclusiva, la sblocca inserendo
 * direttamente la riga in nh_user_upgrades (nessun costo in gemme per
 * quell'inserimento: la skin STESSA è la ricompensa, non un acquisto).
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metodo non consentito', 405);
}

$user = current_user();
rate_limit('achievements_claim', 30, 60);

$body   = json_input();
$tierId = (int) ($body['tier_id'] ?? 0);

if ($tierId <= 0) {
    json_error('tier_id non valido');
}

$pdo = db();
$pdo->beginTransaction();

try {
    $stmt = $pdo->prepare('SELECT * FROM nh_achievement_tiers WHERE id = :id FOR UPDATE');
    $stmt->execute(['id' => $tierId]);
    $tier = $stmt->fetch();

    if (!$tier) {
        $pdo->rollBack();
        json_error('Traguardo non trovato', 404);
    }

    $alreadyClaimed = $pdo->prepare('SELECT 1 FROM nh_user_achievements WHERE user_id = :u AND tier_id = :t');
    $alreadyClaimed->execute(['u' => $user['id'], 't' => $tierId]);
    if ($alreadyClaimed->fetch()) {
        $pdo->rollBack();
        json_error('Ricompensa già riscattata', 409);
    }

    // Il progresso si ricava dalle statistiche a vita, non da un valore
    // inviato dal client — stessa mappa categoria->colonna di achievements.php.
    $statColumn = [
        'kills_total'   => 'lifetime_kills',
        'runs_total'    => 'lifetime_runs',
        'survival_best' => 'best_survival_sec',
        'streak_best'   => 'longest_streak',
        'bosses_total'  => 'lifetime_bosses_killed',
        'damage_total'  => 'lifetime_damage_dealt',
    ][$tier['category']] ?? null;

    if ($statColumn === null) {
        $pdo->rollBack();
        json_error('Categoria del traguardo non riconosciuta', 500);
    }

    $statStmt = $pdo->prepare("SELECT {$statColumn} AS progress FROM nh_users WHERE id = :u FOR UPDATE");
    $statStmt->execute(['u' => $user['id']]);
    $progress = (int) $statStmt->fetchColumn();

    if ($progress < (int) $tier['target']) {
        $pdo->rollBack();
        json_error('Traguardo non ancora raggiunto', 409);
    }

    $pdo->prepare('INSERT INTO nh_user_achievements (user_id, tier_id, claimed_at) VALUES (:u, :t, NOW())')
        ->execute(['u' => $user['id'], 't' => $tierId]);

    $pdo->prepare('UPDATE nh_users SET gems = gems + :g WHERE id = :u')
        ->execute(['g' => (int) $tier['reward_gems'], 'u' => $user['id']]);

    $unlockedSkinKey = null;
    if ($tier['reward_shop_item_id'] !== null) {
        $pdo->prepare(
            'INSERT INTO nh_user_upgrades (user_id, item_id, level, purchased_at)
             VALUES (:u, :i, 1, NOW())
             ON DUPLICATE KEY UPDATE purchased_at = purchased_at'
        )->execute(['u' => $user['id'], 'i' => (int) $tier['reward_shop_item_id']]);

        $skinStmt = $pdo->prepare('SELECT effect_key FROM nh_shop_items WHERE id = :i');
        $skinStmt->execute(['i' => (int) $tier['reward_shop_item_id']]);
        $unlockedSkinKey = $skinStmt->fetchColumn() ?: null;
    }

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    json_error('Errore durante il riscatto', 500);
}

$newGems = (int) $pdo->query('SELECT gems FROM nh_users WHERE id = ' . (int) $user['id'])->fetchColumn();

json_response([
    'ok'               => true,
    'gems_earned'      => (int) $tier['reward_gems'],
    'gems_total'       => $newGems,
    'unlocked_skin_key'=> $unlockedSkinKey,
]);
