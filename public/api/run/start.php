<?php
declare(strict_types=1);
require __DIR__ . '/../config.php';

/**
 * POST /api/run/start
 * Da chiamare quando il giocatore preme "Gioca". Restituisce un token
 * monouso che dovrà essere rimandato in /api/run/submit a fine partita.
 * Serve a impedire il submit di risultati "inventati" senza aver mai
 * aperto una sessione di gioco lato server.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metodo non consentito', 405);
}

$user = current_user();
rate_limit('run_start', 30, 60);

$token = bin2hex(random_bytes(32));

db()->prepare(
    'INSERT INTO nh_run_tokens (token, user_id) VALUES (:t, :u)'
)->execute(['t' => $token, 'u' => $user['id']]);

json_response(['ok' => true, 'run_token' => $token, 'server_time' => time()]);
