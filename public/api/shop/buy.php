<?php
declare(strict_types=1);
require __DIR__ . '/../config.php';

/**
 * POST /api/shop/buy
 * body: { item_id }
 * Acquista un livello dell'oggetto (o l'oggetto stesso se max_level = 1).
 * Transazionale: scala le gemme e registra/incrementa user_upgrades solo
 * se l'utente ne ha a sufficienza e non ha già raggiunto max_level.
 *
 * v1.27.0:
 *  - Applica lo sconto dell'offerta del giorno se l'oggetto acquistato è
 *    quello in offerta oggi (stesso calcolo deterministico di shop.php).
 *  - Se l'oggetto è di tipo 'bundle', acquista/garantisce il possesso di
 *    OGNI oggetto elencato in bundle_items in un'unica transazione,
 *    oltre a registrare il bundle stesso come posseduto.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metodo non consentito', 405);
}

$user = current_user();
rate_limit('shop_buy', 30, 60);

$body   = json_input();
$itemId = (int) ($body['item_id'] ?? 0);

if ($itemId <= 0) {
    json_error('item_id non valido');
}

$pdo = db();
$pdo->beginTransaction();

try {
    $stmt = $pdo->prepare('SELECT * FROM nh_shop_items WHERE id = :id AND active = 1 FOR UPDATE');
    $stmt->execute(['id' => $itemId]);
    $item = $stmt->fetch();

    if (!$item) {
        $pdo->rollBack();
        json_error('Oggetto non trovato', 404);
    }

    $stmt = $pdo->prepare(
        'SELECT gems FROM nh_users WHERE id = :u FOR UPDATE'
    );
    $stmt->execute(['u' => $user['id']]);
    $gems = (int) $stmt->fetchColumn();

    $stmt = $pdo->prepare(
        'SELECT level FROM nh_user_upgrades WHERE user_id = :u AND item_id = :i FOR UPDATE'
    );
    $stmt->execute(['u' => $user['id'], 'i' => $itemId]);
    $currentLevel = (int) ($stmt->fetchColumn() ?: 0);

    if ($currentLevel >= (int) $item['max_level']) {
        $pdo->rollBack();
        json_error('Livello massimo già raggiunto per questo oggetto', 409);
    }

    // Costo cresce leggermente ad ogni livello per gli oggetti stackabili
    $cost = (int) round((float) $item['cost_gems'] * (1 + 0.15 * $currentLevel));

    // Offerta del giorno: stesso calcolo deterministico di shop.php,
    // ricalcolato qui server-side (mai fidarsi di un prezzo scontato
    // inviato dal client) — si applica solo ai tipi idonei, gli stessi
    // filtrati in shop.php.
    if (in_array($item['type'], ['weapon_unlock', 'skin', 'weapon_skin'], true)) {
        $dealEligible = $pdo->query(
            "SELECT id FROM nh_shop_items WHERE active = 1 AND type IN ('weapon_unlock','skin','weapon_skin') ORDER BY sort_order ASC"
        )->fetchAll(PDO::FETCH_COLUMN);
        if (count($dealEligible) > 0) {
            $daySeed = (int) date('Ymd');
            $dealItemId = (int) $dealEligible[$daySeed % count($dealEligible)];
            if ($dealItemId === $itemId) {
                $cost = (int) round($cost * 0.7);
            }
        }
    }

    if ($gems < $cost) {
        $pdo->rollBack();
        json_error('Gemme insufficienti', 402);
    }

    $pdo->prepare('UPDATE nh_users SET gems = gems - :c WHERE id = :u')
        ->execute(['c' => $cost, 'u' => $user['id']]);

    if ($item['type'] === 'bundle') {
        $bundleItemIds = json_decode((string) $item['bundle_items'], true);
        if (!is_array($bundleItemIds)) {
            $bundleItemIds = [];
        }
        $insertUpgrade = $pdo->prepare(
            'INSERT INTO nh_user_upgrades (user_id, item_id, level, purchased_at)
             VALUES (:u, :i, 1, NOW())
             ON DUPLICATE KEY UPDATE purchased_at = purchased_at'
        );
        // Nota: ON DUPLICATE KEY qui non incrementa level (a differenza
        // del ramo normale sotto) — un oggetto incluso nel bundle e già
        // posseduto resta al suo livello attuale, il bundle garantisce
        // il possesso ma non "regala" livelli extra su ciò che si aveva già.
        foreach ($bundleItemIds as $bundledId) {
            $insertUpgrade->execute(['u' => $user['id'], 'i' => (int) $bundledId]);
        }
    }

    $pdo->prepare(
        'INSERT INTO nh_user_upgrades (user_id, item_id, level, purchased_at)
         VALUES (:u, :i, 1, NOW())
         ON DUPLICATE KEY UPDATE level = level + 1, purchased_at = NOW()'
    )->execute(['u' => $user['id'], 'i' => $itemId]);

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    json_error('Errore durante l\'acquisto', 500);
}

$newGems = (int) $pdo->query('SELECT gems FROM nh_users WHERE id = ' . (int) $user['id'])->fetchColumn();
$newLevel = $currentLevel + 1;

json_response(['ok' => true, 'gems_total' => $newGems, 'item_id' => $itemId, 'new_level' => $newLevel]);
