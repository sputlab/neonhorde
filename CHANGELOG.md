# Changelog

Tutte le modifiche rilevanti al progetto sono documentate qui.

## [1.37.1]
### Corretto — importante
- **Falla residua nella protezione del nickname (v1.37.0 non bastava)**:
  un ospite riusciva ancora a impostare un nickname già usato da un
  account REGISTRATO, sia dalla schermata di game over sia creando un
  nuovo ospite con nickname personalizzato. Causa: il vincolo a livello
  di database introdotto in v1.37.0 (colonna generata
  `registered_nickname`) protegge un utente registrato da un ALTRO
  registrato, ma per un ospite quella colonna resta sempre NULL
  qualunque nickname scelga — nessun controllo di unicità può mai
  scattare per fermarlo. Il controllo esplicito che avevo aggiunto
  viveva solo dentro l'endpoint di registrazione, non nei punti dove un
  ospite sceglie o cambia nickname SENZA registrarsi. Spostato in una
  funzione condivisa (`api/config.php`) e applicato esplicitamente in
  OGNI punto che permette di impostare un nickname da ospite
  (`api/auth/set_nickname.php`, usato dalla schermata di game over, e
  la creazione diretta di un account ospite in
  `api/auth/register.php`). Verificato riproducendo esattamente lo
  scenario segnalato: un ospite non può più "rubare" un nickname già
  registrato da nessun punto del gioco, e riceve lo stesso suggerimento
  automatico di variante già introdotto per la registrazione.

## [1.37.0]
### Corretto
- **Bug alla radice: un ospite non riusciva a registrarsi con il
  proprio stesso nickname** ("nickname già in uso" su sé stesso).
  L'unicità del nickname ora si applica solo tra utenti REGISTRATI:
  due ospiti possono avere lo stesso nome senza alcun conflitto, e un
  nickname è protetto (mai duplicabile da nessuno) solo una volta che
  il suo proprietario si registra con email e password. Richiede una
  migrazione database (vedi `sql/nickname_uniqueness_migration_v1370.sql`,
  incluso in questo pacchetto).
- In fase di registrazione, se il nickname scelto è già di un account
  registrato diverso (caso raro ma possibile), il sistema propone in
  automatico la prima variante libera (es. "Sputnik2") invece di un
  semplice rifiuto — un clic la usa subito.

### Aggiunto
- **Modale informativo dopo "Gioca"** (solo per chi gioca da ospite,
  prima della scelta difficoltà): spiega perché conviene registrarsi
  per proteggere il proprio nickname e i propri progressi, con un link
  diretto alla registrazione e una casella "non mostrare più".
- **Cambio nickname** per gli utenti registrati, dalla schermata Account.
- **Eliminazione account** dalla schermata Account: cancellazione
  definitiva e irreversibile (nickname, gemme, run, missioni e
  traguardi), richiede di reinserire la password corrente come
  ulteriore conferma.

## [1.36.0]
### Corretto
- **Bug importante nel database: 6 missioni giornaliere condividevano
  lo stesso ID (0)** invece di averne uno univoco, causando "mission_id
  non valido" al tentativo di riscatto (es. "Sconfiggi un boss") mentre
  le missioni originali funzionavano normalmente. La colonna `id` di
  `nh_missions` non era nemmeno una chiave primaria/AUTO_INCREMENT su
  questa tabella specifica — unica tra tutte quelle del gioco. Fornito
  uno script SQL di correzione (`mission_id_fix_v1350.sql`, incluso in
  questo pacchetto) che assegna ID univoci, blinda la colonna con una
  vera chiave primaria per impedire che ricapiti, e ripulisce i
  progressi ormai ambigui di 14 record/12 utenti coinvolti (le cui
  missioni sulle 6 ORIGINALI e le statistiche a vita dei Traguardi
  restano completamente intatte).
- **La registrazione a fine partita portava via dalla schermata di
  game over**, dando la sensazione di perdere il recap della run
  appena giocata. Sostituita con un modale che resta sopra la
  schermata attuale: stesso account già in uso (nickname, gemme e
  progressi invariati, come già garantito dal fix della v1.35.0), si
  aggiungono solo email e password, restando collegati per continuare
  subito a giocare.

### Aggiunto
- **Manuale completo nella landing page**: 15 sezioni (gameplay, armi,
  modalità di tiro, passivi, nemici, boss, bomba EMP, difficoltà,
  negozio, missioni, traguardi, account, classifica, impostazioni) in
  un modale con indice cliccabile, disponibile in italiano e inglese,
  apribile sia dall'header sia dal footer della landing page.

## [1.35.0]
### Corretto
- **Un ospite che aveva già scelto un nickname non riusciva a
  registrarsi con un account vero**: riceveva "nickname già in uso" —
  letteralmente il proprio nickname, mai davvero preso da nessun altro.
  La registrazione ora aggiorna l'account ospite esistente invece di
  crearne uno nuovo (stesso ID, stesso nickname, stesse gemme e
  progressi, si aggiungono solo email e password). Se l'email scelta è
  già di un altro account, il messaggio ora indirizza a "Password
  dimenticata" per accedere a quell'account, invece di un vicolo cieco.

### Aggiunto
- **Un ospite può visualizzare missioni e Traguardi anche senza
  registrarsi**, ma il pulsante "Riscatta" resta bloccato: un clic
  mostra "Registrati per riscattare" invece di incassare la ricompensa
  — il valore da perdere resta visibile e concreto, invece di un
  accesso negato in anticipo.
- **Rimosso il prompt nickname prima della partita**: chiederlo sia
  prima sia dopo era ridondante. Resta solo quello a fine partita,
  quando il giocatore ha già visto il proprio risultato ed è più
  motivato a salvarlo con un nome.
- **Nuovo invito "Salva i tuoi progressi con un account"** nella
  schermata di fine partita, per chi gioca ancora da ospite — se quella
  run è entrata in una posizione alta di classifica (top 50), il
  messaggio diventa specifico ("Sei #N in classifica!") invece che
  generico, nel momento in cui la spinta a non perdere il risultato è
  più forte.

## [1.34.0]
### Corretto — importante
- **Run lunghe e riuscite venivano rifiutate in blocco, senza assegnare
  né punteggio né gemme.** Analizzando un dump reale del database:
  il 34% dei token di run non risultava mai andato a buon fine, tutti
  vecchi di ore/giorni (non partite ancora in corso). Causa: il
  controllo anti-cheat sul punteggio assumeva un massimo di ~700 punti
  per boss sconfitto, ma il punteggio reale di un boss cresce per tier
  fino a ~1998 punti (boss di tier 18) e il boss finale vale 6000 punti
  fissi — fino a 9 volte il presunto massimo. Con la modalità infinita
  introdotta in precedenza, i boss oltre il ventesimo crescono
  ulteriormente. Qualunque giocatore abbastanza bravo o paziente da
  affrontare boss di livello alto otteneva un punteggio reale
  "impossibile" secondo il vecchio controllo, e si vedeva rifiutare
  l'intera run. Il punteggio massimo dei boss ora si calcola in modo
  esatto (non stimato), replicando fedelmente la stessa formula di
  crescita usata in game. Rimosso anche un moltiplicatore di difficoltà
  applicato per errore al controllo sul punteggio (il punteggio reale
  non scala con la difficoltà, a differenza delle gemme guadagnate) che
  penalizzava ulteriormente proprio la difficoltà Facile. Verificato
  con test end-to-end reali: uno scenario di gioco realistico prima
  rifiutato ora viene accettato, mentre un tentativo di punteggio
  falsificato viene ancora correttamente respinto.
