import test from "node:test";
import assert from "node:assert/strict";
import { QUERY, containsPlayground, createGeocoder, createParkRecord, fetchElements,
  likelyExisting, loadExisting, mergeUpdates, runImport } from "./import-osm.mjs";
import { loadMunicipalities } from "./animator-learning.mjs";

const ring = [
  { lat: 43.83, lon: 11.20 }, { lat: 43.83, lon: 11.21 },
  { lat: 43.84, lon: 11.21 }, { lat: 43.84, lon: 11.20 },
  { lat: 43.83, lon: 11.20 }
];
const park = (id, name, leisure = "park") => ({
  type: "way", id, geometry: ring, tags: { leisure, name, "addr:city": "Sesto Fiorentino" }
});
const playground = (id, lat = 43.835, lon = 11.205) =>
  ({ type: "node", id, lat, lon, tags: { leisure: "playground" } });
const emptyGeocode = async () => ({});

test("Overpass query includes all five requested leisure types", () => {
  for (const type of ["park", "garden", "nature_reserve", "playground", "indoor_play"]) {
    assert.ok(QUERY.includes(`["leisure"="${type}"]`));
  }
  assert.match(QUERY, /out body geom/);
});

test("known park names and each category are retained, even without a city", () => {
  const names = ["Parco dell'Oliveta", "Parco del Neto", "Villa Solaria", "Querciola"];
  for (const [index, name] of names.entries()) {
    const item = park(index, name, ["park", "garden", "nature_reserve", "park"][index]);
    delete item.tags["addr:city"];
    const { record } = createParkRecord(item);
    assert.equal(record.nome, name);
    assert.equal(record.comune, null);
  }
});

test("coordinates drive reverse geocoding and naming from address, neighbourhood or city", () => {
  const item = playground(1);
  for (const [result, expected] of [
    [{ address: { city: "Sesto Fiorentino", county: "Città metropolitana di Firenze", road: "Via Roma", house_number: "2" } }, "Area giochi - Via Roma 2"],
    [{ address: { suburb: "Querceto" } }, "Area giochi - Querceto"],
    [{ comune: "Prato" }, "Area giochi - Prato"]
  ]) assert.equal(createParkRecord(item, result).record.nome, expected);
  const result = createParkRecord(item, { address: { city: "Sesto Fiorentino", county: "Città metropolitana di Firenze", road: "Via Roma" } }).record;
  assert.deepEqual([result.city, result.comune, result.province, result.provincia, result.address, result.indirizzo],
    ["Sesto Fiorentino", "Sesto Fiorentino", "Firenze", "Firenze", "Via Roma", "Via Roma"]);
  assert.match(createParkRecord(item).error, /insufficienti/);
});

test("known municipality supplies Tuscany province from ISTAT without guessing unknown cities", async () => {
  const municipalities = await loadMunicipalities();
  const item = park(1, "Parco Oliveta");
  assert.equal(createParkRecord(item, {}, municipalities).record.provincia, "FI");
  item.tags["addr:city"] = "Località inesistente";
  assert.equal(createParkRecord(item, {}, municipalities).record.provincia, null);
});

test("only demonstrably contained playgrounds are suppressed, existing rows retained", async () => {
  assert.equal(containsPlayground(park(1, "Parco"), playground(2)), true);
  assert.equal(containsPlayground(park(1, "Parco"), playground(3, 43.85)), false);
  assert.equal(containsPlayground({ type: "relation", members: [] }, playground(2)), false);
  const existing = [{ id: "old", external_id: "osm-node-2", nome: "Area giochi" }];
  const logs = [];
  const stats = await runImport({ elements: [playground(2), park(1, "Parco Oliveta")], existing,
    geocode: emptyGeocode, write: false, save: () => assert.fail("dry-run must not write"), log: (line) => logs.push(line) });
  assert.equal(stats.imported, 1);
  assert.equal(stats.duplicates, 1);
  assert.equal(existing.find((row) => row.id === "old").nome, "Area giochi");
  assert.ok(logs.some((line) => line.includes("record esistente conservato")));
});

test("multipolygon segments and holes do not produce false playground duplicates", () => {
  const hole = [
    { lat: 43.834, lon: 11.204 }, { lat: 43.834, lon: 11.206 },
    { lat: 43.836, lon: 11.206 }, { lat: 43.836, lon: 11.204 },
    { lat: 43.834, lon: 11.204 }
  ];
  const relation = { type: "relation", tags: { type: "multipolygon" }, members: [
    { type: "way", role: "outer", geometry: ring.slice(0, 3) },
    { type: "way", role: "outer", geometry: ring.slice(2) },
    { type: "way", role: "inner", geometry: hole }
  ] };
  assert.equal(containsPlayground(relation, playground(1, 43.832, 11.202)), true);
  assert.equal(containsPlayground(relation, playground(2, 43.835, 11.205)), false);
  assert.equal(containsPlayground({ ...relation, tags: { type: "boundary" } }, playground(4, 43.832, 11.202)), true);
  relation.members[1].geometry = ring.slice(3);
  assert.equal(containsPlayground({ ...relation }, playground(3, 43.832, 11.202)), false);
});

