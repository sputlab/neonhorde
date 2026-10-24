<?php
declare(strict_types=1);
require __DIR__ . '/../config.php';

/**
 * POST /api/auth/reset.php
 * body: { email, code, new_password }
 *
 * Verifica il codice a 6 cifre (non scaduto, non già usato), imposta la
 * nuova password e invalida tutte le sessioni esistenti dell'utente per
 * sicurezza (forza un nuovo login con le nuove credenziali ovunque).
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metodo non consentito', 405);
}

rate_limit('reset_password', 10, 300);

$body        = json_input();
$email       = trim(strtolower((string) ($body['email'] ?? '')));
$code        = trim((string) ($body['code'] ?? ''));
$newPassword = (string) ($body['new_password'] ?? '');

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_error('Email non valida');
}
if (!preg_match('/^\d{6}$/', $code)) {
    json_error('Codice non valido');
}
if (strlen($newPassword) < 8) {
    json_error('La nuova password deve avere almeno 8 caratteri');
}

$pdo = db();
$pdo->beginTransaction();

try {
    $stmt = $pdo->prepare('SELECT id FROM nh_users WHERE email = :e AND is_guest = 0 FOR UPDATE');
    $stmt->execute(['e' => $email]);
    $user = $stmt->fetch();

    if (!$user) {
        $pdo->rollBack();
        json_error('Codice o email non validi', 400);
    }

    $stmt = $pdo->prepare(
        'SELECT id FROM nh_password_resets
         WHERE user_id = :u AND code = :c AND used = 0 AND expires_at > NOW()
         ORDER BY id DESC LIMIT 1
         FOR UPDATE'
    );
    $stmt->execute(['u' => $user['id'], 'c' => $code]);
    $reset = $stmt->fetch();

    if (!$reset) {
        $pdo->rollBack();
        json_error('Codice non valido o scaduto', 400);
    }

    $pdo->prepare('UPDATE nh_password_resets SET used = 1 WHERE id = :id')
        ->execute(['id' => $reset['id']]);

    $hash = password_hash($newPassword, PASSWORD_DEFAULT);
    $pdo->prepare('UPDATE nh_users SET password_hash = :h WHERE id = :u')
        ->execute(['h' => $hash, 'u' => $user['id']]);

    // Invalida tutte le sessioni esistenti: dopo un reset password è
    // corretto forzare un nuovo login ovunque fosse loggato l'utente
    $pdo->prepare('DELETE FROM nh_session_tokens WHERE user_id = :u')
        ->execute(['u' => $user['id']]);

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    json_error('Errore durante il reset della password', 500);
}

json_response(['ok' => true, 'message' => 'Password reimpostata. Accedi con la nuova password.']);
