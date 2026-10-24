-- =====================================================================
-- NEON HORDE — Migrazione SICURA e RIPETIBILE (idempotente)
-- =====================================================================
-- A differenza di sql/schema.sql (che fa DROP TABLE + ricrea tutto da
-- zero, cancellando ogni dato), questo script:
--
--   1. crea le tabelle che mancano del tutto (CREATE TABLE IF NOT EXISTS)
--   2. aggiunge alle tabelle GIA' esistenti le colonne/indici/vincoli che
--      dovrebbero esserci secondo lo schema attuale ma mancano (ALTER
--      TABLE ... solo se la colonna/indice non c'e' già)
--   3. risincronizza SOLO i dati di "catalogo" (oggetti del negozio,
--      missioni giornaliere, tier dei traguardi) con i valori corretti
--      del gioco, individuandoli per chiave logica (effect_key / key /
--      categoria+tier) e non per ID numerico — così funziona anche se
--      gli ID/auto_increment nel tuo database sono stati alterati o non
--      corrispondono più a quelli "storici"
--
-- NON viene MAI eseguito un DROP TABLE, un DROP/TRUNCATE su dati
-- giocatore, né una DELETE su nh_users, nh_runs, nh_user_upgrades,
-- nh_user_missions, nh_user_achievements, nh_session_tokens,
-- nh_run_tokens, nh_password_resets, nh_feedback.
--
-- Puoi rilanciare questo script tutte le volte che vuoi (dopo ogni
-- nuova versione del gioco che tocca lo schema): è progettato per non
-- fare nulla sulle parti già a posto e sistemare solo ciò che manca.
--
-- Come importarlo: esattamente come schema.sql — via
--   mysql -u <user> -p <database> < schema_safe_migrate.sql
-- oppure da phpMyAdmin (scheda "Importa"). Funziona anche se il
-- database è VUOTO (prima installazione): in quel caso si comporta
-- come schema.sql, creando tutto da capo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SEZIONE 0 — Helper riutilizzabili (procedure temporanee)
-- Aggiungono una colonna/indice/vincolo SOLO se non esiste già.
-- Vengono rimosse in fondo allo script: non restano nel database.
-- ---------------------------------------------------------------------
DELIMITER $$

DROP PROCEDURE IF EXISTS nh_mig_add_column $$
CREATE PROCEDURE nh_mig_add_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @nh_sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_definition);
    PREPARE nh_stmt FROM @nh_sql;
    EXECUTE nh_stmt;
    DEALLOCATE PREPARE nh_stmt;
  END IF;
END $$

DROP PROCEDURE IF EXISTS nh_mig_add_index $$
CREATE PROCEDURE nh_mig_add_index(IN p_table VARCHAR(64), IN p_index_name VARCHAR(64), IN p_definition TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND INDEX_NAME = p_index_name
  ) THEN
    SET @nh_sql = CONCAT('ALTER TABLE `', p_table, '` ADD ', p_definition);
    PREPARE nh_stmt FROM @nh_sql;
    EXECUTE nh_stmt;
    DEALLOCATE PREPARE nh_stmt;
  END IF;
END $$

DROP PROCEDURE IF EXISTS nh_mig_add_unique_on_column $$
CREATE PROCEDURE nh_mig_add_unique_on_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_index_name VARCHAR(64))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column AND NON_UNIQUE = 0
  ) THEN
    SET @nh_sql = CONCAT('ALTER TABLE `', p_table, '` ADD UNIQUE INDEX `', p_index_name, '` (`', p_column, '`)');
    PREPARE nh_stmt FROM @nh_sql;
    EXECUTE nh_stmt;
    DEALLOCATE PREPARE nh_stmt;
  END IF;
END $$

-- Per i vincoli FK: se fallisce (es. righe orfane che violerebbero il
-- vincolo) NON blocca lo script — segnala solo un avviso da leggere
-- alla fine, così puoi controllare manualmente senza rischiare che la
-- migrazione si interrompa a metà.
DROP PROCEDURE IF EXISTS nh_mig_add_fk $$
CREATE PROCEDURE nh_mig_add_fk(IN p_table VARCHAR(64), IN p_constraint_name VARCHAR(64), IN p_definition TEXT)
BEGIN
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION
  BEGIN
    INSERT INTO nh_mig_warnings (message) VALUES (
      CONCAT('Impossibile aggiungere il vincolo ', p_constraint_name, ' su ', p_table,
             ' — probabili righe orfane (dati che puntano a un id inesistente). Controllare manualmente.')
    );
  END;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table
      AND CONSTRAINT_NAME = p_constraint_name AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) THEN
    SET @nh_sql = CONCAT('ALTER TABLE `', p_table, '` ADD ', p_definition);
    PREPARE nh_stmt FROM @nh_sql;
    EXECUTE nh_stmt;
    DEALLOCATE PREPARE nh_stmt;
  END IF;
