# NEON HORDE — Horde Shooter / Survivor-like

Webgame verticale (portrait 9:16, adattabile a desktop) in stile
"Survivor.io": movimento libero, tiro automatico sul nemico più vicino,
ondate crescenti, boss periodici, potenziamenti "scegli 1 di 3",
meta-progressione persistente (negozio, missioni giornaliere,
classifica). Stack: **HTML5 Canvas + JS vanilla (ES6 modules) + PHP 8 +
MySQL 8**.

## 1. Struttura del progetto

```
/
├── index.html                 # Landing page pubblica (porta d'ingresso, NON il gioco)
├── game.html                  # Il gioco vero e proprio: SPA canvas + overlay UI (menu/HUD)
├── css/
│   ├── style.css              # estetica arcade neon, HUD, menu, responsive (condiviso da game.html e index.html)
│   └── landing.css            # stili aggiuntivi solo per la landing page (index.html)
├── js/
│   ├── config.js              # costanti di bilanciamento (nemici, armi, boss, difficoltà)
│   ├── utils.js                # matematica, RNG, SpatialHash, ObjectPool
│   ├── audio.js                # SFX/jingle sintetizzati via Web Audio API
│   ├── music.js                 # colonna sonora procedurale (40 loop dark techno/drum'n'bass), Web Audio API
│   ├── entities.js             # Player, Enemy, Projectile, Particle, Pickup, DamageNumber
│   ├── spawner.js               # logica ondate: densità/velocità crescente, trigger boss
│   ├── boss.js                  # macchina a stati pattern boss (carica, ventaglio, evocazione)
│   ├── weapons.js               # mira automatica + fabbrica proiettili del player
│   ├── upgrades.js              # pool "scegli 1 di 3" (armi/fire mode/passivi)
│   ├── api.js                   # client fetch verso il backend PHP
│   ├── ui.js                    # DOM: schermate, HUD, joystick, liste dinamiche
│   ├── game.js                  # loop principale, rendering, collisioni
│   ├── main.js                  # bootstrap: wiring menu <-> API <-> Game (caricato da game.html)
│   └── landing.js               # logica della landing page (caricato da index.html, indipendente dal resto)
├── api/
│   ├── config.php               # bootstrap comune: .env, PDO, auth token, rate limit
│   ├── auth/
│   │   ├── register.php         # registrazione (account o ospite)
│   │   └── login.php
│   ├── run/
│   │   ├── start.php            # emette run_token anti-cheat monouso
│   │   └── submit.php           # submit risultato run + validazione anti-cheat
│   ├── shop.php                 # GET elenco negozio
│   ├── shop/
│   │   └── buy.php              # POST acquisto potenziamento permanente
│   ├── missions.php             # GET missioni giornaliere utente
│   └── missions/
│       └── claim.php            # POST riscatto ricompensa missione
├── sql/
│   └── schema.sql               # CREATE DATABASE + tabelle + indici + seed data
├── icons/                        # icone PWA (PNG pronte + sorgenti SVG in icons/src/)
├── manifest.webmanifest          # Web App Manifest (PWA)
├── sw.js                         # Service Worker (cache offline app shell)
├── favicon.ico
├── assets/                       # immagine hero della landing page
├── .env.example                 # template credenziali (rinominare in .env)
└── .htaccess                     # blocca accesso diretto a .env/.sql, disabilita listing, MIME .webmanifest
```

## 2. Requisiti

- PHP 8.1+ con estensione `pdo_mysql`
- MySQL 8.0+ (o MariaDB 10.6+)
- Apache con `mod_rewrite`/`mod_headers` oppure Nginx + PHP-FPM
- Un dominio/sottodominio con HTTPS (consigliato per Web Audio/autoplay e cookie sicuri)

## 3. Setup database

Lo schema **non crea un database**: presuppone che tu ne abbia già uno
disponibile (tipico su hosting condiviso, dove il database e l'utente
sono forniti dal pannello, es. cPanel/Plesk, e non puoi crearne di nuovi
liberamente). Le tabelle vengono create nel database che selezioni tu.

```bash
mysql -u <utente_fornito_dal_hosting> -p <nome_del_tuo_database> < sql/schema.sql
```

Esempio concreto con un database `sputlabc61682` già esistente:

```bash
mysql -u sputlabc61682 -p sputlabc61682 < sql/schema.sql
```

In alternativa, da phpMyAdmin: seleziona il database dalla sidebar →
scheda **Importa** → carica `sql/schema.sql` → Esegui.

⚠️ **Se hai già un database in produzione con dati** (run/punteggi salvati
prima della v1.17.0): rieseguire `schema.sql` cancellerebbe tutto (fa
DROP+CREATE). Per aggiungere la nuova difficoltà "easy" senza perdere
dati, esegui invece solo questa migrazione mirata:

```sql
ALTER TABLE nh_runs
  MODIFY difficulty ENUM('easy','normal','hard','inferno') NOT NULL DEFAULT 'normal';
```

Se il database è antecedente anche alla v1.18.0 (streak giornaliero +
feedback), serve anche questa migrazione aggiuntiva:

```sql
ALTER TABLE nh_users
  ADD COLUMN current_streak   INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN longest_streak   INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN last_streak_date DATE NULL;

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
```

Se il database è antecedente anche alla v1.20.0 (rimozione nickname
automatico "Player1234" + indicatore online), serve infine questa
migrazione:

