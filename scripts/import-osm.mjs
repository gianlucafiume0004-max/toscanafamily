import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { loadMunicipalities, normalize as normalizeMunicipality } from "./animator-learning.mjs";

const BBOX = "(43.55,10.65,44.20,11.45)";
const PARK_TYPES = new Set(["park", "garden", "nature_reserve"]);
const PLAY_TYPES = new Set(["playground", "indoor_play"]);
const TYPES = [...PARK_TYPES, ...PLAY_TYPES];
const OVERPASS_URL = "https://lz4.overpass-api.de/api/interpreter";
const CACHE_PATH = new URL("../data/reverse-geocode-parks-cache.json", import.meta.url);
const QUERY = [
  "[out:json][timeout:180];",
  "(",
  ...TYPES.map((type) => `  nwr["leisure"="${type}"]${BBOX};`),
  ");",
  "out body geom;"
].join("\n");

const text = (value) => typeof value === "string" ? value.trim() : "";
const normalize = (value) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("it-IT").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
const hasValue = (value) => value != null && (typeof value !== "string" || Boolean(value.trim()));
const isGeneric = (value) => /^(area giochi|area gioco|parco|giardino)$/i.test(text(value));

function coordinates(item) {
  if (Number.isFinite(item.lat) && Number.isFinite(item.lon)) return { lat: item.lat, lon: item.lon };
  const points = item.geometry ?? item.members?.flatMap((member) => member.geometry ?? []) ?? [];
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!valid.length) return null;
  const bounds = valid.reduce((result, p) => ({
    minLat: Math.min(result.minLat, p.lat), maxLat: Math.max(result.maxLat, p.lat),
    minLon: Math.min(result.minLon, p.lon), maxLon: Math.max(result.maxLon, p.lon)
  }), { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity });
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lon: (bounds.minLon + bounds.maxLon) / 2
  };
}

const samePoint = (a, b) => a.lat === b.lat && a.lon === b.lon;

function polygon(item) {
  if (item.type !== "way" || !Array.isArray(item.geometry)) return null;
  const points = item.geometry;
  if (points.length < 4) return null;
  if (points.some((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lon))) return null;
  const first = points[0], last = points[points.length - 1];
  if (!samePoint(first, last)) return null;
  return points;
}

function relationRings(members) {
  const pending = members.map((member) => member.geometry?.slice());
  if (pending.some((line) => !line || line.length < 2 ||
    line.some((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lon)))) return null;
  const rings = [];
  while (pending.length) {
    let ring = pending.pop();
    while (!samePoint(ring[0], ring[ring.length - 1])) {
      const index = pending.findIndex((line) => samePoint(line[0], ring[ring.length - 1]) ||
        samePoint(line[line.length - 1], ring[ring.length - 1]));
      if (index < 0) return null;
      let next = pending.splice(index, 1)[0];
      if (!samePoint(next[0], ring[ring.length - 1])) next = next.reverse();
      ring = ring.concat(next.slice(1));
    }
    if (ring.length < 4) return null;
    rings.push(ring);
  }
  return rings;
}

function parkRings(item) {
  const way = polygon(item);
  if (way) return { outer: [way], inner: [] };
  if (item.type !== "relation" || !["multipolygon", "boundary"].includes(item.tags?.type) ||
    !Array.isArray(item.members)) return null;
  const relevant = item.members.filter((member) => member.type === "way" && ["", "outer", "inner"].includes(member.role ?? ""));
  const outer = relationRings(relevant.filter((member) => member.role !== "inner"));
  const inner = relationRings(relevant.filter((member) => member.role === "inner"));
  return outer?.length && inner ? { outer, inner } : null;
}

const geometryCache = new WeakMap();

