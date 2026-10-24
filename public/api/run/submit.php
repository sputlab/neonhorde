<?php
declare(strict_types=1);
require __DIR__ . '/../config.php';

/**
 * POST /api/run/submit
 * body: { run_token, score, wave_reached, kills, duration_sec, difficulty, bosses_killed }
 *
 * Validazioni anti-cheat (basilari, non a prova di cheater esperto, ma
 * sufficienti a filtrare bot/manomissioni banali):
 *  - run_token deve esistere, appartenere all'utente ed essere non-usato
 *  - rate limit sul submit
 *  - sanity check: punteggio massimo plausibile in funzione della durata
 *    e della difficoltà (soglie prudenzialmente larghe)
 *  - wave_reached e kills devono essere coerenti con duration_sec
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Metodo non consentito', 405);
}

$user = current_user();
rate_limit('run_submit', 20, 60);

$body = json_input();

$runToken     = (string) ($body['run_token'] ?? '');
$score        = (int) ($body['score'] ?? -1);
$waveReached  = (int) ($body['wave_reached'] ?? -1);
$kills        = (int) ($body['kills'] ?? -1);
$durationSec  = (int) ($body['duration_sec'] ?? -1);
$difficulty   = (string) ($body['difficulty'] ?? 'normal');
$bossesKilled = (int) ($body['bosses_killed'] ?? 0);
// v1.33.0 — danno totale inflitto nella run, alimenta la categoria
// "damage_total" dei Traguardi. Nessun limite di plausibilità dedicato
// oltre al clamp a 0: un valore anche molto alto non genera di per sé
// alcuna ricompensa diretta qui (viene solo sommato al totale a vita,
// che richiede comunque un claim esplicito lato utente per fruttare
// gemme — vedi api/achievements/claim.php).
$damageDealt  = max(0, (int) ($body['damage_dealt'] ?? 0));

if (!preg_match('/^[a-f0-9]{64}$/', $runToken)) {
    json_error('Token di run mancante o non valido');
}
if ($score < 0 || $waveReached < 0 || $kills < 0 || $durationSec <= 0) {
    json_error('Dati di run non validi');
}
if (!in_array($difficulty, ['easy', 'normal', 'hard', 'inferno'], true)) {
    $difficulty = 'normal';
}
if ($durationSec > 6 * 3600) {
    json_error('Durata run non plausibile');
}

$pdo = db();
$pdo->beginTransaction();

try {
    // Consuma il token in modo atomico (evita doppio submit sullo stesso token)
    $stmt = $pdo->prepare(
        'SELECT token FROM nh_run_tokens
         WHERE token = :t AND user_id = :u AND used = 0
         FOR UPDATE'
    );
    $stmt->execute(['t' => $runToken, 'u' => $user['id']]);
    if (!$stmt->fetch()) {
        $pdo->rollBack();
        json_error('Run token non valido, già usato o scaduto', 409);
    }

    $pdo->prepare('UPDATE nh_run_tokens SET used = 1 WHERE token = :t')
        ->execute(['t' => $runToken]);

    // --- Ospite anonimo (mai impostato un nickname personalizzato): la
    //     run NON viene salvata — né in classifica, né ai fini di gemme
    //     o streak. Il token è comunque consumato sopra (coerenza col
    //     meccanismo anti-riuso), ma ci fermiamo qui prima di scrivere
    //     qualunque cosa in nh_runs, per non intasare il database di
    //     run indistinguibili tra loro e non riempire la classifica di
    //     voci anonime (v1.20.0). ---
    $isAnonymousGuest = (bool) $user['is_guest'] && $user['nickname'] === null;
    if ($isAnonymousGuest) {
        $pdo->commit();
        json_response([
            'ok'                => true,
            'saved'             => false,
            'run_id'            => null,
            'gems_earned'       => 0,
            'gems_total'        => (int) $user['gems'],
            'streak'            => (int) $user['current_streak'],
            'streak_longest'    => (int) $user['longest_streak'],
            'streak_bonus_gems' => 0,
        ]);
    }

    // --- Sanity check anti-cheat ---
    // v1.34.0 — CORREZIONE IMPORTANTE: i limiti sotto (anche dopo un
    // primo giro di correzioni precedente, vedi git blame/changelog)
    // rifiutavano ancora in blocco le run più lunghe e riuscite, con
    // gemme e punteggio azzerati — confermato analizzando un dump reale
    // del database: il 34% dei run_token risultava mai consumato con
    // successo, tutti vecchi di ore/giorni (non partite "ancora in
    // corso"). Due difetti trovati:
    //  1) Il punteggio dei boss stimava un tetto fisso di 700 pt/boss,
    //     ma il punteggio REALE cresce per tier (BOSS_TIER_GROWTH in
    //     js/config.js) fino a ~1998 pt per il boss di tier 18, e il
    //     boss finale vale 6000 pt fissi — quasi 9 volte il tetto
    //     assunto qui. Con la modalità infinita (v1.30.0) i boss oltre
    //     il ventesimo crescono ulteriormente. Qualunque giocatore
    //     abbastanza bravo/paziente da affrontare boss di tier alto o
    //     il finale otteneva un punteggio reale "impossibile" secondo
    //     questo controllo, e si vedeva rifiutare l'INTERA run.
    //  2) L'intera soglia veniva moltiplicata per $difficultyMult, ma il
    //     punteggio in game NON scala affatto con la difficoltà (verificato:
    //     `rewardMult` in DIFFICULTY, js/config.js, è definito ma non
    //     letto da nessuna parte nel client — enemy.score/boss.score
    //     sono valori fissi indipendenti dalla difficoltà). Su Facile
    //     (mult 0.75) questo riduceva artificialmente la soglia sotto
    //     il punteggio realmente raggiungibile, penalizzando proprio
    //     quella difficoltà più delle altre.
    // Il punteggio dei boss ora si calcola ESATTAMENTE (non stimato):
    // dato che i boss si susseguono in un ordine fisso e crescente, la
    // somma dei primi N punteggi possibili è deterministica — vedi
    // max_boss_score_for_kills() in fondo al file, che replica la
    // stessa formula di BOSS_TYPES in js/config.js.
    $maxKillsPlausible = (int) ceil($durationSec * 12.0) + 100;
    $maxWavesPlausible = (int) floor($durationSec / 75) + 5; // WAVE_DURATION_SEC=75 in js/config.js

    // NOTA: usato SOLO per le gemme guadagnate qui sotto (che scalano
    // legittimamente con la difficoltà, per design), MAI per il tetto
    // di punteggio plausibile — quello non va scalato per difficoltà,
    // vedi commento sopra sul perché era un bug.
    $difficultyMult = ['easy' => 0.75, 'normal' => 1.0, 'hard' => 1.5, 'inferno' => 2.2][$difficulty];

    $regularKills = max(0, $kills - $bossesKilled);
    $maxBossScore = max_boss_score_for_kills($bossesKilled);
    // 40 pt/kill regolare (max reale nemico: 30 per "tank" — vedi
    // ENEMY_TYPES in js/config.js — più margine per le monete raccolte,
    // +5 pt ciascuna, mai contate esplicitamente da nessuna parte in
    // questo controllo: un margine proporzionale ai kill le copre meglio
    // di una stima fissa), 200 pt/wave, nessun moltiplicatore di
    // difficoltà (il punteggio reale non ne ha).
    $maxScorePlausible = $regularKills * 40 + $maxBossScore + $waveReached * 200 + 2000;

    if ($kills > $maxKillsPlausible || $waveReached > $maxWavesPlausible || $score > $maxScorePlausible) {
        $pdo->rollBack();
        json_error('Risultato non plausibile, run rifiutata', 422);
    }

    // --- Calcolo gemme guadagnate (valuta soft, moltiplicata per difficoltà) ---
    $gemsEarned = (int) round(($kills * 0.05 + $waveReached * 2) * $difficultyMult);

    $pdo->prepare(
        'INSERT INTO nh_runs (user_id, score, wave_reached, kills, duration_sec, difficulty, gems_earned, created_at)
         VALUES (:u, :s, :w, :k, :d, :diff, :g, NOW())'
    )->execute([
        'u' => $user['id'], 's' => $score, 'w' => $waveReached, 'k' => $kills,
        'd' => $durationSec, 'diff' => $difficulty, 'g' => $gemsEarned,
    ]);
    $runId = (int) $pdo->lastInsertId();

    $pdo->prepare('UPDATE nh_users SET gems = gems + :g WHERE id = :u')
        ->execute(['g' => $gemsEarned, 'u' => $user['id']]);

    // --- Statistiche a vita per i Traguardi (v1.33.0): non richiedono
    //     un claim esplicito per essere AGGIORNATE (solo per incassarne
    //     la ricompensa) — cresciamo tutto qui, la lettura in
    //     api/achievements.php confronta semplicemente questi totali
    //     coi target dei tier. best_survival_sec usa GREATEST invece di
    //     sommare: è un record della singola run migliore, non un
    //     cumulativo (stessa logica già usata per 'duration_sec' nelle
    //     missioni giornaliere sopra).
    $pdo->prepare(
        'UPDATE nh_users SET
           lifetime_kills = lifetime_kills + :k,
           lifetime_runs = lifetime_runs + 1,
           lifetime_bosses_killed = lifetime_bosses_killed + :b,
           lifetime_damage_dealt = lifetime_damage_dealt + :dmg,
           best_survival_sec = GREATEST(best_survival_sec, :dur)
         WHERE id = :u'
    )->execute([
        'k' => $kills, 'b' => $bossesKilled, 'dmg' => $damageDealt,
        'dur' => $durationSec, 'u' => $user['id'],
    ]);

    // --- Streak giornaliero: bonus gemme crescente per giorni consecutivi
    //     in cui si è giocata almeno una run. Aggiornato al massimo una
    //     volta al giorno (idempotente su run multiple nello stesso giorno). ---
    $today = date('Y-m-d');
    $streakStmt = $pdo->prepare(
        'SELECT current_streak, longest_streak, last_streak_date FROM nh_users WHERE id = :u FOR UPDATE'
    );
    $streakStmt->execute(['u' => $user['id']]);
    $streakRow = $streakStmt->fetch();

    $currentStreak = (int) $streakRow['current_streak'];
    $longestStreak = (int) $streakRow['longest_streak'];
    $lastStreakDate = $streakRow['last_streak_date'];
    $streakBonusGems = 0;

    if ($lastStreakDate !== $today) {
        $yesterday = date('Y-m-d', strtotime('-1 day'));
        // Prosegue lo streak solo se si era giocato ieri; altrimenti
        // (prima volta, o un giorno saltato) riparte da 1.
        $currentStreak = ($lastStreakDate === $yesterday) ? $currentStreak + 1 : 1;
        $longestStreak = max($longestStreak, $currentStreak);
        // Ricompensa piccola e crescente, con un tetto per restare
        // sostenibile anche su streak molto lunghi (+1 gemma/giorno fino
        // a un massimo di +10 a partire dal decimo giorno consecutivo).
        $streakBonusGems = min($currentStreak, 10);

        $pdo->prepare(
            'UPDATE nh_users
             SET current_streak = :cs, longest_streak = :ls, last_streak_date = :d, gems = gems + :bonus
             WHERE id = :u'
        )->execute([
            'cs' => $currentStreak, 'ls' => $longestStreak, 'd' => $today,
            'bonus' => $streakBonusGems, 'u' => $user['id'],
        ]);
    }

    // --- Aggiornamento missioni giornaliere (progressivo, idempotente per oggi) ---
    update_daily_missions($pdo, (int) $user['id'], [
        'kills'         => $kills,
        'duration_sec'  => $durationSec,
        'bosses_killed' => $bossesKilled,
        'waves'         => $waveReached,
        'runs_played'   => 1,
    ]);

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    json_error('Errore durante il salvataggio della run', 500);
}

$newGems = (int) $pdo->query('SELECT gems FROM nh_users WHERE id = ' . (int) $user['id'])->fetchColumn();

// v1.35.0 — piazzamento di QUESTA run nella classifica globale della
// sua difficoltà (COUNT delle run con punteggio maggiore, +1): usato
// lato client per un invito contestuale a registrarsi quando un ospite
// entra in una posizione alta (vedi proposta #4 discussa) — il momento
// in cui la spinta a "non perdere questo risultato" è più forte,
// invece di chiederlo a freddo. La soglia esatta (es. "top 50") resta
// una scelta di presentazione lato client, qui restituiamo solo il
// piazzamento grezzo.
$rankStmt = $pdo->prepare('SELECT COUNT(*) + 1 FROM nh_runs WHERE difficulty = :d AND score > :s');
$rankStmt->execute(['d' => $difficulty, 's' => $score]);
$leaderboardRank = (int) $rankStmt->fetchColumn();

json_response([
    'ok'                => true,
    'run_id'            => $runId,
    'gems_earned'       => $gemsEarned,
    'gems_total'        => $newGems,
    'streak'            => $currentStreak,
    'streak_longest'    => $longestStreak,
    'streak_bonus_gems' => $streakBonusGems,
    'leaderboard_rank'  => $leaderboardRank,
]);

/**
 * Somma i progressi di oggi per ciascuna metrica coinvolta in questa run,
 * su tutte le missioni attive che usano quella metrica come "somma".
 * (per 'duration_sec' interpretiamo il target come "singola run",
 *  quindi usiamo il massimo invece della somma)
 */
