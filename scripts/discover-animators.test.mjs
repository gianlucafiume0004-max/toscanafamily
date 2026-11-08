import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  candidatesMatch, enrichCandidate, getQualityScore, isApprovalEligible,
  reviewPendingCandidates, stagingUrl
} from "./discover-animators.mjs";

const source = "https://example.it/";
const candidate = {
  id: "one", name: "Example", status: "pending_review", phone: null,
  website: source, facebook_url: null, instagram_url: null,
  city: "Firenze", province: "FI", services: ["animazione"],
  coverage_area: "Toscana", source_urls: [source],
  field_sources: Object.fromEntries(
    ["website", "city", "province", "services", "coverage_area"].map((key) => [key, source])
  )
};
const websiteHtml = `
  <html><body>Telefono: 338 7862448
  <a href="https://www.facebook.com/share/example/">Facebook</a>
  <a href="https://www.instagram.com/example/">Instagram</a>
  <a href="/contatti">Contatti</a></body></html>`;

async function fetchPage(url) {
  if (url === source) return { html: websiteHtml, finalUrl: source };
  if (url === "https://www.facebook.com/share/example/") {
    return { html: "<html></html>", finalUrl: "https://www.facebook.com/example/" };
  }
  if (url === "https://www.instagram.com/example/" || url === "https://example.it/contatti") {
    return { html: "<html></html>", finalUrl: url };
  }
  throw new Error(`Unexpected URL: ${url}`);
}

function fakeSupabase(response) {
  const updates = [];
  const calls = [];
  return {
    updates, calls,
    from(table) {
      if (table === "providers") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: { id: "provider-one", provider_kind: "feste", party_type: "animatore" }, error: null };
                  }
                };
              }
            };
          }
        };
      }
      assert.equal(table, "animator_candidates");
      return {
        update(values) {
          updates.push(values);
          const query = {
            eq() { return query; },
            async select() { return { data: [{ id: "one" }], error: null }; }
          };
          return query;
        }
      };
    },
    async rpc(name, params) {
      calls.push({ name, params });
      return response;
    }
  };
}

test("enrichment follows official contacts and canonical social redirects", async () => {
  const original = structuredClone(candidate);
  const result = await enrichCandidate(original, [], fetchPage);
  assert.deepEqual(result.failures, []);
  assert.equal(result.candidate.phone, "+393387862448");
  assert.equal(result.candidate.facebook_url, "https://www.facebook.com/example/");
  assert.equal(result.candidate.instagram_url, "https://www.instagram.com/example/");
  assert.equal(result.candidate.quality_score, 100);
  assert.deepEqual(result.candidate.missing_fields, []);
  assert.equal(result.candidate.field_sources.phone, source);
  assert.equal(isApprovalEligible(result.candidate), true);
  assert.equal(original.phone, null);
});

test("official provenance and valid Tuscany province are required", () => {
  const complete = {
    ...candidate, phone: "3387862448", facebook_url: "https://facebook.com/example",
    instagram_url: "https://instagram.com/example",
    quality_score: 100,
    field_sources: Object.fromEntries(
      ["phone", "website", "facebook_url", "instagram_url", "city", "province", "services", "coverage_area"]
        .map((key) => [key, source])
    )
  };
  assert.equal(isApprovalEligible(complete), true);
  assert.equal(isApprovalEligible({ ...complete, province: "RN" }), false);
  assert.equal(isApprovalEligible({ ...complete, phone: "39" }), false);
  assert.equal(isApprovalEligible({ ...complete, field_sources: {} }), false);
  assert.equal(isApprovalEligible({
    ...complete, field_sources: { ...complete.field_sources, phone: "https://unrelated.it/" }
  }), false);
  assert.equal(isApprovalEligible({
    ...complete, facebook_url: "https://facebook.com/share/example", instagram_url: null
  }), false);
  assert.equal(getQualityScore({ ...complete, instagram_url: null }), 90);
});

test("one verified social suffices at the 90-point threshold without optional fields", () => {
  const complete = {
    ...candidate, phone: "3387862448", quality_score: 90,
    services: [], coverage_area: null,
    field_sources: Object.fromEntries(
      ["phone", "website", "city", "province", "facebook_url", "instagram_url"]
        .map((key) => [key, source])
    )
  };
  const facebook = { ...complete, facebook_url: "https://facebook.com/example" };
  const instagram = { ...complete, instagram_url: "https://instagram.com/example" };
  assert.equal(isApprovalEligible(facebook), true);
  assert.equal(isApprovalEligible(instagram), true);
  assert.equal(isApprovalEligible({ ...facebook, quality_score: 89 }), false);
  assert.equal(isApprovalEligible({ ...facebook, quality_score: 85 }), false);
  assert.equal(isApprovalEligible({ ...complete }), false);
  assert.equal(isApprovalEligible({ ...facebook, city: "   " }), false);
  assert.equal(isApprovalEligible({ ...facebook, province: null }), false);
  assert.equal(isApprovalEligible({ ...facebook, website: null }), false);
  assert.equal(isApprovalEligible({ ...facebook, phone: null }), false);
  assert.equal(isApprovalEligible({
    ...facebook, field_sources: { ...facebook.field_sources, facebook_url: "https://unrelated.it/" }
  }), false);
  assert.equal(isApprovalEligible({ ...facebook, quality_score: getQualityScore(facebook) }), true);
  assert.equal(isApprovalEligible({ ...instagram, quality_score: getQualityScore(instagram) }), true);
});