- **Le gemme mostrate in schermata principale potevano differire da
  quelle mostrate nel negozio** dopo aver riscattato una missione
  giornaliera o un Traguardo: il riscatto aggiornava correttamente le
  gemme sul server, ma non la copia locale usata per il numero in
  schermata principale (il negozio invece rilegge sempre il valore dal
  server, quindi mostrava subito quello corretto). Corretto allineando
  questi due flussi allo stesso comportamento già usato — correttamente
  — da fine partita e acquisti nel negozio.

## [1.33.0]
### Aggiunto
- **"Traguardi": missioni a progressione permanente**, mai resettate a
  differenza delle missioni giornaliere già esistenti (che restano
  invariate) — nuovo terzo tab nella schermata Missioni, con due viste:
  "Prossimi" (un solo obiettivo per categoria, quello ancora da
  completare) e "Panoramica" (quanti traguardi completati su quanti
  totali, per categoria).
- **6 categorie, 46 traguardi totali**: Uccisioni Totali, Run
  Completate, Sopravvivenza Record (miglior singola run), Streak
  Giornaliera, Boss Sconfitti, Danno Inflitto — quest'ultime due
  aggiunte su richiesta esplicita, oltre alle 4 proposte inizialmente.
- **6 skin esclusive**, sbloccabili solo raggiungendo un traguardo alto
  in ciascuna categoria (mai acquistabili nel negozio): Macellaio,
  Veterano, Immortale, Devoto, Cacciatore, Distruttore.
- **Nuove statistiche a vita** tracciate per ogni utente: uccisioni
  totali, run completate, boss sconfitti, danno totale inflitto,
  record di sopravvivenza in una singola run (lo streak riusa il
  "longest_streak" già esistente).

## [1.32.0]
### Corretto
- **Bug reale nell'Impulso Magnetico** (soprattutto visibile su desktop,
  dove la visuale ampia rende più probabile lo scenario): la formula
  che calcola la velocità di richiamo di un pickup non considerava che
  un oggetto marcato "da attrarre" potesse trovarsi più lontano del
  raggio base — in quel caso il calcolo produceva una velocità
  **negativa**, spingendo il pickup ad allontanarsi ad alta velocità
  fuori schermo invece di avvicinarsi. Corretto alla radice.
- **Tre potenziamenti mostravano una percentuale diversa da quella
  realmente applicata**: Potenza di fuoco e Cadenza di tiro mostravano
  "+12%" ma applicavano +8%; Magnete mostrava "+30%" ma applicava +20%.

### Cambiato
- **"Magnete" e "Impulso Magnetico" unificati in un solo passivo a 4
  stage** (erano concettualmente la stessa cosa — "i pickup arrivano da
  più lontano" — con curve diverse, risultavano ridondanti se
  comparivano entrambi come scelta nella stessa run). Raggio e velocità
  di richiamo crescono per stage; un cerchio tenue attorno al player ne
  mostra i confini fino allo stage 3, sostituito da un bagliore
  pulsante e discreto ai bordi dello schermo allo stage 4 (raggio ormai
  più ampio dell'intero schermo).
- **Valori dei potenziamenti a percentuale arrotondati** a multipli di
  5: Potenza di fuoco/Cadenza di tiro/Spine Ritorsive 8%→10%, Campo
  Rallentante 12%→15%, Vampirismo 3%→5%.
- **Descrizioni dei potenziamenti ora dinamiche**: ogni carta di scelta
  mostra il totale attuale, il totale che si otterrebbe scegliendola, e
  il massimo raggiungibile — calcolati sempre dalla stessa formula
  realmente applicata in game, non più testo statico che rischiava di
  disallinearsi (come nel bug corretto sopra).

## [1.31.0]
### Corretto
- **Bug audio su iOS**: dopo che il telefono andava in standby o si
  cambiava app durante una partita, musica ed effetti sonori restavano
  muti al ritorno sul gioco. Causa: iOS sospende forzatamente
  l'AudioContext quando l'app va in background e non lo riprende da
  solo al ritorno — mancava un listener che lo riattivasse. Aggiunto.
- **`settings.starting_weapon` mostrato come chiave grezza** invece
  dell'etichetta tradotta nella schermata Impostazioni: la traduzione
  non era mai stata aggiunta quando è stato introdotto il selettore
  dell'arma di partenza (v1.27.0). Corretto in tutte le 7 lingue.

### Aggiunto
- **Musica di sottofondo già dal menu principale**, non solo in
  partita: si avvia alla prima interazione dell'utente (i browser
  bloccano l'audio automatico senza un gesto dell'utente).
- **"Vero duello" contro i boss**: quando un boss appare, i nemici
  regolari già presenti (e i loro proiettili ancora in volo) vengono
  spazzati via per lasciare spazio al combattimento 1-contro-1, invece
  di sommarsi al boss stesso — non contano come uccisioni né droppano
  ricompense, è una pulizia dell'arena. Risolve situazioni in cui
  un'orda già numerosa, combinata al boss, diventava ingestibile anche
  con una build forte.
- **6 nuove missioni giornaliere** (dodici in totale, prima erano sei),
  inclusi due obiettivi sull'ondata raggiunta (metrica mai usata finora)
  e traguardi più impegnativi per chi completa in fretta quelle
  esistenti. Corretto anche un bug latente: senza fix, un obiettivo
  "raggiungi l'ondata X" avrebbe sommato le ondate di run diverse
  invece di guardare il massimo ottenuto in una singola run.
- **Missioni completate archiviate in un tab separato** ("Attive" /
  "Completate") invece di restare mescolate con quelle in corso una
  volta riscattate.

## [1.30.0]
### Corretto
- **La barra HP e il nome del boss restavano visibili dopo la sua
  sconfitta**, fino alla comparsa del boss successivo (percepibile come
  "il nome del prossimo boss appare troppo presto"): mancava del tutto
  la chiamata che nasconde la barra. Corretto sia per la sconfitta
  normale del boss sia per il caso in cui la run termini (morte o
  uscita) mentre un boss è ancora vivo, mai sconfitto — senza questo
  secondo fix, la run successiva sarebbe potuta partire con la barra
  "sporca" del boss abbandonato.

