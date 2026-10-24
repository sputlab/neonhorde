<?php
declare(strict_types=1);
require __DIR__ . '/../config.php';

/**
 * POST /api/missions/claim
 * body: { mission_id }
 * Riscatta la ricompensa di una missione completata e non ancora reclamata
 * (per la data odierna). Idempotente: un secondo tentativo fallisce con 409.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metodo non consentito', 405);
}

$user = current_user();
rate_limit('missions_claim', 30, 60);

$body      = json_input();
$missionId = (int) ($body['mission_id'] ?? 0);
$today     = date('Y-m-d');

if ($missionId <= 0) {
    json_error('mission_id non valido');
}

$pdo = db();
$pdo->beginTransaction();

try {
    $stmt = $pdo->prepare(
        'SELECT um.*, m.reward_gems FROM nh_user_missions um
         JOIN nh_missions m ON m.id = um.mission_id
         WHERE um.user_id = :u AND um.mission_id = :m AND um.`date` = :d
         FOR UPDATE'
    );
    $stmt->execute(['u' => $user['id'], 'm' => $missionId, 'd' => $today]);
    $row = $stmt->fetch();

    if (!$row || !$row['completed']) {
        $pdo->rollBack();
        json_error('Missione non completata', 409);
    }
    if ($row['claimed']) {
        $pdo->rollBack();
        json_error('Ricompensa già riscattata', 409);
    }

    $pdo->prepare(
        'UPDATE nh_user_missions SET claimed = 1 WHERE user_id = :u AND mission_id = :m AND `date` = :d'
    )->execute(['u' => $user['id'], 'm' => $missionId, 'd' => $today]);

    $pdo->prepare('UPDATE nh_users SET gems = gems + :g WHERE id = :u')
        ->execute(['g' => $row['reward_gems'], 'u' => $user['id']]);

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    json_error('Errore durante il riscatto', 500);
}

$newGems = (int) $pdo->query('SELECT gems FROM nh_users WHERE id = ' . (int) $user['id'])->fetchColumn();

json_response(['ok' => true, 'gems_earned' => (int) $row['reward_gems'], 'gems_total' => $newGems]);
