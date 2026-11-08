# Baseline Supabase: stato remoto e riconciliazione

**Stato: pronta per revisione, non approvata per l'esecuzione.** Questo documento registra
l'inventario osservato e il piano di lavoro; non costituisce una migration
eseguibile, un backup o una certificazione che le migration storiche siano state
eseguite. Nessuna versione è autorizzata al repair per il solo fatto di comparire
qui.

## Ambito e metodo

- Progetto: `yihognpbnhdolsnmicwi`, ambiente di produzione.
- Rilevazione: 8 novembre 2026, tramite query al catalogo PostgreSQL e controlli
  sui dati in transazioni in sola lettura. I risultati sono uno snapshot e
  devono essere ricontrollati prima di ogni intervento.
- La verifica dettagliata riguarda gli oggetti interessati dalle 12 migration
  in [`supabase/migrations`](./supabase/migrations). L'elenco degli oggetti
  pubblici sottostante non sostituisce un dump completo di definizioni,
  dati, privilegi, estensioni o schemi gestiti.
- Non sono stati eseguiti `migration repair`, `db push`, migration o scritture
  sul database per questa baseline.

## Stato remoto osservato

`supabase_migrations.schema_migrations` non esiste. L'assenza della cronologia
non dimostra che gli SQL storici non siano mai stati eseguiti: potrebbero
essere stati applicati manualmente o sostituiti.

Nel catalogo `public` sono presenti le seguenti tabelle, tutte con RLS abilitata:

`advertisements`, `advertisers`, `animator_candidates`, `badges`,
`entertainers`, `events`, `favorites`, `import_candidates`, `park_ratings`,
`park_service_reports`, `parks`, `party_rooms`, `play_centers`, `profiles`,
`provider_reviews`, `providers`, `reports`, `reviews`, `sources`, `user_badges`,
`user_verifications`.

È presente la vista `provider_review_stats`. Non risultano
`animators_candidates` (con la s), `park_review_stats`,
`provider_animator_identity_keys` né la funzione
`approve_animator_candidate(uuid,text,text)`.

### Oggetti interessati dalle migration

| Oggetto | Evidenza osservata |
|---|---|
| `providers` | ID `text`; `provider_kind` obbligatorio con valori `feste` e `play_center`; `party_type` presente; `status` usa l'enum `item_status` con default `partial`. Non risultano le colonne storiche `provider_type` e `active`, il vincolo e l'indice storici di `party_type` o il trigger storico di aggiornamento. |
| `animator_candidates` | Colonne, tipi, default, vincoli e indici corrispondenti alla migration; RLS abilitata e policy di gestione per `service_role`. Controlli principali: nessun accesso di lettura/inserimento/cancellazione a `anon` e `authenticated`; privilegi completi a `service_role`. |
| `events` | Presenti le colonne delle migration contatti e prenotazione. Al momento del controllo nessuna riga con `source_url` non nullo aveva `official_url` nullo; questo non dimostra quando sia stato eseguito il backfill. |
| `parks` | `outside_tuscany boolean NOT NULL DEFAULT false` presente. |
| `park_ratings` | Tabella e vincoli base presenti; mancano `comment`, `status`, `reviewer_token` e la vista `park_review_stats`. Le policy attuali hanno nomi diversi da quelli delle migration storiche. |
| `park_service_reports` | Tabella e vincoli base presenti. Il vincolo ammette `presenza_fumatori`, ma la policy remota di inserimento osservata non lo ammette. |
| `provider_reviews` | Tabella, vincoli e indici principali presenti. La policy di inserimento controlla l'esistenza del provider, non `p.active`, colonna che non esiste sul remoto. La vista `provider_review_stats` non riporta l'opzione `security_invoker=true` prevista dal file storico. |

RLS abilitata non equivale a verifica completa delle policy o dei privilegi.
Per `provider_reviews`, i controlli effettuati confermano che `anon` e
`authenticated` possono inserire `reviewer_token` ma non leggerlo. Le altre
policy e i privilegi fuori dall'ambito di questo audit restano da inventariare.

## Stato delle 12 migration

La classificazione seguente riguarda la rappresentazione degli effetti nello
schema corrente, non la prova dell'esecuzione storica.

