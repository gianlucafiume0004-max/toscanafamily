import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { classifyAnimator, isAnimatorCategory, learnApproved, loadMunicipalities, mergeLearning } from "./animator-learning.mjs";
import {
  candidatesMatch, classifyReviewStatus, createReport, enrichCandidate, getQualityScore, isApprovalEligible,
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
  <html><body>Animazione per bambini con truccabimbi e baby dance. Telefono: 338 7862448
  <a href="https://www.facebook.com/share/example/">Facebook</a>
  <a href="https://www.instagram.com/example/">Instagram</a>
  <a href="/contatti">Contatti</a></body></html>`;

test("ISTAT mapping resolves verified municipalities and rejects unknown cities", async () => {
  const municipalities = await loadMunicipalities();
  for (const [city, province] of [["prato", "PO"], ["firenze", "FI"], ["dicomano", "FI"], ["arezzo", "AR"]]) {
    assert.equal(municipalities.get(city), province);
  }
  assert.equal(municipalities.get("rimini"), undefined);
  const empty = { ...structuredClone(candidate), city: "Dicomano", province: null };
  const result = await enrichCandidate(empty, [], async (url) => ({ finalUrl: url, html: "" }), { municipalities });
  assert.equal(result.candidate.province, "FI");
  assert.equal(result.candidate.field_sources.province, source);
  const offline = await enrichCandidate(empty, [], async () => { throw new Error("offline"); }, { municipalities });
  assert.equal(offline.candidate.province, "FI");
  assert.equal(offline.enrichment_failures, 1);
  const missing = { ...structuredClone(candidate), city: null, province: null };
  const fromAddress = await enrichCandidate(missing, [], async (url) =>
    ({ finalUrl: url, html: "Sede legale: Via Roma 12 Dicomano" }), { municipalities });
  assert.equal(fromAddress.candidate.city, "Dicomano");
  assert.equal(fromAddress.candidate.province, "FI");
  const coverage = await enrichCandidate(missing, [], async (url) =>
    ({ finalUrl: url, html: "Operiamo a Dicomano" }), { municipalities });
  assert.equal(coverage.candidate.city, null);
});

test("animator keywords raise confidence and mixed categories remain independent", () => {
  assert.equal(classifyAnimator("Animazione per bambini").confidence_animatore, 60);
  assert.ok(classifyAnimator("Animazione per bambini con truccabimbi").confidence_animatore >= 80);

  const mixed = classifyAnimator(
    "Animazione per bambini con truccabimbi, sala feste, allestimenti, gonfiabili ed eventi"
  );
  assert.equal(isAnimatorCategory(mixed), true);
  assert.deepEqual(mixed.categories, ["animatore", "sala_feste", "allestimenti", "gonfiabili", "eventi"]);

  for (const [text, categories] of [
    ["Klab Kids: animazione per bambini e sala feste", ["animatore", "sala_feste"]],
    ["Orsi in Festa: animazione per bambini e allestimenti", ["animatore", "allestimenti"]],
    ["Party4all: animazione per bambini ed eventi", ["animatore", "eventi"]],
    ["Sem Gonfiabili: noleggio gonfiabili", ["gonfiabili"]]
  ]) assert.deepEqual(classifyAnimator(text).categories, categories, text);

  assert.ok(
    classifyAnimator("Feste per bambini, giochi e baby dance").confidence_animatore >
    classifyAnimator("Feste per bambini").confidence_animatore
  );
  for (const [text, category] of [
    ["noleggio gonfiabili", "gonfiabili"],
    ["sala feste", "sala_feste"],
    ["allestimenti balloon art", "allestimenti"]
  ]) {
    const result = classifyAnimator(text);
    assert.equal(isAnimatorCategory(result), false, text);
    assert.ok(result.categories.includes(category));
  }
});

test("review statuses use 80/60 confidence thresholds only after safety checks", () => {
  const complete = {
    ...structuredClone(candidate),
    phone: "+393387862448",
    facebook_url: "https://facebook.com/example/",
    quality_score: 90,
    field_sources: Object.fromEntries(
      ["phone", "website", "city", "province", "facebook_url"]
        .map((field) => [field, source])
    )
  };
  const sources = [{ name: complete.name, url: source }];
  assert.equal(classifyReviewStatus(complete, { confidence_animatore: 80 }, { sources }), "approved_auto");
  assert.equal(classifyReviewStatus(complete, { confidence_animatore: 60 }, { sources }), "approved_probable");
  assert.equal(classifyReviewStatus(complete, { confidence_animatore: 59 }, { sources }), "pending_review");
  assert.equal(classifyReviewStatus(complete, { confidence_animatore: 100 }, {
    duplicate: true, sources
  }), "duplicate");
  assert.equal(classifyReviewStatus({ ...complete, province: "RN" }, {
    confidence_animatore: 100
  }, { sources }), "pending_review");
  assert.equal(classifyReviewStatus({ ...complete, quality_score: 89 }, {
    confidence_animatore: 100
  }, { sources }), "pending_review");
});

test("mismatched province blocks classification but mixed categories do not", async () => {
  const municipalities = await loadMunicipalities();
  for (const [province, page, expected] of [
    ["PO", "Animazione per bambini con truccabimbi e baby dance", "pending_review"],
    ["FI", "Animazione per bambini con truccabimbi e sala feste", "approved_auto"]
  ]) {
    const client = fakeSupabase({ data: [{ status: "approved", provider_id: "provider-one" }], error: null });
    const pending = { ...structuredClone(candidate), province };
    const result = await reviewPendingCandidates(client, [pending], [], {
      autoApprove: true, dryRun: true, municipalities,
      fetchPage: async (url) => ({ finalUrl: url, html: `${page} Telefono: 338 7862448 <a href="https://instagram.com/example">Instagram</a>` })
    });
    assert.equal(result[0].status, expected);
    assert.equal(client.calls.length, 0);
    assert.deepEqual(client.updates, []);
  }
});

test("approved provenance is aggregated once and merged into historical learning", () => {
  const first = learnApproved([{ id: "1", status: "approved",
    field_sources: { phone: "https://example.it/contatti", city: "https://example.it/privacy" } }]);
  const next = learnApproved([{ id: "2", status: "approved",
    field_sources: { phone: "https://other.it/contatti" } }]);
  const combined = mergeLearning(first, next);
  assert.equal(combined.pages.contatti, 2);
  assert.equal(combined.pages["privacy policy"], 1);
  assert.equal(combined.sources["example.it"], 2);
  assert.equal(mergeLearning(combined, next).records.length, 2);
  assert.throws(() => mergeLearning({ version: 3 }, next), /Storico/);
});

test("failed pages are retried on the next run and other pages remain available", async () => {
  const empty = { ...structuredClone(candidate), phone: null };
  const request = async (url, fail) => {
    if (url === source) return { finalUrl: url, html: '<a href="/contatti">Contatti</a>' };
    if (fail) throw new Error("HTTP 500");
    return { finalUrl: url, html: "Telefono: 338 7862448" };
  };
  const first = await enrichCandidate(empty, [], (url) => request(url, true));
  assert.equal(first.enrichment_failures, 1);
  const second = await enrichCandidate(first.candidate, [], (url) =>
    url === source ? { finalUrl: url, html: "" } : request(url, false),
  { learning: { retries: { one: first.retryUrls } } });
  assert.equal(second.candidate.phone, "+393387862448");
  assert.equal(second.enrichment_failures, 0);
});

test("website linked by a known social requires a reciprocal profile link", async () => {
  const social = "https://facebook.com/example";
  const empty = { ...structuredClone(candidate), website: null, facebook_url: social, source_urls: [] };
  for (const [backlink, expected] of [[social, "https://example.it"], ["https://facebook.com/other", null]]) {
    const result = await enrichCandidate(empty, [], async (url) => ({
      finalUrl: url,
      html: url === social ? `<a href="${source}">Sito ufficiale</a>` : `<a href="${backlink}">Facebook</a>`
    }));
    assert.equal(result.candidate.website, expected);
    if (!expected) assert.ok(result.failures.some((failure) => failure.includes("reciproco")));
  }
});

test("pending candidates are processed by decreasing quality score", async () => {
  const low = { ...structuredClone(candidate), name: "Low", id: "low", website: "https://low.it/", source_urls: [],
    phone: null, instagram_url: null };
  const high = { ...structuredClone(candidate), name: "High", id: "high", website: "https://high.it/", source_urls: [],
    phone: "3387862448", instagram_url: "https://instagram.com/high" };
  const order = [];
  await reviewPendingCandidates(null, [low, high], [], { dryRun: true, fetchPage: async (url) => {
    order.push(url);
    return { finalUrl: url, html: "" };
  } });
  assert.equal(order[0], "https://high.it/");
});

test("historical page frequencies affect subsequent scan order", async () => {
  const visited = [];
  await enrichCandidate(structuredClone(candidate), [], async (url) => {
    visited.push(url);
    return { finalUrl: url, html: url === source
      ? `<a href="/privacy">Privacy</a><a href="/servizi">Servizi</a>`
      : "" };
  }, { learning: { pages: { "servizi e copertura": 20 } } });
  assert.ok(visited.indexOf("https://example.it/servizi") < visited.indexOf("https://example.it/privacy"));
});

test("confidence and timestamp are shown in the advanced report", () => {
  const report = createReport([], { sourcesAnalyzed: 0, rawCandidates: 0, internalDuplicates: 0,
    providerDuplicates: 0, searchErrors: [] }, [
    {
      candidate: { ...candidate, quality_score: 90, missing_fields: ["phone"] },
      status: "approved_probable", failures: ["HTTP 500"], enrichment_failures: 1,
      linkedPolicySources: [], enrichment_attempts: 2, enrichment_successes: 1,
      confidence: classifyAnimator("animazione per bambini"),
      publicationEligible: true,
      enrichments: [{ field: "city", value: "Firenze", source_url: source, attempt: 1,
        method: "contatti", timestamp: "2026-01-01T00:00:00.000Z" }]
    },
    {
      candidate: { ...candidate, name: "Happy Party Planner", quality_score: 90, missing_fields: [] },
      status: "pending_review", failures: [], linkedPolicySources: [],
      enrichment_attempts: 0, enrichment_successes: 0, enrichment_failures: 0,
      confidence: classifyAnimator("animazione"), requirementsEligible: true,
      enrichments: []
    }
  ]);
  assert.match(report, /confidence_animatore/);
  assert.match(report, /approved_auto/);
  assert.match(report, /approved_probable: 1/);
  assert.match(report, /richiede verifica leggera/);
  assert.match(report, /## QUASI APPROVATI/);
  assert.match(report, /Happy Party Planner: manca solo verifica categoria/);
  assert.match(report, /enrichment_failures: 1/);
  assert.match(report, /2026-01-01T00:00:00.000Z/);
  assert.match(report, /QUASI APPROVATI/);
});

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

test("enrichment exhausts linked sources after HTTP, DNS and timeout failures", async () => {
  const empty = { ...structuredClone(candidate), city: null, province: null,
    services: [], coverage_area: null, field_sources: { website: source } };
  const pages = {
    [source]: `<a href="/contatti">Contatti</a><a href="/privacy">Privacy</a>
      <a href="/cookie">Cookie</a><a href="/termini">Termini</a>
      <a href="/chi-siamo">Chi siamo</a><a href="/servizi">Servizi</a>
      <a href="/faq">FAQ</a><a href="/azienda">Azienda</a>`,
    "https://example.it/termini": "Sede legale: Via Villa 25, 50062 Dicomano (FI)",
    "https://example.it/chi-siamo": `<a href="https://api.whatsapp.com/send?phone=393387862448">WhatsApp</a>
      <a href="https://facebook.com/example">Facebook</a>`,
    "https://example.it/servizi": `<p>Animazione e baby dance</p><a href="https://instagram.com/example">Instagram</a>`,
    "https://example.it/faq": "<p>Operiamo in Firenze e Prato.</p>"
  };
  const requested = [];
  const result = await enrichCandidate(empty, [], async (url) => {
    requested.push(url);
    if (url.endsWith("/contatti")) throw new Error("HTTP 429");
    if (url.endsWith("/privacy")) throw new Error("DNS ENOTFOUND");
    if (url.endsWith("/cookie")) throw new Error("timeout");
    if (url.endsWith("/azienda")) throw new Error("HTTP 500");
    return { html: `<html><body>${pages[url] ?? ""}</body></html>`, finalUrl: url };
  });
  assert.equal(result.failures.length, 4);
  assert.equal(result.candidate.city, "Dicomano");
  assert.equal(result.candidate.province, "FI");
  assert.equal(result.candidate.phone, "+393387862448");
  assert.equal(result.candidate.coverage_area, "Firenze e Prato");
  assert.equal(result.candidate.quality_score, 100);
  assert.equal(result.enrichment_attempts, requested.length);
  assert.equal(result.enrichment_successes, 7);
  assert.equal(result.enrichments.find((entry) => entry.field === "city").method, "termini e condizioni");
  assert.equal(result.enrichments.find((entry) => entry.field === "phone").source_url, "https://example.it/chi-siamo");
  assert.ok(requested.indexOf("https://example.it/contatti") < requested.indexOf("https://example.it/privacy"));
  assert.equal(empty.phone, null);
});

test("structured addresses and externally hosted policies require official provenance", async () => {
  const empty = { ...structuredClone(candidate), city: null, province: null,
    field_sources: { website: source } };
  const policy = "https://www.iubenda.com/privacy-policy/123";
  const result = await enrichCandidate(empty, [], async (url) => ({
    finalUrl: url,
    html: url === source
      ? `<a href="${policy}">Privacy policy</a><a href="https://unrelated.it/privacy">Privacy</a>`
      : `<script type="application/ld+json">${JSON.stringify({
        "@type": "LocalBusiness", name: "Example", address: {
          addressLocality: "Prato", addressRegion: "PO"
        }
      })}</script>`
  }));
  assert.equal(result.candidate.city, "Prato");
  assert.equal(result.candidate.field_sources.city, policy);
  assert.deepEqual(result.linkedPolicySources, [policy]);
  const complete = { ...result.candidate, phone: "3387862448",
    facebook_url: "https://facebook.com/example", quality_score: 90,
    field_sources: { ...result.candidate.field_sources, phone: source, facebook_url: source } };
  assert.equal(isApprovalEligible(complete), false);
  assert.equal(isApprovalEligible(complete, [], result.linkedPolicySources), true);
});

test("ambiguous addresses and service coverage do not establish a location", async () => {
  const empty = { ...structuredClone(candidate), city: null, province: null };
  const result = await enrichCandidate(empty, [], async (url) => ({
    finalUrl: url, html: `<p>Sede legale Via Roma 1, 59100 Prato (PO);
      sede operativa Via Villa 25, 50062 Dicomano (FI).</p><p>Operiamo in Firenze.</p>`
  }));
  assert.equal(result.candidate.city, null);
  assert.equal(result.candidate.province, null);
  assert.equal(result.candidate.coverage_area, "Toscana");
});

test("legal social links and non-geographic phrases do not fill candidate fields", async () => {
  const empty = { ...structuredClone(candidate), coverage_area: null };
  const result = await enrichCandidate(empty, [], async (url) => ({
    finalUrl: url,
    html: `<a href="https://instagram.com/about/legal/privacy/">Privacy</a>
      <p>Disponibili su Sem Gonfiabili. Lavoriamo a valutare tutte le esigenze.</p>`
  }));
  assert.equal(result.candidate.instagram_url, null);
  assert.equal(result.candidate.coverage_area, null);
});

test("provincial capital is inferred only from a matching explicit postal address", async () => {
  const empty = { ...structuredClone(candidate), city: null, province: null };
  for (const [html, city, province] of [
    ["Via del Ferrone, 5 – 50124 – Firenze", "Firenze", "FI"],
    ["Via del Ferrone, 5 – 59100 – Firenze", null, null],
    ["Operiamo a Firenze, 50124", null, null]
  ]) {
    const result = await enrichCandidate(empty, [], async (url) => ({ finalUrl: url, html }));
    assert.equal(result.candidate.city, city);
    assert.equal(result.candidate.province, province);
  }
});

test("all linked pages are tried even beyond the former 16-page limit", async () => {
  const links = Array.from({ length: 20 }, (_, i) => `<a href="/servizi-${i}">Servizi ${i}</a>`).join("");
  const result = await enrichCandidate(structuredClone(candidate), [], async (url) => ({
    finalUrl: url, html: url === source ? links : url.endsWith("servizi-19") ? "Telefono: 338 7862448" : ""
  }));
  assert.equal(result.enrichment_attempts, 21);
  assert.equal(result.candidate.phone, "+393387862448");
});

test("domain names do not make unrelated links relevant to enrichment", async () => {
  const url = "https://festamagica.example/";
  const visited = [];
  await enrichCandidate({ ...structuredClone(candidate), website: url, source_urls: [url] }, [], async (page) => {
    visited.push(page);
    return { finalUrl: page, html: `<a href="https://festamagica.example/blog">Blog</a>
      <a href="/servizi">Servizi</a>` };
  });
  assert.deepEqual(visited, [url, "https://festamagica.example/servizi"]);
});

test("review checks duplicates after enriching all pending candidates", async () => {
  const second = { ...structuredClone(candidate), id: "two", name: "Other",
    website: "https://other.it/", source_urls: ["https://other.it/"],
    field_sources: { ...candidate.field_sources, website: "https://other.it/" } };
  const client = fakeSupabase({ data: [{ status: "approved", provider_id: "provider-one" }], error: null });
  const results = await reviewPendingCandidates(client, [structuredClone(candidate), second], [], {
    autoApprove: true, fetchPage: async (url) => ({
      finalUrl: url, html: `Telefono: 338 7862448 <a href="https://instagram.com/${url.includes("other") ? "other" : "example"}">Instagram</a>`
    })
  });
  assert.deepEqual(results.map((entry) => entry.status), ["duplicate", "duplicate"]);
  assert.equal(client.calls.length, 0);
  assert.ok(results.every((entry) => entry.failures.some((failure) => failure.includes("duplicati"))));
});

test("report includes source, attempt and aggregate counters", () => {
  const report = createReport([], { sourcesAnalyzed: 0, rawCandidates: 0, internalDuplicates: 0,
    providerDuplicates: 0, searchErrors: [] }, [{
    candidate: { ...candidate, quality_score: 90, missing_fields: [] }, status: "eligible",
    failures: [], linkedPolicySources: [], enrichment_attempts: 3, enrichment_successes: 1,
    enrichments: [{ field: "phone", value: "+393387862448", source_url: source, attempt: 2, method: "contatti" }]
  }]);
  assert.match(report, /enrichment_attempts: 3/);
  assert.match(report, /enrichment_successes: 1/);
  assert.match(report, /phone \| \+393387862448 \| https:\/\/example\.it\/ \| contatti \| 2/);
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

test("one verified social reaches automatic approval after recalculation and enrichment", async () => {
  for (const platform of ["facebook", "instagram"]) {
    const url = `https://www.${platform}.com/example/`;
    const html = `<html><body>Animazione per bambini con truccabimbi e baby dance. Telefono: 338 7862448 <a href="${url}">${platform}</a></body></html>`;
    const client = fakeSupabase({ data: [{ status: "approved", provider_id: "provider-one" }], error: null });
    const results = await reviewPendingCandidates(client, [structuredClone(candidate)], [], {
      autoApprove: true,
      fetchPage: async (requested) => ({
        html: requested === source ? html : "<html></html>", finalUrl: requested
      })
    });
    assert.equal(client.updates[0].quality_score, 90);
    assert.equal(results[0].status, "approved_auto");
    assert.equal(client.calls.length, 1);
  }
});

