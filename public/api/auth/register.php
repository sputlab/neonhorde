<?php
declare(strict_types=1);
require __DIR__ . '/../config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metodo non consentito', 405);
}

rate_limit('register', 10, 60);

$body = json_input();
$mode = $body['mode'] ?? 'guest';   // 'guest' | 'account'

$pdo = db();

if ($mode === 'guest') {
    // v1.20.0: niente più nickname auto-generato ("GuestXXXX"). Un
    // ospite che non fornisce un nickname esplicito entra con
    // nickname = NULL — potrà scegliere un nickname vero in un secondo
    // momento (prompt pre-partita, fine partita, o schermata Account);
    // finché non lo fa, le sue run non vengono salvate (vedi
    // api/run/submit.php) per non intasare il database e la classifica
    // di voci anonime indistinguibili tra loro.
    // v1.37.0 — un ospite può scegliere QUALUNQUE nickname, anche
    // identico a quello di un altro ospite: il vincolo di unicità (vedi
    // registered_nickname in sql/schema.sql) si applica solo tra
    // account registrati.
    // v1.37.1 — CORREZIONE: quel vincolo a livello di database NON
    // basta da solo per proteggere un nickname già REGISTRATO da
    // qualcun altro, perché la riga che stiamo per creare qui è essa
    // stessa un ospite (registered_nickname = NULL per costruzione,
    // qualunque nickname scelga) — nessun UNIQUE index può mai
    // scattare per fermarla. Serve un controllo esplicito PRIMA
    // dell'INSERT, non solo affidarsi all'eccezione del database.
    $rawNickname = trim((string) ($body['nickname'] ?? ''));
    $nickname = $rawNickname !== '' ? substr($rawNickname, 0, 32) : null;

    if ($nickname !== null && nickname_taken_by_registered($pdo, $nickname, null)) {
        json_response([
            'ok' => false,
            'error' => 'nickname_taken',
            'suggested_nickname' => suggest_nickname_variant($pdo, $nickname),
        ], 409);
    }

    try {
        $stmt = $pdo->prepare(
            'INSERT INTO nh_users (nickname, is_guest, created_at, last_active_at) VALUES (:n, 1, NOW(), NOW())'
        );
        $stmt->execute(['n' => $nickname]);
    } catch (PDOException $e) {
        if ((int) $e->getCode() === 23000) {
            // Finestra di corsa estremamente rara (qualcun altro si è
            // registrato con lo stesso nome nell'istante tra il
            // controllo sopra e questo INSERT) — mai per collisione
            // tra ospiti, impossibile per costruzione.
            json_error('Nickname già in uso, riprova', 409);
        }
        throw $e;

    }

    $userId = (int) $pdo->lastInsertId();

    $token = issue_session_token($userId);
    json_response(['ok' => true, 'token' => $token, 'user' => [
        'id' => $userId, 'nickname' => $nickname, 'is_guest' => true, 'gems' => 0,
    ]]);
}

// --- registrazione con account vero ---
$email    = trim(strtolower((string) ($body['email'] ?? '')));
$password = (string) ($body['password'] ?? '');
$nickname = trim((string) ($body['nickname'] ?? ''));

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_error('Email non valida');
}
if (strlen($password) < 8) {
    json_error('La password deve avere almeno 8 caratteri');
}

// v1.35.0 — CORREZIONE IMPORTANTE: se chi chiama ha già una sessione
// ospite valida (caso di gran lunga più comune: quasi tutti iniziano
// come ospiti silenziosi fin dal primo avvio, vedi js/main.js boot()),
// la registrazione ora AGGIORNA quella stessa riga invece di creare un
// account NUOVO da zero. Nickname, gemme, streak, missioni, traguardi
// e skin già posseduti restano intatti, si aggiungono solo email e
// password alla riga esistente.
$existingUser = current_user(false); // false: un visitatore mai loggato non ha alcuna sessione, non è un errore

