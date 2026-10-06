import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("Variabile SUPABASE_URL mancante.");
}

if (!supabaseKey) {
  throw new Error("Variabile SUPABASE_SERVICE_ROLE_KEY mancante.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const overpassUrl = "https://overpass.kumi.systems/api/interpreter";

const overpassQuery = `
[out:json][timeout:120];
nwr42.20,9.65,44.50,12.40;
out center tags;
`;

function getCoordinates(item) {
  const latitude = item.lat ?? item.center?.lat ?? null;
  const longitude = item.lon ?? item.center?.lon ?? null;

  return {
    latitude,
    longitude
  };
}

function getCity(tags = {}) {
  return (
    tags["addr:city"] ||
    tags["addr:town"] ||
    tags["addr:village"] ||
    tags["addr:municipality"] ||
    null
  );
}

function getAddress(tags = {}) {
  const street = tags["addr:street"] || null;
  const number = tags["addr:housenumber"] || null;

  if (street && number) {
    return `${street} ${number}`;
  }

  return street;
}

function createOsmUrl(item) {
  return `https://www.openstreetmap.org/${item.type}/${item.id}`;
}

function createParkRecord(item) {
  const tags = item.tags || {};
  const { latitude, longitude } = getCoordinates(item);

  return {
    name: tags.name || "Area giochi",
    description:
      tags.description ||
      tags.note ||
      "Area giochi rilevata tramite OpenStreetMap",
    address: getAddress(tags),
    city: getCity(tags),
    province: tags["addr:province"] || null,
    latitude,
    longitude,
    website: tags.website || tags["contact:website"] || null,
    source: "OpenStreetMap",
    source_url: createOsmUrl(item),
    external_id: `osm-${item.type}-${item.id}`,
    updated_at: new Date().toISOString()
  };
}

async function loadOpenStreetMapData() {
  console.log("Avvio ricerca aree giochi su OpenStreetMap...");

  const response = await fetch(overpassUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "text/plain; charset=UTF-8",
      "User-Agent": "ToscanaFamilyCollector/1.0"
    },
    body: overpassQuery
  });

  if (!response.ok) {
    const responseText = await response.text();

    throw new Error(
      `Errore Overpass API ${response.status}: ${responseText.slice(0, 500)}`
    );
  }

  const data = await response.json();
  const elements = Array.isArray(data.elements) ? data.elements : [];

  console.log(`Elementi OSM trovati: ${elements.length}`);

  const records = elements
    .map(createParkRecord)
    .filter(
      (record) =>
        record.latitude !== null &&
        record.longitude !== null
    );

  console.log(`Elementi con coordinate valide: ${records.length}`);

  if (records.length === 0) {
    console.log("Nessun elemento valido da salvare.");
    return;
  }

  const batchSize = 100;
  let savedRecords = 0;

  for (let index = 0; index < records.length; index += batchSize) {
    const batch = records.slice(index, index + batchSize);

    const { error } = await supabase
      .from("parks")
      .upsert(batch, {
        onConflict: "external_id"
      });

    if (error) {
      throw new Error(
        `Errore Supabase durante il salvataggio: ${error.message}`
      );
    }

    savedRecords += batch.length;
    console.log(`Salvati ${savedRecords} record su ${records.length}`);
  }

  console.log("Importazione OpenStreetMap completata.");
}

loadOpenStreetMapData().catch((error) => {
  console.error("Importazione OSM fallita:");
  console.error(error);
  process.exit(1);
});