function update_daily_missions(PDO $pdo, int $userId, array $deltas): void
{
    $today = date('Y-m-d');

    $missions = $pdo->query('SELECT * FROM nh_missions WHERE active = 1')->fetchAll();

    foreach ($missions as $mission) {
        $metric = $mission['metric'];
        if (!array_key_exists($metric, $deltas)) {
            continue;
        }
        $delta = $deltas[$metric];

        $stmt = $pdo->prepare(
            'SELECT progress, completed FROM nh_user_missions
             WHERE user_id = :u AND mission_id = :m AND `date` = :d'
        );
        $stmt->execute(['u' => $userId, 'm' => $mission['id'], 'd' => $today]);
        $row = $stmt->fetch();

        // 'duration_sec' e 'waves' guardano il MASSIMO ottenuto in una
        // singola run (non ha senso sommarli tra run diverse: sopravvivere
        // 5 minuti in due run separate non equivale a sopravvivere 10
        // minuti in una sola, e lo stesso vale per l'ondata raggiunta).
        // Gli altri (kills, bosses_killed, runs_played) si sommano invece
        // progressivamente nell'arco della giornata.
        $isMaxMetric = in_array($metric, ['duration_sec', 'waves'], true);
        $currentProgress = $row ? (int) $row['progress'] : 0;
        $newProgress = $isMaxMetric
            ? max($currentProgress, $delta)
            : $currentProgress + $delta;

        $completed = $newProgress >= $mission['target'] ? 1 : 0;

        $pdo->prepare(
            'INSERT INTO nh_user_missions (user_id, mission_id, `date`, progress, completed)
             VALUES (:u, :m, :d, :p, :c)
             ON DUPLICATE KEY UPDATE progress = :p2, completed = :c2'
        )->execute([
            'u' => $userId, 'm' => $mission['id'], 'd' => $today,
            'p' => $newProgress, 'c' => $completed,
            'p2' => $newProgress, 'c2' => $completed,
        ]);
    }
}

