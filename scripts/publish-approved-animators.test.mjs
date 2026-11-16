import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  assertProject, createReport, loadAll, loadApprovedCandidates, matchingFields, publishCandidates, syncApprovedAnimators
} from "./publish-approved-animators.mjs";

const source = "https://example.it/";
const candidate = {
  id: "c-one", name: "Example", normalized_name: "example", status: "approved_auto",
  published_at: null, quality_score: 90, city: "Firenze", province: "FI",
  phone: "+393381234567", website: source, facebook_url: "https://facebook.com/example",
  instagram_url: null, services: ["animazione"], coverage_area: "Toscana", source_urls: [source],
  field_sources: Object.fromEntries(
    ["phone", "website", "city", "province", "facebook_url"].map((field) => [field, source])
  )
};
const municipalities = new Map([["firenze", "FI"]]);
const sources = [{ name: "Example", url: source }];
const plan = (candidates, providers = []) =>
  syncApprovedAnimators(candidates, [], providers, sources, municipalities);

function fakeClients(providers = []) {
  const productionRows = structuredClone(providers);
  const stagingUpdates = [];
  let productionError = null;
  let stagingError = null;
  let stagingCandidate = { status: candidate.status, published_at: null };
  const production = {
    from(table) {
      assert.equal(table, "providers");
      return {
        select() {
          return { order() { return { range(start, end) {
            return Promise.resolve({ data: productionRows.slice(start, end + 1), count: productionRows.length, error: null });
          } }; } };
        },
        upsert(row, options) {
          assert.deepEqual(options, { onConflict: "animator_candidate_id", ignoreDuplicates: true });
          return { async select() {
            if (productionError) return { error: { message: productionError } };
            if (productionRows.some((item) => item.animator_candidate_id === row.animator_candidate_id)) {
              return { data: [], error: null };
            }
            productionRows.push(row);
            return { data: [{ id: row.id, animator_candidate_id: row.animator_candidate_id }], error: null };
          } };
        }
      };
    }
  };
  const staging = {
    from(table) {
      assert.equal(table, "animator_candidates");
      return {
        select() {
          return { eq() { return { async maybeSingle() {
            return { data: stagingCandidate, error: null };
          } }; } };
        },
        update(values) {
          const query = {
            eq() { return query; },
            is() { return query; },
            async select() {
              if (stagingError) return { data: null, error: { message: stagingError } };
              stagingUpdates.push(values);
              return { data: [{ id: candidate.id }], error: null };
            }
          };
          return query;
        }
      };
    }
  };
  return {
    production, staging, productionRows, stagingUpdates,
    failProduction: (message) => { productionError = message; },
    failStaging: (message) => { stagingError = message; },
    setCandidate: (value) => { stagingCandidate = value; }
  };
}

test("only unpublished approved_auto and approved_probable are selected", () => {
  const rows = plan([
    candidate,
    { ...candidate, id: "c-two", name: "Another", normalized_name: "another",
      status: "approved_probable", website: "https://other.it/", phone: "+393331234567",
      facebook_url: "https://facebook.com/other", field_sources: Object.fromEntries(
        ["phone", "website", "city", "province", "facebook_url"].map((field) => [field, "https://other.it/"])
      ) },
    { ...candidate, id: "legacy", status: "approved" },
    { ...candidate, id: "pending", status: "pending_review" },
    { ...candidate, id: "published", published_at: "2026-01-01T00:00:00Z" }
  ]);
  assert.deepEqual(rows.map((row) => row.candidate_id), ["c-one", "c-two"]);
  assert.ok(rows.every((row) => row.classification === "publishable"));
  assert.equal(rows[0].payload.active, true);
  assert.equal(rows[0].payload.source, "animator_discovery");
  assert.equal(rows[0].payload.services, "animazione");
});

test("website, slug, normalized name and existing phone/social identities detect duplicates", () => {
  for (const [provider, field] of [
    [{ name: "Other", website: "https://www.example.it/path" }, "website"],
    [{ name: "Other", slug: "example" }, "slug"],
    [{ name: "Other", normalized_name: "example" }, "normalized_name"],
    [{ name: "Other", phone: "0039 338 1234567" }, "phone"],
    [{ name: "Other", social_url: "https://facebook.com/example/" }, "facebook_url"]
  ]) {
    const [row] = plan([candidate], [{ id: "other", ...provider }]);
    assert.equal(row.classification, "duplicate", field);
    assert.ok(row.matches[0].fields.includes(field), field);
  }
  assert.deepEqual(matchingFields(
    { social_url: "https://facebook.com/profile.php?id=123" },
    { social_url: "https://facebook.com/pages/example/123" }
  ), ["facebook_url"]);
});

test("requirements, test records and staging collisions remain blocked", () => {
  for (const change of [
    { city: null }, { province: "RN" }, { province: "PO" }, { phone: null },
    { website: null }, { facebook_url: null }, { field_sources: {} }, { quality_score: 89 },
    { name: "Test Example" }
  ]) assert.equal(plan([{ ...candidate, ...change }])[0].classification, "review_required");
  const rows = plan([candidate, { ...candidate, id: "c-two", name: "Other" }]);
  assert.deepEqual(rows.map((row) => row.classification), ["review_required", "review_required"]);
});

