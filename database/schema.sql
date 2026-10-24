-- =====================================================================
-- HORDE SURVIVOR — Schema MySQL 8
-- =====================================================================
-- Import in un database GIA' ESISTENTE (hosting condiviso: qui
-- "your_database_name", ma vale per qualsiasi nome):
--   mysql -u <user> -p your_database_name < schema.sql
-- oppure da phpMyAdmin: seleziona il database dalla sidebar -> scheda
-- "Importa" -> carica questo file.
--
-- Tutte le tabelle sono prefissate "nh_" (NeonHorde) per non entrare in
-- conflitto con altre tabelle già presenti nello stesso database
-- condiviso (es. "users", "runs", "missions" sono nomi generici che
-- potresti già usare per altri progetti).
--
-- Nota sugli errori #1215/#1217 (vincoli FK in fase di creazione/drop):
-- capitano quasi sempre per uno di questi motivi, tutti gestiti qui sotto:
--  1) tabelle di un progetto diverso ma con lo stesso nome già presenti
--     nel database -> risolto usando nomi prefissati "nh_", univoci.
--  2) un tentativo di import precedente ha creato solo alcune tabelle
--     (magari con un ENGINE o CHARSET diverso) e i nuovi CREATE TABLE
--     falliscono in modo silenzioso, oppure il DROP fallisce perché
--     un'altra tabella referenzia ancora la riga -> qui sotto i drop
--     avvengono in ordine inverso alle dipendenze e con i controlli FK
--     disattivati temporaneamente.
--  3) charset/collation non esplicitati fanno ereditare quelli di
--     default del database, che su alcuni hosting condivisi non sono
--     utf8mb4/utf8mb4_unicode_ci -> qui sotto ogni tabella dichiara
--     esplicitamente ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci.

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- Drop puliti (ordine inverso alle dipendenze), per garantire uno
-- stato pulito anche dopo un import parziale/fallito in precedenza.
-- Riguardano solo le tabelle "nh_*" di questo progetto: non toccano
-- altre tabelle eventualmente presenti nel database.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS nh_password_resets;
DROP TABLE IF EXISTS nh_user_missions;
DROP TABLE IF EXISTS nh_missions;
DROP TABLE IF EXISTS nh_user_upgrades;
DROP TABLE IF EXISTS nh_shop_items;
DROP TABLE IF EXISTS nh_runs;
DROP TABLE IF EXISTS nh_run_tokens;
DROP TABLE IF EXISTS nh_session_tokens;
DROP TABLE IF EXISTS nh_users;