function containsPoint(ring, point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.lat > point.lat) !== (b.lat > point.lat) &&
      point.lon < (b.lon - a.lon) * (point.lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

function containsPlayground(park, playground) {
  if (!geometryCache.has(park)) {
    const rings = parkRings(park);
    if (!rings) geometryCache.set(park, null);
    else {
      const bounds = rings.outer.flat().reduce((box, point) => ({
        minLat: Math.min(box.minLat, point.lat), maxLat: Math.max(box.maxLat, point.lat),
        minLon: Math.min(box.minLon, point.lon), maxLon: Math.max(box.maxLon, point.lon)
      }), { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity });
      geometryCache.set(park, { rings, bounds });
    }
  }
  const geometry = geometryCache.get(park);
  if (!geometry) return false;
  const { rings, bounds } = geometry;
  const point = coordinates(playground);
  if (!point || point.lat < bounds.minLat || point.lat > bounds.maxLat ||
    point.lon < bounds.minLon || point.lon > bounds.maxLon) return false;
  const inside = (point) => rings.outer.some((ring) => containsPoint(ring, point)) &&
    !rings.inner.some((ring) => containsPoint(ring, point));
  if (playground.type === "node") {
    return inside(point);
  }
  const shape = polygon(playground);
  if (!shape || !shape.slice(0, -1).every(inside)) return false;
  const cross = (a, b, c) => (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon);
  for (const ring of [...rings.outer, ...rings.inner]) {
    for (let i = 1; i < shape.length; i++) {
      for (let j = 1; j < ring.length; j++) {
        const [a, b, c, d] = [shape[i - 1], shape[i], ring[j - 1], ring[j]];
        if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0 &&
          Math.max(Math.min(a.lon, b.lon), Math.min(c.lon, d.lon)) <= Math.min(Math.max(a.lon, b.lon), Math.max(c.lon, d.lon)) &&
          Math.max(Math.min(a.lat, b.lat), Math.min(c.lat, d.lat)) <= Math.min(Math.max(a.lat, b.lat), Math.max(c.lat, d.lat))) return false;
      }
    }
  }
  return true;
}

function osmId(item) {
  return `osm-${item.type}-${item.id}`;
}

function addressValues(tags = {}, reverse = {}, municipalities = new Map()) {
  const a = reverse.address ?? {};
  const city = text(tags["addr:city"] || tags["addr:town"] || tags["addr:village"] ||
    tags["addr:municipality"] || reverse.comune || a.city || a.town || a.village || a.municipality);
  const province = text(tags["addr:province"] || reverse.provincia || a.county || a.state_district ||
    municipalities.get(normalizeMunicipality(city)))
    .replace(/^(città metropolitana di|provincia di)\s+/i, "");
  const taggedStreet = text(tags["addr:street"]);
  const street = text(a.road || a.pedestrian);
  const address = taggedStreet
    ? [taggedStreet, text(tags["addr:housenumber"])].filter(Boolean).join(" ")
    : text(reverse.indirizzo) || [street, text(a.house_number)].filter(Boolean).join(" ");
  const neighbourhood = text(tags["addr:suburb"] || tags["addr:neighbourhood"] ||
    a.neighbourhood || a.suburb || a.quarter);
  return { city, province, address, neighbourhood };
}

function createParkRecord(item, reverse = {}, municipalities = new Map()) {
  const point = coordinates(item);
  if (!point) return { error: "Coordinate OSM mancanti." };
  const tags = item.tags ?? {};
  const place = addressValues(tags, reverse, municipalities);
  const originalName = text(tags.name || tags["playground:name"] || tags.leisure_name);
  const kind = { park: "Parco", garden: "Giardino", nature_reserve: "Riserva naturale",
    playground: "Area giochi", indoor_play: "Area giochi al coperto" }[tags.leisure];
  if (!kind) return { error: "Categoria OSM non supportata." };
  const qualifier = place.address || place.neighbourhood || place.city;
  const name = originalName && !isGeneric(originalName)
    ? originalName : qualifier ? `${kind} - ${qualifier}` : "";
  if (!name) return { error: "Nome e località insufficienti per identificare il luogo." };
  const id = osmId(item);
  return { record: {
    nome: name, name, comune: place.city || null, city: place.city || null,
    provincia: place.province || null, province: place.province || null,
    indirizzo: place.address || null, address: place.address || null,
    latitudine: point.lat, latitude: point.lat, longitudine: point.lon, longitude: point.lon,
    description: text(tags.description || tags.note) || `${kind} rilevato tramite OpenStreetMap`,
    website: text(tags.website || tags["contact:website"]) || null,
    source: "OpenStreetMap", source_url: `https://www.openstreetmap.org/${item.type}/${item.id}`,
    external_id: id
  } };
}