### Candidate a repair, subordinate a revisione

| Versione | Motivazione | Controllo residuo |
|---|---|---|
| [`20261025111000`](./supabase/migrations/20261025111000_add_outside_tuscany_to_parks.sql) | Colonna `outside_tuscany` con tipo, nullabilità e default previsti. | Ricontrollare lo schema prima del repair. |
| [`20261101150000`](./supabase/migrations/20261101150000_add_event_contact_details.sql) | Colonne contatti presenti e postcondizione attuale del backfill soddisfatta. | Confermare i dati e accettare che il controllo non prova l'esecuzione storica. |
| [`20261101161000`](./supabase/migrations/20261101161000_add_event_booking_enrichment.sql) | Colonne di prenotazione e indirizzo presenti con tipi coerenti. | Ricontrollare lo schema prima del repair. |
| [`20261105181700`](./supabase/migrations/20261105181700_create_animator_candidates.sql) | Struttura, vincoli, indici, RLS e policy osservati coerenti. | Completare il confronto dei privilegi effettivi e delle eventuali differenze non rilevate. |

Solo dopo la revisione e un'autorizzazione separata, un possibile comando è:

```powershell
npx.cmd supabase migration repair --remote --status applied 20261025111000 20261101150000 20261101161000 20261105181700
```

Il comando **modifica la cronologia remota**; non è stato eseguito. Registrare
solo queste quattro versioni lascerebbe sette versioni pendenti più vecchie
dell'ultima registrata e non rende riproducibile la baseline.

### Divergenti: non registrare senza riconciliazione

| Versione | Differenza e rischio | Decisione o intervento necessario |
|---|---|---|
| [`20261021130000`](./supabase/migrations/20261021130000_create_providers.sql) | Lo schema storico `providers` usa UUID, `provider_type` e `active`; il remoto usa ID testuali, `provider_kind` e `status`, con policy e trigger diversi. Rieseguire `CREATE TABLE` fallirebbe. | Documentare il modello accettato, confrontare funzionalità, RLS e dipendenze; non ricreare la tabella. |
| [`20261021183000`](./supabase/migrations/20261021183000_unify_provider_categories.sql) | Aggiorna `provider_type`, assente sul remoto. La classificazione attuale usa un modello diverso. | Verificare mappatura e dati; decidere se l'effetto funzionale corrente sia accettabile e documentare la differenza. |
| [`20261022213400`](./supabase/migrations/20261022213400_add_provider_party_type.sql) | `party_type` è presente, ma vincolo e indice del file non risultano presenti. | Inventariare i valori in uso e decidere vincolo e indice compatibili prima di una eventuale migration correttiva. |
| [`20261025150000`](./supabase/migrations/20261025150000_document_park_community_tables.sql) | Le tabelle esistono ma le policy hanno nomi e comportamento diversi, in particolare `presenza_fumatori`. | Stabilire il comportamento voluto e riconciliare policy e privilegi senza lasciare policy permissive aggiuntive involontarie. |
| [`20261103232500`](./supabase/migrations/20261103232500_create_provider_reviews.sql) | La policy di inserimento e l'opzione di sicurezza della vista divergono; `p.active` non esiste sul remoto. | Stabilire il criterio di visibilità basato sul modello attuale e testare viste, RLS e privilegi prima di modificare la configurazione. |

### Mancanti: non marcare come applied

| Versione | Stato e decisione necessaria |
|---|---|
| [`20261103220000`](./supabase/migrations/20261103220000_create_animators_candidates.sql) | `animators_candidates` non esiste. Decidere se la vecchia tabella di staging sia ancora necessaria; non confonderla con `animator_candidates`. |
| [`20261105171400`](./supabase/migrations/20261105171400_add_park_reviews.sql) | Mancano colonne e vista delle recensioni parchi. Se desiderate, preparare una modifica compatibile con le policy effettive, i cui nomi differiscono da quelli rimossi dal file storico. |
| [`20261107174500`](./supabase/migrations/20261107174500_approve_animator_candidates.sql) | RPC e tabella delle identità non sono presenti. Lasciare pendente; testare migration e RPC intere prima di un'applicazione autorizzata. |

## Strategia di riconciliazione