test("publishes a candidate and marks it only after successful upsert", async () => {
  const clients = fakeClients();
  const logs = [];
  const result = await publishCandidates(clients.staging, clients.production, plan([candidate]), (line) => logs.push(line));
  assert.deepEqual(result, { total: 1, published: 1, duplicates: 0, errors: 0 });
  assert.match(logs[0], /^\[PUBLISHED\] Example/);
  assert.equal(clients.productionRows[0].source, "animator_discovery");
  assert.ok(Number.isFinite(Date.parse(clients.stagingUpdates[0].published_at)));
});

test("duplicate skips without staging update", async () => {
  const clients = fakeClients([{ id: "existing", name: "Other", website: source }]);
  const logs = [];
  const result = await publishCandidates(clients.staging, clients.production, plan([candidate], clients.productionRows), (line) => logs.push(line));
  assert.deepEqual(result, { total: 1, published: 0, duplicates: 1, errors: 0 });
  assert.deepEqual(logs, ["[SKIP DUPLICATE] Example"]);
  assert.equal(clients.stagingUpdates.length, 0);
});

test("publication errors do not mark the candidate", async () => {
  const clients = fakeClients();
  clients.failProduction("denied");
  const logs = [];
  const result = await publishCandidates(clients.staging, clients.production, plan([candidate]), (line) => logs.push(line));
  assert.equal(result.errors, 1);
  assert.equal(clients.stagingUpdates.length, 0);
  assert.match(logs[0], /^\[ERROR\] Example:.*denied/);
});

test("a failed staging update can be recovered without overwriting production", async () => {
  const clients = fakeClients();
  clients.failStaging("offline");
  const logs = [];
  const first = await publishCandidates(clients.staging, clients.production, plan([candidate]), (line) => logs.push(line));
  assert.equal(first.errors, 1);
  assert.equal(clients.productionRows.length, 1);
  clients.failStaging(null);
  const nextPlan = plan([candidate], clients.productionRows);
  assert.equal(nextPlan[0].classification, "recover");
  const second = await publishCandidates(clients.staging, clients.production, nextPlan, (line) => logs.push(line));
  assert.equal(second.published, 1);
  assert.equal(clients.productionRows.length, 1);
  assert.equal(clients.stagingUpdates.length, 1);
});

test("a provider appearing after the initial plan is skipped", async () => {
  const entries = plan([candidate]);
  const clients = fakeClients([{ id: "late", name: "Other", website: source }]);
  const result = await publishCandidates(clients.staging, clients.production, entries, () => {});
  assert.equal(result.duplicates, 1);
  assert.equal(clients.stagingUpdates.length, 0);
});

test("revoked candidate cannot be published from a stale plan", async () => {
  const clients = fakeClients();
  clients.setCandidate({ status: "pending_review", published_at: null });
  const logs = [];
  const result = await publishCandidates(clients.staging, clients.production, plan([candidate]), (line) => logs.push(line));
  assert.equal(result.errors, 1);
  assert.equal(clients.productionRows.length, 0);
  assert.match(logs[0], /non più approvato/);
});

test("candidate query filters approved statuses and null published_at on the server", async () => {
  const filters = [];
  const query = {
    in(field, values) { filters.push(["in", field, values]); return this; },
    is(field, value) { filters.push(["is", field, value]); return this; },
    then(resolve) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); }
  };
  const client = { from: () => ({ select: () => ({ order: () => ({ range: () => query }) }) }) };
  assert.deepEqual(await loadApprovedCandidates(client), []);
  assert.deepEqual(filters, [
    ["in", "status", ["approved_auto", "approved_probable"]],
    ["is", "published_at", null]
  ]);
});

test("report includes totals and CLI requires explicit write", () => {
  const report = createReport({ total: 4, published: 1, duplicates: 2, errors: 1 });
  for (const line of ["Totale candidati: 4", "Pubblicati: 1", "Duplicati: 2", "Errori: 1"]) {
    assert.ok(report.includes(line));
  }
  assert.throws(() => assertProject("https://wrong.supabase.co", "eqonpqgazhmjbrjtexmg.supabase.co"), /progetto/);
  for (const args of [[], ["--dry-run"]]) {
    const run = spawnSync(process.execPath, ["scripts/publish-approved-animators.mjs", ...args], { encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /richiede esplicitamente --write/);
  }
});

test("pagination detects incomplete snapshots", async () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({ id: i }));
  const client = { from: () => ({ select: () => ({ order: () => ({ range: (start) =>
    Promise.resolve({ data: rows.slice(start, start + 2), count: 4, error: null })
  }) }) }) };
  assert.deepEqual(await loadAll(client, "providers"), rows);
  const incomplete = { from: () => ({ select: () => ({ order: () => ({ range: () =>
    Promise.resolve({ data: [], count: 1, error: null })
  }) }) }) };
  await assert.rejects(loadAll(incomplete, "providers"), /incompleta/);
});
