<?php
declare(strict_types=1);
require __DIR__ . '/../config.php';

/**
 * POST /api/auth/set_nickname.php
 * body: { nickname }
 *
 * Aggiorna il nickname dell'utente autenticato (funziona sia per account
 * ospite che registrati). Usato principalmente dalla schermata di game
 * over per permettere agli ospiti di scegliere un nome prima di comparire
 * in classifica, dato che le run passate e future in classifica leggono
 * il nickname corrente dell'utente (nessun bisogno di re-inviare la run).
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metodo non consentito', 405);
}

$user = current_user();
rate_limit('set_nickname', 20, 60);

$body = json_input();
$nickname = trim((string) ($body['nickname'] ?? ''));

if ($nickname === '' || strlen($nickname) > 32) {
    json_error('Nickname non valido (1-32 caratteri)');
}

$pdo = db();

// v1.37.1 — CORREZIONE IMPORTANTE: qui mancava il controllo esplicito
// contro i nickname già REGISTRATI. Il vincolo a livello di database
// (registered_nickname in sql/schema.sql) protegge un utente
// registrato da un ALTRO registrato, ma NON può proteggere da un
// ospite che sceglie lo stesso nome: la riga di un ospite ha sempre
// registered_nickname = NULL, qualunque nickname le venga assegnato,
// quindi nessun UNIQUE index scatta mai per fermarla — esattamente il
// bug segnalato in produzione (un ospite riusciva a impostare un
// nickname già registrato da qualcun altro, es. al game over). Il
// controllo esplicito qui si applica SEMPRE (sia che chi chiama sia
// ancora ospite, sia che sia già registrato e stia solo cambiando
// nome), escludendo sé stesso in modo che "cambiare" nickname al
// proprio valore attuale non generi mai un falso conflitto.
if (nickname_taken_by_registered($pdo, $nickname, (int) $user['id'])) {
    json_response([
        'ok' => false,
        'error' => 'nickname_taken',
        'suggested_nickname' => suggest_nickname_variant($pdo, $nickname),
    ], 409);
}

try {
    $pdo->prepare('UPDATE nh_users SET nickname = :n WHERE id = :u')
        ->execute(['n' => $nickname, 'u' => $user['id']]);
} catch (PDOException $e) {
    // Finestra di corsa estremamente rara (qualcun altro si è
    // registrato con lo stesso nome nell'istante tra il controllo sopra
    // e questo UPDATE) — il controllo esplicito sopra copre già la
    // stragrande maggioranza dei casi, questo è solo un ultimo
    // paracadute.
    if ((int) $e->getCode() === 23000) {
        json_error('Nickname già in uso, riprova', 409);
    }
    throw $e;
}

json_response(['ok' => true, 'nickname' => $nickname]);
