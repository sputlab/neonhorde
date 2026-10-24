<?php
/**
 * config.php — bootstrap comune per tutti gli endpoint API.
 * Carica .env, apre la connessione PDO, imposta gli header di risposta
 * e alcune funzioni helper condivise (risposta JSON, errori, ecc.).
 */

declare(strict_types=1);

// ---------------------------------------------------------------------
// Caricamento .env (parser minimale, senza dipendenze esterne)
// ---------------------------------------------------------------------
function load_env(string $path): void
{
    if (!is_file($path)) {
        return;
    }
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        [$key, $value] = array_pad(explode('=', $line, 2), 2, '');
        $key   = trim($key);
        $value = trim($value);
        if ($key !== '' && getenv($key) === false) {
            putenv("$key=$value");
            $_ENV[$key] = $value;
        }
    }
}

load_env(__DIR__ . '/../.env');

define('APP_ENV', getenv('APP_ENV') ?: 'production');
$appSecret = getenv('APP_SECRET') ?: '';
if (strlen($appSecret) < 32 || stripos($appSecret, 'change_me') !== false) {
    // Fail closed: mai avviare con un segreto assente, troppo corto o di esempio
    error_log('NEON HORDE: APP_SECRET mancante o non valido (min. 32 caratteri, non il valore di esempio). Vedi .env.example');
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'server_misconfigured']);
    exit;
}
define('APP_SECRET', $appSecret);
define('SESSION_TTL', (int) (getenv('SESSION_TTL') ?: 2592000));

if (APP_ENV === 'production') {
    ini_set('display_errors', '0');
    error_reporting(0);
} else {
    ini_set('display_errors', '1');
    error_reporting(E_ALL);
}

// ---------------------------------------------------------------------
// Header comuni (JSON API, CORS same-origin di default — adattare se
// il frontend gira su un dominio diverso dal backend)
// ---------------------------------------------------------------------
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ---------------------------------------------------------------------
// Connessione PDO (singleton)
// ---------------------------------------------------------------------
function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $host    = getenv('DB_HOST') ?: '127.0.0.1';
    $name    = getenv('DB_NAME') ?: 'horde_survivor';
    $user    = getenv('DB_USER') ?: 'root';
    $pass    = getenv('DB_PASS') ?: '';
    $charset = getenv('DB_CHARSET') ?: 'utf8mb4';

    $dsn = "mysql:host=$host;dbname=$name;charset=$charset";

    try {
        $pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    } catch (PDOException $e) {
        json_error('Database non disponibile', 503);
    }

    return $pdo;
}

// ---------------------------------------------------------------------
// Helper di risposta
// ---------------------------------------------------------------------
function json_response(array $data, int $status = 200)
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function json_error(string $message, int $status = 400)
{
    json_response(['ok' => false, 'error' => $message], $status);
}

function json_input(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

// ---------------------------------------------------------------------
// Rate limiting minimale basato su file (per IP + endpoint).
// Per un traffico serio, sostituire con Redis/memcached.
// ---------------------------------------------------------------------
function rate_limit(string $bucket, int $maxRequests, int $perSeconds): void
{
    $ip   = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $file = sys_get_temp_dir() . '/rl_' . md5($bucket . $ip) . '.json';

    $now = time();
    $state = ['count' => 0, 'reset' => $now + $perSeconds];

    if (is_file($file)) {
        $decoded = json_decode((string) file_get_contents($file), true);
        if (is_array($decoded) && ($decoded['reset'] ?? 0) > $now) {
            $state = $decoded;
        }
    }

    $state['count']++;
    file_put_contents($file, json_encode($state), LOCK_EX);

    if ($state['count'] > $maxRequests) {
        json_error('Troppe richieste, riprova più tardi', 429);
    }
}

// ---------------------------------------------------------------------
// Autenticazione: token opaco (colonna session_tokens) letto da
// header "Authorization: Bearer <token>"
// ---------------------------------------------------------------------
function current_user(bool $required = true): ?array
{
    $token = extract_bearer_token();

    if ($token === null) {
        if ($required) {
            json_error('Autenticazione richiesta', 401);
        }
        return null;
    }

    $stmt = db()->prepare(
        'SELECT u.* FROM nh_session_tokens t
         JOIN nh_users u ON u.id = t.user_id
         WHERE t.token = :token AND t.expires_at > NOW()'
    );
    $stmt->execute(['token' => $token]);
    $user = $stmt->fetch();

    if (!$user) {
        if ($required) {
            json_error('Sessione scaduta o non valida', 401);
        }
        return null;
    }

    db()->prepare('UPDATE nh_session_tokens SET last_used_at = NOW() WHERE token = :t')
        ->execute(['t' => $token]);

    return $user;
}

/**
 * Estrae il token di sessione dalla richiesta, in ordine di priorità:
 *  1. Header custom "X-Auth-Token" — trasporto primario. A differenza
 *     di "Authorization", molti host condivisi (Apache+PHP-FPM/CGI
 *     senza configurazione ad hoc) NON lo eliminano prima che arrivi
 *     a PHP, quindi è il metodo più affidabile "out of the box".
 *  2. Header "Authorization: Bearer <token>", letto da più fonti
 *     possibili ($_SERVER, REDIRECT_HTTP_AUTHORIZATION per i setup con
 *     mod_rewrite, apache_request_headers(), getallheaders()) perché a
 *     seconda della configurazione del server può comparire in punti
 *     diversi o mancare del tutto.
 * Restituisce il token (64 caratteri esadecimali minuscoli) o null.
 */
function extract_bearer_token(): ?string
{
    // 1) Header custom dedicato (trasporto primario)
    $direct = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
    if (preg_match('/^[a-f0-9]{64}$/i', $direct)) {
        return strtolower($direct);
    }

    // 2) Authorization, cercato in tutte le fonti plausibili
    $candidates = [
        $_SERVER['HTTP_AUTHORIZATION'] ?? '',
        $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '',
    ];

    if (function_exists('apache_request_headers')) {
        $all = apache_request_headers();
        $candidates[] = $all['Authorization'] ?? ($all['authorization'] ?? '');
    }
    if (function_exists('getallheaders')) {
        $all = getallheaders();
        $candidates[] = $all['Authorization'] ?? ($all['authorization'] ?? '');
    }

    foreach ($candidates as $header) {
        if ($header && preg_match('/Bearer\s+([a-f0-9]{64})/i', $header, $m)) {
            return strtolower($m[1]);
        }
    }

    return null;
}

function issue_session_token(int $userId): string
{
    $token = bin2hex(random_bytes(32));
    $expires = date('Y-m-d H:i:s', time() + SESSION_TTL);

    db()->prepare(
        'INSERT INTO nh_session_tokens (token, user_id, expires_at) VALUES (:t, :u, :e)'
    )->execute(['t' => $token, 'u' => $userId, 'e' => $expires]);

    return $token;
}

// ---------------------------------------------------------------------
// Email (usata solo per il reset password). Usa la funzione mail() di
// PHP tramite il sendmail locale dell'hosting: su cPanel/Plesk funziona
// "out of the box" nella grande maggioranza dei casi, senza bisogno di
// credenziali SMTP. Se il tuo hosting non consegna le mail così,
// sostituisci il corpo di questa funzione con una chiamata a un
// provider SMTP (es. tramite PHPMailer) senza toccare i chiamanti.
// ---------------------------------------------------------------------
function send_email(string $to, string $subject, string $body): bool
{
    $from     = getenv('MAIL_FROM') ?: 'no-reply@localhost';
    $fromName = getenv('MAIL_FROM_NAME') ?: 'NEON HORDE';

    $headers = "From: {$fromName} <{$from}>\r\n";
    $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";

    return @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers);
}

