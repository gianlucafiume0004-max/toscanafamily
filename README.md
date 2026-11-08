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
durante la nuova esecuzione. Per ciascuno visita le fonti associate, il sito e
i profili disponibili, segue un numero limitato di pagine contatti e aggiorna
solo i campi mancanti con la relativa fonte. Errori di rete e limite di pagine
sono indicati nel report. Non effettua ricerche web generiche: se una fonte
non è configurata o collegata, occorre aggiungerla dopo averne verificato
l'identità. Non deduce la sede dalla zona servita.

Il punteggio assegna 40 punti al telefono, 30 al sito, 20 al primo social
presente e altri 10 al secondo: telefono, sito e un social valgono 90 punti;
con entrambi i social si raggiunge 100. Il punteggio misura la presenza dei
campi; la validità dei contatti e le relative fonti sono controllate
separatamente prima dell'approvazione.
Con `ANIMATOR_AUTO_APPROVE=true`, il workflow approva tramite RPC solo con
punteggio almeno 90, telefono, sito, comune e provincia toscana validi, almeno
un social ufficiale verificato (Facebook oppure Instagram), relative fonti e
nessun duplicato rilevato. Servizi, copertura e il secondo social non sono
obbligatori per l'approvazione, ma restano indicati fra i dati mancanti.
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
$env:ANIMATOR_AUTO_APPROVE = "true"
node scripts/discover-animators.mjs --dry-run
```

Il comando effettua letture sul database e richieste alle fonti pubbliche, ma
non modifica dati né chiama la RPC. Senza `--dry-run`, lo script rifiuta
qualsiasi progetto diverso dallo staging; l'approvazione automatica è attiva
solo se `ANIMATOR_AUTO_APPROVE=true`. `--source-url=<URL>` restringe la
discovery iniziale, non la revisione delle fonti degli altri candidati.
Eseguire i test isolati con `node --test scripts/discover-animators.test.mjs`.