test("dry run performs no updates or RPC calls", async () => {
  const client = fakeSupabase({});
  const result = await reviewPendingCandidates(client, [structuredClone(candidate)], [], {
    fetchPage, dryRun: true, autoApprove: true
  });
  assert.equal(result[0].status, "approved_auto");
  assert.deepEqual(client.updates, []);
  assert.deepEqual(client.calls, []);
});

test("approved_probable is reported for light verification without automatic RPC", async () => {
  const client = fakeSupabase({});
  const result = await reviewPendingCandidates(client, [structuredClone(candidate)], [], {
    fetchPage: async (url) => ({
      finalUrl: url,
      html: '<html><body>Animazione per bambini. Telefono: 338 7862448 <a href="https://instagram.com/example">Instagram</a></body></html>'
    }),
    autoApprove: true
  });
  assert.equal(result[0].status, "approved_probable");
  assert.equal(result[0].confidence.confidence_animatore, 60);
  assert.equal(client.calls.length, 0);
});

test("approved and duplicate RPC outcomes persist candidate changes before RPC", async () => {
  for (const [rpcStatus, expectedStatus] of [["approved", "approved_auto"], ["duplicate", "duplicate"]]) {
    const client = fakeSupabase({ data: [{ status: rpcStatus, provider_id: "provider-one" }], error: null });
    const result = await reviewPendingCandidates(client, [structuredClone(candidate)], [], {
      fetchPage, autoApprove: true
    });
    assert.equal(result[0].status, expectedStatus);
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
  assert.equal(reviewed[0].status, "pending_review");

  const conflictClient = fakeSupabase({});
  const other = { ...structuredClone(candidate), id: "two", status: "approved" };
  const conflicts = await reviewPendingCandidates(conflictClient, [structuredClone(candidate), other], [], {
    fetchPage, autoApprove: true
  });
  assert.equal(conflicts[0].status, "duplicate");
  assert.match(conflicts[0].failures[0], /duplicati/);
  assert.equal(conflictClient.calls.length, 0);

  const providerClient = fakeSupabase({});
  const providerConflict = await reviewPendingCandidates(providerClient, [structuredClone(candidate)], [], {
    fetchPage, autoApprove: true, providers: [{ name: "Other", website: source }]
  });
  assert.equal(providerConflict[0].status, "duplicate");
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

test("pending-only mode cannot run without dry-run", () => {
  const result = spawnSync(process.execPath, ["scripts/discover-animators.mjs", "--pending-only"], {
    encoding: "utf8",
    env: { ...process.env }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--pending-only richiede --dry-run/);
});