// ---------------------------------------------------------------------
// v1.37.1 — CORREZIONE IMPORTANTE: queste due funzioni vivevano prima
// solo dentro api/auth/register.php, quindi proteggevano un nickname
// registrato SOLO al momento della registrazione stessa. Ma un ospite
// può scegliere/cambiare nickname anche SENZA registrarsi — al
// game over (api/auth/set_nickname.php) o alla creazione stessa
// dell'account ospite (api/auth/register.php, mode=guest) — e in
// quei punti il solo vincolo a livello di database (colonna generata
// registered_nickname, vedi sql/schema.sql) NON basta: per un ospite
// quella colonna resta sempre NULL qualunque nickname scelga, quindi
// nessun UNIQUE index può mai scattare per fermarlo. Da qui il bug
// segnalato: un ospite poteva scegliere "Sputnik" anche se "Sputnik"
// era già un account registrato. Centralizzate qui, queste funzioni
// vanno richiamate ESPLICITAMENTE prima di ogni INSERT/UPDATE che
// tocchi il nickname di un ospite, in ogni endpoint che lo permette.
// ---------------------------------------------------------------------

/** Vero se `$nickname` è già di un account REGISTRATO diverso da
 *  `$excludeUserId` (null = nessuna esclusione). */
function nickname_taken_by_registered(PDO $pdo, string $nickname, ?int $excludeUserId): bool
{
    $sql = 'SELECT id FROM nh_users WHERE nickname = :n AND is_guest = 0';
    $params = ['n' => $nickname];
    if ($excludeUserId !== null) {
        $sql .= ' AND id != :u';
        $params['u'] = $excludeUserId;
    }
    $check = $pdo->prepare($sql);
    $check->execute($params);
    return (bool) $check->fetch();
}

/**
 * Dato un nickname già preso da un account registrato, propone la
 * prima variante libera (Nome2, Nome3, ...) invece di un semplice
 * rifiuto. Controlla solo contro is_guest = 0: due ospiti con lo
 * stesso nome non generano mai un conflitto da risolvere qui.
 */
function suggest_nickname_variant(PDO $pdo, string $baseNickname): string
{
    for ($i = 2; $i <= 999; $i++) {
        $suffix = (string) $i;
        $candidate = strlen($baseNickname) + strlen($suffix) > 32
            ? substr($baseNickname, 0, 32 - strlen($suffix)) . $suffix
            : $baseNickname . $suffix;
        $check = $pdo->prepare('SELECT id FROM nh_users WHERE nickname = :n AND is_guest = 0');
        $check->execute(['n' => $candidate]);
        if (!$check->fetch()) {
            return $candidate;
        }
    }
    // Praticamente mai raggiunto (servirebbero 998 varianti già tutte
    // occupate), ma un fallback comunque univoco per sicurezza.
    return $baseNickname . '_' . bin2hex(random_bytes(3));
}