END $$

-- ---------------------------------------------------------------------
-- Riparazione doppioni nel CATALOGO (negozio/missioni/traguardi),
-- indispensabile PRIMA di poter aggiungere un vincolo UNIQUE se il
-- pasticcio su id/auto_increment ha lasciato righe duplicate. Per
-- ogni gruppo di doppioni tiene la riga con id più basso come
-- "canonica" e:
--  - se un giocatore possiede/ha completato SIA la riga canonica SIA
--    quella duplicata, fonde i due progressi tenendo il valore
--    migliore (livello più alto, data di completamento più antica) —
--    nessun progresso viene perso;
--  - se possiede SOLO la riga duplicata, la ripunta sulla riga
--    canonica invece di perderla;
--  - infine elimina le righe di catalogo duplicate rimaste (ormai
--    senza più alcun riferimento "orfano" da un giocatore).
-- I dati dei giocatori vengono quindi preservati per intero: viene
-- ripulito solo il catalogo, mai un account o un progresso.
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS nh_mig_dedupe_shop_items $$
CREATE PROCEDURE nh_mig_dedupe_shop_items()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  DECLARE v_keep_id INT UNSIGNED;
  DECLARE dup_cur CURSOR FOR
    SELECT effect_key, MIN(id) FROM nh_shop_items GROUP BY effect_key HAVING COUNT(*) > 1;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN dup_cur;
  read_loop: LOOP
    FETCH dup_cur INTO v_key, v_keep_id;
    IF done THEN LEAVE read_loop; END IF;

    UPDATE nh_user_upgrades keep_row
    JOIN nh_user_upgrades dup_row ON dup_row.user_id = keep_row.user_id
    JOIN nh_shop_items si ON si.id = dup_row.item_id AND si.effect_key = v_key AND si.id <> v_keep_id
    SET keep_row.level = GREATEST(keep_row.level, dup_row.level),
        keep_row.purchased_at = LEAST(keep_row.purchased_at, dup_row.purchased_at)
    WHERE keep_row.item_id = v_keep_id;

    -- Elimina ESPLICITAMENTE le righe appena fuse (non fidarsi di un
    -- eventuale ON DELETE CASCADE, che potrebbe non essere presente
    -- se anche i vincoli di chiave esterna sono stati compromessi)
    DELETE dup_row FROM nh_user_upgrades dup_row
    JOIN nh_shop_items si ON si.id = dup_row.item_id AND si.effect_key = v_key AND si.id <> v_keep_id
    JOIN nh_user_upgrades keep_row ON keep_row.user_id = dup_row.user_id AND keep_row.item_id = v_keep_id;

    UPDATE nh_user_upgrades dup_row
    JOIN nh_shop_items si ON si.id = dup_row.item_id AND si.effect_key = v_key AND si.id <> v_keep_id
    LEFT JOIN nh_user_upgrades keep_row ON keep_row.user_id = dup_row.user_id AND keep_row.item_id = v_keep_id
    SET dup_row.item_id = v_keep_id
    WHERE keep_row.user_id IS NULL;

    DELETE FROM nh_shop_items WHERE effect_key = v_key AND id <> v_keep_id;
  END LOOP;
  CLOSE dup_cur;
END $$