/**
 * v1.34.0 — Punteggio boss massimo ESATTO (non stimato) raggiungibile
 * con $bossesKilled uccisioni totali, replicando fedelmente la stessa
 * formula usata per generare BOSS_TYPES in js/config.js:
 *  - 19 boss regolari (tier 0..18), punteggio = round(500 * 1.08^tier)
 *  - il 20° (tier 19, "singularity") è il boss finale, punteggio fisso 6000
 *  - dopo il 20°, il roster ricomincia (v1.30.0, modalità infinita) e il
 *    punteggio di ciascun boss viene moltiplicato per 1.10^numeroGiro
 * I boss si susseguono SEMPRE in questo identico ordine fisso (mai a
 * scelta del giocatore), quindi per un dato numero di uccisioni la somma
 * dei punteggi possibili è unica e calcolabile esattamente — non serve
 * una stima approssimata con margine, e infatti una stima approssimata
 * è esattamente ciò che causava il bug corretto in questa versione.
 */
function max_boss_score_for_kills(int $bossesKilled): int
{
    static $tierScores = null;
    if ($tierScores === null) {
        $tierScores = [];
        for ($i = 0; $i < 19; $i++) {
            $tierScores[] = (int) round(500 * (1.08 ** $i));
        }
        $tierScores[] = 6000; // tier 19: boss finale, punteggio fisso
    }
    $rosterLength = count($tierScores); // 20

    $total = 0;
    for ($n = 0; $n < $bossesKilled; $n++) {
        $bossIndex = $n % $rosterLength;
        $cycleNumber = intdiv($n, $rosterLength);
        $score = $tierScores[$bossIndex];
        if ($cycleNumber > 0) {
            $score = (int) round($score * (1.10 ** $cycleNumber));
        }
        $total += $score;
    }
    return $total;
}