-- ---------------------------------------------------------------------
-- NH_USERS
-- ---------------------------------------------------------------------
CREATE TABLE nh_users (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(190) NULL UNIQUE,          -- NULL per account "ospite"
  password_hash VARCHAR(255) NULL,                 -- NULL per account "ospite"
  -- v1.20.0: nickname ora NULLABLE. Un ospite che non ha ancora scelto
  -- un nickname personalizzato ha nickname = NULL (niente più "Guest1234"
  -- auto-generato): l'indice UNIQUE sotto tratta più righe NULL come
  -- valori distinti tra loro (comportamento standard MySQL), quindi
  -- nessuna collisione tra ospiti anonimi.
  nickname      VARCHAR(32)  NULL DEFAULT NULL,
  is_guest      TINYINT(1)   NOT NULL DEFAULT 0,
  gems          INT UNSIGNED NOT NULL DEFAULT 0,
  base_hp_lvl   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  base_dmg_lvl  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  -- Aggiornato periodicamente dal client finché l'app resta aperta
  -- (endpoint api/heartbeat.php): usato per stimare quanti utenti sono
  -- "online" in questo momento (v1.20.0).
  last_active_at DATETIME NULL,
  -- Streak giornaliero: numero di giorni consecutivi in cui l'utente ha
  -- completato almeno una run, aggiornato in api/run/submit.php.
  current_streak    INT UNSIGNED NOT NULL DEFAULT 0,
  longest_streak    INT UNSIGNED NOT NULL DEFAULT 0,
  last_streak_date  DATE NULL,
  -- v1.33.0 — statistiche cumulative A VITA (mai resettate, a differenza
  -- delle missioni giornaliere): alimentano i Traguardi a progressione
  -- permanente (nh_achievement_tiers sotto). Aggiornate ad ogni run in
  -- api/run/submit.php. longest_streak sopra viene riusata direttamente
  -- per la categoria streak, non serve una colonna dedicata per quella.
  lifetime_kills          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  lifetime_runs           INT UNSIGNED NOT NULL DEFAULT 0,
  lifetime_bosses_killed  INT UNSIGNED NOT NULL DEFAULT 0,
  lifetime_damage_dealt   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  best_survival_sec       INT UNSIGNED NOT NULL DEFAULT 0,
  -- v1.37.0 — l'unicità del nickname ora si applica SOLO tra account
  -- REGISTRATI (is_guest = 0): due ospiti possono avere lo stesso nome
  -- senza alcun conflitto (comportamento voluto, non un bug), ma un
  -- nickname già usato da un account registrato non è mai disponibile,
  -- né per un altro registrato né per un ospite che lo voglia scegliere.
  -- Prima l'UNIQUE era diretto su `nickname`: un ospite che aveva già
  -- scelto un nome e poi si registrava andava in conflitto con SÉ
  -- STESSO (l'unico altro proprietario di quel nickname era lui
  -- stesso, ancora come ospite) — bug corretto qui alla radice, non
  -- solo aggirato lato applicazione. La colonna generata sotto vale
  -- `nickname` per i registrati e NULL per gli ospiti; MySQL/MariaDB
  -- trattano più NULL come valori distinti ai fini di un UNIQUE index,
  -- quindi tutti gli ospiti restano automaticamente esclusi dal
  -- controllo, qualunque nome scelgano.
  registered_nickname VARCHAR(32)
    GENERATED ALWAYS AS (CASE WHEN is_guest = 0 THEN nickname ELSE NULL END) STORED,
  INDEX idx_nickname (nickname),
  UNIQUE INDEX uq_registered_nickname (registered_nickname),
  INDEX idx_last_active (last_active_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- NH_SESSION_TOKENS (autenticazione stateless via bearer token opaco)
-- ---------------------------------------------------------------------
CREATE TABLE nh_session_tokens (
  token         CHAR(64)     NOT NULL PRIMARY KEY,  -- random_bytes(32) hex
  user_id       BIGINT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME NOT NULL,
  last_used_at  DATETIME NULL,
  INDEX idx_user (user_id),
  CONSTRAINT fk_nh_session_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- NH_RUN_TOKENS (anti-cheat: un token monouso per sessione di gioco,
-- emesso quando il client inizia una run, consumato al submit)
-- ---------------------------------------------------------------------
CREATE TABLE nh_run_tokens (
  token         CHAR(64)     NOT NULL PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  issued_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used          TINYINT(1)   NOT NULL DEFAULT 0,
  INDEX idx_user_used (user_id, used),
  CONSTRAINT fk_nh_runtoken_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- NH_RUNS (storico partite / punteggi)
-- ---------------------------------------------------------------------
CREATE TABLE nh_runs (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  score         INT UNSIGNED NOT NULL,
  wave_reached  SMALLINT UNSIGNED NOT NULL,
  kills         INT UNSIGNED NOT NULL,
  duration_sec  INT UNSIGNED NOT NULL,
  difficulty    ENUM('easy','normal','hard','inferno') NOT NULL DEFAULT 'normal',
  gems_earned   INT UNSIGNED NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_leaderboard (score DESC),
  INDEX idx_user_runs (user_id, score DESC),
  CONSTRAINT fk_nh_runs_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- NH_SHOP_ITEMS (potenziamenti permanenti acquistabili con gemme)
-- ---------------------------------------------------------------------
CREATE TABLE nh_shop_items (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(64) NOT NULL,
  type            ENUM('stat','weapon_unlock','skin','weapon_skin','bundle') NOT NULL,
  effect_key      VARCHAR(64) NOT NULL,   -- es. 'base_hp', 'base_dmg', 'weapon_shotgun', 'skin_ninja', 'weaponskin_laser', 'bundle_all_skins'
  effect_value    DECIMAL(10,2) NOT NULL DEFAULT 0,
  cost_gems       INT UNSIGNED NOT NULL,
  required_level  INT UNSIGNED NOT NULL DEFAULT 0,  -- livello del potenziamento richiesto (per upgrade a step)
  max_level       INT UNSIGNED NOT NULL DEFAULT 1,  -- 1 = acquisto singolo (skin/arma), >1 = stackabile (stat)
  sort_order      INT NOT NULL DEFAULT 0,
  active          TINYINT(1) NOT NULL DEFAULT 1,
  -- v1.27.0: SOLO per type='bundle' — elenco JSON degli id di
  -- nh_shop_items inclusi nel pacchetto (es. '[7,8,9]'). NULL per
  -- ogni altro tipo. Acquistarlo crea/aggiorna direttamente una riga
  -- nh_user_upgrades per CIASCUN item incluso (vedi api/shop/buy.php),
  -- non solo per il bundle stesso.
  bundle_items    JSON NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- NH_USER_UPGRADES (acquisti effettuati, con livello raggiunto per item stackabili)
-- ---------------------------------------------------------------------
CREATE TABLE nh_user_upgrades (
  user_id       BIGINT UNSIGNED NOT NULL,
  item_id       INT UNSIGNED NOT NULL,
  level         INT UNSIGNED NOT NULL DEFAULT 1,
  purchased_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_id),
  CONSTRAINT fk_nh_upg_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_nh_upg_item FOREIGN KEY (item_id) REFERENCES nh_shop_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- NH_MISSIONS (definizioni missioni giornaliere)
-- ---------------------------------------------------------------------
CREATE TABLE nh_missions (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `key`           VARCHAR(64) NOT NULL UNIQUE,   -- es. 'kill_500', 'survive_600', 'beat_3_bosses'
  description     VARCHAR(190) NOT NULL,
  metric          ENUM('kills','duration_sec','bosses_killed','waves','runs_played') NOT NULL,
  target          INT UNSIGNED NOT NULL,
  reward_gems     INT UNSIGNED NOT NULL,
  active          TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- NH_USER_MISSIONS (progresso giornaliero per utente, reset su data)
-- ---------------------------------------------------------------------
CREATE TABLE nh_user_missions (
  user_id       BIGINT UNSIGNED NOT NULL,
  mission_id    INT UNSIGNED NOT NULL,
  `date`        DATE NOT NULL,
  progress      INT UNSIGNED NOT NULL DEFAULT 0,
  completed     TINYINT(1) NOT NULL DEFAULT 0,
  claimed       TINYINT(1) NOT NULL DEFAULT 0,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, mission_id, `date`),
  CONSTRAINT fk_nh_um_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_nh_um_mission FOREIGN KEY (mission_id) REFERENCES nh_missions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- NH_ACHIEVEMENT_TIERS / NH_USER_ACHIEVEMENTS (v1.33.0 — "Traguardi":
-- missioni a progressione PERMANENTE, mai resettate, organizzate per
-- categoria — a differenza di nh_missions sopra, che sono giornaliere.
-- Ogni categoria ha più tier in ordine crescente (es. kills_total:
-- 1000, 5000, 10000...); il client mostra normalmente solo il primo
-- tier non ancora riscattato per categoria, più una vista d'insieme
-- opzionale. reward_shop_item_id (nullable) collega un tier a una
-- skin ESCLUSIVA in nh_shop_items (active=0, mai acquistabile — si
-- ottiene solo completando questo traguardo, vedi
-- api/achievements/claim.php).
-- ---------------------------------------------------------------------
CREATE TABLE nh_achievement_tiers (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category             ENUM('kills_total','runs_total','survival_best','streak_best','bosses_total','damage_total') NOT NULL,
  tier_order           TINYINT UNSIGNED NOT NULL,  -- 1,2,3... ordine crescente all'interno della categoria
  target               BIGINT UNSIGNED NOT NULL,
  reward_gems          INT UNSIGNED NOT NULL,
  reward_shop_item_id  INT UNSIGNED NULL,
  UNIQUE KEY uq_nh_at_category_tier (category, tier_order),
  CONSTRAINT fk_nh_at_item FOREIGN KEY (reward_shop_item_id) REFERENCES nh_shop_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE nh_user_achievements (
  user_id      BIGINT UNSIGNED NOT NULL,
  tier_id      INT UNSIGNED NOT NULL,
  claimed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, tier_id),
  CONSTRAINT fk_nh_ua_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_nh_ua_tier FOREIGN KEY (tier_id) REFERENCES nh_achievement_tiers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- NH_PASSWORD_RESETS (reset password self-service via codice via email)
-- ---------------------------------------------------------------------
CREATE TABLE nh_password_resets (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  code          CHAR(6)      NOT NULL,           -- codice numerico a 6 cifre
  expires_at    DATETIME     NOT NULL,
  used          TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_code (user_id, code, used),
  CONSTRAINT fk_nh_pwreset_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- NH_FEEDBACK (feedback rapido 👍/👎 post-partita, opzionalmente legato
-- a una run specifica per poterlo incrociare con ondata/difficoltà/ecc.)
-- ---------------------------------------------------------------------
CREATE TABLE nh_feedback (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  run_id        BIGINT UNSIGNED NULL,
  sentiment     ENUM('up','down') NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_run (run_id),
  CONSTRAINT fk_nh_feedback_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_nh_feedback_run FOREIGN KEY (run_id) REFERENCES nh_runs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- SEED DATA di esempio
-- =====================================================================
INSERT INTO nh_shop_items (name, type, effect_key, effect_value, cost_gems, required_level, max_level, sort_order) VALUES
('Vita Massima +10',      'stat',          'base_hp',        10,   50,  0, 10, 1),
('Danno Base +5%',        'stat',          'base_dmg',       0.05, 60,  0, 10, 2),
('Velocità Movimento +5%','stat',          'base_speed',     0.05, 55,  0,  6, 3),
('Sblocca: Shotgun',      'weapon_unlock', 'weapon_shotgun', 1,    200, 0,  1, 10),
('Sblocca: Laser',        'weapon_unlock', 'weapon_laser',   1,    350, 0,  1, 11),
('Sblocca: Flamethrower', 'weapon_unlock', 'weapon_flamethrower', 1,    500, 0,  1, 12),
('Sblocca: Boomerang',       'weapon_unlock', 'weapon_boomerang',      1, 280, 0, 1, 13),
('Sblocca: Fulmine a Catena','weapon_unlock', 'weapon_chainlightning', 1, 420, 0, 1, 14),
('Sblocca: Railgun',         'weapon_unlock', 'weapon_railgun',        1, 600, 0, 1, 15),
('Sblocca: Drone Orbitale',  'weapon_unlock', 'weapon_drone',          1, 750, 0, 1, 16),
('Skin: Ninja',           'skin',          'skin_ninja',     1,    150, 0,  1, 20),
('Skin: Robot',           'skin',          'skin_robot',     1,    150, 0,  1, 21),
('Skin: Nucleo Pulsante', 'skin',          'skin_pulsecore', 1,    180, 0,  1, 22),
('Skin: Sentinella',      'skin',          'skin_sentinel',  1,    200, 0,  1, 23),
('Skin: Sovraccarico',    'skin',          'skin_overcharge',1,    190, 0,  1, 24),
('Skin: Spettro',         'skin',          'skin_spectre',   1,    220, 0,  1, 25),
('Skin Arma: Laser Viola',    'weapon_skin', 'weaponskin_laser',  1, 120, 0, 1, 30),
('Skin Arma: Railgun Cremisi','weapon_skin', 'weaponskin_railgun',1, 150, 0, 1, 31),
('Skin Arma: Drone Dorato',   'weapon_skin', 'weaponskin_drone',  1, 150, 0, 1, 32),
-- v1.33.0 — 6 skin ESCLUSIVE per i Traguardi (nh_achievement_tiers
-- sotto): active=0 le esclude dal negozio normale (shop.php filtra
-- WHERE active = 1), si ottengono SOLO completando il traguardo
-- corrispondente (vedi api/achievements/claim.php, che inserisce
-- direttamente la riga in nh_user_upgrades senza costo in gemme).
-- Riusano al 100% l'infrastruttura skin già esistente (equip,
-- selettore Impostazioni, computeMetaBonuses) — nessun codice nuovo
-- necessario per il possesso/equipaggiamento in sé.
('Skin: Macellaio',   'skin', 'skin_butcher',   1, 0, 0, 1, 50),
('Skin: Veterano',    'skin', 'skin_veteran',   1, 0, 0, 1, 51),
('Skin: Immortale',   'skin', 'skin_immortal',  1, 0, 0, 1, 52),
('Skin: Devoto',      'skin', 'skin_devoted',   1, 0, 0, 1, 53),
('Skin: Cacciatore',  'skin', 'skin_hunter',    1, 0, 0, 1, 54),
('Skin: Distruttore', 'skin', 'skin_destroyer', 1, 0, 0, 1, 55);
UPDATE nh_shop_items SET active = 0 WHERE effect_key IN
  ('skin_butcher','skin_veteran','skin_immortal','skin_devoted','skin_hunter','skin_destroyer');

-- Bundle: acquistabili solo dopo che le righe sopra hanno ricevuto i
-- loro ID auto-incrementali (11-16 le 6 skin personaggio, 4-10 le 7
-- armi sbloccabili) — per questo sono un INSERT separato, successivo.
INSERT INTO nh_shop_items (name, type, effect_key, effect_value, cost_gems, required_level, max_level, sort_order, bundle_items) VALUES
('Bundle: Tutte le Skin',      'bundle', 'bundle_all_skins',    1, 870,  0, 1, 40, '[11,12,13,14,15,16]'),
('Bundle: Arsenale Completo',  'bundle', 'bundle_full_arsenal', 1, 2635, 0, 1, 41, '[4,5,6,7,8,9,10]');

INSERT INTO nh_missions (`key`, description, metric, target, reward_gems) VALUES
('kill_200',        'Uccidi 200 nemici',            'kills',         200, 20),
('kill_500',        'Uccidi 500 nemici',            'kills',         500, 40),
('survive_300',     'Sopravvivi 5 minuti in una run','duration_sec', 300, 25),
('survive_600',     'Sopravvivi 10 minuti in una run','duration_sec',600, 50),
('beat_3_bosses',   'Sconfiggi 3 boss (totale sessioni di oggi)', 'bosses_killed', 3, 35),
('play_3_runs',     'Gioca 3 run',                  'runs_played',   3,  15),
('beat_1_boss',     'Sconfiggi un boss',             'bosses_killed',  1,  15),
('wave_10',         'Raggiungi l''ondata 10 in una run', 'waves',    10,  30),
('wave_15',         'Raggiungi l''ondata 15 in una run', 'waves',    15,  55),
('kill_1000',       'Uccidi 1000 nemici',            'kills',       1000, 65),
('survive_900',     'Sopravvivi 15 minuti in una run','duration_sec',900, 75),
('play_6_runs',     'Gioca 6 run',                   'runs_played',   6,  35);

-- ---------------------------------------------------------------------
-- NH_ACHIEVEMENT_TIERS — seed dei 46 tier sulle 6 categorie (v1.33.0).
-- reward_shop_item_id fa riferimento alle 6 skin esclusive inserite
-- sopra (id 22-27, nello stesso ordine di inserimento).
-- ---------------------------------------------------------------------
INSERT INTO nh_achievement_tiers (category, tier_order, target, reward_gems, reward_shop_item_id) VALUES
-- Uccisioni totali (a vita) — skin "Macellaio" al tier 7 (500.000)
('kills_total', 1, 1000,     30,  NULL),
('kills_total', 2, 5000,     80,  NULL),
('kills_total', 3, 10000,    150, NULL),
('kills_total', 4, 50000,    400, NULL),
('kills_total', 5, 100000,   700, NULL),
('kills_total', 6, 200000,   1200,NULL),
('kills_total', 7, 500000,   2500,22),
('kills_total', 8, 1000000,  5000,NULL),
-- Run completate (a vita) — skin "Veterano" al tier 6 (500)
('runs_total', 1, 10,    25,  NULL),
('runs_total', 2, 20,    50,  NULL),
('runs_total', 3, 50,    120, NULL),
('runs_total', 4, 100,   250, NULL),
('runs_total', 5, 200,   500, NULL),
('runs_total', 6, 500,   1200,23),
('runs_total', 7, 1000,  2500,NULL),
-- Sopravvivenza record (miglior singola run, secondi) — skin "Immortale" al tier 6 (45 min)
('survival_best', 1, 300,  30,  NULL),
('survival_best', 2, 600,  60,  NULL),
('survival_best', 3, 900,  120, NULL),
('survival_best', 4, 1200, 220, NULL),
('survival_best', 5, 1800, 400, NULL),
('survival_best', 6, 2700, 700, 24),
('survival_best', 7, 3600, 1200,NULL),
-- Streak giornaliera record — skin "Devoto" al tier 7 (90 giorni)
('streak_best', 1, 3,   15,  NULL),
('streak_best', 2, 7,   30,  NULL),
('streak_best', 3, 14,  60,  NULL),
('streak_best', 4, 30,  150, NULL),
('streak_best', 5, 45,  250, NULL),
('streak_best', 6, 60,  400, NULL),
('streak_best', 7, 90,  650, 25),
('streak_best', 8, 180, 1500,NULL),
('streak_best', 9, 365, 4000,NULL),
-- Boss sconfitti totali (a vita) — skin "Cacciatore" al tier 7 (250)
('bosses_total', 1, 1,   15,  NULL),
('bosses_total', 2, 5,   50,  NULL),
('bosses_total', 3, 10,  100, NULL),
('bosses_total', 4, 25,  250, NULL),
('bosses_total', 5, 50,  500, NULL),
('bosses_total', 6, 100, 1000,NULL),
('bosses_total', 7, 250, 2500,26),
('bosses_total', 8, 500, 5000,NULL),
-- Danno totale inflitto (a vita) — skin "Distruttore" al tier 6 (200.000.000)
('damage_total', 1, 100000,     30,  NULL),
('damage_total', 2, 500000,     80,  NULL),
('damage_total', 3, 2000000,    200, NULL),
('damage_total', 4, 10000000,   500, NULL),
('damage_total', 5, 50000000,   1200,NULL),
('damage_total', 6, 200000000,  3000,27),
('damage_total', 7, 1000000000, 6000,NULL);
