<?php
declare(strict_types=1);
require __DIR__ . '/config.php';

/**
 * POST /api/feedback
 * body: { sentiment: 'up'|'down', run_id?: number }
 *
 * Feedback rapido e anonimo (nel senso che non richiede altro dell'utente
 * oltre alla sessione già attiva) su una run appena conclusa. Se run_id
 * è specificato, viene verificato che appartenga davvero all'utente
 * corrente prima di essere collegato — altrimenti il feedback viene
 * comunque salvato ma senza il collegamento a una run specifica.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metodo non consentito', 405);
}

$user = current_user();
$body = json_decode(file_get_contents('php://input'), true) ?? [];

$sentiment = (string) ($body['sentiment'] ?? '');
if (!in_array($sentiment, ['up', 'down'], true)) {
    json_error('Sentiment non valido');
}

$runId = isset($body['run_id']) ? (int) $body['run_id'] : null;

$pdo = db();

if ($runId !== null) {
    $check = $pdo->prepare('SELECT id FROM nh_runs WHERE id = :r AND user_id = :u');
    $check->execute(['r' => $runId, 'u' => $user['id']]);
    if (!$check->fetch()) {
        $runId = null;
    }
}

$pdo->prepare(
    'INSERT INTO nh_feedback (user_id, run_id, sentiment, created_at) VALUES (:u, :r, :s, NOW())'
)->execute(['u' => $user['id'], 'r' => $runId, 's' => $sentiment]);

json_response(['ok' => true]);