if ($existingUser !== null && (bool) $existingUser['is_guest']) {
    // Nickname non specificato in questa richiesta -> si mantiene
    // quello già posseduto (comodo per chi lo ha già scelto prima).
    if ($nickname === '') {
        $nickname = (string) $existingUser['nickname'];
    }
    if ($nickname === '' || strlen($nickname) > 32) {
        json_error('Nickname non valido (1-32 caratteri)');
    }

    // v1.37.0 — CORREZIONE ALLA RADICE del bug "nickname già in uso" su
    // sé stessi: il controllo qui esclude esplicitamente l'utente
    // corrente (che è ancora is_guest=1 in questo momento, quindi il
    // suo registered_nickname è comunque NULL — ma un controllo
    // esplicito qui, PRIMA di tentare l'UPDATE, permette di offrire un
    // suggerimento invece di scoprire il conflitto solo dopo un errore
    // del database).
    if (nickname_taken_by_registered($pdo, $nickname, (int) $existingUser['id'])) {
        json_response([
            'ok' => false,
            'error' => 'nickname_taken',
            'suggested_nickname' => suggest_nickname_variant($pdo, $nickname),
        ], 409);
    }

    $check = $pdo->prepare('SELECT id FROM nh_users WHERE email = :e');
    $check->execute(['e' => $email]);
    if ($check->fetch()) {
        // v1.35.0 — invece di un vicolo cieco ("email già registrata" e
        // basta), indirizza esplicitamente verso "password dimenticata":
        // chi ha già un account con quell'email può reimpostare la
        // password e accedervi da lì, "reclamando" l'account esistente
        // anche da un dispositivo o una sessione diversi da quelli con
        // cui lo aveva originariamente creato.
        json_error('Email già registrata. Usa "Password dimenticata" nella schermata di accesso per entrare in quell\'account.', 409);
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    try {
        $pdo->prepare(
            'UPDATE nh_users SET email = :e, password_hash = :p, nickname = :n, is_guest = 0 WHERE id = :u'
        )->execute(['e' => $email, 'p' => $hash, 'n' => $nickname, 'u' => $existingUser['id']]);
    } catch (PDOException $ex) {
        if ((int) $ex->getCode() === 23000) {
            // Raro (finestra di corsa tra il controllo sopra e questo
            // UPDATE: qualcun altro si è appena registrato con lo
            // stesso nome) — niente suggerimento qui, un semplice
            // nuovo tentativo dal client risolve.
            json_error('Nickname già in uso, riprova', 409);
        }
        throw $ex;
    }

    $token = issue_session_token((int) $existingUser['id']);
    json_response(['ok' => true, 'token' => $token, 'user' => [
        'id' => (int) $existingUser['id'], 'nickname' => $nickname, 'is_guest' => false,
        'gems' => (int) $existingUser['gems'],
    ]]);
}

// --- Nessuna sessione ospite preesistente (visitatore mai loggato, o
//     già registrato con un altro account): crea un account nuovo,
//     comportamento invariato rispetto a prima. ---
if ($nickname === '' || strlen($nickname) > 32) {
    json_error('Nickname non valido (1-32 caratteri)');
}

if (nickname_taken_by_registered($pdo, $nickname, null)) {
    json_response([
        'ok' => false,
        'error' => 'nickname_taken',
        'suggested_nickname' => suggest_nickname_variant($pdo, $nickname),
    ], 409);
}

$check = $pdo->prepare('SELECT id FROM nh_users WHERE email = :e');
$check->execute(['e' => $email]);
if ($check->fetch()) {
    json_error('Email già registrata', 409);
}

$hash = password_hash($password, PASSWORD_DEFAULT);

try {
    $stmt = $pdo->prepare(
        'INSERT INTO nh_users (email, password_hash, nickname, is_guest, created_at, last_active_at)
         VALUES (:e, :p, :n, 0, NOW(), NOW())'
    );
    $stmt->execute(['e' => $email, 'p' => $hash, 'n' => $nickname]);
} catch (PDOException $e) {
    if ((int) $e->getCode() === 23000) {
        json_error('Nickname già in uso, riprova', 409);
    }
    throw $e;
}
$userId = (int) $pdo->lastInsertId();

$token = issue_session_token($userId);
json_response(['ok' => true, 'token' => $token, 'user' => [
    'id' => $userId, 'nickname' => $nickname, 'is_guest' => false, 'gems' => 0,
]]);