test("quality score awards 20 for either first social and 10 for the second", () => {
  const base = { phone: "3387862448", website: source };
  assert.equal(getQualityScore(base), 70);
  assert.equal(getQualityScore({ ...base, facebook_url: "https://facebook.com/example" }), 90);
  assert.equal(getQualityScore({ ...base, instagram_url: "https://instagram.com/example" }), 90);
  assert.equal(getQualityScore({
    ...base, facebook_url: "https://facebook.com/example", instagram_url: "https://instagram.com/example"
  }), 100);
  assert.equal(getQualityScore({ facebook_url: "https://facebook.com/example" }), 20);
  assert.equal(getQualityScore({}), 0);
});

test("one verified social reaches approval after recalculation and enrichment", async () => {
  for (const platform of ["facebook", "instagram"]) {
    const url = `https://www.${platform}.com/example/`;
    const html = `<html><body>Telefono: 338 7862448 <a href="${url}">${platform}</a></body></html>`;
    const client = fakeSupabase({ data: [{ status: "approved", provider_id: "provider-one" }], error: null });
    const results = await reviewPendingCandidates(client, [structuredClone(candidate)], [], {
      autoApprove: true,
      fetchPage: async (requested) => ({
        html: requested === source ? html : "<html></html>", finalUrl: requested
      })
    });
    assert.equal(client.updates[0].quality_score, 90);
    assert.equal(results[0].status, "approved");
    assert.equal(client.calls.length, 1);
  }
});

test("dry run performs no updates or RPC calls", async () => {
  const client = fakeSupabase({});
  const result = await reviewPendingCandidates(client, [structuredClone(candidate)], [], {
    fetchPage, dryRun: true, autoApprove: true
  });
  assert.equal(result[0].status, "eligible");
  assert.deepEqual(client.updates, []);
  assert.deepEqual(client.calls, []);
});

test("approved and duplicate RPC outcomes persist candidate changes before RPC", async () => {
  for (const status of ["approved", "duplicate"]) {
    const client = fakeSupabase({ data: [{ status, provider_id: "provider-one" }], error: null });
    const result = await reviewPendingCandidates(client, [structuredClone(candidate)], [], {
      fetchPage, autoApprove: true
    });
    assert.equal(result[0].status, status);
    assert.equal(client.updates[0].quality_score, 100);
    assert.equal(client.calls[0].name, "approve_animator_candidate");
    assert.equal(client.calls[0].params.p_city, "Firenze");
  }
});

test("manual review remains pending, missing fields and duplicate candidates prevent approval", async () => {
  const match = { provider_id: "p", provider_name: "P", identities: [{ kind: "website", value: "example.it" }] };
  const client = fakeSupabase({ data: [{ status: "manual_review", matches: [match, match] }], error: null });
  const reviewed = await reviewPendingCandidates(client, [structuredClone(candidate)], [], {
    fetchPage, autoApprove: true
  });
  assert.equal(reviewed[0].status, "manual_review");

  const conflictClient = fakeSupabase({});
  const other = { ...structuredClone(candidate), id: "two", status: "approved" };
  const conflicts = await reviewPendingCandidates(conflictClient, [structuredClone(candidate), other], [], {
    fetchPage, autoApprove: true
  });
  assert.equal(conflicts[0].status, "pending_review");
  assert.match(conflicts[0].failures[0], /duplicati/);
  assert.equal(conflictClient.calls.length, 0);

  const providerClient = fakeSupabase({});
  const providerConflict = await reviewPendingCandidates(providerClient, [structuredClone(candidate)], [], {
    fetchPage, autoApprove: true, providers: [{ name: "Other", website: source }]
  });
  assert.equal(providerConflict[0].status, "pending_review");
  assert.match(providerConflict[0].failures[0], /duplicati tra provider/);
  assert.equal(providerClient.calls.length, 0);

  const incompleteClient = fakeSupabase({});
  const incomplete = await reviewPendingCandidates(incompleteClient, [structuredClone(candidate)], [], {
    fetchPage: async () => { throw new Error("offline"); }, autoApprove: true
  });
  assert.equal(incomplete[0].status, "pending_review");
  assert.ok(incomplete[0].failures.length);
  assert.equal(incompleteClient.calls.length, 0);
});

test("RPC and concurrent update errors are surfaced", async () => {
  const client = fakeSupabase({ data: null, error: { message: "RPC missing" } });
  await assert.rejects(
    reviewPendingCandidates(client, [structuredClone(candidate)], [], { fetchPage, autoApprove: true }),
    /RPC missing/
  );
  const race = fakeSupabase({});
  race.from = () => ({
    update: () => {
      const query = { eq: () => query, select: async () => ({ data: [], error: null }) };
      return query;
    }
  });
  await assert.rejects(
    reviewPendingCandidates(race, [structuredClone(candidate)], [], { fetchPage, autoApprove: true }),
    /modificato contemporaneamente/
  );
  assert.equal(race.calls.length, 0);
});

test("Instagram identity participates in duplicate detection", () => {
  assert.equal(candidatesMatch(
    { name: "Alpha", instagram_url: "https://instagram.com/same/" },
    { name: "Beta", instagram_url: "https://www.instagram.com/same" }
  ), true);
});

test("production writes and automatic approval are rejected before network requests", () => {
  assert.equal(stagingUrl("https://eqonpqgazhmjbrjtexmg.supabase.co"), true);
  assert.equal(stagingUrl("https://yihognpbnhdolsnmicwi.supabase.co"), false);
  assert.equal(stagingUrl("https://eqonpqgazhmjbrjtexmg.supabase.co.example.com"), false);
  const result = spawnSync(process.execPath, ["scripts/discover-animators.mjs"], {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_URL: "https://yihognpbnhdolsnmicwi.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "not-a-key", ANIMATOR_AUTO_APPROVE: "true" }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /solo sul progetto staging/);
});
