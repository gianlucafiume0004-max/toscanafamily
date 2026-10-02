import fs from "node:fs/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const CONTACT = process.env.NOMINATIM_CONTACT;
const WRITE = process.argv.includes("--write");
const limitArg = process.argv.find((x) => x.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 180;
const CACHE_FILE = "geocode-cache.json";
const LOG_FILE = "geocode-results.csv";
const WAIT_MS = 1200;

if (!URL || !SECRET || !CONTACT) {
  console.error("Mancano SUPABASE_URL, SUPABASE_SECRET_KEY o NOMINATIM_CONTACT.");
  process.exit(1);
}

const supabase = createClient(URL, SECRET, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const csv = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;

async function readCache() {
  try { return JSON.parse(await fs.readFile(CACHE_FILE, "utf8")); }
  catch { return {}; }
}

async function searchNominatim(query) {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "3",
    countrycodes: "it",
    addressdetails: "1",
    email: CONTACT,
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: {
      "User-Agent": `ToscanaFamily-Geocoder/1.0 (${CONTACT})`,
      "Accept-Language": "it",
    },
  });

  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  return response.json();
}

function chooseResult(results) {
  return results.find((r) => {
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= 42.7 && lat <= 44.5 && lon >= 9.6 && lon <= 12.5;
  }) || null;
}

function buildQueries(park) {
  const address = park.indirizzo && !/da verificare/i.test(park.indirizzo)
    ? park.indirizzo : "";
  return [
    [park.nome, address, park.comune, park.provincia, "Toscana", "Italia"],
    [address, park.comune, park.provincia, "Toscana", "Italia"],
    [park.nome, park.comune, "Toscana", "Italia"],
  ]
    .map((parts) => parts.filter(Boolean).join(", "))
    .filter((q, i, arr) => q && arr.indexOf(q) === i);
}

async function main() {
  console.log(WRITE ? "MODALITA SCRITTURA" : "ANTEPRIMA: nessuna modifica a Supabase");

  const { data: parks, error } = await supabase
    .from("parks")
    .select("id,nome,comune,provincia,indirizzo,latitudine,longitudine")
    .or("latitudine.is.null,longitudine.is.null")
    .limit(LIMIT);

  if (error) throw error;

  const cache = await readCache();
  const rows = ["id,nome,comune,query,latitudine,longitudine,display_name,esito"];
  let found = 0;
  let updated = 0;

  for (const [index, park] of parks.entries()) {
    console.log(`[${index + 1}/${parks.length}] ${park.nome} - ${park.comune}`);
    let selected = null;
    let usedQuery = "";

    for (const query of buildQueries(park)) {
      usedQuery = query;
      let results = cache[query];
      if (!results) {
        results = await searchNominatim(query);
        cache[query] = results;
        await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
        await sleep(WAIT_MS);
      }
      selected = chooseResult(results);
      if (selected) break;
    }

    if (!selected) {
      rows.push([park.id, park.nome, park.comune, usedQuery, "", "", "", "NON TROVATO"].map(csv).join(","));
      continue;
    }

    found++;
    const lat = Number(selected.lat);
    const lon = Number(selected.lon);
    console.log(`  -> ${lat}, ${lon} | ${selected.display_name}`);

    if (WRITE) {
      const { error: updateError } = await supabase
        .from("parks")
        .update({ latitudine: lat, longitudine: lon })
        .eq("id", park.id);
      if (updateError) {
        rows.push([park.id, park.nome, park.comune, usedQuery, lat, lon, selected.display_name, `ERRORE: ${updateError.message}`].map(csv).join(","));
        continue;
      }
      updated++;
    }

    rows.push([park.id, park.nome, park.comune, usedQuery, lat, lon, selected.display_name, WRITE ? "AGGIORNATO" : "ANTEPRIMA"].map(csv).join(","));
  }

  await fs.writeFile(LOG_FILE, rows.join("\n"), "utf8");
  console.log(`Finito. Trovati: ${found}. Aggiornati: ${updated}.`);
  console.log(`Controlla ${LOG_FILE} prima di usare --write.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
