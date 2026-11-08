# Toscana Family Frontend

1. Copia `.env.example` in `.env.local`.
2. Inserisci la publishable key Supabase.
3. Esegui `npm install`.
4. Esegui `npm run build`.
5. Pubblica la cartella `dist` su Netlify.

La secret key o service role key non deve mai essere inserita nel frontend.

Prima di usare l'importatore eventi aggiornato, applica le migrazioni Supabase in `supabase/migrations` per creare i campi di contatto, indirizzo e prenotazione degli eventi. L'importatore legge dati strutturati, metadati, microdata, link e contenuti della pagina sorgente. Con `--write`, inserisce nuovi eventi e completa solo i campi vuoti degli eventi già presenti.

## Discovery animatori nello staging

Il workflow `.github/workflows/discover-animators.yml` usa esclusivamente il
progetto staging `eqonpqgazhmjbrjtexmg`. Configurare i secret GitHub
`STAGING_SUPABASE_URL` e `STAGING_SUPABASE_SECRET_KEY` con l'URL e la service
role key dello staging; non usare credenziali di produzione. La migration
`20261107174500_approve_animator_candidates.sql` deve essere già installata
nello staging. Il workflow non installa migration.

La discovery esamina le fonti configurate in `data/animator-sources.json` e
rivede tutti i candidati `pending_review`, anche se non sono stati scoperti
durante la nuova esecuzione. I candidati con `quality_score >= 90` sono
elaborati prima degli altri. Per ciascuno esamina tutti i campi mancanti e
visita le fonti associate, il sito e i profili disponibili. Segue i link
pertinenti a contatti, privacy, cookie, termini, informazioni aziendali,
servizi, feste, animazione, FAQ e copertura; esamina anche footer, dati
strutturati, link `tel:` e WhatsApp. Le pagine contatti hanno priorità, seguite
dal sito e dalle altre pagine pertinenti; lo storico può modificare questa
priorità. I candidati sono ordinati per punteggio decrescente. Ogni URL viene visitato al massimo
una volta per candidato, fino a esaurire i link noti. Solo dopo l'arricchimento
di tutti i candidati vengono verificati i duplicati e l'idoneità.

Vengono completati solo i campi vuoti, con la relativa fonte, e il punteggio
viene ricalcolato dopo ogni pagina. Il report riporta ciascun campo trovato,
valore, URL, numero e tipo del tentativo, più `enrichment_attempts` (pagine
richieste, incluse quelle fallite), `enrichment_successes` (campi completati)
ed `enrichment_failures` (richieste o redirect falliti)
per candidato e complessivi. Errori HTTP, DNS e timeout sono riportati e non
impediscono di provare le altre fonti. Gli URL falliti sul dominio del sito
ufficiale vengono conservati nello storico e riprovati nel run successivo;
gli URL iniziali e quelli esterni nuovamente collegati vengono riprovati
quando disponibili. Il report include data, pagina e i punteggi di categoria,
oltre alla sezione `QUASI APPROVATI` e ai requisiti ancora mancanti.

Non si effettuano ricerche web generiche: se una fonte non è configurata o
collegata, occorre aggiungerla dopo averne verificato l'identità. Le pagine
collegate devono essere sul sito ufficiale; privacy e termini ospitati su
Iubenda sono ammessi solo se collegati direttamente dal sito del candidato e
verificati nella stessa esecuzione. Altri servizi esterni non sono esplorati.
Un sito collegato da un social noto viene usato solo se unico e se rimanda
allo stesso profilo social.
Gli indirizzi testuali vengono usati se indicano una località con sigla
provinciale toscana, un capoluogo con CAP coerente o una sede esplicita con
un unico comune riconoscibile nell'elenco ISTAT; indirizzi
multipli discordanti sulla stessa pagina non vengono scelti automaticamente. Non si deduce la sede dalla
zona servita. I risultati automatici richiedono comunque verifica editoriale
della categoria: una sala feste o un noleggio non sono necessariamente un
animatore.

