<?php
declare(strict_types=1);
require __DIR__ . '/config.php';

/**
 * GET /api/leaderboard
 * Restituisce, per ciascuna delle 4 difficoltà, la top 50 globale
 * (confrontare punteggi tra difficoltà diverse non avrebbe senso, dati
 * i moltiplicatori di ricompensa differenti — v1.17.0) + (se
 * autenticato) le migliori 10 run personali in assoluto, con
 * indicata la difficoltà di ciascuna.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_error('Metodo non consentito', 405);
}

$pdo = db();

$difficulties = ['easy', 'normal', 'hard', 'inferno'];
$global = [];
$stmt = $pdo->prepare(
    'SELECT r.score, r.wave_reached, r.kills, r.duration_sec, r.difficulty, r.created_at,
            u.nickname
     FROM nh_runs r
     JOIN nh_users u ON u.id = r.user_id
     WHERE r.difficulty = :d
     ORDER BY r.score DESC
     LIMIT 50'
);
foreach ($difficulties as $diff) {
    $stmt->execute(['d' => $diff]);
    $global[$diff] = $stmt->fetchAll();
}

$personal = [];
$user = current_user(false);
if ($user) {
    $stmt = $pdo->prepare(
        'SELECT score, wave_reached, kills, duration_sec, difficulty, created_at
         FROM nh_runs
         WHERE user_id = :u
         ORDER BY score DESC
         LIMIT 10'
    );
    $stmt->execute(['u' => $user['id']]);
    $personal = $stmt->fetchAll();
}

json_response(['ok' => true, 'global' => $global, 'personal' => $personal]);