function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (a.lat - b.lat) * rad, dLon = (a.lon - b.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function likelyExisting(record, existing) {
  const name = normalize(record.nome);
  if (!name || isGeneric(record.nome)) return [];
  return existing.filter((park) => {
    if (normalize(park.nome || park.name) !== name) return false;
    const lat = park.latitudine ?? park.latitude, lon = park.longitudine ?? park.longitude;
    if (lat != null && lon != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
      if (distanceMeters({ lat: record.latitudine, lon: record.longitudine },
        { lat: Number(lat), lon: Number(lon) }) <= 200) return true;
    }
    const city = normalize(record.comune), existingCity = normalize(park.comune || park.city);
    return !city || !existingCity || city === existingCity;
  });
}

function mergeUpdates(existing, record) {
  const updates = {};
  for (const [field, value] of Object.entries(record)) {
    if (field === "external_id" || !hasValue(value)) continue;
    const current = existing[field];
    if (!hasValue(current) || (["nome", "name"].includes(field) && isGeneric(current) && !isGeneric(value))) {
      updates[field] = value;
    }
  }
  return updates;
}

async function loadExisting(client) {
  const all = [];
  const ids = new Set();
  let total;
  for (;;) {
    const { data, error, count } = await client.from("parks").select("*", { count: "exact" })
      .order("id").range(all.length, all.length + 499);
    if (error || !Array.isArray(data)) throw new Error(`Lettura parks fallita: ${error?.message || "risposta non valida"}`);
    if (!Number.isInteger(count) || count < 0 || (total !== undefined && total !== count)) {
      throw new Error("Conteggio parks mancante o cambiato durante la lettura.");
    }
    total = count;
    for (const row of data) {
      if (row.id == null || ids.has(String(row.id))) throw new Error("Lettura parks incoerente: ID mancante o ripetuto.");
      ids.add(String(row.id));
      all.push(row);
    }
    if (all.length === total) return all;
    if (!data.length || all.length > total) throw new Error("Lettura parks incompleta o incoerente.");
  }
}

async function fetchElements(fetcher = fetch) {
  const response = await fetcher(OVERPASS_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "ToscanaFamilyCollector/2.0" },
    body: new URLSearchParams({ data: QUERY }), signal: AbortSignal.timeout(210000)
  });
  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.elements)) throw new Error("Risposta Overpass priva di elements.");
  return data.elements;
}

async function loadCache() {
  try {
    const cache = JSON.parse(await readFile(CACHE_PATH, "utf8"));
    if (!cache || typeof cache !== "object" || Array.isArray(cache)) throw new Error("cache non valida");
    return cache;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Lettura cache reverse geocoding: ${error.message}`);
  }
}

function createGeocoder(cache, endpoint, fetcher = fetch) {
  let url;
  if (endpoint) {
    url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password ||
      url.hostname.toLowerCase() === "nominatim.openstreetmap.org") {
      throw new Error("REVERSE_GEOCODE_URL deve essere un servizio HTTPS autorizzato, diverso dal Nominatim pubblico.");
    }
  }
  let lastRequest = 0;
  return async (point) => {
    const key = `${point.lat.toFixed(7)},${point.lon.toFixed(7)}`;
    if (cache[key]?.status === "success") return cache[key].values ?? {};
    if (!url) return {};
    const wait = Math.max(0, 1100 - (Date.now() - lastRequest));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequest = Date.now();
    const request = new URL(url);
    request.searchParams.set("lat", point.lat.toFixed(7));
    request.searchParams.set("lon", point.lon.toFixed(7));
    request.searchParams.set("format", "jsonv2");
    request.searchParams.set("addressdetails", "1");
    const response = await fetcher(request, { headers: { "User-Agent": "ToscanaFamilyCollector/2.0", "Accept-Language": "it" },
      signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Reverse geocoding HTTP ${response.status}`);
    const data = await response.json();
    if (!data.address || typeof data.address !== "object") throw new Error("Reverse geocoding senza address valido.");
    return data;
  };
}

