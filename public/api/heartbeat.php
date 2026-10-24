<?php
declare(strict_types=1);
require __DIR__ . '/config.php';

/**
 * POST /api/heartbeat
 * Nessun body richiesto. Aggiorna last_active_at dell'utente corrente a
 * "adesso" — chiamato periodicamente dal client finché l'app resta
 * aperta, per stimare quanti utenti sono online in questo momento (vedi
 * api/online_count.php). Endpoint volutamente minimo e leggero: nessuna
 * validazione di payload, nessuna scrittura oltre al timestamp.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metodo non consentito', 405);
}

$user = current_user();
rate_limit('heartbeat', 30, 60);

db()->prepare('UPDATE nh_users SET last_active_at = NOW() WHERE id = :u')
    ->execute(['u' => $user['id']]);

json_response(['ok' => true]);
