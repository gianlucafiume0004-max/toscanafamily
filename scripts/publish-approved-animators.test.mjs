import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  assertProject, createReport, loadAll, matchingFields, readOnlyFetch, syncApprovedAnimators
} from "./publish-approved-animators.mjs";

const provider = {
  id: "p-one", name: "Example", provider_kind: "feste", provider_type: "feste",
  party_type: "animatore", city: "Firenze", province: "FI", phone: "+393381234567",
  website: "https://example.it", social_url: "https://instagram.com/example",
  services: "animazione", coverage_area: null, notes: null, source_url: "https://example.it"
};
const candidate = {
  id: "c-one", name: "Example", status: "approved", approved_provider_id: "p-one", quality_score: 90
};

test("dry-run copies exactly the permitted fields of approved publishable animators", () => {
  const rows = syncApprovedAnimators([candidate, { ...candidate, id: "pending", status: "pending_review" }],
    [{ ...provider, private_field: "must not copy" }], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].classification, "publishable");
  assert.deepEqual(Object.keys(rows[0].payload), [
    "id", "name", "provider_kind", "provider_type", "party_type", "city", "province",
    "phone", "website", "social_url", "services", "coverage_area", "notes", "source_url"
  ]);
});

test("all five identity fields detect production matches independently of ID", () => {
  const variants = [
    [{ name: "Example", phone: null, website: null, social_url: null }, "name"],
    [{ name: "Other", phone: "0039 338 1234567", website: null, social_url: null }, "phone"],
    [{ name: "Other", phone: null, website: "https://www.example.it/page", social_url: null }, "website"],
    [{ name: "Other", phone: null, website: null, social_url: "https://instagram.com/example/" }, "instagram_url"]
  ];
  for (const [changes, field] of variants) {
    const target = { ...provider, id: "different", ...changes };
    const [row] = syncApprovedAnimators([candidate], [provider], [target]);
    assert.equal(row.classification, ["name", "website"].includes(field) ? "review_required" : "duplicate", field);
    assert.ok(row.matches[0].fields.includes(field));
  }
  assert.deepEqual(matchingFields(
    { social_url: "https://facebook.com/profile.php?id=123" },
    { social_url: "https://facebook.com/pages/example/123" }
  ), ["facebook_url"]);
});

test("all contact values are compared, including candidate and later provider profiles", () => {
  const source = { ...provider, phone: "05512345678; 3381234567",
    social_url: "https://facebook.com/first; https://facebook.com/second; https://instagram.com/first" };
  assert.deepEqual(matchingFields(source, { phone: "+39 338 1234567" }), ["phone"]);
  assert.deepEqual(matchingFields(source, { social_url: "https://facebook.com/second" }), ["facebook_url"]);
  const target = { ...provider, id: "p-two", name: "Other", phone: null, website: null,
    social_url: "https://instagram.com/candidateprofile" };
  const [row] = syncApprovedAnimators([{ ...candidate, instagram_url: target.social_url }], [source], [target]);
  assert.equal(row.classification, "duplicate");
});

test("test records, missing requirements, non-animators and ID collisions are not publishable", () => {
  assert.equal(syncApprovedAnimators([{ ...candidate, name: "Test Approved" }], [provider], [])[0].classification, "test_record");
  for (const change of [
    { city: null }, { province: "RN" }, { province: "fi" }, { phone: null }, { website: null },
    { social_url: "https://instagram.com/about/legal/privacy/" }, { party_type: "sala_feste" }
  ]) {
    assert.equal(syncApprovedAnimators([candidate], [{ ...provider, ...change }], [])[0].classification, "review_required");
  }
  const collision = { ...provider, name: "Other", phone: null, website: null, social_url: null };
  assert.equal(syncApprovedAnimators([candidate], [provider], [collision])[0].classification, "review_required");
  assert.equal(syncApprovedAnimators([candidate], [], [])[0].classification, "review_required");
});

