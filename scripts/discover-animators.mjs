import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

const DRY_RUN = process.argv.includes("--dry-run");
const REPORT_PATH = process.env.REPORT_PATH || "animators-report.md";
const MAX_NEW = Number(process.env.MAX_NEW_CANDIDATES || 60);
const UA = "ToscanaFamilyBot/1.0 (+https://github.com/gianlucafiume0004-max/toscanafamily)";

const CITIES = [
  ["Firenze", "FI"], ["Prato", "PO"], ["Pistoia", "PT"], ["Empoli", "FI"],
  ["Scandicci", "FI"], ["Sesto Fiorentino", "FI"], ["Pisa", "PI"],
  ["Livorno", "LI"], ["Lucca", "LU"], ["Arezzo", "AR"], ["Siena", "SI"],
  ["Grosseto", "GR"], ["Massa", "MS"], ["Viareggio", "LU"]
];

const TAG_RULES = [
  ["feste-compleanno", /compleann|birthday|festa/i],
  ["mascotte", /mascott|personaggi|supereroi|principesse|costumi/i],
  ["magia", /\bmag(o|ia|hi)\b|illusion/i],
  ["truccabimbi", /trucca|face ?painting|pittura/i],
  ["palloncini", /palloncin|balloon|twist/i],
  ["baby-dance", /baby ?dance|mini ?disco|musica|dj\b/i],
  ["bolle-di-sapone", /bolle/i],
  ["laboratori", /laborator|creativ/i],
  ["giochi", /giochi|gioco|animazione/i],
  ["teatro-burattini", /burattin|teatro|spettacol/i],
  ["gonfiabili", /gonfiabil/i],
  ["eventi-piazza", /piazza|eventi|sagre|feste patronali/i],
  ["a-domicilio", /domicilio|a casa|ovunque/i]
];

const BLOCKED_DOMAINS = [
  "facebook.com", "instagram.com", "youtube.com", "tripadvisor.", "paginegialle.it",
  "yelp.", "wikipedia.org", "amazon.", "subito.it", "google.", "pinterest.", "tiktok.com",
  "linkedin.com", "twitter.com", "x.com", "paginebianche.it", "virgilio.it", "bing.com"
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, { timeout = 15000, method = "GET", body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    body,
    headers: { "User-Agent": UA, "Accept-Language": "it-IT,it;q=0.9", ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

const normalizeName = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(animazione|animatori|animatore|feste|bambini|srl|snc|asd|di|e|il|la|per|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();

const normalizePhone = (p) => {
  if (!p) return null;
  let d = p.replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (d.startsWith("+39")) d = d.slice(3);
  d = d.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 11 ? d : null;
};

const domainOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
};

const igHandle = (url) => {
  const m = url?.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const h = m?.[1]?.toLowerCase();
  return h && !["p", "reel", "explore", "accounts", "about", "stories"].includes(h) ? h : null;
};

const fbPage = (url) => {
  const m = url?.match(/facebook\.com\/([A-Za-z0-9._-]+)/i);
  const h = m?.[1]?.toLowerCase();
  return h && !["sharer", "sharer.php", "share", "tr", "plugins", "dialog", "events", "groups", "watch", "login", "policies"].includes(h)
    ? h : null;
};

function buildKey(c) {
  return (
    (c.website_domain && `d:${c.website_domain}`) ||
    (c.phone_normalized && `p:${c.phone_normalized}`) ||
    (igHandle(c.instagram) && `i:${igHandle(c.instagram)}`) ||
    (fbPage(c.facebook) && `f:${fbPage(c.facebook)}`) ||
    `n:${c.normalized_name}:${(c.city || "").toLowerCase()}`
  );
}

// ---------- Fonti ----------
const RELEVANT = /animat|animazion|feste|festa|compleann|mascott|baby ?dance|bambin/i;

// Ricerca web tramite Brave Search API (opzionale: richiede BRAVE_SEARCH_API_KEY)
async function searchWeb(query) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];
  const text = await fetchText(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&country=it&search_lang=it&count=20`,
    { headers: { "X-Subscription-Token": key, Accept: "application/json" } }
  );
  return (JSON.parse(text).web?.results || [])
    .map((r) => ({ title: r.title || "", url: r.url, snippet: (r.description || "").replace(/<[^>]+>/g, "") }))
    .filter((r) => RELEVANT.test(`${r.title} ${r.snippet} ${r.url}`));
}

async function searchOverpass() {
  const query = `[out:json][timeout:60];
area["ISO3166-2"="IT-52"]->.a;
(nwr["shop"="party"](area.a);
 nwr["amenity"="events_venue"]["name"~"animazion|animator",i](area.a);
 nwr["name"~"animazion|animatori",i]["website"](area.a););
out tags center 200;`;
  let text;
  let lastError;
  for (const endpoint of [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ]) {
    try {
      text = await fetchText(endpoint, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 90000
      });
      break;
    } catch (e) { lastError = e; }
  }
  if (!text) throw lastError;
  return JSON.parse(text).elements
    .filter((e) => e.tags?.name)
    .map((e) => ({
      name: e.tags.name,
      website: e.tags.website || e.tags["contact:website"],
      phone: e.tags.phone || e.tags["contact:phone"] || e.tags["contact:mobile"],
      facebook: e.tags["contact:facebook"],
      instagram: e.tags["contact:instagram"],
      email: e.tags.email || e.tags["contact:email"],
      city: e.tags["addr:city"],
      source: "osm",
      source_url: `https://www.openstreetmap.org/${e.type}/${e.id}`
    }));
}

