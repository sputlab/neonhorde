<?php
declare(strict_types=1);
require __DIR__ . '/config.php';

/**
 * GET /api/shop
 * Elenco oggetti acquistabili. Se autenticato, include il livello
 * già posseduto per ciascun oggetto e le gemme disponibili.
 *
 * v1.27.0 — include anche l'offerta del giorno: un oggetto sbloccabile
 * one-shot (arma, skin o skin arma — non oggetti stat stackabili né
 * bundle, che hanno già uno sconto proprio) scontato del 30%,
 * deterministico dalla data odierna quindi identico per tutti gli
 * utenti e stabile per l'intera giornata (nessuna tabella dedicata
 * necessaria: si ricalcola sempre allo stesso modo da date('Ymd')).
 */

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_error('Metodo non consentito', 405);
}

$pdo = db();
$user = current_user(false);

$items = $pdo->query(
    'SELECT * FROM nh_shop_items WHERE active = 1 ORDER BY sort_order ASC'
)->fetchAll();

$owned = [];
if ($user) {
    $stmt = $pdo->prepare('SELECT item_id, level FROM nh_user_upgrades WHERE user_id = :u');
    $stmt->execute(['u' => $user['id']]);
    foreach ($stmt->fetchAll() as $row) {
        $owned[(int) $row['item_id']] = (int) $row['level'];
    }
}

$dealEligible = array_values(array_filter(
    $items,
    fn($i) => in_array($i['type'], ['weapon_unlock', 'skin', 'weapon_skin'], true)
));
$dealDiscountPct = 30;
$dealItemId = null;
if (count($dealEligible) > 0) {
    $daySeed = (int) date('Ymd');
    $dealItemId = (int) $dealEligible[$daySeed % count($dealEligible)]['id'];
}

$result = array_map(function ($item) use ($owned, $dealItemId, $dealDiscountPct) {
    $item['owned_level'] = $owned[(int) $item['id']] ?? 0;
    if ((int) $item['id'] === $dealItemId) {
        $item['deal_price'] = (int) round((float) $item['cost_gems'] * (1 - $dealDiscountPct / 100));
    }
    return $item;
}, $items);

json_response([
    'ok'         => true,
    'items'      => $result,
    'gems'       => $user ? (int) $user['gems'] : null,
    'daily_deal' => $dealItemId !== null ? ['item_id' => $dealItemId, 'discount_pct' => $dealDiscountPct] : null,
]);