L'inventario locale comprende 12 versioni: quattro candidate a repair,
cinque divergenti e tre mancanti, tutte elencate sopra. Le categorie sono
relative allo snapshot osservato e non certificano la storia di esecuzione.

La strategia è preservare il database popolato e costruire un percorso
riproducibile, non rieseguire alla cieca le migration storiche. Prima di
registrare qualsiasi versione occorre approvare, per ciascuna, un confronto
degli effetti effettivi con lo stato desiderato e il trattamento delle
divergenze. Per le versioni mancanti si dovrà decidere se implementare la
funzionalità con una migration compatibile o sostituire formalmente il
percorso storico con una baseline concordata; l'assenza degli oggetti non è
motivo per marcarle `applied`.

La soluzione scelta deve funzionare sia su una copia rappresentativa del
remoto sia su un'installazione nuova. In particolare, il repair delle sole
quattro candidate lascia versioni precedenti pendenti: non risolve l'ordine
della cronologia e non autorizza un successivo push. Prima dell'intervento
occorre decidere e testare esplicitamente come gestire ogni versione
precedente, senza modificare la storia condivisa o registrare effetti non
riconciliati soltanto per sbloccare la CLI.

### Sequenza proposta

1. Confermare progetto, fare un backup ripristinabile e acquisire un inventario
   completo di schema, ruoli, privilegi, policy, funzioni, trigger, estensioni,
   viste e dipendenze, inclusi gli schemi gestiti pertinenti. Verificare la
   copertura del dump e proteggere eventuali dati sensibili.
2. Scegliere e documentare lo stato desiderato per ogni divergenza e le
   funzionalità mancanti da mantenere o abbandonare. Non contrassegnare una
   migration come eseguita solo per sopprimere errori.
3. Preparare una baseline riproducibile e testarla su un database isolato
   rappresentativo del remoto; verificare anche la creazione da zero, tenendo
   conto degli oggetti e delle dipendenze non coperti dalle migration locali.
   Concordare come conservare la storia e rappresentare gli effetti storici
   sostituiti o intenzionalmente non adottati.
4. Progettare eventuali nuove migration correttive, testando dati preesistenti,
   policy RLS, privilegi, viste, trigger e comportamento dell'app. Decidere il
   trattamento delle versioni storiche pendenti prima di un qualunque push.
5. Testare la migration di approvazione completa e la RPC in isolamento,
   includendo collisioni singole e multiple, aggiornamenti concorrenti,
   vincoli, permessi, rollback e lo stato effettivo del candidato.
6. Dopo backup, revisione e autorizzazione, allineare la cronologia solo per
   versioni riconciliate. Controllare `migration list --remote` e un dry-run,
   fermandosi se compaiono migration non previste. `--include-all` non è una
   scorciatoia sicura: può includere SQL storico indesiderato.

