<?php
declare(strict_types=1);
require __DIR__ . '/config.php';

/**
 * GET /api/online_count
 * Pubblico, nessuna autenticazione richiesta: restituisce quante persone
 * risultano "online" in questo momento, stimato dagli utenti il cui
 * last_active_at (aggiornato via api/heartbeat.php) rientra nella
 * finestra di ONLINE_WINDOW_SEC più recente. Non è un conteggio
 * realtime esatto (nessun websocket), ma con un heartbeat ogni ~45s dal
 * client e una finestra di 90s la stima resta ragionevolmente accurata.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_error('Metodo non consentito', 405);
}

rate_limit('online_count', 30, 60);

const ONLINE_WINDOW_SEC = 90;

$count = (int) db()->query(
    'SELECT COUNT(*) FROM nh_users WHERE last_active_at > (NOW() - INTERVAL ' . ONLINE_WINDOW_SEC . ' SECOND)'
)->fetchColumn();

json_response(['ok' => true, 'online' => $count]);
