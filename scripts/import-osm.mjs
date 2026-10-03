import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const overpassQuery = `
[out:json][timeout:120];

area["name"="Toscana"]->.searchArea;

(
  nodearea.searchArea;
  wayarea.searchArea;
  relationarea.searchArea;
);

out center;
`;

async function loadOpenStreetMapData() {
  console.log("Ricerca parchi giochi OSM...");

  const response = await fetch(
    "https://overpass-api.de/api/interpreter",
    {
      method: "POST",
      body: overpassQuery
    }
  );

  if (!response.ok) {
    throw new Error(`Errore Overpass API: ${response.status}`);
  }

  const data = await response.json();

  console.log(`Elementi trovati: ${data.elements.length}`);

  for (const item of data.elements) {
    const lat = item.lat ?? item.center?.lat ?? null;
    const lon = item.lon ?? item.center?.lon ?? null;

    const record = {
      name: item.tags?.name || "Parco giochi",
      latitude: lat,
      longitude: lon,
      city:
        item.tags?.["addr:city"] ||
        item.tags?.["addr:municipality"] ||
        null,
      source: "OpenStreetMap",
      website: item.tags?.website || null
    };

    const { error } = await supabase
      .from("parks")
      .upsert(record);

    if (error) {
      console.error(error);
    }
  }

  console.log("Import OSM completato");
}

loadOpenStreetMapData()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