```sql
-- Il nickname può ora essere NULL (ospite che non ne ha ancora scelto
-- uno). L'indice UNIQUE esistente su nickname tratta automaticamente
-- più righe NULL come valori distinti tra loro (comportamento standard
-- MySQL), quindi nessuna collisione tra ospiti anonimi.
ALTER TABLE nh_users
  MODIFY nickname VARCHAR(32) NULL DEFAULT NULL,
  ADD COLUMN last_active_at DATETIME NULL,
  ADD INDEX idx_last_active (last_active_at);
```

⚠️ Chi aveva già utenti ospite con un nickname auto-generato "GuestXXXX"
da versioni precedenti alla v1.20.0 **non viene toccato retroattivamente**
da questa migrazione: quei nickname restano validi e quegli utenti
continuano a salvare le proprie run normalmente (la regola "niente
nickname = niente salvataggio" si applica solo a chi non ha *mai* avuto
un nickname, non a chi ce l'aveva già). Se vuoi anche "smontare"
retroattivamente quei vecchi nickname auto-generati per uniformare il
comportamento, dovresti prima decidere un criterio per riconoscerli
(es. pattern `Guest[0-9]{4}`) ed eseguire un `UPDATE` mirato — non
incluso qui perché rischioso da fare alla cieca senza verificare prima
i dati reali.

Se il database è antecedente anche alla v1.21.0 (sblocco armi/skin del
negozio finalmente collegato al gioco — prima veniva solo registrato
l'acquisto senza alcun effetto reale, vedi CHANGELOG.md per il
dettaglio), serve anche questa piccola correzione: la voce del
Flamethrower nel negozio era salvata con la chiave `weapon_flame`
mentre nel codice del gioco l'arma si chiama `flamethrower` — un
refuso che avrebbe comunque impedito lo sblocco di funzionare anche
dopo la correzione generale, se non sistemato:

```sql
UPDATE nh_shop_items SET effect_key = 'weapon_flamethrower' WHERE effect_key = 'weapon_flame';
```

Chi avesse già acquistato il Flamethrower con la chiave sbagliata prima
di questa correzione lo ritroverà correttamente sbloccato non appena
`nh_user_upgrades` viene riletto (l'acquisto stesso, collegato
all'`item_id` e non alla chiave testuale, non va perso da questa query
— cambia solo la chiave usata per interpretarlo in game).

Se il database è antecedente anche alla v1.27.0 (skin per le armi,
offerta del giorno, loadout di partenza, bundle scontati), serve anche
questa migrazione: aggiunge i nuovi tipi di oggetto e la colonna usata
dai bundle per elencare cosa contengono.

```sql
ALTER TABLE nh_shop_items
  MODIFY type ENUM('stat','weapon_unlock','skin','weapon_skin','bundle') NOT NULL,
  ADD COLUMN bundle_items JSON NULL;

INSERT INTO nh_shop_items (name, type, effect_key, effect_value, cost_gems, required_level, max_level, sort_order) VALUES
('Skin Arma: Laser Viola',    'weapon_skin', 'weaponskin_laser',  1, 120, 0, 1, 30),
('Skin Arma: Railgun Cremisi','weapon_skin', 'weaponskin_railgun',1, 150, 0, 1, 31),
('Skin Arma: Drone Dorato',   'weapon_skin', 'weaponskin_drone',  1, 150, 0, 1, 32);
```

⚠️ Per i due bundle ("Tutte le Skin" e "Arsenale Completo"), l'`INSERT`
esatto dipende dagli ID reali assegnati agli oggetti già presenti nel
tuo database (il campo `bundle_items` è un JSON di ID, es. `[11,12,13]`)
— **non copiare alla cieca** l'`INSERT` usato per un'installazione
pulita in `sql/schema.sql`, gli ID lì presuppongono l'ordine esatto di
inserimento di un database nuovo. Verifica prima gli ID reali con:

```sql
SELECT id, name, effect_key FROM nh_shop_items WHERE type IN ('skin','weapon_unlock') ORDER BY sort_order;
```

e poi costruisci l'`INSERT` dei bundle con quegli ID specifici.

Se il database è antecedente anche alla v1.33.0 ("Traguardi" a
progressione permanente, statistiche a vita, 6 skin esclusive), serve
questa migrazione aggiuntiva — crea le due nuove tabelle, le colonne
statistiche su `nh_users`, le 6 skin esclusive (mai acquistabili,
`active = 0`) e i 46 tier seminati. Copia l'intero blocco da
`CREATE TABLE nh_achievement_tiers` a `CREATE TABLE nh_user_achievements`
in `sql/schema.sql`, poi:

```sql
ALTER TABLE nh_users
  ADD COLUMN lifetime_kills          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN lifetime_runs           INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN lifetime_bosses_killed  INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN lifetime_damage_dealt   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN best_survival_sec       INT UNSIGNED NOT NULL DEFAULT 0;
```

⚠️ Come per i bundle sopra, l'`INSERT` delle 6 skin esclusive e dei 46
tier in `sql/schema.sql` presuppone gli ID di un database nuovo — se il
tuo ha già altre righe in `nh_shop_items`, verifica prima gli ID reali
con la stessa query di sopra e adatta sia l'`INSERT` delle skin sia i
`reward_shop_item_id` nell'`INSERT` di `nh_achievement_tiers` di
conseguenza. Le statistiche a vita partono da 0 per tutti gli utenti
esistenti (non c'è modo di ricostruirle retroattivamente dalle run
passate senza una migrazione dati dedicata, che non è inclusa qui) —
chi gioca da tempo dovrà macinare di nuovo i primi tier, cosa da tenere
presente se il gioco ha già una base di utenti attiva prima di questo
aggiornamento.

⚠️ **Se il database ha subito migrazioni manuali prima della v1.36.0**,
verifica che `nh_missions` non abbia righe con `id = 0`: un bug scoperto
in produzione ha fatto sì che 6 missioni aggiunte in un secondo momento
finissero tutte con lo stesso ID (0) invece di uno univoco, causando
"mission_id non valido" al riscatto — la colonna non era nemmeno una
chiave primaria/AUTO_INCREMENT su questa tabella specifica. Verifica con:

```sql
SELECT id, `key` FROM nh_missions WHERE id = 0;
```

Se la query restituisce righe, applica `mission_id_fix_v1350.sql`
(incluso in questo pacchetto): assegna ID univoci, blinda la colonna
con una vera chiave primaria per impedire che ricapiti, e ripulisce i
progressi ormai ambigui degli utenti coinvolti (le missioni sulle 6
originali e le statistiche a vita dei Traguardi non vengono toccate).
Lo script è già testato end-to-end contro un export reale prima di
essere incluso qui.

⚠️ **Se il database è antecedente alla v1.37.0**, applica anche
`sql/nickname_uniqueness_migration_v1370.sql` (incluso in questo
pacchetto): sostituisce il vincolo di unicità sul nickname, prima
applicato a TUTTI gli utenti, con uno applicato solo tra utenti
REGISTRATI — un ospite che sceglieva un nickname e poi provava a
registrarsi con lo stesso nome andava in conflitto con sé stesso
("nickname già in uso", bug segnalato più volte). Lo script è già
testato sia su schema nuovo sia su dati preesistenti prima di essere
incluso qui.

Se il tuo hosting ti permette comunque di creare utenti/privilegi
dedicati (es. VPS con accesso root a MySQL), puoi isolare ulteriormente
i permessi:

```sql
CREATE USER 'horde_user'@'localhost' IDENTIFIED BY 'una_password_forte';
GRANT SELECT, INSERT, UPDATE, DELETE ON sputlabc61682.* TO 'horde_user'@'localhost';
FLUSH PRIVILEGES;
```

Altrimenti usa direttamente l'utente MySQL già associato al database
(quello che usi per gli altri progetti, es. µDungeon) in `.env`.

⚠️ **Non vedi le armi/skin più recenti in negozio o in game?** Le armi
si sbloccano solo se acquistate (per design, come già Shotgun/Laser/
Flamethrower fin dall'inizio) — se il tuo database non ha ricevuto le
migrazioni delle versioni che le hanno introdotte (v1.25.0 per le 4
nuove armi, v1.26.0 per le 4 nuove skin, v1.27.0 per skin arma/bundle),
quegli oggetti semplicemente non esistono da comprare. Prima di
sospettare un bug, verifica con:

```sql
SELECT effect_key FROM nh_shop_items ORDER BY sort_order;
```

Se mancano voci tipo `weapon_boomerang`, `skin_pulsecore`,
`weaponskin_laser` ecc., cerca le migrazioni corrispondenti più sopra
in questa stessa sezione e applicale.

## 4. Configurazione

```bash
cp .env.example .env
# poi modifica .env con le credenziali reali (DB_HOST, DB_NAME, DB_USER, DB_PASS, APP_SECRET)
```

`APP_SECRET` deve essere una stringa lunga e casuale (es. `openssl rand -hex 32`).
Il file `.env` **non deve mai essere raggiungibile via browser**: il
`.htaccess` incluso lo blocca su Apache; su Nginx aggiungi (vedi sotto).

Se il frontend gira in una sotto-cartella diversa da `/`, aggiorna
`API_BASE` in `js/config.js` (es. `'/survivor-game/api'`).

## 5. Deployment — Apache + PHP-FPM

1. Copia l'intero progetto nella document root (es. `/var/www/neonhorde`).
2. VirtualHost minimo:

```apache
<VirtualHost *:443>
    ServerName giochi.tuodominio.it
    DocumentRoot /var/www/neonhorde

    <Directory /var/www/neonhorde>
        AllowOverride All
        Require all granted
    </Directory>

    <FilesMatch \.php$>
        SetHandler "proxy:unix:/run/php/php8.2-fpm.sock|fcgi://localhost"
    </FilesMatch>

    SSLEngine on
    SSLCertificateFile      /etc/letsencrypt/live/giochi.tuodominio.it/fullchain.pem
    SSLCertificateKeyFile   /etc/letsencrypt/live/giochi.tuodominio.it/privkey.pem
</VirtualHost>
```

3. Assicurati che `AllowOverride All` sia attivo per far rispettare il
   `.htaccess` incluso (protezione `.env`/`.sql`).
4. Ricarica Apache: `sudo systemctl reload apache2`.

## 6. Deployment — Nginx + PHP-FPM

```nginx
server {
    listen 443 ssl http2;
    server_name giochi.tuodominio.it;
    root /var/www/neonhorde;
    index index.html;

    ssl_certificate     /etc/letsencrypt/live/giochi.tuodominio.it/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/giochi.tuodominio.it/privkey.pem;

    location ~ \.(env|sql)$ {
        deny all;
    }

    location /api/ {
        try_files $uri =404;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
```

## 7. Note tecniche importanti

- **Autenticazione**: token opaco a 64 caratteri (`bin2hex(random_bytes(32))`)
  salvato in `session_tokens`, inviato come header `Authorization: Bearer <token>`.
  Nessuna dipendenza esterna (no librerie JWT): più semplice da mantenere
  su hosting condiviso, comunque robusto per un gioco di questo tipo.
- **Anti-cheat**: `run_tokens` monouso emesso da `/api/run/start.php` e
  consumato atomicamente (`FOR UPDATE`) in `/api/run/submit.php`, più
  soglie di plausibilità su kills/wave/score in funzione della durata.
  Non è a prova di reverse engineering avanzato, ma blocca bot/manomissioni
  banali del payload. Le soglie sono tarate con margine generoso sul ritmo
  reale del gioco (vedi i commenti in `submit.php`): se in futuro cambi il
  bilanciamento di spawn/danno in `js/config.js` o `js/spawner.js` in modo
  sostanziale, ricontrolla che le soglie lato server restino coerenti, o
  rischi di scartare run legittime (successo nella v1.5.0).
- **Performance client**: object pooling per proiettili/nemici/particelle/
  pickup (nessuna allocazione a runtime durante il gameplay) + spatial
  hashing a griglia per le collisioni proiettili↔nemici, per reggere
  200+ entità simultanee senza cali di frame rate su mobile.
- **Salvataggio**: la run corrente vive solo lato client; la sincronizzazione
  con il server avviene un'unica volta a fine run (`/api/run/submit.php`),
  come richiesto.
- **Audio**: interamente sintetizzato via Web Audio API (oscillatori +
  rumore filtrato), zero asset audio da scaricare. Il context viene
  sbloccato al primo input utente per rispettare le autoplay policy.
- **Rate limiting**: implementazione minimale basata su file in
  `sys_get_temp_dir()`. Per traffico più serio, sostituire `rate_limit()`
  in `api/config.php` con una soluzione basata su Redis/memcached.

## 8. Funzionalità principali del client (v1.37.1)

Per lo storico dettagliato versione per versione vedi **`CHANGELOG.md`**
(tenerlo aggiornato ad ogni release, incluso il changelog mostrato in-app
dal titolo di `game.html`, che va aggiornato manualmente lì insieme a
questo file — vedi anche la nota sulla copia separata in `index.html`
nella sezione 11 più sotto). Riepilogo delle funzionalità attualmente presenti:

- **Controlli mobile/desktop**: il player segue direttamente il dito
  (touch) o il puntatore del mouse (mouse), oltre a tastiera (WASD/frecce)
  e inclinazione del dispositivo (tilt, via `DeviceOrientationEvent`).
  Su iOS 13+ il tilt richiede un permesso esplicito, richiedibile dal
  menu Impostazioni quando quello schema è selezionato. Per touch/mouse
  è selezionabile anche la **velocità di movimento**: costante (sempre al
  massimo, si ferma solo esattamente sul puntatore) oppure proporzionale
  alla distanza dal player (0% a distanza 0, 100% da 220px in su —
  soglia in `CONFIG.POINTER_MAX_SPEED_DISTANCE`).
- **Posizione del player** in schermo, configurabile: in basso (classica,
  guarda verso l'alto) o esattamente al centro.
- **Menu Impostazioni**, raggiungibile dal titolo e dalla pausa
  (`js/settings.js`, persistito in `localStorage`): audio on/off, lingua,
  schema di controllo, velocità puntatore, posizione player, modalità
  Daltonici, Effetti Avanzati.
- **7 lingue** (IT/EN/ES/FR/DE/SL/RU) in `js/i18n.js`: traduzione di
  tutta l'interfaccia, inclusi nomi di armi/potenziamenti/boss e i
  messaggi di errore più comuni restituiti dal backend PHP. Il changelog
  mostrato in-app resta in italiano per scelta (contenuto principalmente
  di servizio per lo sviluppo, non tradotto nelle altre 6 lingue).
- **Modalità Daltonici**: palette alternativa blu/giallo/viola sia per
  il canvas di gioco (`CONFIG.COLORS_COLORBLIND` in `js/config.js`) sia
  per gli accenti dell'interfaccia HTML (classe `body.colorblind`).
- **Effetti Avanzati** (disattivabili): scia luminosa dietro al player,
  glow potenziato su player/boss, scia sui proiettili, vignetta rossa
  pulsante quando l'HP scende sotto il 30%.
- **Nickname per gli ospiti**: se non si è loggati con un account vero e
  non si è ancora scelto un nickname personalizzato, a fine partita
  compare un prompt per impostarlo (nuovo endpoint
  `POST /api/auth/set_nickname.php`) — necessario per comparire in modo
  riconoscibile in classifica invece che con un nome generato a caso.
- **Indicatore di stato account** nella schermata principale: mostra se
  si è connessi come ospite o con account registrato, e con quale nickname.
- **Sistema di potenziamenti progressivo**: ogni potenziamento (tranne il
  cambio arma) è livellabile fino a un massimo (`maxLevel` in
  `FIRE_MODES`/`PASSIVES`, `js/config.js`), mostrato in-game come "Lv. X/Y".
  Include 2 potenziamenti aggiuntivi: Colpo Critico e Vampirismo.
- **Changelog in-app** (link in basso a destra vicino alla versione):
  disponibile in italiano se la lingua impostata è italiano, in inglese
  per tutte le altre — non tradotto nelle altre 5 lingue per scelta,
  essendo contenuto principalmente di servizio.
- **Bilanciamento nel tempo**: nemici e boss diventano più forti man mano
  che la run prosegue (`Spawner.timeScaleMult` in `js/spawner.js`),
  sopra al moltiplicatore di difficoltà scelto a inizio partita — pensato
  per contrastare la crescita di potenza del player dovuta ai
  potenziamenti stackati, evitando che il gioco diventi banale dopo
  pochi minuti indipendentemente dalla difficoltà.
- **Nemici come triangoli** orientati verso il player invece di pallini,
  per una lettura più immediata della direzione di minaccia.
- **20 boss** (`BOSS_TYPES` in `js/config.js`, generati proceduralmente da
  un roster + formula di crescita): 19 regolari più un boss finale con
  tutti i pattern d'attacco e colore dinamico. Aspetto: anelli poligonali
  concentrici in rotazione (che si spezzano perdendo HP) con satelliti
  triangolari orbitanti, invece di un pallino colorato.
- **Bomba EMP**: potenziamento accumulabile fino a 2 cariche (scelta a
  level-up o pickup a terra) che azzera tutti i nemici regolari a
  schermo, inefficace sui boss per design. Attivabile con il tasto E
  (desktop) o dal pulsante dedicato nell'HUD (qualunque piattaforma).
- **Privacy Policy conforme al GDPR** (link nel footer del titolo e nella
  schermata Account): analizza i dati realmente raccolti dall'app
  (account, dati di gioco, token di sessione via localStorage, IP per
  anti-abuso, Google Fonts come unico servizio terzo, nessun cookie) e i
  diritti dell'interessato. Disponibile in italiano/inglese come il
  changelog in-app.
- **PWA installabile** su Android e iOS (`manifest.webmanifest` + `sw.js`
  nella root, icone in `icons/`): vedi sezione 11 più sotto per i
  dettagli di deployment.
- **Prompt di rotazione** su mobile, mostrato **solo subito prima di
  avviare una partita** (non nei menu, pensati per restare in
  verticale) — vedi `maybeWaitForRotate()` in `js/main.js`, richiamata
  da `startRun()`. **D-pad
  virtuale** come terzo schema di controllo mobile (a trascinamento,
  centro sempre ancorato al centro fisso del pad, configurabile per
  lato/dimensione) e **calibrazione dei sensori** di movimento con
  livella virtuale.
- **Nickname univoci** (non case-sensitive) a livello di database.
- **Proiettili homing con aggancio fisso al bersaglio** (`Game._resolveHomingTarget()`
  in `js/game.js`), invece di ricalcolare il nemico più vicino ogni
  frame — evita che oscillino senza mai colpire nulla quando i nemici
  sono in movimento. Tutti i proiettili hanno inoltre una **durata
  massima di vita** (`CONFIG.PROJECTILE_MAX_LIFETIME_SEC`, 3.5s), oltre
  la quale svaniscono in `CONFIG.PROJECTILE_FADE_DURATION_MS` (500ms)
  invece di poter restare in volo indefinitamente.
- **Controllo a inclinazione corretto per l'orientamento schermo**
  (`js/sensors.js`): i valori beta/gamma del sensore sono relativi al
  telaio fisico del dispositivo, non allo schermo — la calibrazione e la
  lettura in gioco vengono ora normalizzate rispetto all'orientamento
  corrente (`screen.orientation.angle`), altrimenti ruotare tra
  verticale e orizzontale tra calibrazione e partita invertiva gli assi.
- **Prompt nickname pre-partita** per gli ospiti senza nickname
  personalizzato (`maybeWaitForNickname()` in `js/main.js`), saltabile,
  con il prompt di fine partita già esistente come seconda occasione.
- **Colonna sonora procedurale** (`js/music.js`): 20 loop dark/hard
  techno (132-151 BPM, cassa in levare four-on-the-floor) + 20 loop
  drum'n'bass specifici dei boss (167-182 BPM, pattern sincopato stile
  breakbeat — mappatura 1-a-1 su indice), generati interamente via Web
  Audio API — nessun asset audio esterno, coerente con `js/audio.js`.
  Cambio automatico alla traccia del boss quando appare, ritorno morbido
  alla rotazione standard alla sua morte. Sezione **Audio** dedicata nel
  menu Impostazioni, con attivazione e volume separati per effetti
  sonori e musica.
- **4 difficoltà** (Facile/Normale/Difficile/Inferno): ognuna con il
  proprio ritmo di scaling temporale (`timeScaleRampSec`/
  `timeScaleMaxBonus` in `CONFIG.DIFFICULTY`, prima costanti globali
  uguali per tutte) e bonus diretti al player su Facile (HP/danno/
  rigenerazione, vedi `js/game.js`). Vedi CHANGELOG.md v1.17.0 per il
  criterio di taratura.
- **Classifica arricchita e separata per difficoltà** (`api/leaderboard.php`
  restituisce 4 liste distinte), con ondata/uccisioni/durata mostrati
  per ogni voce oltre al punteggio — sia nel gioco che sulla landing page.
- **Layout landscape** per tutte le schermate/modali (non l'HUD, già
  pensato per l'orizzontale): vedi il blocco
  `@media (orientation: landscape) and (max-height: 560px)` in fondo a
  `css/style.css`.
- **Streak giornaliero** (`current_streak`/`longest_streak`/
  `last_streak_date` su `nh_users`, logica in `api/run/submit.php`):
  bonus gemme crescente per i giorni consecutivi giocati, calcolato
  server-side con lock di riga per evitare race condition su submit
  multipli. Badge in titolo, riga dedicata nel riepilogo fine partita.
- **Card punteggio condivisibile** (`shareScoreCard()` in `js/main.js`):
  generata via Canvas 2D, nessun asset esterno — Web Share API su
  mobile, download PNG diretto come fallback.
- **Feedback rapido post-partita** (`api/feedback.php` + tabella
  `nh_feedback`): due pulsanti 👍/👎, collegati alla run specifica per
  poterli incrociare in futuro con ondata/difficoltà/durata.
- **Nessun nickname automatico per gli ospiti** (rimosso in v1.20.0): un
  ospite senza nickname personalizzato compare come "Ospite" (mai un
  nome fasullo tipo "Player1234") e la sua run **non viene salvata**
  (né in classifica, né gemme, né streak) — vedi il controllo in
  `api/run/submit.php` (`$isAnonymousGuest`). La classifica esclude
  quindi automaticamente gli ospiti anonimi senza bisogno di filtri
  aggiuntivi nella query, dato che le loro run non vengono proprio
  scritte in `nh_runs`.
- **Indicatore di presenza online** (`api/heartbeat.php` +
  `api/online_count.php`): il client invia un heartbeat leggero ogni 45s
  (solo a scheda visibile) per aggiornare `last_active_at`; il conteggio
  mostrato in schermata titolo somma gli utenti attivi negli ultimi 90s.
  Stima ragionevole, non un conteggio realtime esatto (nessun websocket).
- **Sblocco armi e skin del negozio finalmente collegato al gioco**
  (bug corretto in v1.21.0): prima l'acquisto veniva registrato ma
  nessun codice lo leggeva mai, quindi non aveva alcun effetto reale.
  Ora `player.unlockedWeapons` (`js/entities.js`) viene popolato da
  `metaBonuses.unlockedWeapons` in `Game.constructor`, e
  `upgrades.js:nextWeapon()` offre solo armi possedute (saltando quelle
  non sbloccate invece di bloccare la progressione). Le skin cambiano
  colore/aspetto del player in `Game._renderPlayer()`, selezionabili
  dalla nuova riga "Skin" in Impostazioni (visibile solo se se ne
  possiede almeno una).
- **Card punteggio condivisibile ingrandita** (v1.21.0): canvas
  aumentato a 1200x760, punteggio/statistiche/logo sensibilmente più
  grandi, nuova tagline promozionale in calce (tradotta in tutte le 7
  lingue, con andata a capo automatica) invece del piccolo credito
  testuale precedente.
- **Durata proiettili homing ridotta** (v1.22.0): 1.6s invece di 3.5s
  (dissolvenza di 500ms invariata), per evitare che l'autotracciamento
  combinato a danno alto "cacciasse" più nemici in sequenza per l'intera
  durata con un impegno minimo da parte del giocatore.
- **4 nuovi potenziamenti passivi** (v1.23.0): Spine Ritorsive (riflette
  danno subito ai nemici vicini), Secondo Fiato (sopravvivi a un colpo
  letale una volta a partita), Impulso Magnetico (richiama
  periodicamente i pickup), Campo Rallentante (rallenta i nemici vicini).
- **4 nuovi tipi di nemico** (v1.24.0): Divisore, Corazzato (scudo
  rotante che blocca l'85% dei colpi da un lato), Teletrasportatore,
  Evocatore — sbloccati progressivamente tra i 110 e i 200 secondi di run.
- **4 nuove armi** (v1.25.0): Boomerang (torna indietro colpendo di
  nuovo), Fulmine a Catena (salta al nemico più vicino non ancora
  colpito), Railgun (perforazione altissima), Drone Orbitale (satellite
  persistente invece di proiettili sparati in avanti).
- **4 nuove skin personaggio** (v1.26.0): Nucleo Pulsante (pulsa a tempo
  col BPM della colonna sonora), Sentinella (orbe orbitante decorativo),
  Sovraccarico (archi elettrici procedurali), Spettro (scia fantasma
  marcata, visibile anche a Effetti Avanzati disattivati).
- **Espansione del negozio** (v1.27.0): skin per le armi (Laser,
  Railgun, Drone — ricolorano i proiettili di quell'arma), offerta del
  giorno a rotazione deterministica (30% di sconto, stessa per tutti
  gli utenti, cambia ogni giorno), loadout di partenza personalizzabile
  tra le armi possedute, bundle scontati ("Tutte le Skin" -20%,
  "Arsenale Completo" -15%).
- **Ondate blindate ai boss + modalità infinita** (v1.28.0-v1.30.0): lo
  spawner smette di generare nemici regolari durante un combattimento
  boss (e spazza via quelli già presenti, per un vero duello 1-contro-1
  — v1.31.0), tutti i boss sparano davvero (corretto anche un bug che
  ne impediva l'attacco a distanza su schermi a 60Hz), e dopo il
  ventesimo il roster ricomincia con una crescita più dolce invece di
  fermarsi o esplodere in difficoltà.
- **"Traguardi": missioni a progressione permanente** (v1.33.0), affiancate
  alle missioni giornaliere esistenti: 6 categorie (uccisioni totali,
  run completate, sopravvivenza record, streak giornaliera, boss
  sconfitti, danno inflitto) su 46 tier complessivi, con 6 skin
  esclusive sbloccabili solo completandoli — mai acquistabili nel
  negozio. Vista "Prossimi" (un solo obiettivo per categoria) o
  "Panoramica" (quanti completati su quanti totali).
- **Impulso Magnetico unificato e potenziamenti ricalibrati** (v1.32.0):
  "Magnete" e "Impulso Magnetico" fusi in un solo passivo a 4 stage
  (corretto anche un bug per cui i pickup lontani potevano schizzare
  via invece di avvicinarsi), percentuali dei potenziamenti arrotondate
  e corrette dove non corrispondevano al valore reale applicato, e
  descrizioni ora sempre dinamiche (totale attuale, prossimo, massimo).
- **Corretto un bug importante nell'anti-cheat lato server** (v1.34.0):
  le run lunghe con boss di tier alto venivano rifiutate in blocco
  (niente punteggio, niente gemme) perché il controllo di plausibilità
  assumeva un tetto fisso di ~700 punti/boss, mentre il punteggio reale
  cresce per tier fino a ~1998 punti (tier 18) e 6000 per il boss
  finale — vedi `max_boss_score_for_kills()` in `api/run/submit.php`,
  che ora calcola il tetto reale in modo esatto invece di stimarlo.
  Corretto anche lo sfasamento delle gemme tra negozio e schermata
  principale dopo il riscatto di missioni/traguardi.
- **Ospiti e registrazione ripensati** (v1.35.0): un ospite che aveva
  già scelto un nickname può ora registrarsi con un account vero senza
  scontrarsi con "nickname già in uso" (era il proprio — la
  registrazione aggiorna l'account esistente invece di crearne uno
  nuovo, vedi `api/auth/register.php`); email già registrata da
  un altro account indirizza a "Password dimenticata" invece di un
  vicolo cieco. Missioni e Traguardi restano visibili anche da ospite,
  ma il riscatto richiede la registrazione (il pulsante mostra
  "Registrati per riscattare" invece di essere semplicemente
  nascosto). Rimosso il prompt nickname pre-partita (ridondante con
  quello di fine partita); nuovo invito "Salva i tuoi progressi con un
  account" a fine partita, con messaggio specifico se quella run è
  entrata in una posizione alta di classifica (vedi `leaderboard_rank`
  restituito da `api/run/submit.php`).
- **Correzioni di produzione e manuale** (v1.36.0): corretto un bug del
  database per cui 6 missioni giornaliere condividevano lo stesso ID,
  impedendo il riscatto di alcune (vedi `mission_id_fix_v1350.sql` e la
  nota di migrazione più sopra); la registrazione a fine partita ora
  avviene in un modale invece di lasciare la schermata di game over;
  aggiunto un manuale completo (15 sezioni, IT/EN) nella landing page.
- **Nickname protetto solo tra registrati, non più tra ospiti**
  (v1.37.0): corretto alla radice il bug per cui un ospite non poteva
  registrarsi col proprio stesso nickname (vedi
  `sql/nickname_uniqueness_migration_v1370.sql` e la nota di migrazione
  più sopra) — due ospiti possono ora avere lo stesso nome, ma un
  nickname è protetto per sempre una volta registrato. In caso di
  conflitto reale in fase di registrazione, il sistema propone in
  automatico una variante libera invece di un rifiuto secco. Nuovo
  modale informativo dopo "Gioca" per chi gioca da ospite (con opzione
  "non mostrare più"), e nuove funzionalità nella schermata Account:
  cambio nickname ed eliminazione definitiva dell'account (richiede la
  password corrente come conferma, vedi `api/account/delete.php`).
- **Corretta una falla residua nella protezione del nickname** (v1.37.1):
  il vincolo a livello di database introdotto in v1.37.0 protegge un
  utente registrato da un ALTRO registrato, ma per un ospite quella
  colonna generata resta sempre NULL qualunque nickname scelga — nessun
  controllo di unicità può mai scattare per fermarlo. Un ospite riusciva
  ancora a impostare un nickname già registrato da qualcun altro, sia
  dalla schermata di game over sia creando un nuovo ospite. Il controllo
  esplicito (già scritto per la registrazione) è stato spostato in una
  funzione condivisa (`api/config.php`) e applicato a ogni endpoint che
  permette di impostare un nickname da ospite.

## 9. Estendere il gioco

- Nuove armi: aggiungi una voce in `WEAPONS` (`js/config.js`) e, se va
  sbloccata permanentemente, una riga `weapon_unlock` in `shop_items`.
- Nuovi nemici: aggiungi una voce in `ENEMY_TYPES` e includila nella
  tabella pesata `_enemyWeights()` in `js/spawner.js`.
- Nuovi boss: aggiungi una voce in `BOSS_ROSTER` (`js/config.js`) con
  chiave e combinazione di `attacks` desiderata (`charge`, `fan_shot`,
  `summon`, `radial_burst` già implementati in `js/boss.js`) — hp/danno/
  velocità/raggio/punteggio vengono calcolati automaticamente dalla
  formula di crescita in base alla posizione nel roster; ricordati di
  aggiungere anche `boss.<chiave>` in `js/i18n.js` per tutte le 7 lingue
  (o almeno IT/EN con fallback automatico alle altre).
- Nuove missioni giornaliere: inserisci una riga in `missions` (tabella
  SQL); il progresso viene calcolato automaticamente in base alla
  `metric` scelta (`kills`, `duration_sec`, `bosses_killed`, `waves`,
  `runs_played`) — vedi `update_daily_missions()` in `api/run/submit.php`.
- Nuove traduzioni/lingue: aggiungi un blocco al dizionario `DICTS` in
  `js/i18n.js` e la relativa voce in `AVAILABLE_LANGUAGES`.

## 10. PWA (Progressive Web App)

Il gioco è installabile come app su Android e iOS direttamente dal
browser, senza passare da store.

### File coinvolti
- `manifest.webmanifest` — nome, icone, colori, modalità di visualizzazione.
- `sw.js` — Service Worker: cache dell'app shell (HTML/CSS/JS/icone) con
  strategia stale-while-revalidate; le chiamate API (`/api/...`) non
  vengono **mai** messe in cache, per restare sempre aggiornate.
- `icons/` — icone PNG pronte all'uso in tutte le taglie richieste, più
  `icons/src/*.svg` con i sorgenti vettoriali (modificabili e
  ri-rasterizzabili in futuro, es. con `rsvg-convert -w N -h N src.svg -o out.png`).
- `favicon.ico` — icona multi-risoluzione per la scheda del browser.
- Meta tag dedicati in `game.html` (`<head>`): link al manifest,
  `theme-color`, `apple-touch-icon` e i meta tag proprietari Apple
  (`apple-mobile-web-app-capable`, ecc. — Safari non legge il manifest
  per queste opzioni). La PWA installabile è il gioco (`game.html`), non
  la landing page (`index.html`): `start_url` nel manifest punta a
  `game.html` di proposito.

### Aggiornare la cache dopo un deploy
Ad ogni release, aggiorna **`CACHE_NAME`** in cima a `sw.js` (es.
`neon-horde-v1.9.0` → `neon-horde-v1.10.0`, in linea con `APP_VERSION`
in `js/config.js`): è il meccanismo con cui i dispositivi degli utenti
scartano la cache della versione precedente e scaricano quella nuova.
Se te ne dimentichi, gli utenti potrebbero continuare a vedere una
versione vecchia della UI/logica finché non forzano un refresh completo.

### Installazione lato utente
- **Android (Chrome)**: menu ⋮ → "Installa app" (o banner automatico se
  i criteri PWA di Chrome sono soddisfatti).
- **iOS (Safari)**: pulsante Condividi → "Aggiungi a Home".
  Safari supporta i Service Worker in modo più limitato rispetto a
  Chrome e non mostra un prompt di installazione automatico: l'utente
  deve sempre usare "Aggiungi a Home" manualmente.

### Non incluso (possibili estensioni future)
- Splash screen dedicate per ogni risoluzione di iPhone/iPad (Apple ne
  richiede circa 20 varianti per una copertura completa): al momento
  iOS genera una schermata di avvio basilare da icona + `theme-color`.
- Notifiche push, sincronizzazione in background, o altre API PWA più
  avanzate: non implementate, non necessarie per questo tipo di gioco.

## 11. Landing page

`index.html` è la landing page pubblica, separata dal gioco vero e
proprio (`game.html`): non fa parte della PWA installabile, non è nella
cache del Service Worker (quella è scoped su `game.html`). Pensata come
"porta d'ingresso" del sito, con link "GIOCA" che porta a `game.html`.

- **Immagine hero**: metti il file generato in `assets/hero.jpg` (vedi
  `assets/README.md` per le dimensioni consigliate e il prompt usato
  per generarla). Senza il file, la hero mostra comunque un gradiente
  scuro di fallback — la pagina resta presentabile anche prima di avere
  l'immagine definitiva.
- **Classifica**: il modale fa una fetch reale a `api/leaderboard.php`
  (stesso endpoint del gioco, nessuna autenticazione richiesta per la
  classifica globale) — se il backend non è ancora configurato/online,
  mostra un messaggio di errore invece di rompersi.
- **Changelog**: contenuto statico direttamente nell'HTML (non collegato
  dinamicamente a `CHANGELOG.md` né al changelog in-app di `game.html`):
  se aggiorni una versione del gioco, ricordati di aggiungere
  manualmente la voce anche qui se vuoi che compaia sulla landing page.
- **Sezione Supporto/Donazioni**: link a `https://www.sputlab.com/donate`,
  posizionata dopo la sezione descrittiva (prima ti presenta il gioco,
  poi chiede supporto) con motivazioni concrete e oneste (nessuna
  pubblicità, nessun pay-to-win, costi reali di hosting/sviluppo) invece
  di formule generiche.
- Riusa integralmente `css/style.css` (stesse variabili colore/font,
  stessi componenti `.btn`/`.modal-overlay`/`.leaderboard-list`): per
  cambiare la palette del gioco, quella della landing page si aggiorna
  automaticamente di conseguenza.
- **Bilingue IT/EN**: pulsante cambio lingua nella hero (in alto a
  destra), traduzione integrale di ogni sezione, del modale changelog
  (due blocchi statici IT/EN in `index.html`) e del modale classifica
  (titolo/loading/errore tradotti in `js/landing.js`). La lingua scelta
  qui è condivisa con il gioco tramite la stessa chiave di localStorage
  (`nh_settings`): resta impostata anche entrando in `game.html`. Il
  dizionario di traduzione vive interamente in `js/landing.js`
  (`DICTS`), separato dal sistema i18n del gioco (`js/i18n.js`) — se
  aggiungi testo alla landing page ricordati di tradurlo in entrambi i
  posti.
