# Toscana Family Frontend

1. Copia `.env.example` in `.env.local`.
2. Inserisci la publishable key Supabase.
3. Esegui `npm install`.
4. Esegui `npm run build`.
5. Pubblica la cartella `dist` su Netlify.

La secret key o service role key non deve mai essere inserita nel frontend.

Prima di usare l'importatore eventi aggiornato, applica le migrazioni Supabase in `supabase/migrations` per creare i campi di contatto, indirizzo e prenotazione degli eventi. L'importatore legge dati strutturati, metadati, microdata, link e contenuti della pagina sorgente. Con `--write`, inserisce nuovi eventi e completa solo i campi vuoti degli eventi già presenti.

## Importazione parchi OpenStreetMap

`scripts/import-osm.mjs` cerca nella stessa area geografica usata in precedenza
`leisure=park`, `garden`, `nature_reserve`, `playground` e `indoor_play`.
Elabora prima i parchi; un playground interamente contenuto nel perimetro di
un parco rappresentato non viene inserito separatamente. Sono supportati
poligoni OSM e relazioni multipolygon/boundary complete; geometrie incomplete
o ambigue non vengono considerate una prova di contenimento. I playground
già presenti sono conservati, comprese recensioni e segnalazioni: eventuali
duplicati sono riportati nei log per una revisione manuale. Un possibile
duplicato con lo stesso nome e stesso comune, comune sconosciuto, oppure entro
200 metri se entrambi hanno coordinate, non viene importato automaticamente. Il confronto non
identifica tutti i duplicati, soprattutto nomi differenti o confini complessi.

Lo script conserva i valori esistenti, completa solo campi vuoti e sostituisce
solo nomi generici con nomi più informativi. Per un oggetto senza nome usa
indirizzo, quartiere o comune; senza elementi sufficienti lo segnala e lo
salta. Comune nullo non causa l'esclusione: si prova prima a ricavarlo dalle
coordinate. Per relazioni e poligoni il punto è il centro del rettangolo
delimitante, che può cadere fuori da un'area irregolare; verificare
manualmente coordinate e geocodifica prima della pubblicazione.

I tag OSM e la cache `data/reverse-geocode-parks-cache.json` vengono usati
per completare `comune`, `city`, `provincia`, `province`, `indirizzo` e
`address`; una provincia toscana mancante può essere dedotta da un comune
univoco tramite il dataset ISTAT già usato dalla discovery. Per risultati non
in cache configurare `REVERSE_GEOCODE_URL` con un endpoint **HTTPS autorizzato**
compatibile con la risposta Nominatim `jsonv2` e le condizioni del fornitore.
Il servizio pubblico `nominatim.openstreetmap.org` è rifiutato per evitare
richieste massive automatiche. Senza endpoint né cache i campi mancanti
restano tali; i record nominati possono comunque essere importati e quelli
senza nome o località sono segnalati. L'app può ancora escludere un record
privo di comune e provincia: verificare i campi prima di considerarlo visibile.
Il reverse geocoding può associare strade o confini vicini e va verificato.

Il workflow `.github/workflows/import-osm.yml` esegue **solo anteprime** sia
su pianificazione sia su avvio manuale; per scrivere occorre selezionare
esplicitamente `write` nell'avvio manuale. Configurare il servizio autorizzato
con la variabile GitHub `PARK_REVERSE_GEOCODE_URL`; configurare i secret
`SUPABASE_URL` e `SUPABASE_SECRET_KEY` per il progetto previsto. La chiave
deve permettere la lettura completa della tabella, altrimenti i controlli
duplicati potrebbero essere incompleti. In locale, con le variabili
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e, facoltativamente,
`REVERSE_GEOCODE_URL` impostate nell'ambiente:

```powershell
node scripts/import-osm.mjs
# Solo dopo verifica dell'anteprima:
node scripts/import-osm.mjs --write
node --test scripts/import-osm.test.mjs scripts/reverse-geocode-parks.test.mjs
```

Il report nei log conta trovati, nuovi, aggiornati, duplicati, esclusi ed
errori; in anteprima i conteggi sono simulati. Errori di rete o database
sono segnalati e producono un esito non riuscito; una scrittura può aver
già salvato gli altri record, quindi controllare il report prima di ripetere.
Lo script separato `scripts/reverse-geocode-parks.mjs` considera anche parchi
con nome e completa i campi vuoti in entrambe le lingue; usa la stessa cache
e, per richieste non presenti in cache, richiede `REVERSE_GEOCODE_URL`.

