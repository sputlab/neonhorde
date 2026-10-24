<?php
declare(strict_types=1);
require __DIR__ . '/../config.php';

/**
 * POST /api/auth/forgot.php
 * body: { email }
 *
 * Genera un codice numerico a 6 cifre, valido 15 minuti, e lo invia via
 * email. Risponde sempre con lo stesso messaggio generico indipendentemente
 * dal fatto che l'email esista o meno, per non rivelare quali indirizzi
 * sono registrati (protezione base contro l'enumerazione utenti).
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metodo non consentito', 405);
}

rate_limit('forgot_password', 5, 300); // max 5 richieste ogni 5 minuti per IP

$body  = json_input();
$email = trim(strtolower((string) ($body['email'] ?? '')));

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_error('Email non valida');
}

$pdo = db();
$stmt = $pdo->prepare('SELECT id, nickname FROM nh_users WHERE email = :e AND is_guest = 0');
$stmt->execute(['e' => $email]);
$user = $stmt->fetch();

// Messaggio identico sia che l'utente esista sia che non esista
$genericMessage = 'Se l\'indirizzo è registrato, riceverai a breve un\'email con il codice per reimpostare la password.';

if ($user) {
    // Un solo codice attivo per volta: invalida quelli precedenti non usati
    $pdo->prepare('UPDATE nh_password_resets SET used = 1 WHERE user_id = :u AND used = 0')
        ->execute(['u' => $user['id']]);

    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $expires = date('Y-m-d H:i:s', time() + 900); // 15 minuti

    $pdo->prepare(
        'INSERT INTO nh_password_resets (user_id, code, expires_at) VALUES (:u, :c, :e)'
    )->execute(['u' => $user['id'], 'c' => $code, 'e' => $expires]);

    $subject = 'NEON HORDE — Codice per reimpostare la password';
    $body = "Ciao {$user['nickname']},\n\n"
          . "Il tuo codice per reimpostare la password è: {$code}\n"
          . "Il codice è valido per 15 minuti.\n\n"
          . "Se non hai richiesto tu il reset, ignora questa email.";
    send_email($email, $subject, $body);
}

json_response(['ok' => true, 'message' => $genericMessage]);