La provincia di una città già documentata può essere dedotta dal dataset
locale `data/istat-comuni-toscana.json`, derivato dall'[elenco ISTAT dei comuni](https://www.istat.it/classificazione/codici-dei-comuni-delle-province-e-delle-regioni/)
del 21 febbraio 2026. Non si deduce un comune dal solo CAP o da una via: la
sede deve essere verificabile. Il dataset va aggiornato quando cambia l'elenco
ISTAT.

Lo storico `animator-learning.json` raccoglie i tipi di pagina e gli URL di
provenienza registrati per gli approved; non ricostruisce pattern assenti.
Le frequenze sono conteggi di fonti associate ad approvati, **non** probabilità
statistiche di affidabilità: non sono disponibili esempi negativi etichettati.
Il workflow ripristina lo storico dall'ultimo artifact disponibile di un run
riuscito e ne carica uno nuovo con conservazione di 90 giorni; se è scaduto
riparte dagli approved correnti. Il dry-run non scrive lo storico.

Il punteggio assegna 40 punti al telefono, 30 al sito, 20 al primo social
presente e altri 10 al secondo: telefono, sito e un social valgono 90 punti;
con entrambi i social si raggiunge 100. Il punteggio misura la presenza dei
campi; la validità dei contatti e le relative fonti sono controllate
separatamente prima dell'approvazione.
La classificazione animatore somma segnali testuali distinti: animazione,
animatori, feste per bambini, compleanni, baby dance, truccabimbi, magia,
spettacoli, laboratori creativi, intrattenimento e giochi. Un riferimento
congiunto ad animazione/animatori e a bambini o compleanni aggiunge evidenza.
Le categorie sono indipendenti: un candidato può essere animatore insieme a
sala_feste, allestimenti, gonfiabili o eventi; le attività miste non lo
squalificano. Altri segnali di categoria vengono riportati separatamente.

Il report classifica i candidati idonei come `approved_auto`
(`confidence_animatore >= 80`), `approved_probable`
(`confidence_animatore >= 60`, richiede verifica leggera), `pending_review`
o `duplicate`. `approved_probable` è considerato pubblicabile dopo la verifica
leggera; la sezione `QUASI APPROVATI` evidenzia i candidati promossi e ciò che
manca agli altri. In `--dry-run` questi sono esiti simulati: non cambiano lo
stato persistito e non chiamano la RPC. Nelle esecuzioni con scrittura solo
`approved_auto` viene passato alla RPC; `approved_probable` resta
`pending_review` nel database finché non termina la verifica editoriale.
La classificazione non riduce i controlli: per essere
promosso il candidato deve comunque avere `quality_score >= 90`, telefono,
sito, comune e provincia toscana verificati, almeno un social ufficiale con
fonte valida e nessun duplicato tra candidati o provider. Province non toscane,
fonti non verificabili e collisioni continuano a impedire la promozione.
Con `ANIMATOR_AUTO_APPROVE=true`, solo `approved_auto` viene passato alla RPC;
`approved_probable` è segnalato nel report per la verifica editoriale e non
viene inserito automaticamente. Queste confidenze sono punteggi euristici,
non probabilità calibrate. Servizi, copertura e il secondo social non sono
obbligatori per la promozione, ma restano indicati fra i dati mancanti.
Possibili duplicati fra candidati o provider,
assenza di fonti verificabili e province non ammesse impediscono l'approvazione;
la RPC può inoltre rilevare collisioni e restituire `duplicate` o
`manual_review`, anche in caso di modifiche concorrenti. Quest'ultimo
resta persistito come `pending_review`. Verificare il report allegato per
distinguere i casi. La query verifica la creazione e la categoria dei provider.

Per una simulazione locale senza scritture, usando credenziali di staging:

```powershell
$env:SUPABASE_URL = "https://eqonpqgazhmjbrjtexmg.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service-role-key-staging>"
node scripts/discover-animators.mjs --dry-run
```

Per simulare esclusivamente i candidati già salvati con stato `pending_review`,
senza includere quelli appena scoperti dalle fonti, aggiungere `--pending-only`:

```powershell
node scripts/discover-animators.mjs --dry-run --pending-only
```

