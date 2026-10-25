import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(projectRoot, ".env") });
dotenv.config({ path: resolve(projectRoot, ".env.local") });

const CACHE_FILE = resolve(projectRoot, "data", "reverse-geocode-parks-cache.json");
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const REQUEST_INTERVAL_MS = 1100;
const MAX_RETRIES = 3;
const MAX_PAGE_SIZE = 500;
const USER_AGENT_CONTACT =
  process.env.NOMINATIM_CONTACT || process.env.TOSCANAFAMILY_CONTACT_EMAIL || "";
const USER_AGENT = USER_AGENT_CONTACT
  ? `ToscanaFamily-ReverseGeocoder/1.0 (${USER_AGENT_CONTACT})`
  : "ToscanaFamily-ReverseGeocoder/1.0";

function parseArguments(args) {
  const options = { write: false, limit: Infinity, name: null };
  let limitProvided = false;
  let nameProvided = false;

  for (const arg of args) {
    if (arg === "--write") {
      if (options.write) throw new Error("L'opzione --write può essere specificata una sola volta.");
      options.write = true;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      if (limitProvided) throw new Error("L'opzione --limit può essere specificata una sola volta.");
      const value = arg.slice("--limit=".length);
      const limit = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(limit) || limit < 1) {
        throw new Error("Il limite deve essere un intero positivo, ad esempio --limit=5.");
      }
      options.limit = limit;
      limitProvided = true;
      continue;
    }

    if (arg.startsWith("--name=")) {
      if (nameProvided) throw new Error("L'opzione --name può essere specificata una sola volta.");
      const value = arg.slice("--name=".length).trim();
      if (!value) throw new Error("Il nome del parco non può essere vuoto.");
      options.name = value.toLocaleLowerCase("it-IT");
      nameProvided = true;
      continue;
    }

    throw new Error(`Argomento non riconosciuto: ${arg}`);
  }

  return options;
}

function normalizeName(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isGenericParkName(value) {
  const name = normalizeName(value);
  return name === "area gioco" || name === "area giochi";
}

function isBlank(value) {
  return value == null || (typeof value === "string" && !value.trim());
}

function parseCoordinate(value, minimum, maximum) {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || coordinate < minimum || coordinate > maximum) return null;
  return coordinate;
}

function coordinateKey(latitude, longitude) {
  return `${latitude.toFixed(7)},${longitude.toFixed(7)}`;
}

function firstNonBlank(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() ?? "";
}

function mapAddress(result) {
  const address = result?.address;
  if (!address || typeof address !== "object" || Array.isArray(address)) {
    return { error: "La risposta Nominatim non contiene un indirizzo." };
  }

  const comune = firstNonBlank(
    address.city,
    address.town,
    address.village,
    address.municipality
  );
  const street = firstNonBlank(address.road, address.pedestrian);
  const houseNumber = firstNonBlank(address.house_number);
  const indirizzo = [street, houseNumber].filter(Boolean).join(" ");
  const provincia = firstNonBlank(address.county, address.state_district);
  const regione = firstNonBlank(address.state);
  const values = { comune, indirizzo, provincia };

  if (!Object.values(values).some(Boolean)) {
    return { error: "La risposta non contiene Comune, via o provincia utilizzabili." };
  }

  return { values, regione };
}

function getRetryAfterMs(response) {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return 0;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const retryAt = Date.parse(retryAfter);
  return Number.isNaN(retryAt) ? 0 : Math.max(0, retryAt - Date.now());
}

const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

let lastRequestAt = null;

async function waitForRequestInterval() {
  if (lastRequestAt === null) return;
  const elapsed = performance.now() - lastRequestAt;
  if (elapsed < REQUEST_INTERVAL_MS) {
    await sleep(REQUEST_INTERVAL_MS - elapsed);
  }
}

async function requestReverseGeocode(latitude, longitude) {
  const url = new URL(NOMINATIM_ENDPOINT);
  url.search = new URLSearchParams({
    lat: latitude.toFixed(7),
    lon: longitude.toFixed(7),
    format: "jsonv2",
    addressdetails: "1",
    "accept-language": "it",
    zoom: "18"
  }).toString();
  if (USER_AGENT_CONTACT) url.searchParams.set("email", USER_AGENT_CONTACT);

  let lastError = "Errore Nominatim non specificato.";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) await sleep(1000 * (2 ** (attempt - 1)));
    await waitForRequestInterval();
    lastRequestAt = performance.now();

    let response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "it"
        },
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      lastError = `Errore di rete: ${error.message}`;
      if (attempt === MAX_RETRIES) break;
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      lastError = `Nominatim HTTP ${response.status}`;
      if (attempt === MAX_RETRIES) break;
      const retryAfterMs = response.status === 429 ? getRetryAfterMs(response) : 0;
      if (retryAfterMs > 0) await sleep(retryAfterMs);
      continue;
    }

    if (!response.ok) {
      return { error: `Nominatim HTTP ${response.status}` };
    }

    let result;
    try {
      result = await response.json();
    } catch (error) {
      lastError = `Risposta JSON non valida: ${error.message}`;
      if (attempt === MAX_RETRIES) break;
      continue;
    }

    const mapped = mapAddress(result);
    if (mapped.error) return mapped;
    return {
      values: mapped.values,
      regione: mapped.regione,
      displayName: typeof result.display_name === "string" ? result.display_name : ""
    };
  }

  return { error: `${lastError} (tentativi esauriti)` };
}