### Aggiunto
- **Modalità infinita dopo il ventesimo boss**: invece di continuare a
  spawnare boss identici all'ultimo (anticlimatico) o di far esplodere
  la difficoltà boss dopo boss all'infinito (alla lunga ingiusto), il
  roster ricomincia dal primo ma con una crescita aggiuntiva "per giro
  completo" — molto più dolce di quella già presente boss per boss
  all'interno di un singolo giro. I boss ripetuti mostrano un marcatore
  "✦N" accanto al nome per rendere chiaro perché risultano più tosto
  della prima volta.

## [1.29.0]
### Corretto
- **Bug importante: `fan_shot`/`summon`/`radial_burst` dei boss non
  scattavano quasi mai in pratica su un display standard a 60Hz.** Il
  codice controllava `stateMs < 10` (millisecondi) per capire se
  eseguire l'attacco una sola volta all'ingresso dello stato — ma a
  60Hz un singolo frame dura ~16.7ms, quindi quella finestra non si
  apriva quasi mai. Sostituito con un flag dedicato (`attackFired`),
  robusto rispetto a qualunque durata di frame. Verificato che il bug
  si riproducesse con un dt realistico prima della correzione, e che
  sparisse dopo.
- **7 boss su 19 non avevano affatto `fan_shot`** nel proprio elenco di
  attacchi (brute, wraith, colossus, warden, behemoth, tyrant,
  devourer): si limitavano a caricare e/o evocare, mai a sparare.
  Aggiunto `fan_shot` al repertorio di tutti i boss, che restano
  comunque distinti tra loro per gli altri attacchi posseduti.

### Aggiunto
- **Difficoltà d'attacco calibrata per tier**: i boss più tardivi (fino
  al finale) attaccano fino al 40% più di frequente e con un tempo di
  preavviso ("telegraph") più corto rispetto al primo — mai sotto una
  soglia di leggibilità comunque. Prima la frequenza d'attacco era
  identica per tutti i boss, cambiavano solo HP e danno.

## [1.28.0]
### Ribilanciato
- **Ondate "blindate" durante i combattimenti contro i boss**: quando
  un boss è vivo, lo spawner smette di generare nuovi nemici regolari
  (quelli già presenti restano, semplicemente non se ne aggiungono
  altri) — prima continuavano ad accumularsi sopra il boss stesso fino
  al tetto massimo di 220 nemici contemporanei, rendendo il
  combattimento ingestibile anche con le bombe. Lo spawn riprende
  normalmente non appena il boss viene sconfitto.
- **Corretto il timer del prossimo boss**: prima continuava a scorrere
  anche durante un combattimento boss già in corso (la richiesta
  veniva scartata silenziosamente, ma il conteggio verso il boss
  successivo era comunque ripartito da quel momento) — risultato,
  l'intervallo reale tra un boss e il successivo poteva risultare più
  corto del previsto se un combattimento si protraeva a lungo. Ora il
  conto alla rovescia resta in pausa finché il boss attuale non viene
  sconfitto.

## [1.27.0]
### Aggiunto
- **4 nuove funzionalità del negozio** (quinto e ultimo blocco delle 20
  proposte di espansione):
  - **Skin per le armi** — 3 varianti di colore acquistabili per Laser,
    Railgun e Drone Orbitale, applicate automaticamente ai proiettili
    quando l'arma corrispondente è equipaggiata (nessuna scelta
    necessaria: una sola variante per arma).
  - **Offerta del giorno** — un oggetto sbloccabile (arma, skin o skin
    arma) scontato del 30%, scelto in modo deterministico dalla data
    odierna: uguale per tutti gli utenti, stabile per l'intera giornata,
    cambia il giorno successivo. Nessuna tabella dedicata necessaria.
  - **Loadout di partenza** — possibilità di iniziare una run con
    un'arma diversa dalla pistola, tra quelle già sbloccate (nuovo
    selettore in Impostazioni).
  - **Bundle scontati** — "Tutte le Skin" (-20%) e "Arsenale Completo"
    (-15%), acquisto singolo che garantisce il possesso di tutti gli
    oggetti inclusi in un'unica transazione.
- **Corretto un refuso trascurato**: la voce del Flamethrower nel
  negozio era stata rinominata da `weapon_flame` a `weapon_flamethrower`
  nel database in v1.21.0, ma le traduzioni in `js/i18n.js` non erano
  mai state aggiornate di conseguenza — l'oggetto ricadeva silenziosamente
  sul nome italiano in ogni lingua. Corretto insieme al resto.

## [1.26.0]
### Aggiunto
- **4 nuove skin** (quarto di più blocchi di espansione contenuti — una
  nuova funzionalità del negozio nella prossima versione), tutte con un
  effetto distintivo oltre al semplice colore diverso, come le già
  esistenti Ninja/Robot:
  - **Nucleo Pulsante** — il player pulsa (raggio e bagliore) a tempo
    con il BPM della traccia musicale attualmente in riproduzione.
    Richiesto esporre il BPM corrente da `js/music.js`, prima non
    accessibile dall'esterno del modulo.
  - **Sentinella** — un piccolo orbe decorativo orbita di continuo
    attorno al player, collegato da una linea sottile. Puramente
    estetico, distinto intenzionalmente dal Drone Orbitale (l'arma
    introdotta in v1.25.0, che ha un effetto di gioco reale).
  - **Sovraccarico** — archi elettrici procedurali che scoccano a
    intervalli brevi e irregolari attorno al corpo.
  - **Spettro** — scia fantasma marcata che segue il player: riusa e
    potenzia l'infrastruttura già esistente della scia di "Effetti
    Avanzati" (più lunga, più intensa, colore diverso), resa visibile
    per questa skin anche quando Effetti Avanzati è disattivato.

## [1.25.0]
### Aggiunto
- **4 nuove armi** (terzo di più blocchi di espansione contenuti —
  skin aggiuntive e nuove funzionalità del negozio nelle prossime
  versioni), sbloccabili dal negozio come le esistenti Shotgun/Laser/
  Flamethrower:
  - **Boomerang** — esce, poi torna indietro colpendo di nuovo lungo il
    percorso di ritorno (fino al doppio dei bersagli di un colpo
    normale, in due passaggi).
  - **Fulmine a Catena** — dopo ogni impatto salta al nemico non ancora
    colpito più vicino invece di proseguire in linea retta, ottimo
    contro gruppi.
  - **Railgun** — perforazione altissima (attraversa praticamente
    qualunque fila di nemici) ma cadenza di tiro molto lenta.
  - **Drone Orbitale** — non spara in avanti: un satellite orbita di
    continuo attorno al player, colpendo chi vi passa vicino. La
    velocità di rotazione scala con la cadenza di tiro posseduta, così
    il passivo "Cadenza di Tiro" resta utile anche con quest'arma.