`--pending-only` è rifiutato senza `--dry-run` e non può essere combinato con
`--source-url`.
Il comando effettua letture sul database e richieste alle fonti pubbliche, ma
non modifica dati né chiama la RPC; gli stati del report sono esiti simulati
e non aggiornano lo stato persistito dei candidati. Senza `--dry-run`, lo script rifiuta
qualsiasi progetto diverso dallo staging; l'approvazione automatica è attiva
solo se `ANIMATOR_AUTO_APPROVE=true`. `--source-url=<URL>` restringe la
discovery iniziale, non la revisione delle fonti degli altri candidati.
Eseguire i test isolati con `node --test scripts/discover-animators.test.mjs`.

## Publish Approved Animators: solo dry-run

Il workflow manuale `.github/workflows/publish-approved-animators.yml` genera
un piano di pubblicazione, senza eseguire pubblicazioni né chiamare RPC. Lo
script `scripts/publish-approved-animators.mjs` accetta solo `--dry-run` e
consente esclusivamente richieste HTTP GET e HEAD ai progetti Supabase previsti.
Anche `syncApprovedAnimators()` è una funzione pura che prepara il piano:
non implementa inserimenti, aggiornamenti o cancellazioni.

Configurare nei secret GitHub `STAGING_SUPABASE_URL` e
`PRODUCTION_SUPABASE_URL` con gli URL rispettivamente dei progetti
`eqonpqgazhmjbrjtexmg` e `yihognpbnhdolsnmicwi`, e
`STAGING_SUPABASE_READ_ONLY_KEY` e `PRODUCTION_SUPABASE_READ_ONLY_KEY` con
credenziali dedicate e **di sola lettura**. Non usare la service role key:
il database deve negare scritture indipendentemente dal blocco lato script.
Le credenziali devono poter leggere tutti gli `animator_candidates` approvati
e tutti i `providers` nello staging, e tutti i `providers` in produzione,
inclusi quelli nascosti da RLS. Predisporre autorizzazioni e policy appropriate
separatamente: il workflow non modifica policy. Il conteggio esatto e la
paginazione verificano solo i record visibili, non la completezza rispetto
alle policy RLS. Verificare tale visibilità prima di considerare attendibile il
report: una chiave pubblica potrebbe produrre risultati incompleti. Il
conteggio stabile non garantisce uno snapshot coerente se i dati cambiano
durante la lettura; rieseguire la simulazione prima di ogni valutazione.

Avviare manualmente il workflow dalla scheda Actions; la summary e l'artifact
`publish-approved-animators-report` contengono il report e i payload proposti.
Il report può includere note e contatti dei provider: limitarne l'accesso e
la conservazione secondo le policy del progetto.

Vengono considerati solo candidati `approved`, collegati al provider staging.
Sono pubblicabili soltanto provider non di test, classificati come animatori,
con città, sigla provinciale toscana maiuscola, telefono valido, sito HTTP(S),
un profilo Facebook o Instagram valido nel campo `social_url` e nessuna
corrispondenza rilevata. Il controllo verifica la forma dei contatti, non che
il sito sia attivo o che il social sia ufficiale. Nome, telefono, dominio
website e profili social vengono confrontati anche con tutte le categorie
produttive; l'ID è un controllo supplementare. Un singolo match telefono o
social con un animatore è classificato duplicato; un solo nome o dominio,
corrispondenze multiple, collisioni con altre categorie o solo ID richiedono
revisione. Anche possibili duplicati fra approved nello staging sono bloccati.
Le euristiche possono sia confondere attività con contatti condivisi sia
non riconoscere duplicati con dati diversi: occorre una verifica manuale.
I record di test sono riconosciuti dalla parola `test` nel nome o nell'ID,
delimitata da spazi, trattini o underscore: altri record di prova potrebbero
richiedere identificazione manuale.

Il piano copia, senza trasformazioni, solo `id`, `name`, `provider_kind`,
`provider_type`, `party_type`, `city`, `province`, `phone`, `website`,
`social_url`, `services`, `coverage_area`, `notes` e `source_url`. Non è
previsto un comando di scrittura: una futura pubblicazione richiederà una
progettazione e autorizzazione separate, inclusi controlli di concorrenza.
Eseguire i test con `node --test scripts/publish-approved-animators.test.mjs`.
