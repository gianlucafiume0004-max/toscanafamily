# Toscana Family Frontend

1. Copia `.env.example` in `.env.local`.
2. Inserisci la publishable key Supabase.
3. Esegui `npm install`.
4. Esegui `npm run build`.
5. Pubblica la cartella `dist` su Netlify.

La secret key o service role key non deve mai essere inserita nel frontend.

Prima di usare l'importatore eventi aggiornato, applica le migrazioni Supabase in `supabase/migrations` per creare i campi di contatto, indirizzo e prenotazione degli eventi. L'importatore legge dati strutturati, metadati, microdata, link e contenuti della pagina sorgente. Con `--write`, inserisce nuovi eventi e completa solo i campi vuoti degli eventi già presenti.