Supabase documenta [`db pull --remote` e `migration repair`](https://supabase.com/docs/guides/deployment/database-migrations)
come strumenti di acquisizione dello schema e correzione della cronologia.
Un pull può creare file locali e può anche richiedere un'operazione sulla
cronologia remota: verificarne l'anteprima e le conferme, senza eseguirlo
automaticamente in produzione.

## Strategia approvazione animatori

### Inventario oggetti e impatto della migration

Confronto del catalogo remoto in sola lettura dell'8 novembre 2026 con
[`20261107174500`](./supabase/migrations/20261107174500_approve_animator_candidates.sql).
«No» indica assenza al momento della verifica, non un problema per oggetti che
la migration deve creare. Le colonne facoltative citate sotto sono considerate
singolarmente: non sono dipendenze obbligatorie.

| Oggetto | Esiste sul remoto? | Creato dalla migration? | Criticità |
|---|---|---|---|
| Tabella `public.providers` | Sì | No, alterata | Tabella popolata; aggiunta colonne, backfill, lock e trigger possono influenzare le scritture esistenti. |
| Tabella `public.animator_candidates` | Sì | No | Dipendenza della RPC; i suoi dati cambiano solo invocando la RPC, non alla creazione della funzione. |
| Colonna `providers.provider_type` | No | Sì, se assente | Backfill di tutte le righe con valore nullo a partire da `provider_kind`; introduce sincronizzazione legacy. Verificare impatto su dati e applicazione. |
| Colonne `providers.provider_kind`, `party_type`, `social_url`, `services`, `coverage_area`, `notes`, `status` | Sì | Solo se assenti | Sul remoto `status` è enum `item_status`, non `text`: `ADD COLUMN IF NOT EXISTS` non cambia il tipo. Verificare compatibilità dell'RPC e di tutti i consumer. |
| Tabella `public.provider_animator_identity_keys` | No | Sì | RLS abilitata; accesso revocato a `PUBLIC`, `anon`, `authenticated`, concessi privilegi a `service_role`. Le chiavi sono popolate per animatori esistenti. |
| Vincoli `provider_animator_identity_keys_pkey` e `provider_animator_identity_keys_identity_kind_check` | No, tabella assente | Sì | La PK comprende anche `provider_id`: identità preesistenti condivise da più provider sono conservabili. Il check limita il tipo a `phone`, `website`, `social`. |
| Indice implicito `provider_animator_identity_keys_pkey` | No | Sì, tramite PK | Garantisce unicità della tripletta, non unicità globale dell'identità. |
| Indice `provider_animator_identity_provider_idx` | No | Sì | Supporta la rimozione delle chiavi per provider; verificare tempi e spazio di creazione. |
| Funzione `public.sync_legacy_provider_type()` | No | Sì, `CREATE OR REPLACE` | Sincronizza categorie legacy; permessi revocati a `PUBLIC`, `anon`, `authenticated`. In caso di presenza futura potrebbe essere sostituita. |
| Funzione `public.animator_identity_values(text,text,text)` | No | Sì, `CREATE OR REPLACE` | Normalizzazione di telefono, sito e social determina i match. La migration non revoca esplicitamente `EXECUTE`: verificare privilegi predefiniti e accesso effettivo. |
| Funzione `public.sync_animator_provider_identity_keys()` | No | Sì, `CREATE OR REPLACE` | `SECURITY DEFINER`; modifica le chiavi e può rifiutare nuove collisioni, anche da scritture diverse dall'RPC. Verificare owner, privilegi e `search_path`. |
| RPC `public.approve_animator_candidate(uuid,text,text)` | No | Sì, `CREATE OR REPLACE` | `SECURITY DEFINER`; esecuzione revocata a `PUBLIC`, `anon`, `authenticated`, concessa a `service_role`. Può creare provider o aggiornare candidati solo quando invocata. |
| Trigger `sync_legacy_provider_type` su `providers` | No | Sì, dopo `DROP IF EXISTS` | `BEFORE INSERT` o aggiornamento categorie; se presente in futuro sarebbe sostituito. |
| Trigger `sync_animator_provider_identity_keys_insert` su `providers` | No | Sì, dopo `DROP IF EXISTS` | `AFTER INSERT`; sincronizza le identità e può respingere nuove collisioni. |
| Trigger `sync_animator_provider_identity_keys_update` su `providers` | No | Sì, dopo `DROP IF EXISTS` | `AFTER UPDATE` dei campi rilevanti; collisioni preesistenti possono rimanere, ma nuove collisioni sono respinte. |
| Trigger `sync_animator_provider_identity_keys_delete` su `providers` | No | Sì, dopo `DROP IF EXISTS` | `AFTER DELETE`; rimuove le chiavi associate al provider. |
| Policy su `provider_animator_identity_keys` | No, tabella assente | **No** | RLS è attivata senza creare policy. Verificare accesso effettivo del ruolo di servizio e delle funzioni `SECURITY DEFINER`; non attribuire policy alla migration. |

Non risultano trigger utente su `providers` nel catalogo interrogato. Le policy
esistenti su `providers` e `animator_candidates` non sono create o modificate
da questa migration. Il backfill delle identità interessa solo i provider con
`provider_kind = 'feste'` e `party_type = 'animatore'`; non approva candidati.
La migration può anche aggiornare `provider_kind`, `services`, `party_type`,
`coverage_area` e `social_url` tramite backfill condizionali se esistono le
colonne legacy pertinenti. Nel remoto osservato `categories`, `service_areas`,
`facebook` e `instagram` sono assenti, quindi i relativi rami non si eseguono
in tale stato.

### Checklist di pre-applicazione

I controlli seguenti sono condizioni da soddisfare, non operazioni già
eseguite. L'esistenza delle dipendenze principali è stata osservata, ma
compatibilità completa, test e autorizzazioni non sono ancora dimostrati.

- [ ] Ricontrollare progetto e inventario oggetti, firme, vincoli e ruoli
      `anon`, `authenticated`, `service_role`; arrestarsi in caso di drift.
- [ ] Verificare su copia le colonne usate dalla RPC, tipi, default, vincoli
      e privilegi effettivi delle tabelle esistenti. Le colonne obbligatorie
      osservate su `providers` e `animator_candidates` sono presenti;
      `provider_type` viene creata dalla migration.
- [ ] Riconciliare la cronologia e tutte le versioni precedenti con il piano
      approvato; verificare che un eventuale dry-run proponga solo versioni
      autorizzate e che `20261107174500` sia pendente.
- [ ] Misurare su copia numero di righe aggiornate, durata, lock, spazio,
      collisioni e impatto di indici e trigger sulle scritture concorrenti;
      prevedere finestra di intervento e sospensione delle scritture.
- [ ] Verificare i permessi di esecuzione delle quattro funzioni, gli owner,
      i privilegi predefiniti e l'accesso effettivo alle chiavi con RLS.
- [ ] Eseguire tutti i test della sezione «Test obbligatori prima della
      produzione», inclusi backfill, concorrenza, collisioni, Magici Sorrisi
      e comportamento dello script.
- [ ] Preparare e provare backup, ripristino e migration compensativa secondo
      la sezione «Rollback previsto», includendo dati e privilegi preesistenti.
- [ ] Ottenere revisione e autorizzazione esplicita per l'applicazione;
      l'approvazione di un candidato richiederà autorizzazione separata.

### Quando applicare `20261107174500`

La migration resterà pendente fino a quando saranno soddisfatti **tutti** i
prerequisiti e i test seguenti, la baseline e il piano operativo saranno stati
revisionati, e l'utente avrà autorizzato separatamente l'intervento sul
database. L'applicazione avverrà nella finestra concordata, dopo la
riconciliazione della cronologia e prima di qualsiasi approvazione reale.
Non esiste ancora una data o autorizzazione. La sola revisione di questo
documento non autorizza repair, push, migration o approvazioni.

### Prerequisiti obbligatori

- Backup recente e ripristino provato su ambiente isolato; piano di recupero,
  responsabile, finestra di intervento e modalità di sospensione delle
  scritture concordati.
- Inventario aggiornato di schema, dati interessati, privilegi, dipendenze e
  cronologia; schema e cronologia riconciliati secondo il percorso approvato,
  con un dry-run che elenchi solo le migration effettivamente autorizzate.
  La versione `20261107174500` deve risultare pendente.
- Compatibilità verificata con `providers` e `animator_candidates` effettivi,
  inclusi tipi, vincoli, default, colonne obbligatorie, RLS e permessi.
  La migration aggiunge `provider_type` se assente, esegue backfill sui
  provider e crea trigger che influenzano anche scritture successive: questi
  effetti devono essere accettati e verificati esplicitamente.
- Inventario delle collisioni identitarie e decisione sul loro trattamento,
  compreso `bolledisaponegiganti.com`; non assumere che provider collegati
  siano duplicati. Verificare che il backfill delle chiavi riesca anche in
  presenza di collisioni già esistenti.
- Script di rollback specifico e sua procedura operativa predisposti,
  revisionati e provati su copia rappresentativa. Prima dell'applicazione
  salvare definizioni, privilegi e stato precedente degli oggetti interessati
  e delle righe che potrebbero essere aggiornate, oltre al backup complessivo.
- Per ogni approvazione successiva, verifica aggiornata di candidato, fonti,
  comune, provincia e identità; nuova autorizzazione esplicita per la scrittura.

### Test obbligatori prima della produzione

Su PostgreSQL compatibile e copia isolata rappresentativa, con gli stessi
ruoli, vincoli e dati rilevanti:

1. Verificare sintassi SQL e compilazione PL/pgSQL, applicare **l'intera**
   migration e confrontare oggetti, backfill, trigger, permessi e dati prima e
   dopo; verificare che la sincronizzazione delle identità segua inserimenti,
   aggiornamenti e cancellazioni dei provider.
2. Eseguire la RPC completa: nessun match produce `approved` e crea un solo
   provider; un match produce `duplicate` senza crearne uno; più match
   producono `manual_review`, riportano provider e identità coinvolti e non
   creano provider né cambiano lo stato del candidato. Verificare anche la
   ripetizione di un'approvazione, ID/slug già occupato, input errati,
   permessi e normalizzazione di telefoni, domini e profili social.
3. Esercitare il caso `bolledisaponegiganti.com` con entrambi i provider e
   l'eventuale aggiunta di una nuova identità duplicata tramite trigger.
   Verificare concorrenza e atomicità con transazioni parallele e un errore
   forzato: nessun provider, stato o chiave parziali dopo un fallimento.
4. Eseguire su copia la RPC per Magici Sorrisi con `Vinci` e `FI`,
   controllando tutti i campi persistiti, `approved`, assenza di collisioni e
   ID previsto `provider-magici-sorrisi-vinci` se ancora disponibile; un ID
   occupato comporta il suffisso previsto dal codice. Ripetere i controlli
   d'identità sui dati correnti prima di un'eventuale approvazione reale.
5. Testare lo script
   [`approve-animator-candidate.mjs`](./scripts/approve-animator-candidate.mjs)
   con i tre esiti e con errori, inclusi permessi e RPC non disponibile.
   Provare il rollback e confrontare schema, privilegi e dati con lo stato
   precedente; verificare anche la procedura di recupero da backup.

La precedente simulazione di matching non dimostra l'esito della RPC completa.
L'applicazione della migration non approva automaticamente Magici Sorrisi.

### Rollback previsto

Non esiste attualmente una down migration pronta: è un prerequisito da
realizzare e testare, non un'operazione già verificata. In caso di problemi:

1. Sospendere approvazioni e scritture sui provider, verificare se la migration
   sia stata completamente registrata e quali effetti siano effettivamente
   presenti; conservare log e backup. Non assumere che un errore CLI implichi
   l'assenza di modifiche o che correggere la cronologia annulli lo schema.
2. Applicare solo dopo autorizzazione una migration compensativa, preparata
   dalla fotografia precedente: rimuovere i trigger di sincronizzazione e gli
   oggetti introdotti dalla migration se non più necessari, ripristinando le
   eventuali definizioni e privilegi preesistenti di funzioni sostituite.
   Valutare dipendenze e modifiche successive prima di rimuovere la tabella
   delle chiavi, colonne o valori; non eliminare ciecamente `provider_type`
   o altre colonne che potrebbero essere diventate necessarie.
3. Ripristinare selettivamente i valori precedenti dei provider interessati dai
   backfill solo dopo confronto con le scritture intervenute. Se vi sono state
   approvazioni, riconciliare separatamente provider creati e stati dei
   candidati, verificando dipendenze e dati successivi: il rollback dello
   schema non annulla automaticamente quelle operazioni. Se il ripristino
   selettivo non è sicuro, valutare il recupero dal backup su ambiente isolato
   e un piano approvato per preservare le scritture successive.
4. Verificare dati, trigger, RLS, privilegi e funzionamento applicativo; quindi
   riconciliare la cronologia secondo la procedura Supabase approvata. Non
   usare `migration repair` come sostituto del rollback dello schema o dei dati.

## Punti aperti prima dell'approvazione

- Backup e inventario completo non ancora acquisiti o validati.
- Divergenze e funzionalità mancanti non ancora decise o riconciliate.
- Baseline non ancora testata su copia isolata né dimostrata riproducibile.
- Privilegi e policy non ancora verificati esaustivamente per tutti gli oggetti.
- Migration e RPC di approvazione non ancora eseguite end-to-end in isolamento
  con uno schema rappresentativo. La precedente simulazione di Magici Sorrisi
  ha verificato il matching, non l'intera RPC.
- La collisione del dominio tra Mago Federico e Acse in Gioco richiede una
  decisione sui dati; la gestione `manual_review` non conferma la loro identità.
- `supabase/.temp/` risultava non tracciata durante la verifica; non è stata
  rimossa né inclusa intenzionalmente nella baseline.