## [1.24.0]
### Aggiunto
- **4 nuovi tipi di nemico** (secondo di più blocchi di espansione
  contenuti — armi e skin aggiuntive nelle prossime versioni), sbloccati
  progressivamente tra i 110 e i 200 secondi di run, dal più semplice al
  più complesso:
  - **Divisore** — alla morte si divide in 2 copie più piccole e deboli,
    che a loro volta non si dividono ulteriormente.
  - **Corazzato** — ha uno scudo che copre solo un arco (~109°) e ruota
    nel tempo: i colpi che arrivano da quel lato vengono ridotti
    dell'85%, serve fiancheggiarlo dal lato scoperto per danneggiarlo
    efficacemente.
  - **Teletrasportatore** — si sposta periodicamente vicino al player a
    distanza controllata, con un anello visivo che segnala il salto.
  - **Evocatore** — mantiene le distanze come i nemici a distanza e
    genera periodicamente un minion, con un anello pulsante che
    telegrafa in anticipo la prossima evocazione.
  - 4 nuovi colori distinti aggiunti a entrambe le palette (normale e
    Daltonici).

## [1.23.0]
### Aggiunto
- **4 nuovi potenziamenti passivi** (primo di più blocchi di espansione
  contenuti — armi, nemici e skin aggiuntive nelle prossime versioni):
  - **Spine Ritorsive** 🌵 — riflette una parte del danno effettivamente
    subito (non quello assorbito da scudo/invulnerabilità) come danno
    ad area ai nemici entro un raggio fisso dal player.
  - **Secondo Fiato** 💫 — sopravvivi a un colpo altrimenti letale con
    1 HP, una volta per partita (si riattiva solo alla run successiva).
  - **Impulso Magnetico** 🌀 — richiama periodicamente tutti i pickup
    sullo schermo verso il player (intervallo da 15s a 5s scalando col
    livello), indipendente dal raggio di raccolta passivo già esistente.
  - **Campo Rallentante** ❄️ — aura passiva che rallenta i nemici entro
    un raggio fisso dal player, crescente in intensità col livello.

## [1.22.0]
### Ribilanciato
- **Durata dei proiettili homing ridotta** (da 3.5s a 1.6s, dissolvenza
  di 500ms invariata per tutti): i proiettili homing, agganciati a un
  bersaglio fisso e capaci di virare aggressivamente verso di esso,
  restando in vita quanto un proiettile normale potevano "cacciare" più
  nemici in sequenza per l'intera durata (specialmente con la
  perforazione), diventando efficaci quasi da soli con un impegno
  minimo da parte del giocatore — soprattutto a potenza di danno già
  alta. I proiettili non-homing mantengono la durata di 3.5s invariata.

## [1.21.0]
### Corretto
- **Bug importante: gli acquisti del negozio (armi e skin) non avevano
  alcun effetto reale in partita.** L'acquisto veniva registrato
  correttamente (gemme scalate, riga salvata nel database), ma nessun
  codice leggeva mai quei dati per cambiare qualcosa durante il gioco:
  - le armi seguivano un ordine di sblocco fisso e identico per tutti,
    scollegato da cosa si era effettivamente comprato nel negozio;
  - non esisteva alcun codice che applicasse una skin all'aspetto del
    personaggio, che restava sempre identico a prescindere da cosa si
    possedeva.
  
  Corretto su entrambi i fronti: `player.unlockedWeapons` viene ora
  popolato dagli acquisti reali e la progressione delle armi in partita
  offre solo quelle possedute (saltando le altre invece di bloccarsi);
  le skin cambiano davvero colore/aspetto del personaggio, selezionabili
  da una nuova riga "Skin" in Impostazioni (mostrata solo se se ne
  possiede almeno una). Corretto anche un refuso collegato: il
  Flamethrower era salvato nel negozio con la chiave `weapon_flame`
  invece di `weapon_flamethrower`, che avrebbe comunque impedito il suo
  sblocco di funzionare anche dopo la correzione generale.

### Migliorato
- **Card punteggio condivisibile ingrandita**: canvas più grande
  (1200x760), punteggio/statistiche/logo sensibilmente più leggibili
  senza dover zoomare, e una nuova tagline promozionale in calce
  ("Migliaia di nemici. Un solo sopravvissuto...") al posto del piccolo
  credito testuale precedente — tradotta in tutte le 7 lingue, con
  andata a capo automatica per adattarsi alla lunghezza variabile del
  testo tradotto.

## [1.20.0]
### Modificato
- **Rimossa completamente la generazione automatica di nickname per gli
  ospiti** (tipo "Player1234"). Causa del problema alla radice, non solo
  lato server: il client generava esplicitamente il nome casuale e lo
  inviava come se l'utente lo avesse scelto — corretto anche quello, non
  solo il fallback lato server che l'aveva introdotto. Un ospite che non
  imposta un nickname personalizzato ora:
  - compare in schermata come "Ospite" (nessun nome fasullo);
  - **non ha la propria run salvata** (né in classifica, né gemme
    guadagnate, né streak) — evita di intasare il database di run
    anonime indistinguibili tra loro e di confondere la classifica, che
    ora esclude automaticamente gli ospiti anonimi senza bisogno di
    filtri aggiuntivi nella query (le loro run non vengono proprio
    scritte). Chi registra un account vero o imposta un nickname da
    ospite continua a funzionare esattamente come prima.
  - I testi dei prompt nickname (pre e post partita) sono stati
    rafforzati in tutte le 7 lingue per spiegare la posta in gioco reale
    ("senza un nickname la partita non viene salvata", non solo "non
    compari in classifica" come prima).
- **Schermata titolo**: i badge di gemme e streak giornaliero ora sulla
  stessa riga invece che impilati.
- **Landing page**: rimossi i link a Changelog/Classifica/Contatti dalla
  barra di navigazione in alto (restano raggiungibili dal footer);
  resta solo il logo a sinistra e il selettore lingua a destra.
- **Bagliore pulsante** sui pulsanti "GIOCA ORA" e "SOSTIENI IL
  PROGETTO" della landing page, per attirare l'attenzione senza
  risultare invasivo (rispetta `prefers-reduced-motion`).

### Aggiunto
- **Indicatore di presenza online** in schermata titolo (pallino verde
  pulsante + conteggio): il client invia un heartbeat leggero ogni 45
  secondi (solo mentre la scheda è visibile, per non sprecare richieste
  inutili) verso il nuovo endpoint `api/heartbeat.php`; un nuovo
  endpoint pubblico `api/online_count.php` conta quanti utenti risultano
  attivi negli ultimi 90 secondi. Non è un conteggio realtime esatto
  (nessun websocket), ma una stima ragionevole senza bisogno di
  infrastruttura aggiuntiva.

## [1.19.0]
### Modificato
- **Ristrutturazione completa della schermata Game Over**, con priorità
  assoluta all'orizzontale mobile (obiettivo: nessuno scroll nemmeno su
  iPhone 12 Mini in landscape — verificato anche su un caso ancora più
  estremo, 320px di altezza):
  - Titolo "SISTEMA COMPROMESSO" più grande e in grassetto.
  - Riepilogo esteso a **5 riquadri** (Ondata, Nemici uccisi,
    **Punteggio**, Sopravvissuto, **Gemme** — nuovo, con prefisso "+").
    Il punteggio è ora l'elemento con più risalto: centrato, riquadro
    più grande, numero maggiore e in grassetto con bagliore.
  - Rimosso il testo viola informativo sotto i riquadri (assorbito dal
    nuovo riquadro Gemme).
  - Nickname: campo di inserimento e pulsante "Salva" ora sulla stessa
    riga invece che impilati.
  - Streak, mini sondaggio di gradimento e condivisione riuniti in
    un'unica riga compatta; il pulsante di condivisione ora usa solo
    l'icona, senza testo, per ridurre l'ingombro.
  - "Rigioca" e "Menu" ora affiancati sulla stessa riga.
  - In verticale il punteggio diventa un riquadro "hero" a piena
    larghezza in cima, con gli altri 4 in una griglia 2x2 sotto — stessa
    gerarchia visiva del landscape, adattata allo spazio disponibile.
    Su desktop si riusa lo stesso layout a riga singola del landscape
    mobile, essendoci spazio a sufficienza.