## Discovery animatori nello staging

Il workflow `.github/workflows/discover-animators.yml` usa esclusivamente il
progetto staging `eqonpqgazhmjbrjtexmg`. Configurare i secret GitHub
`STAGING_SUPABASE_URL` e `STAGING_SUPABASE_SECRET_KEY` con l'URL e la service
role key dello staging; non usare credenziali di produzione. Le migration `20261107174500_approve_animator_candidates.sql` e
`20261116194500_animator_publication.sql` devono essere già installate nello
staging. Il workflow non installa migration.

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
stato persistito e non chiamano la RPC. Con scrittura e
`ANIMATOR_AUTO_APPROVE=true`, `approved_probable` viene salvato direttamente;
`approved_auto` passa prima dalla RPC di staging e, se approvato, viene
salvato con il nuovo stato. Se la RPC crea il provider ma il successivo
aggiornamento dello stato fallisce, il run fallisce: il candidato può rimanere
`approved` e richiede una verifica manuale prima di riprovare.
La classificazione non riduce i controlli: per essere
promosso il candidato deve comunque avere `quality_score >= 90`, telefono,
sito, comune e provincia toscana verificati, almeno un social ufficiale con
fonte valida e nessun duplicato tra candidati o provider. Province non toscane,
fonti non verificabili e collisioni continuano a impedire la promozione.
Con `ANIMATOR_AUTO_APPROVE=true`, solo `approved_auto` viene passato alla RPC;
`approved_probable` resta contrassegnato come da verificare leggermente, ma è
selezionabile dal publisher. Queste confidenze sono punteggi euristici,
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

## Publish Approved Animators

**Il workflow manuale scrive in produzione.** Prima di abilitarlo, applicare
`20261116194500_animator_publication.sql` a staging e produzione dopo le
migration precedenti e verificare schema e policy di entrambi i progetti. La
migration aggiunge `published_at` e i nuovi stati ai candidati dove la tabella
esiste, più i campi di pubblicazione su `providers`. I vecchi candidati
`approved` non vengono modificati né pubblicati automaticamente.

Configurare `STAGING_SUPABASE_URL`, `PRODUCTION_SUPABASE_URL`,
`STAGING_SUPABASE_SECRET_KEY` e `PRODUCTION_SUPABASE_SECRET_KEY`. Le credenziali
devono poter leggere tutti i provider e i candidati pertinenti, scrivere i
provider in produzione e aggiornare `published_at` nello staging; policy RLS
incomplete possono nascondere duplicati. Limitare l'accesso ai secret e
all'avvio manuale del workflow.

L'esecuzione richiede esplicitamente:

```powershell
node scripts/publish-approved-animators.mjs --write
```

Non esiste un'opzione dry-run per il publisher. Sono selezionati solo i
candidati `approved_auto` o `approved_probable` con `published_at` nullo:
verificare leggermente i `probable` prima di avviare il workflow. Il publisher
ricontrolla punteggio, fonti, telefono, sito, social e comune/provincia ISTAT
e cerca duplicati per nome normalizzato, dominio, slug, telefono e social
contro tutti i provider; collisioni tra candidati e record di test sono
bloccati. Gli errori e il riepilogo sono riportati nella summary e nell'artifact.

I provider sono inseriti tramite upsert senza sovrascrivere record esistenti,
con `active=true` e `source=animator_discovery`. L'identificativo univoco
`animator_candidate_id` consente di riprendere la marcatura se l'inserimento
riesce ma l'aggiornamento di `published_at` fallisce. In tal caso il run
segnala errore e va ripetuto dopo aver verificato i dati.

**Concorrenza:** staging e produzione non condividono una transazione. Il
workflow serializza le proprie esecuzioni e ricontrolla i duplicati subito
prima dell'inserimento, ma non impedisce a processi esterni di creare un
duplicato tra controllo e upsert. Coordinare tutte le altre scritture durante
la pubblicazione; il conteggio e i controlli dipendono inoltre dalla visibilità
delle credenziali. Il publisher non installa migration né modifica policy.
Eseguire i test isolati con
`node --test scripts/discover-animators.test.mjs scripts/publish-approved-animators.test.mjs`.
