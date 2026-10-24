<?php
declare(strict_types=1);
require __DIR__ . '/../config.php';

/**
 * POST /api/account/delete
 * body: { password }
 *
 * Cancella DEFINITIVAMENTE l'account autenticato — richiede di
 * reinserire la password corrente come ulteriore conferma (non basta
 * un semplice popup, trattandosi di un'operazione irreversibile). Solo
 * per account REGISTRATI (is_guest = 0): un ospite non ha una password
 * da verificare, e "cancellare" un ospite equivale semplicemente a
 * smettere di usare quella sessione, non serve un endpoint dedicato.
 *
 * v1.37.0 — elimina esplicitamente da OGNI tabella collegata invece di
 * affidarsi soltanto a ON DELETE CASCADE: lo schema di riferimento
 * (sql/schema.sql) lo prevede su tutte le FK verso nh_users, ma
 * database live aggiornati con migrazioni manuali nel tempo possono
 * essere andati fuori sincrono rispetto allo schema (già successo in
 * passato con altre tabelle) — meglio non fidarsi ciecamente qui,
 * dato che è un'operazione distruttiva e irreversibile.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metodo non consentito', 405);
}

$user = current_user();
rate_limit('account_delete', 5, 300);

if ((bool) $user['is_guest']) {
    json_error('Un account ospite non ha una password da verificare', 400);
}

$body     = json_input();
$password = (string) ($body['password'] ?? '');

if ($password === '' || !password_verify($password, (string) $user['password_hash'])) {
    json_error('Password non corretta', 401);
}

$pdo = db();
$userId = (int) $user['id'];

$pdo->beginTransaction();
try {
    foreach ([
        'nh_session_tokens', 'nh_run_tokens', 'nh_runs', 'nh_user_upgrades',
        'nh_user_missions', 'nh_user_achievements', 'nh_password_resets', 'nh_feedback',
    ] as $table) {
        $pdo->prepare("DELETE FROM {$table} WHERE user_id = :u")->execute(['u' => $userId]);
    }
    $pdo->prepare('DELETE FROM nh_users WHERE id = :u')->execute(['u' => $userId]);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    json_error('Errore durante la cancellazione dell\'account', 500);
}

json_response(['ok' => true]);