### Corretto
- L'`aria-label` del pulsante di condivisione riusava la chiave di
  traduzione del vecchio testo visibile (con emoji inclusa): uno screen
  reader avrebbe letto "📤 SHARE" invece di un'etichetta pulita. Aggiunta
  una chiave dedicata, tradotta in tutte le 7 lingue.

## [1.18.1]
### Modificato
- **Riepilogo fine partita su desktop**: i 4 riquadri (ondata, nemici
  uccisi, sopravvissuto, punteggio) ora stanno su un'unica riga anche su
  desktop (prima erano una griglia 2x2 lì, il layout su una riga era
  finora riservato al landscape mobile).
- **Titolo di fine partita**: da "SEI CADUTO" a **"SISTEMA COMPROMESSO"**,
  con un nuovo sottotitolo **"Segnale perso"** — tradotto in tutte le 7
  lingue.

## [1.18.0]
### Corretto
- **Testo illeggibile nelle card di scelta potenziamento** ("1 di 3"):
  erano elementi `<button>` senza `color` esplicito, quindi su alcuni
  browser desktop ricadevano sul nero di default del sistema invece di
  ereditare il tema chiaro del gioco. Aggiunto anche un bagliore bianco
  dietro le icone, leggibile indipendentemente dal colore intrinseco
  del glifo emoji (alcune rendono scure/nere su certi sistemi).
- **Bug preesistente scoperto durante questo lavoro**: il numero di
  gemme mostrato in schermata titolo non veniva mai risincronizzato
  dopo una run (solo dopo un acquisto in negozio, unico altro punto che
  lo aggiornava) — corretto insieme all'integrazione dello streak.

### Aggiunto
- **Streak giornaliero**: bonus gemme crescente (+1/giorno, fino a un
  tetto di +10) per i giorni consecutivi in cui si gioca almeno una run.
  Badge nella schermata titolo, riga dedicata nel riepilogo di fine
  partita quando il bonus viene guadagnato. Si resetta se si salta un
  giorno intero.
- **Card punteggio condivisibile**: a fine partita, un pulsante genera
  un'immagine (Canvas 2D, nessun asset esterno) con punteggio, ondata,
  uccisioni, durata e difficoltà, in linea con lo stile visivo del
  gioco. Su mobile usa la Web Share API per condividere direttamente
  verso altre app; altrove scarica il PNG.
- **Feedback rapido post-partita**: due pulsanti 👍/👎 non invasivi a
  fine partita, collegati a un nuovo endpoint (`api/feedback.php` +
  tabella `nh_feedback`) che registra anche a quale run specifica si
  riferisce il feedback, per poterlo incrociare in futuro con
  ondata/difficoltà/durata.

## [1.17.0]
### Aggiunto
- **Nuova difficoltà "Facile"**: il gioco risultava troppo punitivo già
  nelle prime ondate. Su Facile i nemici sono più deboli (HP/danno/
  velocità spawn ridotti), il player parte con +40 HP, +30% danno e
  rigenerazione base (+0.4 HP/s, prima assente di default), e lo
  scaling di difficoltà nel tempo è disteso su 700s invece di 320s —
  tarato perché la difficoltà percepita all'ondata 20 sia paragonabile
  a quella dell'ondata 10 su Normale (verificato numericamente: il
  moltiplicatore di scaling coincide esattamente). "Normale" ammorbidito
  anch'esso; "Difficile" e "Inferno" restano invariati per chi cerca più
  sfida. Lo scaling temporale e il ritmo di spawn, prima costanti
  globali uguali per tutte le difficoltà, sono ora specifici per
  ciascuna (`js/spawner.js`).
- **Classifica arricchita**: ogni voce mostra ora ondata raggiunta,
  nemici uccisi e durata della partita, non solo il punteggio.
  **Classifiche globali separate per difficoltà** (Facile/Normale/
  Difficile/Inferno, tramite tab dedicati): confrontare punteggi tra
  difficoltà con moltiplicatori diversi non avrebbe avuto senso.
  Implementato sia nel gioco che sulla landing page.
