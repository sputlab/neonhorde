<?php
declare(strict_types=1);
require __DIR__ . '/../config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metodo non consentito', 405);
}

rate_limit('login', 15, 60);

$body     = json_input();
$email    = trim(strtolower((string) ($body['email'] ?? '')));
$password = (string) ($body['password'] ?? '');

if ($email === '' || $password === '') {
    json_error('Email e password richieste');
}

$pdo = db();
$stmt = $pdo->prepare('SELECT * FROM nh_users WHERE email = :e AND is_guest = 0');
$stmt->execute(['e' => $email]);
$user = $stmt->fetch();

if (!$user || !password_verify($password, (string) $user['password_hash'])) {
    // Messaggio generico: non rivelare se l'email esiste o meno
    json_error('Credenziali non valide', 401);
}

$pdo->prepare('UPDATE nh_users SET last_login_at = NOW() WHERE id = :id')
    ->execute(['id' => $user['id']]);

$token = issue_session_token((int) $user['id']);

json_response(['ok' => true, 'token' => $token, 'user' => [
    'id'       => (int) $user['id'],
    'nickname' => $user['nickname'],
    'is_guest' => false,
    'gems'     => (int) $user['gems'],
]]);