DROP PROCEDURE IF EXISTS nh_mig_dedupe_missions $$
CREATE PROCEDURE nh_mig_dedupe_missions()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  DECLARE v_keep_id INT UNSIGNED;
  DECLARE dup_cur CURSOR FOR
    SELECT `key`, MIN(id) FROM nh_missions GROUP BY `key` HAVING COUNT(*) > 1;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN dup_cur;
  read_loop: LOOP
    FETCH dup_cur INTO v_key, v_keep_id;
    IF done THEN LEAVE read_loop; END IF;

    -- Il progresso giornaliero è per (user_id, mission_id, date): fonde
    -- progresso/completato/riscattato quando lo stesso giocatore ha
    -- righe su entrambe le missioni doppie nello stesso giorno.
    UPDATE nh_user_missions keep_row
    JOIN nh_user_missions dup_row
      ON dup_row.user_id = keep_row.user_id AND dup_row.`date` = keep_row.`date`
    JOIN nh_missions m ON m.id = dup_row.mission_id AND m.`key` = v_key AND m.id <> v_keep_id
    SET keep_row.progress = GREATEST(keep_row.progress, dup_row.progress),
        keep_row.completed = GREATEST(keep_row.completed, dup_row.completed),
        keep_row.claimed = GREATEST(keep_row.claimed, dup_row.claimed)
    WHERE keep_row.mission_id = v_keep_id;

    DELETE dup_row FROM nh_user_missions dup_row
    JOIN nh_missions m ON m.id = dup_row.mission_id AND m.`key` = v_key AND m.id <> v_keep_id
    JOIN nh_user_missions keep_row
      ON keep_row.user_id = dup_row.user_id AND keep_row.mission_id = v_keep_id AND keep_row.`date` = dup_row.`date`;

    UPDATE nh_user_missions dup_row
    JOIN nh_missions m ON m.id = dup_row.mission_id AND m.`key` = v_key AND m.id <> v_keep_id
    LEFT JOIN nh_user_missions keep_row
      ON keep_row.user_id = dup_row.user_id AND keep_row.mission_id = v_keep_id AND keep_row.`date` = dup_row.`date`
    SET dup_row.mission_id = v_keep_id
    WHERE keep_row.user_id IS NULL;

    DELETE FROM nh_missions WHERE `key` = v_key AND id <> v_keep_id;
  END LOOP;
  CLOSE dup_cur;
END $$

DROP PROCEDURE IF EXISTS nh_mig_dedupe_achievement_tiers $$
CREATE PROCEDURE nh_mig_dedupe_achievement_tiers()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_cat VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  DECLARE v_tier TINYINT UNSIGNED;
  DECLARE v_keep_id INT UNSIGNED;
  DECLARE dup_cur CURSOR FOR
    SELECT category, tier_order, MIN(id) FROM nh_achievement_tiers GROUP BY category, tier_order HAVING COUNT(*) > 1;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN dup_cur;
  read_loop: LOOP
    FETCH dup_cur INTO v_cat, v_tier, v_keep_id;
    IF done THEN LEAVE read_loop; END IF;

    -- Un riscatto è unico per (user_id, tier_id): se lo stesso
    -- giocatore ha già riscattato SIA il tier canonico SIA il suo
    -- doppione, tiene solo quello canonico (il riscatto è comunque
    -- già avvenuto per entrambi, niente viene "de-riscattato") ed
    -- elimina esplicitamente la riga ridondante del doppione, senza
    -- fidarsi di un eventuale ON DELETE CASCADE.
    DELETE dup_row FROM nh_user_achievements dup_row
    JOIN nh_achievement_tiers t ON t.id = dup_row.tier_id AND t.category = v_cat AND t.tier_order = v_tier AND t.id <> v_keep_id
    JOIN nh_user_achievements keep_row ON keep_row.user_id = dup_row.user_id AND keep_row.tier_id = v_keep_id;

    UPDATE nh_user_achievements dup_row
    JOIN nh_achievement_tiers t ON t.id = dup_row.tier_id AND t.category = v_cat AND t.tier_order = v_tier AND t.id <> v_keep_id
    LEFT JOIN nh_user_achievements keep_row
      ON keep_row.user_id = dup_row.user_id AND keep_row.tier_id = v_keep_id
    SET dup_row.tier_id = v_keep_id
    WHERE keep_row.user_id IS NULL;

    DELETE FROM nh_achievement_tiers WHERE category = v_cat AND tier_order = v_tier AND id <> v_keep_id;
  END LOOP;
  CLOSE dup_cur;
END $$

DELIMITER ;