- **Layout landscape per menu, schermate e modali** (tutto tranne l'HUD
  in-partita, già pensato per l'orizzontale): schermata titolo con logo
  e menu affiancati invece che impilati, griglia difficoltà in riga,
  liste (impostazioni/negozio/missioni/classifica) più larghe e meno
  alte, riepilogo fine partita su una riga invece di una griglia 2x2,
  modali più ampi. Corregge anche, come effetto collaterale utile, lo
  spazio disponibile nel modale di calibrazione sensori in orizzontale.

### Corretto
- Bug scoperto durante il ribilanciamento: il campo che esprime il bonus
  HP del player (sia dal negozio che, ora, dalla difficoltà) è un valore
  *flat* additivo, non percentuale come il bonus danno — un primo
  tentativo di bonus HP per la difficoltà Facile veniva applicato quasi
  a zero effetto per questo motivo, ora corretto.

## [1.16.1]
### Modificato
- **Genere della colonna sonora rivisto**: dal vaporwave/synthwave
  ambient (poco adatto al ritmo del gioco) a **dark/hard techno** per
  le 20 tracce standard (132-151 BPM, cassa in levare regolare
  four-on-the-floor, incalzante e ipnotica) e **drum'n'bass** per le 20
  tracce dei boss (167-182 BPM, pattern sincopato stile breakbeat,
  hi-hat molto più fitti, nettamente più energico). Il cambio non
  riguarda solo tempo/tonalità ma il pattern ritmico stesso — le due
  famiglie ora hanno una "grammatica" percussiva distinta, non solo
  una velocità diversa. Stessa architettura di sintesi procedurale via
  Web Audio API di prima (nessun asset audio esterno), API pubblica
  invariata (nessuna modifica necessaria altrove nel codice).

## [1.16.0]
### Corretto
- **Modale di calibrazione sensori inutilizzabile in landscape**: il
  pulsante "Imposta punto zero" finiva fuori dallo schermo su viewport
  basse. Causa: a differenza degli altri modali dell'app, il contenuto
  centrale non era avvolto nel contenitore scrollabile — ora lo è
  (stesso pattern già usato da changelog/privacy), quindi titolo e
  pulsanti restano sempre raggiungibili, con la livella che scorre se
  serve. Aggiunto anche un ridimensionamento automatico della livella su
  viewport molto basse.

### Aggiunto
- **Colonna sonora**: 20 loop musicali ambient in stile vaporwave/synth­wave
  che ruotano casualmente durante il gioco, più 20 loop specifici dei
  boss (uno per ciascuno dei 20 boss del roster) con tensione più alta,
  attivati automaticamente all'arrivo del boss e sostituiti da un
  ritorno morbido alla rotazione ambient alla sua sconfitta. **Nota
  tecnica importante**: non sono brani preregistrati, ma un motore di
  sintesi/sequencer procedurale via Web Audio API (`js/music.js`) —
  teoria musicale reale (scale modali, accordi diatonici), pad/basso/
  arpeggio/batteria sintetizzati, riverbero generato, scheduler a
  lookahead per un timing preciso — coerente con la filosofia "zero
  asset esterni" già seguita per gli effetti sonori.
- **Nuova sezione Audio nel menu Impostazioni**: attivazione e volume
  regolabili separatamente per effetti sonori e musica.

## [1.15.0]
### Corretto
- **Bug controllo a inclinazione**: calibrando in verticale e poi
  ruotando in orizzontale per giocare (o viceversa), gli assi
  sinistra/destra e avanti/indietro risultavano scambiati, rendendo i
  controlli inutilizzabili. Causa: i valori beta/gamma del sensore sono
  relativi al telaio fisico del dispositivo, non allo schermo
  visualizzato. Ora la lettura viene corretta in base all'orientamento
  corrente dello schermo prima di essere usata, sia in fase di
  calibrazione che durante il gioco — coerente in qualunque
  orientamento. Il modale di calibrazione mostra inoltre un avviso se ci
  si trova in verticale, suggerendo di ruotare prima di calibrare dato
  che si giocherà in orizzontale. **Nota**: chi aveva già calibrato con
  una versione precedente deve ricalibrare una volta per applicare la
  correzione (il formato dei dati salvati è cambiato).

### Aggiunto
- **Prompt nickname prima della partita**: gli ospiti che non hanno
  ancora scelto un nickname personalizzato (nickname auto-generato tipo
  "Player1234") ora vengono invitati a sceglierne uno subito prima di
  iniziare, con la possibilità di saltare e continuare comunque — in tal
  caso viene chiesto di nuovo alla partita successiva, finché non viene
  impostato (qui, dalla schermata Account, o dal prompt già esistente a
  fine partita, che resta come ultima occasione). Pensato per ridurre le
  numerose voci anonime "Player####" osservate in classifica dopo il
  rilascio pubblico.

## [1.14.2]
### Modificato
- **Privacy Policy corretta**: la v1.14.1 assumeva Umami self-hosted,
  ma il servizio è in realtà **Umami Cloud** (versione ospitata da
  terzi). Corretta la sezione 5 per trattarlo esplicitamente come
  servizio di terze parti (come già avviene per Google Fonts), con
  nota sul possibile trasferimento dati fuori SEE. Resa inoltre più
  onesta la sezione 2: l'hash IP+user agent usato da Umami per calcolare
  i visitatori unici è dato "pseudonimizzato", che secondo
  l'interpretazione prevalente del GDPR resta comunque "dato personale"
  anche se non identifica direttamente nessuno — invece di ripetere
  acriticamente la sola dicitura "nessun dato personale raccolto".

## [1.14.1]
### Modificato
- **Privacy Policy aggiornata** per l'introduzione di **Umami Analytics**:
  aggiunta la descrizione dei dati statistici raccolti (pagine visitate,
  provenienza, dispositivo/browser, paese approssimativo, durata visita
  — tutto in forma aggregata e anonima, IP mai salvato in chiaro),
  la base giuridica (legittimo interesse, nessun consenso necessario
  data la natura cookieless e non identificativa dello strumento), e
  rimossa la precedente dichiarazione "non vengono utilizzati servizi
  di analisi" (non più accurata). **Nota**: il testo assume Umami
  ospitato sui server propri (self-hosted, nessuna terza parte
  coinvolta) — se in realtà si usa Umami Cloud (servizio di terze
  parti), va corretta la sezione 5 di conseguenza.

## [1.14.0]
### Corretto
- **Bug**: la landing page (`index.html`) non scrollava su desktop. Causa
  reale: le regole "schermo fisso" pensate solo per la sessione di gioco
  (`overflow:hidden`, `touch-action:none`, ecc.) erano applicate di
  default a *qualunque* pagina includesse `css/style.css`, landing
  compresa — che doveva poi "smontarle" via override, in modo fragile e
  dipendente dall'ordine/specificità CSS. Reso tutto più robusto: quelle
  regole ora sono opt-in tramite una classe dedicata (`body.game-body`,
  applicata solo in `game.html`), quindi la landing eredita di default
  un `html`/`body` normale, scrollabile, senza bisogno di override.

### Aggiunto
- **Landing page completamente bilingue IT/EN**: pulsante per cambiare
  lingua in alto a destra nella hero, traduzione integrale di ogni testo
  (hero, descrizione, feature, statistiche, sezione supporto, footer),
  **incluso il modale changelog** (contenuto in due blocchi IT/EN) e
  **il modale classifica** (titolo, stato di caricamento, messaggi di
  errore/vuoto, tutto tradotto). La scelta della lingua è condivisa con
  le impostazioni del gioco (stessa chiave di localStorage): selezionata
  qui, resta impostata anche entrando nel gioco vero e proprio.

## [1.13.0]
### Modificato
- **Scambiati i nomi dei file principali**: il gioco (ex `index.html`)
  è ora `game.html`; la landing page (ex `landing.html`) è ora
  `index.html`, così da essere servita di default alla root del dominio
  dai comuni server web (Apache/Nginx) senza bisogno di configurazioni
  aggiuntive. Aggiornati di conseguenza tutti i riferimenti incrociati:
  link "GIOCA" della landing, `start_url` del manifest PWA (che punta
  correttamente a `game.html`, non alla landing), lista di cache del
  Service Worker.

## [1.12.0]
### Aggiunto
- **Landing page** (`landing.html`, `css/landing.css`, `js/landing.js`):
  hero fullscreen con immagine (placeholder in `assets/hero.jpg`, da
  generare col prompt fornito — funziona anche senza, con un gradiente
  scuro di fallback) e indicatore di scroll animato; sezione descrittiva
  con 6 feature card; barra statistiche (20 boss, 5 armi, 14
  potenziamenti, 7 lingue, 0€); sezione dedicata al supporto/donazioni
  con motivazioni concrete e CTA in evidenza; modale changelog (statico)
  e modale classifica con **fetch live** dal backend reale
  (`api/leaderboard.php`, lo stesso endpoint usato in-game); link di
  contatto e footer. Riusa integralmente palette colori, font e
  componenti (`.btn`, `.modal-overlay`, `.leaderboard-list`, ecc.) già
  definiti in `css/style.css` per coerenza visiva perfetta col gioco.
  Pagina separata e non facente parte della PWA installabile del gioco
  (non aggiunta alla cache del Service Worker).

## [1.11.0]
### Corretto
- **Bug importante sui proiettili homing**: ricalcolavano "il nemico più
  vicino" ad ogni singolo frame invece di restare agganciati a un
  bersaglio fisso. Con nemici in movimento, questo faceva cambiare
  bersaglio in continuazione (bastava che un altro nemico diventasse
  anche solo momentaneamente più vicino) impedendo al proiettile di
  convergere su chiunque: risultato, proiettili che ondeggiavano su/giù
  destra/sinistra per tutto lo schermo senza mai colpire nulla. Ora un
  proiettile homing aggancia UN bersaglio alla prima occasione utile e
  lo mantiene per tutta la sua vita, cercandone uno nuovo solo se quello
  agganciato muore (gestito anche il caso limite in cui l'oggetto nemico
  morto venga riciclato dal pool per un nemico successivo, evitando che
  il proiettile lo scambi per il vecchio bersaglio).

### Aggiunto
- **Durata massima di vita per tutti i proiettili** (3.5 secondi):
  superato questo limite, il proiettile smette di poter colpire
  qualunque cosa e svanisce visivamente in 500ms, poi viene rimosso —
  rete di sicurezza contro proiettili (in particolare homing, ma vale
  per tutti) che in casi limite potrebbero restare in volo a tempo
  indeterminato senza mai trovare un bersaglio.

## [1.10.1]
### Corretto
- Il prompt di rotazione compariva ovunque nell'app quando il dispositivo
  era in verticale, inclusi i menu (titolo, negozio, impostazioni, ecc.)
  pensati per restare in verticale. Ora compare **solo** subito prima di
  avviare effettivamente una partita (dopo aver scelto la difficoltà),
  bloccando l'ingresso in gioco finché non si ruota il dispositivo o non
  si sceglie "Continua in verticale" — i menu non lo mostrano mai.

## [1.10.0]
### Aggiunto
- **Prompt di rotazione** su mobile: se il dispositivo è in verticale,
  suggerisce di ruotarlo in orizzontale con un'animazione (icona
  telefono che ruota), lasciando comunque la possibilità di continuare
  in verticale con un pulsante dedicato.