async function loadCache() {
  try {
    const parsed = JSON.parse(await readFile(CACHE_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Il file cache deve contenere un oggetto JSON.");
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Impossibile leggere la cache ${CACHE_FILE}: ${error.message}`);
  }
}

async function saveCache(cache) {
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

async function loadCandidates(supabase, limit, name) {
  const candidates = [];

  for (let offset = 0; ; offset += MAX_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("parks")
      .select("id, nome, comune, indirizzo, provincia, latitudine, longitudine")
      .order("id", { ascending: true })
      .range(offset, offset + MAX_PAGE_SIZE - 1);

    if (error) throw new Error(`Impossibile leggere i parchi da Supabase: ${error.message}`);

    for (const park of data ?? []) {
      const matchesName = typeof park.nome === "string" &&
        park.nome.trim().toLocaleLowerCase("it-IT") === name;
      if ((name === null ? !isGenericParkName(park.nome) : !matchesName) || !isBlank(park.comune)) continue;
      const latitude = parseCoordinate(park.latitudine, -90, 90);
      const longitude = parseCoordinate(park.longitudine, -180, 180);
      if (latitude === null || longitude === null) continue;

      candidates.push({ park, latitude, longitude });
      if (candidates.length >= limit) return candidates;
    }

    if (!data || data.length < MAX_PAGE_SIZE) return candidates;
  }
}

async function writeParkFields(supabase, park, values) {
  const updates = {};
  const writableFields = [];

  for (const field of ["comune", "indirizzo", "provincia"]) {
    if (!values[field] || !isBlank(park[field])) continue;
    updates[field] = values[field];
    writableFields.push(field);
  }

  if (writableFields.length === 0) return "Nessun campo vuoto da aggiornare";

  let query = supabase.from("parks").update(updates).eq("id", park.id);
  for (const field of writableFields) {
    query = isBlank(park[field]) && park[field] != null
      ? query.eq(field, park[field])
      : query.is(field, null);
  }

  const { data, error } = await query.select("id");
  if (error) return `Errore aggiornamento Supabase: ${error.message}`;
  if (!data?.length) return "Record non aggiornato: i campi sono cambiati o non sono scrivibili";
  return "Aggiornato";
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Mancano SUPABASE_URL e una chiave Supabase configurata nell'ambiente.");
  }
  if (options.write && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Per --write è richiesta la variabile SUPABASE_SERVICE_ROLE_KEY.");
  }
  if (!USER_AGENT_CONTACT) {
    console.warn("NOMINATIM_CONTACT non configurato: User-Agent identificato dall'app, senza recapito.");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const candidates = await loadCandidates(supabase, options.limit, options.name);
  const cache = await loadCache();
  const results = [];

  console.log(options.write
    ? "MODALITÀ SCRITTURA: aggiorno solo campi vuoti dei record elaborati con risposta valida."
    : "ANTEPRIMA: nessuna modifica a Supabase.");
  console.log(`Record selezionati: ${candidates.length}`);

  for (const { park, latitude, longitude } of candidates) {
    const key = coordinateKey(latitude, longitude);
    let cached = cache[key];

    if (!cached) {
      const response = await requestReverseGeocode(latitude, longitude);
      cached = {
        status: response.error ? "failed" : "success",
        values: response.values ?? null,
        regione: response.regione ?? "",
        displayName: response.displayName ?? "",
        error: response.error ?? null,
        cachedAt: new Date().toISOString()
      };
      cache[key] = cached;
    }

    let writeResult = options.write ? "Non aggiornato" : "Preview";
    if (cached.status === "success") {
      const regione = typeof cached.regione === "string" ? cached.regione.trim() : "";
      if (normalizeName(regione) !== "toscana") {
        writeResult = regione ? `Fuori Toscana: ${regione}` : "Regione mancante o non riconosciuta";
        if (regione) {
          console.warn(`⛔ FUORI TOSCANA: ${park.nome} → ${regione}`);
        } else {
          console.warn(`⚠ REGIONE NON RICONOSCIUTA: ${park.nome} → (mancante)`);
        }
      } else if (options.write) {
        writeResult = await writeParkFields(supabase, park, cached.values);
      }
    }

    const values = cached.values ?? {};
    results.push({
      id: park.id,
      latitudine: latitude,
      longitudine: longitude,
      comune: values.comune || "(mancante)",
      indirizzo: values.indirizzo || "(mancante)",
      provincia: values.provincia || "(mancante)",
      esito: cached.error || writeResult
    });

    await saveCache(cache);
  }

  console.table(results);
  if (results.some((result) => result.esito.includes("mancante"))) {
    console.warn("Alcune risposte non hanno restituito tutti i campi richiesti; sono indicati come (mancante).");
  }
  const failures = results.filter((result) =>
    result.esito.startsWith("Errore") ||
    result.esito.includes("tentativi esauriti") ||
    result.esito.includes("senza indirizzo") ||
    result.esito.includes("non contiene")
  );
  if (failures.length) {
    console.error(`Record con errori o risposta non valida: ${failures.length}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