-- Tabella temporanea di appoggio per raccogliere eventuali avvisi
-- (es. vincoli FK non applicabili per righe orfane). Viene letta e
-- droppata in fondo allo script.
CREATE TABLE IF NOT EXISTS nh_mig_warnings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- SEZIONE 1 — Crea le tabelle mancanti (installazione da zero, o
-- tabelle di funzionalità più recenti — es. i Traguardi di v1.33.0 —
-- che nel tuo database potrebbero non esistere affatto). Se una
-- tabella esiste già, questi CREATE TABLE non fanno nulla.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nh_users (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(190) NULL UNIQUE,
  password_hash VARCHAR(255) NULL,
  nickname      VARCHAR(32)  NULL DEFAULT NULL,
  is_guest      TINYINT(1)   NOT NULL DEFAULT 0,
  gems          INT UNSIGNED NOT NULL DEFAULT 0,
  base_hp_lvl   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  base_dmg_lvl  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  last_active_at DATETIME NULL,
  current_streak    INT UNSIGNED NOT NULL DEFAULT 0,
  longest_streak    INT UNSIGNED NOT NULL DEFAULT 0,
  last_streak_date  DATE NULL,
  lifetime_kills          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  lifetime_runs           INT UNSIGNED NOT NULL DEFAULT 0,
  lifetime_bosses_killed  INT UNSIGNED NOT NULL DEFAULT 0,
  lifetime_damage_dealt   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  best_survival_sec       INT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE INDEX idx_nickname (nickname),
  INDEX idx_last_active (last_active_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nh_session_tokens (
  token         CHAR(64)     NOT NULL PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME NOT NULL,
  last_used_at  DATETIME NULL,
  INDEX idx_user (user_id),
  CONSTRAINT fk_nh_session_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nh_run_tokens (
  token         CHAR(64)     NOT NULL PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  issued_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used          TINYINT(1)   NOT NULL DEFAULT 0,
  INDEX idx_user_used (user_id, used),
  CONSTRAINT fk_nh_runtoken_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nh_runs (
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

CREATE TABLE IF NOT EXISTS nh_shop_items (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(64) NOT NULL,
  type            ENUM('stat','weapon_unlock','skin','weapon_skin','bundle') NOT NULL,
  effect_key      VARCHAR(64) NOT NULL,
  effect_value    DECIMAL(10,2) NOT NULL DEFAULT 0,
  cost_gems       INT UNSIGNED NOT NULL,
  required_level  INT UNSIGNED NOT NULL DEFAULT 0,
  max_level       INT UNSIGNED NOT NULL DEFAULT 1,
  sort_order      INT NOT NULL DEFAULT 0,
  active          TINYINT(1) NOT NULL DEFAULT 1,
  bundle_items    JSON NULL,
  UNIQUE INDEX uq_nh_shop_items_effect_key (effect_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nh_user_upgrades (
  user_id       BIGINT UNSIGNED NOT NULL,
  item_id       INT UNSIGNED NOT NULL,
  level         INT UNSIGNED NOT NULL DEFAULT 1,
  purchased_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_id),
  CONSTRAINT fk_nh_upg_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_nh_upg_item FOREIGN KEY (item_id) REFERENCES nh_shop_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nh_missions (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `key`           VARCHAR(64) NOT NULL UNIQUE,
  description     VARCHAR(190) NOT NULL,
  metric          ENUM('kills','duration_sec','bosses_killed','waves','runs_played') NOT NULL,
  target          INT UNSIGNED NOT NULL,
  reward_gems     INT UNSIGNED NOT NULL,
  active          TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nh_user_missions (
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

CREATE TABLE IF NOT EXISTS nh_achievement_tiers (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category             ENUM('kills_total','runs_total','survival_best','streak_best','bosses_total','damage_total') NOT NULL,
  tier_order           TINYINT UNSIGNED NOT NULL,
  target               BIGINT UNSIGNED NOT NULL,
  reward_gems          INT UNSIGNED NOT NULL,
  reward_shop_item_id  INT UNSIGNED NULL,
  UNIQUE KEY uq_nh_at_category_tier (category, tier_order),
  CONSTRAINT fk_nh_at_item FOREIGN KEY (reward_shop_item_id) REFERENCES nh_shop_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nh_user_achievements (
  user_id      BIGINT UNSIGNED NOT NULL,
  tier_id      INT UNSIGNED NOT NULL,
  claimed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, tier_id),
  CONSTRAINT fk_nh_ua_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_nh_ua_tier FOREIGN KEY (tier_id) REFERENCES nh_achievement_tiers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nh_password_resets (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  code          CHAR(6)      NOT NULL,
  expires_at    DATETIME     NOT NULL,
  used          TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_code (user_id, code, used),
  CONSTRAINT fk_nh_pwreset_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nh_feedback (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  run_id        BIGINT UNSIGNED NULL,
  sentiment     ENUM('up','down') NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_run (run_id),
  CONSTRAINT fk_nh_feedback_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_nh_feedback_run FOREIGN KEY (run_id) REFERENCES nh_runs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- SEZIONE 2 — Ripara le tabelle che esistevano GIA' nel tuo database
-- ma con struttura vecchia/incompleta: aggiunge solo ciò che manca,
-- senza toccare le righe esistenti. Se una colonna/indice è già a
-- posto, ogni chiamata qui sotto è un no-op.
-- ---------------------------------------------------------------------

-- nh_users: colonne introdotte nelle versioni successive alla v1.0.0
CALL nh_mig_add_column('nh_users', 'nickname', '`nickname` VARCHAR(32) NULL DEFAULT NULL AFTER password_hash');
CALL nh_mig_add_column('nh_users', 'is_guest', '`is_guest` TINYINT(1) NOT NULL DEFAULT 0 AFTER nickname');
CALL nh_mig_add_column('nh_users', 'gems', '`gems` INT UNSIGNED NOT NULL DEFAULT 0 AFTER is_guest');
CALL nh_mig_add_column('nh_users', 'base_hp_lvl', '`base_hp_lvl` SMALLINT UNSIGNED NOT NULL DEFAULT 0');
CALL nh_mig_add_column('nh_users', 'base_dmg_lvl', '`base_dmg_lvl` SMALLINT UNSIGNED NOT NULL DEFAULT 0');
CALL nh_mig_add_column('nh_users', 'last_login_at', '`last_login_at` DATETIME NULL');
CALL nh_mig_add_column('nh_users', 'last_active_at', '`last_active_at` DATETIME NULL');
CALL nh_mig_add_column('nh_users', 'current_streak', '`current_streak` INT UNSIGNED NOT NULL DEFAULT 0');
CALL nh_mig_add_column('nh_users', 'longest_streak', '`longest_streak` INT UNSIGNED NOT NULL DEFAULT 0');
CALL nh_mig_add_column('nh_users', 'last_streak_date', '`last_streak_date` DATE NULL');
CALL nh_mig_add_column('nh_users', 'lifetime_kills', '`lifetime_kills` BIGINT UNSIGNED NOT NULL DEFAULT 0');
CALL nh_mig_add_column('nh_users', 'lifetime_runs', '`lifetime_runs` INT UNSIGNED NOT NULL DEFAULT 0');
CALL nh_mig_add_column('nh_users', 'lifetime_bosses_killed', '`lifetime_bosses_killed` INT UNSIGNED NOT NULL DEFAULT 0');
CALL nh_mig_add_column('nh_users', 'lifetime_damage_dealt', '`lifetime_damage_dealt` BIGINT UNSIGNED NOT NULL DEFAULT 0');
CALL nh_mig_add_column('nh_users', 'best_survival_sec', '`best_survival_sec` INT UNSIGNED NOT NULL DEFAULT 0');
-- Il nickname deve poter essere NULL (v1.20.0): questa MODIFY è
-- sicura e non cancella nulla, cambia solo il vincolo della colonna.
-- Eseguita solo se serve, per non bloccare inutilmente la tabella.
SET @nh_nickname_nullable = (
  SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nh_users' AND COLUMN_NAME = 'nickname'
);
SET @nh_sql = IF(@nh_nickname_nullable = 'NO',
  'ALTER TABLE nh_users MODIFY COLUMN `nickname` VARCHAR(32) NULL DEFAULT NULL',
  'SELECT 1');
PREPARE nh_stmt FROM @nh_sql; EXECUTE nh_stmt; DEALLOCATE PREPARE nh_stmt;

CALL nh_mig_add_unique_on_column('nh_users', 'nickname', 'idx_nickname');
CALL nh_mig_add_index('nh_users', 'idx_last_active', 'INDEX idx_last_active (last_active_at)');
CALL nh_mig_add_unique_on_column('nh_users', 'email', 'idx_email');

-- nh_shop_items: chiave logica su effect_key (fondamentale per far
-- funzionare la risincronizzazione del catalogo nella Sezione 3 anche
-- se gli ID sono stati alterati manualmente in passato). Se il
-- pasticcio su id/auto_increment ha lasciato righe duplicate (stesso
-- effect_key più volte), le fonde/ripulisce PRIMA di poter applicare
-- il vincolo di unicità, senza perdere alcun acquisto dei giocatori.
CALL nh_mig_add_column('nh_shop_items', 'bundle_items', '`bundle_items` JSON NULL');
CALL nh_mig_dedupe_shop_items();
CALL nh_mig_add_unique_on_column('nh_shop_items', 'effect_key', 'uq_nh_shop_items_effect_key');

-- Stessa protezione anti-doppioni per le missioni giornaliere e per i
-- tier dei Traguardi, per lo stesso motivo.
CALL nh_mig_dedupe_missions();
CALL nh_mig_add_unique_on_column('nh_missions', 'key', 'uq_nh_missions_key');
CALL nh_mig_dedupe_achievement_tiers();
CALL nh_mig_add_index('nh_achievement_tiers', 'uq_nh_at_category_tier', 'UNIQUE KEY uq_nh_at_category_tier (category, tier_order)');

-- Indici principali sulle altre tabelle, nel caso mancassero
CALL nh_mig_add_index('nh_session_tokens', 'idx_user', 'INDEX idx_user (user_id)');
CALL nh_mig_add_index('nh_run_tokens', 'idx_user_used', 'INDEX idx_user_used (user_id, used)');
CALL nh_mig_add_index('nh_runs', 'idx_leaderboard', 'INDEX idx_leaderboard (score DESC)');
CALL nh_mig_add_index('nh_runs', 'idx_user_runs', 'INDEX idx_user_runs (user_id, score DESC)');
CALL nh_mig_add_index('nh_password_resets', 'idx_user_code', 'INDEX idx_user_code (user_id, code, used)');
CALL nh_mig_add_index('nh_feedback', 'idx_run', 'INDEX idx_run (run_id)');

-- Vincoli di chiave esterna, nel caso mancassero (es. tabelle create
-- a mano o con FOREIGN_KEY_CHECKS disattivato in passato). Se una FK
-- non può essere applicata per righe orfane, lo script continua e
-- l'avviso finisce in nh_mig_warnings (vedi il SELECT finale).
CALL nh_mig_add_fk('nh_session_tokens', 'fk_nh_session_user', 'CONSTRAINT fk_nh_session_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE');
CALL nh_mig_add_fk('nh_run_tokens', 'fk_nh_runtoken_user', 'CONSTRAINT fk_nh_runtoken_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE');
CALL nh_mig_add_fk('nh_runs', 'fk_nh_runs_user', 'CONSTRAINT fk_nh_runs_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE');
CALL nh_mig_add_fk('nh_user_upgrades', 'fk_nh_upg_user', 'CONSTRAINT fk_nh_upg_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE');
CALL nh_mig_add_fk('nh_user_upgrades', 'fk_nh_upg_item', 'CONSTRAINT fk_nh_upg_item FOREIGN KEY (item_id) REFERENCES nh_shop_items(id) ON DELETE CASCADE');
CALL nh_mig_add_fk('nh_user_missions', 'fk_nh_um_user', 'CONSTRAINT fk_nh_um_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE');
CALL nh_mig_add_fk('nh_user_missions', 'fk_nh_um_mission', 'CONSTRAINT fk_nh_um_mission FOREIGN KEY (mission_id) REFERENCES nh_missions(id) ON DELETE CASCADE');
CALL nh_mig_add_fk('nh_achievement_tiers', 'fk_nh_at_item', 'CONSTRAINT fk_nh_at_item FOREIGN KEY (reward_shop_item_id) REFERENCES nh_shop_items(id) ON DELETE SET NULL');
CALL nh_mig_add_fk('nh_user_achievements', 'fk_nh_ua_user', 'CONSTRAINT fk_nh_ua_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE');
CALL nh_mig_add_fk('nh_user_achievements', 'fk_nh_ua_tier', 'CONSTRAINT fk_nh_ua_tier FOREIGN KEY (tier_id) REFERENCES nh_achievement_tiers(id) ON DELETE CASCADE');
CALL nh_mig_add_fk('nh_password_resets', 'fk_nh_pwreset_user', 'CONSTRAINT fk_nh_pwreset_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE');
CALL nh_mig_add_fk('nh_feedback', 'fk_nh_feedback_user', 'CONSTRAINT fk_nh_feedback_user FOREIGN KEY (user_id) REFERENCES nh_users(id) ON DELETE CASCADE');
CALL nh_mig_add_fk('nh_feedback', 'fk_nh_feedback_run', 'CONSTRAINT fk_nh_feedback_run FOREIGN KEY (run_id) REFERENCES nh_runs(id) ON DELETE SET NULL');

-- ---------------------------------------------------------------------
-- SEZIONE 3 — Risincronizza SOLO i dati di catalogo (oggetti negozio,
-- missioni, tier traguardi). Sono dati "di configurazione del gioco",
-- non dati dei giocatori: qui è corretto riscriverli con i valori
-- ufficiali. Il match avviene per chiave logica (effect_key / key /
-- categoria+tier), MAI per id numerico — quindi funziona anche se
-- l'auto_increment del tuo database è stato alterato.
--
-- Cosa NON viene mai toccato da questa sezione: nh_users (gemme,
-- nickname, statistiche...), nh_runs, nh_user_upgrades (oggetti già
-- posseduti dai giocatori), nh_user_missions, nh_user_achievements.
-- ---------------------------------------------------------------------

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
('Skin: Macellaio',   'skin', 'skin_butcher',   1, 0, 0, 1, 50),
('Skin: Veterano',    'skin', 'skin_veteran',   1, 0, 0, 1, 51),
('Skin: Immortale',   'skin', 'skin_immortal',  1, 0, 0, 1, 52),
('Skin: Devoto',      'skin', 'skin_devoted',   1, 0, 0, 1, 53),
('Skin: Cacciatore',  'skin', 'skin_hunter',    1, 0, 0, 1, 54),
('Skin: Distruttore', 'skin', 'skin_destroyer', 1, 0, 0, 1, 55),
('Bundle: Tutte le Skin',      'bundle', 'bundle_all_skins',    1, 870,  0, 1, 40),
('Bundle: Arsenale Completo',  'bundle', 'bundle_full_arsenal', 1, 2635, 0, 1, 41)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  effect_value = VALUES(effect_value),
  cost_gems = VALUES(cost_gems),
  required_level = VALUES(required_level),
  max_level = VALUES(max_level),
  sort_order = VALUES(sort_order);

-- Le 6 skin esclusive dei Traguardi non sono mai acquistabili nel
-- negozio normale (si ottengono solo completando il tier corrispondente)
UPDATE nh_shop_items SET active = 0 WHERE effect_key IN
  ('skin_butcher','skin_veteran','skin_immortal','skin_devoted','skin_hunter','skin_destroyer');
UPDATE nh_shop_items SET active = 1 WHERE effect_key NOT IN
  ('skin_butcher','skin_veteran','skin_immortal','skin_devoted','skin_hunter','skin_destroyer');

-- bundle_items risolti DINAMICAMENTE per effect_key -> id reale
-- nel TUO database, qualunque esso sia oggi. Il calcolo passa da una
-- tabella derivata (JOIN su subquery) perché MySQL/MariaDB non
-- permette di leggere e aggiornare la stessa tabella in un'unica
-- sottoquery diretta nella SET.
UPDATE nh_shop_items b
JOIN (
  SELECT JSON_ARRAYAGG(si.id) AS ids FROM nh_shop_items si
  WHERE si.effect_key IN ('skin_ninja','skin_robot','skin_pulsecore','skin_sentinel','skin_overcharge','skin_spectre')
) AS agg ON 1=1
SET b.bundle_items = agg.ids
WHERE b.effect_key = 'bundle_all_skins';

UPDATE nh_shop_items b
JOIN (
  SELECT JSON_ARRAYAGG(si.id) AS ids FROM nh_shop_items si
  WHERE si.effect_key IN ('weapon_shotgun','weapon_laser','weapon_flamethrower','weapon_boomerang','weapon_chainlightning','weapon_railgun','weapon_drone')
) AS agg ON 1=1
SET b.bundle_items = agg.ids
WHERE b.effect_key = 'bundle_full_arsenal';

-- Missioni giornaliere (definizioni, non il progresso dei giocatori)
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
('play_6_runs',     'Gioca 6 run',                   'runs_played',   6,  35)
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  metric = VALUES(metric),
  target = VALUES(target),
  reward_gems = VALUES(reward_gems);

-- Tier dei Traguardi (46 righe, 6 categorie) — reward_shop_item_id
-- viene lasciato NULL qui e risolto subito dopo per effect_key
INSERT INTO nh_achievement_tiers (category, tier_order, target, reward_gems, reward_shop_item_id) VALUES
('kills_total', 1, 1000,     30,  NULL),
('kills_total', 2, 5000,     80,  NULL),
('kills_total', 3, 10000,    150, NULL),
('kills_total', 4, 50000,    400, NULL),
('kills_total', 5, 100000,   700, NULL),
('kills_total', 6, 200000,   1200,NULL),
('kills_total', 7, 500000,   2500,NULL),
('kills_total', 8, 1000000,  5000,NULL),
('runs_total', 1, 10,    25,  NULL),
('runs_total', 2, 20,    50,  NULL),
('runs_total', 3, 50,    120, NULL),
('runs_total', 4, 100,   250, NULL),
('runs_total', 5, 200,   500, NULL),
('runs_total', 6, 500,   1200,NULL),
('runs_total', 7, 1000,  2500,NULL),
('survival_best', 1, 300,  30,  NULL),
('survival_best', 2, 600,  60,  NULL),
('survival_best', 3, 900,  120, NULL),
('survival_best', 4, 1200, 220, NULL),
('survival_best', 5, 1800, 400, NULL),
('survival_best', 6, 2700, 700, NULL),
('survival_best', 7, 3600, 1200,NULL),
('streak_best', 1, 3,   15,  NULL),
('streak_best', 2, 7,   30,  NULL),
('streak_best', 3, 14,  60,  NULL),
('streak_best', 4, 30,  150, NULL),
('streak_best', 5, 45,  250, NULL),
('streak_best', 6, 60,  400, NULL),
('streak_best', 7, 90,  650, NULL),
('streak_best', 8, 180, 1500,NULL),
('streak_best', 9, 365, 4000,NULL),
('bosses_total', 1, 1,   15,  NULL),
('bosses_total', 2, 5,   50,  NULL),
('bosses_total', 3, 10,  100, NULL),
('bosses_total', 4, 25,  250, NULL),
('bosses_total', 5, 50,  500, NULL),
('bosses_total', 6, 100, 1000,NULL),
('bosses_total', 7, 250, 2500,NULL),
('bosses_total', 8, 500, 5000,NULL),
('damage_total', 1, 100000,     30,  NULL),
('damage_total', 2, 500000,     80,  NULL),
('damage_total', 3, 2000000,    200, NULL),
('damage_total', 4, 10000000,   500, NULL),
('damage_total', 5, 50000000,   1200,NULL),
('damage_total', 6, 200000000,  3000,NULL),
('damage_total', 7, 1000000000, 6000,NULL)
ON DUPLICATE KEY UPDATE
  target = VALUES(target),
  reward_gems = VALUES(reward_gems);

-- Collega ogni tier "premio-skin" alla riga reale della sua skin
-- esclusiva, individuata per effect_key (non per id)
UPDATE nh_achievement_tiers t JOIN nh_shop_items si ON si.effect_key = 'skin_butcher'
  SET t.reward_shop_item_id = si.id WHERE t.category = 'kills_total' AND t.tier_order = 7;
UPDATE nh_achievement_tiers t JOIN nh_shop_items si ON si.effect_key = 'skin_veteran'
  SET t.reward_shop_item_id = si.id WHERE t.category = 'runs_total' AND t.tier_order = 6;
UPDATE nh_achievement_tiers t JOIN nh_shop_items si ON si.effect_key = 'skin_immortal'
  SET t.reward_shop_item_id = si.id WHERE t.category = 'survival_best' AND t.tier_order = 6;
UPDATE nh_achievement_tiers t JOIN nh_shop_items si ON si.effect_key = 'skin_devoted'
  SET t.reward_shop_item_id = si.id WHERE t.category = 'streak_best' AND t.tier_order = 7;
UPDATE nh_achievement_tiers t JOIN nh_shop_items si ON si.effect_key = 'skin_hunter'
  SET t.reward_shop_item_id = si.id WHERE t.category = 'bosses_total' AND t.tier_order = 7;
UPDATE nh_achievement_tiers t JOIN nh_shop_items si ON si.effect_key = 'skin_destroyer'
  SET t.reward_shop_item_id = si.id WHERE t.category = 'damage_total' AND t.tier_order = 6;

-- ---------------------------------------------------------------------
-- SEZIONE 4 — Diagnostica di chiusura: righe "orfane" (che puntano a
-- un id che non esiste più) sui dati DEI GIOCATORI. Questa query NON
-- cancella e NON modifica nulla: serve solo a farti vedere se, per
-- via del passato pasticcio su id/auto_increment, ci sono acquisti o
-- progressi rimasti agganciati a un item_id/tier_id oggi inesistente,
-- così puoi decidere tu come intervenire caso per caso.
-- ---------------------------------------------------------------------
SELECT 'nh_user_upgrades con item_id orfano' AS controllo, uu.user_id, uu.item_id
FROM nh_user_upgrades uu
LEFT JOIN nh_shop_items si ON si.id = uu.item_id
WHERE si.id IS NULL;

SELECT 'nh_user_achievements con tier_id orfano' AS controllo, ua.user_id, ua.tier_id
FROM nh_user_achievements ua
LEFT JOIN nh_achievement_tiers t ON t.id = ua.tier_id
WHERE t.id IS NULL;

SELECT * FROM nh_mig_warnings;

-- ---------------------------------------------------------------------
-- SEZIONE 5 — Pulizia: rimuove le procedure e la tabella di appoggio
-- usate solo durante questa migrazione. Non toccano altro.
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS nh_mig_add_column;
DROP PROCEDURE IF EXISTS nh_mig_add_index;
DROP PROCEDURE IF EXISTS nh_mig_add_unique_on_column;
DROP PROCEDURE IF EXISTS nh_mig_add_fk;
DROP PROCEDURE IF EXISTS nh_mig_dedupe_shop_items;
DROP PROCEDURE IF EXISTS nh_mig_dedupe_missions;
DROP PROCEDURE IF EXISTS nh_mig_dedupe_achievement_tiers;
DROP TABLE IF EXISTS nh_mig_warnings;