- **D-pad virtuale** come nuovo schema di controllo selezionabile su
  mobile (accanto a touch e inclinazione), configurabile per lato
  (sinistra/destra) e dimensione (piccolo/medio/grande) dalla schermata
  Impostazioni. Funziona solo a trascinamento (mai a tocco secco), con
  il centro di riferimento sempre ancorato al centro geometrico fisso
  del D-pad — non al punto di primo tocco — così il dito resta
  nell'angolo e non copre mai il centro dello schermo. Il pulsante
  bomba e la barra HP/XP si riposizionano automaticamente per non
  sovrapporsi mai al D-pad, qualunque lato/dimensione sia stata scelta.
- **Calibrazione dei sensori di movimento**: quando lo schema di
  controllo è "Inclinazione dispositivo", un pulsante "Calibra" apre un
  modale con una livella virtuale in tempo reale e un tasto per
  impostare il punto zero nella posizione in cui si tiene il
  dispositivo durante il gioco. Calibrazione persistita tra le sessioni.
- **Controllo di unicità nickname**, non case-sensitive ("Sputnik" e
  "sputnik" sono considerati lo stesso nome): applicato a livello di
  database (vincolo UNIQUE, la collation della tabella è già
  case-insensitive) e restituito come errore tradotto in tutte le
  lingue quando si tenta di registrarsi o cambiare nickname con un nome
  già in uso da un altro utente. Se un nickname ospite auto-generato
  collide per puro caso, il server ritenta automaticamente con un altro
  nome invece di mostrare un errore per un nome che l'utente non ha scelto.

## [1.9.0]
### Aggiunto
- **Trasformato in PWA** (Progressive Web App), installabile su Android e
  iOS direttamente dal browser:
  - `manifest.webmanifest` con 10 icone (8 standard da 72 a 512px + 2
    "maskable" per le icone adattive Android)
  - `sw.js` (Service Worker): cache dell'app shell con strategia
    stale-while-revalidate per un caricamento istantaneo e supporto
    offline parziale; le chiamate API non vengono mai messe in cache
    per restare sempre aggiornate
  - Meta tag dedicati per iOS (`apple-mobile-web-app-capable`,
    `apple-touch-icon`) e favicon completo (.ico multi-risoluzione + PNG)
  - Icone disegnate riusando la stessa identità visiva già presente nel
    gioco: l'esagono degli anelli poligonali dei boss attorno al
    triangolo allungato dei nemici (`icons/src/*.svg` per i sorgenti
    vettoriali, modificabili in futuro)

## [1.8.0]
### Bilanciamento
- Curva di difficoltà nel tempo ammorbidita rispetto alla v1.6.0 (era
  diventata troppo punitiva): crescita nemici/boss più lenta (+100% ogni
  5 minuti invece di 4) e tetto più basso (3x invece di 3.5x). Massimali
  di alcuni potenziamenti rialzati leggermente (danno/cadenza/vitalità/
  rigenerazione) per compensare.

### Aggiunto
- **Bomba EMP**: potenziamento accumulabile fino a 2 cariche (scelta a
  level-up, oppure raccolta a terra con una piccola probabilità di drop
  dai nemici uccisi) che azzera tutti i nemici regolari visibili a
  schermo — **inefficace sui boss** per design. Si attiva con il tasto
  **E** su desktop o dal pulsante dedicato in basso a sinistra nell'HUD
  (con contatore cariche), utilizzabile su qualunque piattaforma.
- **Privacy Policy conforme al GDPR**, raggiungibile da un link nel
  footer della schermata principale e dalla schermata Account (sotto
  "Password dimenticata?"): analizza nel dettaglio i dati realmente
  raccolti dal gioco (account, dati di gioco, token di sessione,
  indirizzo IP per anti-abuso, impostazioni salvate solo in locale,
  nessun cookie, Google Fonts come unico servizio di terze parti) e i
  diritti dell'interessato. Disponibile in italiano/inglese, stesso
  criterio del changelog in-app.

## [1.7.0]
### Aggiunto
- **Roster boss esteso da 3 a 20**: 19 boss regolari con progressione di
  forza generata proceduralmente (facilmente ritarabile da poche costanti
  in `js/config.js` invece di dover ritoccare 20 numeri a mano), più un
  **20° boss finale** ("Singolarità Assoluta") nettamente più forte di
  tutti, con tutti i pattern d'attacco inclusi un nuovo attacco esclusivo
  a raffica su 360° ("radial_burst") e colore che cambia continuamente
  nel tempo invece di restare fisso.