test("playground is not suppressed when parent could not be represented", async () => {
  const unnamed = park(1, "");
  delete unnamed.tags["addr:city"];
  const play = playground(2);
  play.tags.name = "Giochi di Querceto";
  const stats = await runImport({ elements: [unnamed, play], existing: [], geocode: emptyGeocode,
    write: false, save: () => assert.fail(), log: () => {} });
  assert.equal(stats.skipped, 1);
  assert.equal(stats.imported, 1);
  assert.equal(stats.duplicates, 0);
});

test("existing manual records are never overwritten and ambiguous duplicates are reported", async () => {
  const manual = { id: "manual", nome: "Parco del Neto", comune: "Sesto Fiorentino", note: "Dati curati" };
  assert.equal(likelyExisting(createParkRecord(park(4, manual.nome)).record, [manual]).length, 1);
  const noCity = { ...createParkRecord(park(4, manual.nome)).record, comune: null };
  assert.equal(likelyExisting(noCity, [manual]).length, 1);
  const log = [];
  const stats = await runImport({ elements: [park(4, manual.nome)], existing: [manual], geocode: emptyGeocode,
    write: true, save: () => assert.fail(), log: (line) => log.push(line) });
  assert.equal(stats.duplicates, 1);
  assert.equal(manual.note, "Dati curati");
  assert.match(log[0], /\[PARK DUPLICATE\]/);
});

test("updates fill missing fields without overwriting existing values and improve generic names", () => {
  assert.deepEqual(mergeUpdates({ nome: "Area giochi", city: "Comune curato", comune: null, note: "recensione" },
    { nome: "Area giochi - Via Roma", city: "Altro", comune: "Firenze", external_id: "osm-node-1" }),
  { nome: "Area giochi - Via Roma", comune: "Firenze" });
});

test("existing address and city avoid a reverse lookup and fill empty aliases", async () => {
  const item = park(1, "Parco Oliveta");
  delete item.tags["addr:city"];
  const existing = [{ id: "1", external_id: "osm-way-1", nome: "Parco Oliveta",
    comune: "Sesto Fiorentino", provincia: "FI", indirizzo: "Viale Repubblica" }];
  const stats = await runImport({ elements: [item], existing, geocode: () => assert.fail("unnecessary lookup"),
    write: false, save: () => assert.fail(), log: () => {} });
  assert.equal(stats.updated, 1);
  assert.deepEqual([existing[0].city, existing[0].province, existing[0].address],
    ["Sesto Fiorentino", "FI", "Viale Repubblica"]);
});

test("record errors are reported without stopping subsequent candidates", async () => {
  const logs = [];
  const results = await runImport({ elements: [park(1, "Primo"), park(2, "Secondo")], existing: [],
    geocode: async () => { throw new Error("DNS"); }, write: true,
    save: async (operation, record) => { if (record.external_id === "osm-way-1") throw new Error("DB"); return { ...record, id: "new" }; },
    log: (line) => logs.push(line) });
  assert.equal(results.errors, 3);
  assert.equal(results.imported, 1);
  assert.ok(logs.some((line) => line.includes("[PARK IMPORTED]")));
  assert.ok(logs.some((line) => line.includes("DNS")));
});

test("cache and configured reverse endpoint work; public Nominatim is rejected", async () => {
  let requests = 0;
  const point = { lat: 43.835, lon: 11.205 };
  const key = "43.8350000,11.2050000";
  const cached = createGeocoder({ [key]: { status: "success", values: { comune: "Sesto" } } }, "", () => assert.fail());
  assert.deepEqual(await cached(point), { comune: "Sesto" });
  assert.throws(() => createGeocoder({}, "https://nominatim.openstreetmap.org/reverse"), /autorizzato/);
  const remote = createGeocoder({}, "https://example.test/reverse", async (url) => {
    requests++;
    assert.equal(url.searchParams.get("lat"), "43.8350000");
    return { ok: true, json: async () => ({ address: { city: "Sesto" } }) };
  });
  assert.equal((await remote(point)).address.city, "Sesto");
  assert.equal(requests, 1);
});

test("Overpass errors and incomplete database pages are surfaced", async () => {
  await assert.rejects(fetchElements(async () => ({ ok: false, status: 500 })), /HTTP 500/);
  await assert.rejects(fetchElements(async () => ({ ok: true, json: async () => ({}) })), /elements/);
  const client = { from: () => ({ select: () => ({ order: () => ({ range: async () =>
    ({ data: [{ id: 1 }, { id: 1 }], count: 2, error: null }) }) }) }) };
  await assert.rejects(loadExisting(client), /ID mancante o ripetuto/);
});