test("every staging collision is detected even with three records or a missing provider", () => {
  const providers = ["one", "two", "three"].map((id) => ({ ...provider, id, name: id }));
  const candidates = providers.map((item) => ({
    ...candidate, id: `c-${item.id}`, name: item.name, approved_provider_id: item.id
  }));
  const rows = syncApprovedAnimators(candidates, providers, []);
  assert.deepEqual(rows.map((row) => row.classification), Array(3).fill("review_required"));
  assert.deepEqual(rows.map((row) => row.reasons.length), [2, 2, 2]);
  const missing = { ...candidate, id: "missing", approved_provider_id: "missing",
    name: "Different", phone: provider.phone };
  const collision = syncApprovedAnimators([candidate, missing], [provider], []);
  assert.deepEqual(collision.map((row) => row.classification), ["review_required", "review_required"]);
});

test("collisions against a production duplicate still block other staging records", () => {
  const second = { ...provider, id: "second", name: "Another", phone: "3331234567" };
  const target = { ...provider, id: "production", name: "Other", website: null, social_url: null };
  const rows = syncApprovedAnimators([candidate,
    { ...candidate, id: "c-two", name: "Another", approved_provider_id: "second" }],
  [provider, second], [target]);
  assert.deepEqual(rows.map((row) => row.classification), ["duplicate", "review_required"]);
});

test("cross-category matches and shared identities between staging records require review", () => {
  const hall = { ...provider, id: "hall", party_type: "sala_feste" };
  assert.equal(syncApprovedAnimators([candidate], [provider], [hall])[0].classification, "review_required");
  const second = { ...provider, id: "second", name: "Another" };
  const rows = syncApprovedAnimators([candidate, { ...candidate, id: "c-two", name: "Another", approved_provider_id: "second" }],
    [provider, second], []);
  assert.deepEqual(rows.map((row) => row.classification), ["review_required", "review_required"]);
});

test("report includes counts, reasons, matches and proposed payload without excluded records", () => {
  const rows = syncApprovedAnimators([candidate], [provider], []);
  const report = createReport(rows);
  assert.match(report, /Nuovi animatori pubblicabili \(1\)/);
  assert.match(report, /Duplicati \(0\)/);
  assert.match(report, /"id": "p-one"/);
  assert.match(report, /Nessuna scrittura/);
});

test("project checks and transport prohibit database writes", async () => {
  assert.throws(() => assertProject("https://wrong.supabase.co", "eqonpqgazhmjbrjtexmg.supabase.co"), /progetto/);
  assert.throws(() => readOnlyFetch("https://example.it", { method: "POST" }), /vietata/);
  assert.throws(() => readOnlyFetch("https://example.it", { method: "PATCH" }), /vietata/);
  assert.throws(() => readOnlyFetch(new Request("https://example.it", { method: "DELETE" })), /vietata/);
  const run = spawnSync(process.execPath, ["scripts/publish-approved-animators.mjs", "--write"], { encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /pubblicazione non è implementata/);
});

test("pagination continues until exact count and fails explicitly on incomplete snapshots", async () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({ id: i }));
  function fakeClient(inconsistent = false) {
    return { from() {
      return { select() { return { order() { return { range(start) {
        return Promise.resolve({ data: rows.slice(start, start + 2), error: null,
          count: inconsistent && start ? 5 : 4 });
      } }; } }; } };
    } };
  }
  assert.deepEqual(await loadAll(fakeClient(), "providers"), rows);
  await assert.rejects(loadAll(fakeClient(true), "providers"), /cambiati/);
  const incomplete = { from: () => ({ select: () => ({ order: () => ({ range: () =>
    Promise.resolve({ data: [], count: 1, error: null }) }) }) }) };
  await assert.rejects(loadAll(incomplete, "providers"), /incompleta/);
  const repeated = { from: () => ({ select: () => ({ order: () => ({ range: () =>
    Promise.resolve({ data: [{ id: 1 }, { id: 1 }], count: 2, error: null }) }) }) }) };
  await assert.rejects(loadAll(repeated, "providers"), /ID mancante o ripetuto/);
});