- **Nuovo aspetto visivo dei boss**: non più un pallino colorato, ma
  anelli poligonali concentrici in rotazione (l'anello esterno "si spezza"
  progressivamente man mano che il boss perde HP) con satelliti
  triangolari orbitanti attorno al nucleo — stesso linguaggio visivo dei
  nemici normali. Ogni boss è visivamente distinto soprattutto per forma
  (numero di lati dell'anello, numero di satelliti), non solo per colore,
  restando leggibile anche in modalità Daltonici.
- Tutti i 20 nomi boss tradotti in tutte e 7 le lingue.

## [1.6.0]
### Bilanciamento (v1.5.0 diventava troppo facile dopo qualche minuto)
- **Nemici e boss ora scalano nel tempo** (`Spawner.timeScaleMult` in
  `js/spawner.js`): HP e danno crescono progressivamente durante la run
  (+100% ogni 4 minuti, fino a un tetto di +250% intorno ai 10 minuti),
  sopra al moltiplicatore di difficoltà scelto a inizio partita. Prima
  restavano della stessa forza per tutta la run mentre il player
  continuava a crescere di potenza: risolto il problema per cui diventava
  "quasi impossibile morire" dopo un certo punto.
- **Massimali dei potenziamenti ridotti** per evitare crescita composta
  eccessiva: danno e cadenza di tiro da 8 a 5 livelli (e rateo per
  livello abbassato, 12%→8% e 12%→8%), velocità/magnete da 6 a 4 livelli,
  scudo da 5 a 3, vitalità da 8 a 5, colpo critico da 6 a 4, multishot/
  perforante da 4 a 3. Rigenerazione ridotta e dimezzata nei livelli
  massimi (da +1/3s per livello, max 6 livelli, a +0.2/s per livello,
  max 3 livelli).
- **Vampirismo reso temporaneo** come richiesto: non più un moltiplicatore
  permanente che si accumula per sempre, ma una finestra di 12 secondi
  di cura attiva (rateo in base al livello raggiunto) che si rinnova
  scegliendolo di nuovo — scaduta, la cura torna a 0 finché non lo si
  riprende.

### Aggiunto
- I nemici regolari sono ora **triangoli allungati orientati verso il
  player** (invece di pallini), per una lettura più immediata della
  direzione di minaccia e un look più distintivo.

## [1.5.0]
### Aggiunto
- Sistema di potenziamenti in-game **davvero progressivo**: ogni
  potenziamento (tranne il cambio arma) ha ora più livelli — mostrati
  in-game come "Lv. X/Y" sulla card di scelta — invece di fermarsi al
  primo utilizzo. Vale sia per i passivi (danno, cadenza, velocità,
  magnete, rigenerazione, scudo, vitalità) sia per le modalità di tiro
  (multi-shot, perforante, rimbalzante, homing, esplosivo), che prima
  erano acquisibili una sola volta.
- 2 nuovi potenziamenti passivi: **Colpo Critico** (chance di infliggere
  danno doppio, numeri di danno critico mostrati in modo distinto) e
  **Vampirismo** (cura una % del danno inflitto).
- Il changelog in-app è ora disponibile anche in inglese: italiano se la
  lingua impostata è italiano, inglese per tutte le altre 5 lingue
  (non tradotto singolarmente in ciascuna per non appesantire la
  manutenzione di un contenuto principalmente di servizio).

### Corretto
- **Bug importante**: run lunghe e legittime potevano essere scartate dal
  server (mostrando 0 gemme guadagnate nonostante una buona partita).
  Le soglie anti-cheat in `api/run/submit.php` erano tarate su un ritmo
  di gioco troppo prudente rispetto a quello reale a fine partita
  (multishot+pierce+esplosivo possono generare uccisioni molto più
  rapide di quanto stimato), e il punteggio dei boss (500-650 pt, contati
  però come un solo "kill") non era considerato correttamente nella stima
  del punteggio plausibile. Ricalibrate entrambe le soglie sul reale
  modello di gioco.
- Un submit di run fallito ora mostra un avviso a schermo invece di
  passare inosservato con 0 gemme silenziose.

## [1.4.0]
### Aggiunto
- Impostazione **Velocità movimento** per gli schemi touch/mouse: Costante
  (sempre alla massima velocità) o Proporzionale alla distanza dal
  player (0% a distanza 0, 100% da 220px in su).
- Link "Changelog" in basso a destra vicino al numero di versione, apre
  un modale scrollabile con lo storico delle versioni e un pulsante
  Chiudi tradotto in tutte le lingue.

### Corretto
- Il player si fermava se il mouse/dito restava fermo per 1-2 secondi
  (soglia di "arrivo" troppo ampia); ora si muove sempre verso il
  puntatore finché c'è distanza residua, coerentemente con la nuova
  impostazione di velocità.
- Il prompt per scegliere un nickname a fine partita compariva per
  qualunque account ospite ad ogni game over, anche dopo averne già
  scelto uno; ora compare solo se non è loggato un account vero e non è
  ancora stato impostato un nickname personalizzato dall'utente.
- README allineato (era rimasto fermo alla v1.2.0).

## [1.3.0]
### Aggiunto
- Impostazione **Posizione Giocatore**: in basso (classica) o esattamente al centro dello schermo.
- Nella schermata di game over, se si sta giocando come ospite, è ora possibile
  scegliere un nickname per comparire correttamente in classifica (nuovo
  endpoint `POST /api/auth/set_nickname.php`).
- Indicatore nella schermata principale che mostra se si è connessi e con
  quale nickname (ospite o account registrato).
- Questo changelog.

## [1.2.0]
### Aggiunto
- Controlli mobile/desktop: il player segue il dito (touch) o il puntatore
  del mouse (mouse), oltre a tastiera e inclinazione del dispositivo (tilt).
- Menu Impostazioni (dal titolo e dalla pausa): audio on/off, lingua,
  schema di controllo, modalità Daltonici, Effetti Avanzati.
- Traduzione completa dell'interfaccia in 7 lingue: IT, EN, ES, FR, DE, SL, RU.
- Modalità Daltonici con palette alternativa per canvas e UI.
- Effetti Avanzati opzionali: scia player, glow potenziato, scia proiettili,
  vignetta HP basso.

### Corretto
- Movimento non funzionante su mobile (il livello touch aveva
  `pointer-events: none` nel CSS, bloccando ogni interazione).
- Icona del pulsante pausa poco chiara, sostituita con un'icona CSS pulita
  (due barre) e riposizionata per non sovrapporsi al contatore uccisioni.

## [1.1.0]
### Aggiunto
- Reset password self-service via codice a 6 cifre inviato per email
  (`POST /api/auth/forgot.php`, `POST /api/auth/reset.php`).

### Corretto
- Autenticazione che falliva silenziosamente su alcuni hosting condivisi
  che filtrano l'header `Authorization` (aggiunto header custom
  `X-Auth-Token` come trasporto primario).

## [1.0.0]
### Aggiunto
- Prima versione pubblicabile: gameplay completo (ondate, boss, armi,
  potenziamenti, meta-progressione), backend PHP/MySQL (autenticazione,
  classifica, negozio, missioni giornaliere), anti-cheat di base.
