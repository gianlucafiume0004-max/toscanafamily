import test from "node:test";
import assert from "node:assert/strict";
import { loadCandidates, writeParkFields } from "./reverse-geocode-parks.mjs";

test("selects named and generic parks with any missing location field", async () => {
  const rows = [
    { id: "1", nome: "Parco Oliveta", comune: null, latitudine: 43.8, longitudine: 11.2 },
    { id: "2", nome: "Area giochi", comune: "Sesto", city: "Sesto", provincia: "FI", province: "FI",
      indirizzo: "Via Roma", address: null, latitudine: 43.8, longitudine: 11.2 },
    { id: "3", nome: "Senza coordinate", latitudine: null, longitudine: null },
    { id: "4", nome: "Fuori regione", outside_tuscany: true, latitudine: 43.8, longitudine: 11.2 }
  ];
  const client = { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: rows, error: null }) }) }) }) };
  assert.deepEqual((await loadCandidates(client, Infinity, null)).map(({ park }) => park.id), ["1", "2"]);
  assert.deepEqual((await loadCandidates(client, Infinity, "parco oliveta")).map(({ park }) => park.id), ["1"]);
});

test("fills both language variants without overwriting existing fields", async () => {
  const park = { id: "1", comune: "Sesto Fiorentino", city: null, indirizzo: null, address: null, provincia: null, province: null };
  let actual;
  const chain = { eq: () => chain, is: () => chain, select: async () => ({ data: [{ id: "1" }], error: null }) };
  const client = { from: () => ({ update: (values) => { actual = values; return chain; } }) };
  assert.equal(await writeParkFields(client, park, { comune: "Firenze", indirizzo: "Viale Repubblica", provincia: "FI" }), "Aggiornato");
  assert.deepEqual(actual, { city: "Sesto Fiorentino", indirizzo: "Viale Repubblica",
    address: "Viale Repubblica", provincia: "FI", province: "FI" });
});