// ---------- Arricchimento ----------
async function enrich(c) {
  if (!c.website) return c;
  const pages = [c.website];
  const contactPaths = ["contatti", "contact", "chi-siamo"];
  const seen = new Set();
  let text = "";
  for (let i = 0; i < pages.length && i < 3; i++) {
    let html;
    try { html = await fetchText(pages[i], { timeout: 12000 }); } catch { continue; }
    const $ = cheerio.load(html);
    if (i === 0) {
      c.description ||= ($('meta[name="description"]').attr("content") || "").trim().slice(0, 400);
      $("a[href]").each((_, a) => {
        const h = $(a).attr("href") || "";
        if (/contatt|contact|chi-siamo/i.test(h) && pages.length < 3) {
          try { const u = new URL(h, c.website).href; if (domainOf(u) === domainOf(c.website) && !pages.includes(u)) pages.push(u); } catch {}
        }
      });
      if (pages.length === 1) {
        for (const p of contactPaths) { try { pages.push(new URL(p, c.website).href); } catch {} }
      }
    }
    $("a[href]").each((_, a) => {
      const h = $(a).attr("href") || "";
      if (!c.facebook && fbPage(h)) c.facebook = h.split("?")[0];
      if (!c.instagram && igHandle(h)) c.instagram = h.split("?")[0];
      if (!c.phone && /^tel:/i.test(h)) c.phone = decodeURIComponent(h.slice(4));
      if (!c.email && /^mailto:/i.test(h)) c.email = h.slice(7).split("?")[0];
    });
    $("script,style,noscript").remove();
    const body = $("body").text().replace(/\s+/g, " ");
    text += " " + body.slice(0, 6000);
    if (!c.phone) {
      const m = body.match(/(?:\+39[\s.]?)?\b3\d{2}[\s.]?\d{6,7}\b|\b0\d{1,3}[\s.\/]?\d{5,8}\b/);
      if (m) c.phone = m[0].trim();
    }
    seen.add(pages[i]);
    await sleep(300);
  }
  c._text = text;
  return c;
}

function assignTags(c) {
  const hay = [c.name, c.description, c.snippet, c._text].filter(Boolean).join(" ");
  const tags = TAG_RULES.filter(([, re]) => re.test(hay)).map(([t]) => t);
  if (!tags.length) tags.push("animazione");
  if (c.city) tags.push(`zona-${c.city.toLowerCase().replace(/\s+/g, "-")}`);
  return [...new Set(tags)];
}

function detectCity(c, fallback) {
  const hay = `${c.name} ${c.description || ""} ${c.snippet || ""}`.toLowerCase();
  const hit = CITIES.find(([n]) => hay.includes(n.toLowerCase()));
  return c.city || hit?.[0] || fallback?.[0] || null;
}

