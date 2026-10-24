-- =====================================================================
-- MIGRAZIONE v1.37.0 — unicità nickname solo tra utenti REGISTRATI
-- =====================================================================
-- Prima: il nickname era univoco tra TUTTI gli utenti (ospiti compresi).
-- Un ospite che sceglieva un nickname e poi provava a registrarsi con
-- lo STESSO nome andava in conflitto con SÉ STESSO (l'unico altro
-- proprietario di quel nickname era lui stesso, ancora come ospite) —
-- causa esatta del bug "nickname già in uso" segnalato più volte.
--
-- Dopo questa migrazione: due ospiti possono avere lo stesso nickname
-- senza alcun conflitto; un nickname è "protetto" (mai duplicabile, né
-- da un altro ospite né da un altro registrato) solo una volta che il
-- suo proprietario si registra con email e password.
--
-- Meccanismo: una colonna generata (`registered_nickname`) che vale
-- `nickname` per gli utenti registrati e NULL per gli ospiti; MySQL/
-- MariaDB trattano più valori NULL come distinti ai fini di un indice
-- UNIQUE, quindi gli ospiti restano sempre esclusi dal controllo,
-- qualunque nome scelgano. Migrazione e comportamento finale già
-- testati end-to-end (schema nuovo E migrazione di dati preesistenti)
-- prima di essere consegnati qui.
-- =====================================================================

-- --- PASSO 1 — verifica preliminare (sola lettura): il vecchio indice
--     deve chiamarsi esattamente `idx_nickname` perché il PASSO 2 lo
--     rimuova correttamente. Se il nome differisce sul tuo database,
--     aggiusta la riga DROP INDEX sotto di conseguenza. ---
SHOW INDEX FROM nh_users WHERE Key_name = 'idx_nickname';

-- --- PASSO 2 — rimuove il vecchio vincolo (univoco su TUTTI gli utenti) ---
ALTER TABLE nh_users DROP INDEX idx_nickname;

-- --- PASSO 3 — aggiunge la colonna generata e il nuovo vincolo, univoco
--     solo tra utenti registrati. Ripristina anche un indice semplice
--     (non univoco) su `nickname`, utile per ricerche/ordinamenti. ---
ALTER TABLE nh_users
  ADD COLUMN registered_nickname VARCHAR(32)
    GENERATED ALWAYS AS (CASE WHEN is_guest = 0 THEN nickname ELSE NULL END) STORED,
  ADD INDEX idx_nickname (nickname),
  ADD UNIQUE INDEX uq_registered_nickname (registered_nickname);

-- --- PASSO 4 — verifica finale: ogni riga deve mostrare
--     registered_nickname = NULL per gli ospiti (is_guest=1) e uguale
--     al proprio nickname per i registrati (is_guest=0). ---
SELECT id, nickname, is_guest, registered_nickname FROM nh_users ORDER BY id LIMIT 20;
