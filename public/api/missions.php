<?php
declare(strict_types=1);
require __DIR__ . '/config.php';

/**
 * GET /api/missions
 * Missioni attive di oggi con il progresso dell'utente (creato al volo
 * a 0 se non esiste ancora una riga per la data odierna).
 */

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_error('Metodo non consentito', 405);
}

$user  = current_user();
$today = date('Y-m-d');
$pdo   = db();

$missions = $pdo->query('SELECT * FROM nh_missions WHERE active = 1')->fetchAll();

$stmt = $pdo->prepare(
    'SELECT mission_id, progress, completed, claimed FROM nh_user_missions
     WHERE user_id = :u AND `date` = :d'
);
$stmt->execute(['u' => $user['id'], 'd' => $today]);
$progressByMission = [];
foreach ($stmt->fetchAll() as $row) {
    $progressByMission[(int) $row['mission_id']] = $row;
}

$result = array_map(function ($m) use ($progressByMission) {
    $p = $progressByMission[(int) $m['id']] ?? ['progress' => 0, 'completed' => 0, 'claimed' => 0];
    return [
        'id'          => (int) $m['id'],
        'key'         => $m['key'],
        'description' => $m['description'],
        'metric'      => $m['metric'],
        'target'      => (int) $m['target'],
        'reward_gems' => (int) $m['reward_gems'],
        'progress'    => (int) $p['progress'],
        'completed'   => (bool) $p['completed'],
        'claimed'     => (bool) $p['claimed'],
    ];
}, $missions);

json_response(['ok' => true, 'date' => $today, 'missions' => $result]);