// ---------- Main ----------
async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!DRY_RUN && (!url || !key)) throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY richiesti.");
  const supabase = !DRY_RUN || (url && key) ? createClient(url, key) : null;

  // Chiavi già note: candidati + providers esistenti
  const known = { domains: new Set(), phones: new Set(), ig: new Set(), fb: new Set(), keys: new Set() };
  const addKnown = (r) => {
    const d = domainOf(r.website); if (d) known.domains.add(d);
    const p = normalizePhone(r.phone); if (p) known.phones.add(p);
    const i = igHandle(r.instagram || r.social_url); if (i) known.ig.add(i);
    const f = fbPage(r.facebook || r.social_url); if (f) known.fb.add(f);
    if (r.dedupe_key) known.keys.add(r.dedupe_key);
  };
  const loadAll = async (table, cols) => {
    if (!supabase) return;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(table).select(cols).range(from, from + 999);
      if (error) { console.warn(`Lettura ${table} fallita: ${error.message}`); return; }
      data.forEach(addKnown);
      if (data.length < 1000) return;
    }
  };
  await loadAll("animators_candidates", "website,phone,instagram,facebook,dedupe_key");
  await loadAll("providers", "website,phone,social_url");

  const isKnown = (c) =>
    (c.website_domain && known.domains.has(c.website_domain)) ||
    (c.phone_normalized && known.phones.has(c.phone_normalized)) ||
    (igHandle(c.instagram) && known.ig.has(igHandle(c.instagram))) ||
    (fbPage(c.facebook) && known.fb.has(fbPage(c.facebook))) ||
    known.keys.has(c.dedupe_key);

  const raw = [];
  const errors = [];
  try { raw.push(...(await searchOverpass())); } catch (e) { errors.push(`Overpass: ${e.message}`); }

  if (!process.env.BRAVE_SEARCH_API_KEY) errors.push("BRAVE_SEARCH_API_KEY non impostata: ricerca web saltata (solo OSM).");
  const queries = !process.env.BRAVE_SEARCH_API_KEY ? [] : CITIES.flatMap(([city]) => [
    `animatori feste bambini ${city}`,
    `animazione compleanno bambini ${city} sito`
  ]);
  for (const q of queries) {
    try {
      const city = CITIES.find(([n]) => q.endsWith(n));
      for (const r of await searchWeb(q)) {
        const d = domainOf(r.url);
        if (!d || BLOCKED_DOMAINS.some((b) => d.includes(b))) continue;
        raw.push({
          name: r.title.split(/[|\-–—·]/)[0].trim() || d,
          website: new URL(r.url).origin,
          snippet: r.snippet,
          city: city?.[0],
          province: city?.[1],
          source: "web-search",
          source_url: r.url
        });
      }
    } catch (e) { errors.push(`Ricerca "${q}": ${e.message}`); }
    await sleep(1500);
  }

  const stats = { found: raw.length, duplicates: 0, inserted: 0, failed: 0 };
  const fresh = [];
  const batchKeys = new Set();
  for (const base of raw) {
    if (fresh.length >= MAX_NEW) break;
    const c = {
      ...base,
      website_domain: domainOf(base.website),
      normalized_name: normalizeName(base.name)
    };
    if (!c.normalized_name) continue;
    c.phone_normalized = normalizePhone(c.phone);
    c.dedupe_key = buildKey(c);
    if (isKnown(c) || batchKeys.has(c.dedupe_key)) { stats.duplicates++; continue; }
    batchKeys.add(c.dedupe_key);
    await enrich(c);
    // dopo l'arricchimento ricontrolla i duplicati con i nuovi contatti
    c.phone_normalized = normalizePhone(c.phone);
    c.dedupe_key = buildKey(c);
    if (isKnown(c)) { stats.duplicates++; continue; }
    c.city = detectCity(c);
    c.tags = assignTags(c);
    fresh.push(c);
  }

  const rows = fresh.map((c) => ({
    name: c.name.slice(0, 200),
    normalized_name: c.normalized_name,
    website: c.website || null,
    website_domain: c.website_domain || null,
    phone: c.phone || null,
    phone_normalized: c.phone_normalized,
    facebook: c.facebook || null,
    instagram: c.instagram || null,
    email: c.email || null,
    city: c.city || null,
    province: c.province || null,
    description: c.description || c.snippet || null,
    tags: c.tags,
    source: c.source,
    source_url: c.source_url || null,
    dedupe_key: c.dedupe_key,
    status: "pending"
  }));

  if (DRY_RUN) {
    console.log("DRY RUN: nessuna scrittura su database.");
  } else if (rows.length) {
    const { data, error } = await supabase
      .from("animators_candidates")
      .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (error) { stats.failed = rows.length; errors.push(`Insert: ${error.message}`); }
    else stats.inserted = data.length;
  }

  const report = [
    `# Report animatori - ${new Date().toISOString().slice(0, 10)}`,
    "",
    `- Risultati grezzi: ${stats.found}`,
    `- Duplicati scartati: ${stats.duplicates}`,
    `- Nuovi candidati ${DRY_RUN ? "(dry-run)" : "salvati"}: ${DRY_RUN ? rows.length : stats.inserted}`,
    `- Errori: ${errors.length + stats.failed}`,
    "",
    "Stato: tutti i candidati sono `pending` in `animators_candidates` (nessuna pubblicazione).",
    "",
    "    | Nome | Città | Sito | Telefono | Facebook | Instagram | Tag |",
    "|---|---|---|---|---|---|---|",
    ...rows.map((r) =>
      `| ${r.name.replace(/\|/g, "/")} | ${r.city || "-"} | ${r.website || "-"} | ${r.phone || "-"} | ${r.facebook || "-"} | ${r.instagram || "-"} | ${r.tags.join(", ")} |`),
    ...(errors.length ? ["", "## Errori", ...errors.map((e) => `- ${e}`)] : [])
  ].join("\n");

  await writeFile(REPORT_PATH, report + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, report + "\n", { flag: "a" });
  console.log(report);
  if (!raw.length && errors.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
