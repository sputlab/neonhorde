-- =====================================================================
-- CORREZIONE DEFINITIVA — bug "mission_id non valido" (v1.35.0+)
-- =====================================================================
-- CAUSA CONFERMATA: nella tabella nh_missions, le 6 missioni aggiunte
-- successivamente alle prime 6 (wave_10, wave_15, kill_1000,
-- beat_1_boss, play_6_runs, survive_900) hanno TUTTE id = 0 — invece di
-- un ID univoco assegnato automaticamente. La colonna id di questa
-- tabella, sul tuo database, non è AUTO_INCREMENT e non ha nemmeno una
-- chiave primaria: una migrazione manuale ha probabilmente inserito
-- queste righe specificando id=0 esplicitamente, e senza vincoli il
-- database lo ha accettato alla lettera invece di assegnare 7,8,9...
--
-- Conseguenza pratica: il client riceve "id": 0 per queste 6 missioni,
-- e il controllo di sicurezza in api/missions/claim.php (che rifiuta
-- giustamente qualunque id <= 0, dato che un ID reale non è mai 0)
-- blocca il riscatto con "mission_id non valido" — non è un bug in
-- quel controllo, è la naturale conseguenza del dato corrotto a monte.
--
-- Un effetto collaterale più serio: siccome tutte e 6 condividevano lo
-- stesso id, la chiave primaria di nh_user_missions (user_id,
-- mission_id, date) le confondeva tra loro — il progresso su
-- "wave_10", "kill_1000", "beat_1_boss" ecc. per uno stesso utente
-- nello stesso giorno finiva scritto sopra la STESSA riga, mescolando
-- numeri che non corrispondono più in modo affidabile a nessuna delle
-- 6 missioni specifiche. Ho verificato tutto questo caricando il tuo
-- export reale in una copia di prova, e la correzione qui sotto
-- risolve il problema end-to-end (testato con vere chiamate HTTP
-- contro il codice reale, non solo a mente).
-- =====================================================================

-- --- PASSO 1 — assegna un ID univoco a ciascuna delle 6 missioni
--     corrotte (7-12, proseguendo dopo le prime 6 che erano già
--     corrette). Se il tuo MAX(id) attuale tra le missioni sane fosse
--     diverso da 6, aggiusta i numeri qui sotto di conseguenza — puoi
--     verificarlo con: SELECT MAX(id) FROM nh_missions WHERE id > 0; ---
UPDATE nh_missions SET id = 7  WHERE `key` = 'wave_10'     AND id = 0;
UPDATE nh_missions SET id = 8  WHERE `key` = 'wave_15'     AND id = 0;
UPDATE nh_missions SET id = 9  WHERE `key` = 'kill_1000'   AND id = 0;
UPDATE nh_missions SET id = 10 WHERE `key` = 'beat_1_boss' AND id = 0;
UPDATE nh_missions SET id = 11 WHERE `key` = 'play_6_runs' AND id = 0;
UPDATE nh_missions SET id = 12 WHERE `key` = 'survive_900' AND id = 0;

-- Verifica: questa query deve restituire 12 righe, tutte con id diverso
-- da 0 e tutte diverse tra loro.
SELECT id, `key` FROM nh_missions ORDER BY id;

-- --- PASSO 2 — blinda la colonna con una vera chiave primaria e
--     AUTO_INCREMENT, esattamente come già hanno nh_shop_items e
--     nh_achievement_tiers: impedisce che lo stesso problema si
--     ripresenti in futuro, qualunque migrazione manuale si debba
--     ancora fare. Funziona solo se il PASSO 1 ha già reso tutti gli id
--     univoci (altrimenti MySQL rifiuta l'aggiunta della chiave). ---
ALTER TABLE nh_missions
  MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ADD PRIMARY KEY (id);

-- --- PASSO 3 — pulizia dei progressi ormai ambigui: le righe in
--     nh_user_missions con mission_id=0 rappresentano il progresso di
--     PIÙ missioni diverse mescolato nella stessa riga (vedi sopra), e
--     non si possono separare in modo affidabile a posteriori. Le
--     rimuovo: gli utenti coinvolti ripartiranno da zero SOLO su
--     queste 6 missioni, da oggi in poi — il progresso sulle 6
--     missioni originali (mai state corrotte) e tutte le statistiche a
--     vita dei Traguardi restano completamente intatti. ---
SELECT COUNT(*) AS righe_da_pulire, COUNT(DISTINCT user_id) AS utenti_coinvolti
FROM nh_user_missions WHERE mission_id = 0;

DELETE FROM nh_user_missions WHERE mission_id = 0;

-- =====================================================================
-- Sui 12 utenti coinvolti (dato reale dal tuo export più recente): le
-- loro missioni risultavano "completed=1" prima della pulizia, quindi
-- avevano davvero raggiunto l'obiettivo di ALMENO una delle 6 missioni
-- in modo legittimo — semplicemente non riuscivano a incassarne la
-- ricompensa per il bug. Non ho incluso qui una compensazione
-- automatica perché non è possibile sapere con certezza QUALE delle 6
-- missioni ciascuno avesse davvero completato (i numeri erano
-- mescolati) — è una scelta di prodotto che lascio a te: se vuoi,
-- posso preparare un secondo script che accredita le gemme di TUTTE e
-- 6 le missioni nuove ai 12 utenti coinvolti, come gesto compensativo
-- forfettario (dato il dubbio, meglio dare di più che di meno).
-- =====================================================================