async function runImport({ elements, existing, geocode, write, save, municipalities = new Map(), log = console.log }) {
  const stats = { found: elements.length, imported: 0, updated: 0, duplicates: 0, skipped: 0, errors: 0 };
  const byExternal = new Map(existing.filter((row) => row.external_id).map((row) => [row.external_id, row]));
  const parks = elements.filter((item) => PARK_TYPES.has(item.tags?.leisure));
  const representedParks = new Set();
  const ordered = [...parks, ...elements.filter((item) => !PARK_TYPES.has(item.tags?.leisure))];
  for (const item of ordered) {
    const id = osmId(item);
    try {
      const current = byExternal.get(id);
      if (PLAY_TYPES.has(item.tags?.leisure)) {
        const parents = parks.filter((park) => representedParks.has(osmId(park)) && containsPlayground(park, item));
        if (parents.length) {
          stats.duplicates++;
          log(`[PARK DUPLICATE] ${id}: playground nel parco ${parents.map(osmId).join(", ")}${current ? "; record esistente conservato" : "; non importato separatamente"}.`);
          continue;
        }
      }
      const point = coordinates(item);
      if (!point) {
        stats.skipped++;
        log(`[PARK SKIPPED] ${id}: coordinate mancanti.`);
        continue;
      }
      const fromTags = addressValues(item.tags, {}, municipalities);
      const knownCity = current?.comune || current?.city;
      const knownProvince = current?.provincia || current?.province;
      const knownAddress = current?.indirizzo || current?.address;
      const needsLocation = !(fromTags.city || knownCity) || !(fromTags.province || knownProvince) ||
        !(fromTags.address || knownAddress);
      let reverse = {};
      if (needsLocation) {
        try { reverse = await geocode(point); } catch (error) {
          stats.errors++;
          log(`[PARK ERROR] ${id}: reverse geocoding fallito: ${error.message}; proseguo con i dati disponibili.`);
        }
      }
      const { record, error } = createParkRecord(item, {
        ...reverse,
        comune: knownCity || reverse.comune,
        provincia: knownProvince || reverse.provincia,
        indirizzo: knownAddress || reverse.indirizzo
      }, municipalities);
      if (error) {
        stats.skipped++;
        log(`[PARK SKIPPED] ${id}: ${error}`);
        continue;
      }
      if (!current) {
        const matches = likelyExisting(record, existing);
        if (matches.length) {
          stats.duplicates++;
          log(`[PARK DUPLICATE] ${id}: possibile corrispondenza ${matches.map((row) => row.id).join(", ")}; revisione necessaria.`);
          if (PARK_TYPES.has(item.tags?.leisure) && matches.length === 1) representedParks.add(id);
          continue;
        }
        const inserted = write ? await save("insert", record) : { ...record, id: id };
        existing.push(inserted);
        byExternal.set(id, inserted);
        stats.imported++;
        if (PARK_TYPES.has(item.tags?.leisure)) representedParks.add(id);
        log(`[PARK IMPORTED] ${write ? "" : "(anteprima) "}${id}: ${record.nome}`);
      } else {
        if (PARK_TYPES.has(item.tags?.leisure)) representedParks.add(id);
        const changes = mergeUpdates(current, record);
        if (!Object.keys(changes).length) {
          stats.skipped++;
          log(`[PARK SKIPPED] ${id}: nessun campo da completare.`);
          continue;
        }
        if (write) await save("update", changes, current);
        Object.assign(current, changes);
        stats.updated++;
        log(`[PARK UPDATED] ${write ? "" : "(anteprima) "}${id}: ${Object.keys(changes).join(", ")}`);
      }
    } catch (error) {
      stats.errors++;
      log(`[PARK SKIPPED] ${id}: errore ${error.message}`);
    }
  }
  return stats;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--write") || args.length > 1) throw new Error("Uso: node scripts/import-osm.mjs [--write]");
  const write = args.includes("--write");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Servono SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const [elements, existing, cache, municipalities] = await Promise.all([
    fetchElements(), loadExisting(client), loadCache(), loadMunicipalities()
  ]);
  const geocode = createGeocoder(cache, process.env.REVERSE_GEOCODE_URL);
  const save = async (operation, values, current) => {
    let query;
    if (operation === "insert") {
      query = client.from("parks").insert(values);
    } else {
      query = client.from("parks").update(values).eq("id", current.id);
      for (const field of Object.keys(values)) {
        query = current[field] == null ? query.is(field, null) : query.eq(field, current[field]);
      }
    }
    const { data, error } = await query.select("*");
    if (error) throw new Error(`Supabase ${operation}: ${error.message}`);
    if (data?.length !== 1) throw new Error(`Supabase ${operation}: record modificato da un altro processo o non accessibile.`);
    return data[0];
  };
  console.log(write ? "MODALITÀ SCRITTURA" : "ANTEPRIMA: nessuna scrittura sul database.");
  const stats = await runImport({ elements, existing, geocode, write, save, municipalities });
  console.log(`Report: trovati=${stats.found}, nuovi=${stats.imported}, aggiornati=${stats.updated}, duplicati=${stats.duplicates}, esclusi=${stats.skipped}, errori=${stats.errors}`);
  if (stats.errors) process.exitCode = 1;
}

export { QUERY, addressValues, containsPlayground, coordinates, createGeocoder, createParkRecord,
  fetchElements, likelyExisting, loadExisting, mergeUpdates, runImport };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`Importazione OSM fallita: ${error.message}`); process.exitCode = 1; });
}
