import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import crypto from "node:crypto";

const WRITE = process.argv.includes("--write");
const MAX_LINKS_PER_SOURCE = Number(process.env.MAX_EVENT_LINKS || 35);
const REQUEST_TIMEOUT_MS = Number(process.env.EVENT_REQUEST_TIMEOUT_MS || 20000);
const USER_AGENT = process.env.EVENTS_USER_AGENT || "LaPianaFamily/1.0 event importer";

const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
const SUPABASE_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: null }
});

function cleanEnv(value) {
  return String(value || "").trim().replace(/^['\"]|['\"]$/g, "").replace(/\/$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compact(value, max = 2000) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function sameHost(urlA, urlB) {
  try {
    return new URL(urlA).hostname === new URL(urlB).hostname;
  } catch {
    return false;
  }
}

function likelyEventLink(url) {
  const value = String(url || "").toLowerCase();
  return /event|evento|eventi|agenda|calendar|manifestaz|spettacol|laborator|festival|mostr|mercat|festa|bambin/.test(value);
}

function extractLinks(html, baseUrl) {
  const found = new Set();
  const regex = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const url = absoluteUrl(match[1], baseUrl);
    if (!url || !sameHost(url, baseUrl) || !likelyEventLink(url)) continue;
    found.add(url.split("#")[0]);
  }
  return [...found].slice(0, MAX_LINKS_PER_SOURCE);
}

function flattenJsonLd(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (typeof value !== "object") return [];
  const graph = Array.isArray(value["@graph"]) ? value["@graph"].flatMap(flattenJsonLd) : [];
  return [value, ...graph];
}

function isEventNode(node) {
  const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
  return types.some((type) => /event$/i.test(String(type || "")));
}

function extractJsonLdEvents(html) {
  const events = [];
  const regex = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      for (const node of flattenJsonLd(parsed)) {
        if (isEventNode(node)) events.push(node);
      }
    } catch {
      // Invalid JSON-LD on the page: ignore this block.
    }
  }
  return events;
}

function firstValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function imageUrl(image, baseUrl) {
  const value = firstValue(image);
  if (typeof value === "string") return absoluteUrl(value, baseUrl);
  if (value && typeof value === "object") return absoluteUrl(value.url || value.contentUrl, baseUrl);
  return null;
}

function locationData(location) {
  const item = firstValue(location);
  if (!item) return { city: null, venue: null, address: null };
  if (typeof item === "string") return { city: null, venue: compact(item, 300), address: compact(item, 500) };

  const address = item.address;
  if (typeof address === "string") {
    return { city: null, venue: compact(item.name, 300), address: compact(address, 500) };
  }

  const city = compact(address?.addressLocality || "", 150) || null;
  const fullAddress = [
    address?.streetAddress,
    address?.postalCode,
    address?.addressLocality,
    address?.addressRegion
  ].filter(Boolean).join(", ");

  return {
    city,
    venue: compact(item.name || "", 300) || null,
    address: compact(fullAddress, 500) || null
  };
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function eventKey(event) {
  return crypto
    .createHash("sha256")
    .update([event.title, event.city, event.starts_on].join("|").toLowerCase())
    .digest("hex");
}

function normalizeEvent(node, source, pageUrl) {
  const title = compact(node.name || node.headline || "", 300);
  const startsOn = validDate(node.startDate);
  if (!title || !startsOn) return null;

  const loc = locationData(node.location);
  const city = loc.city || source.comune || null;
  const sourceUrl = absoluteUrl(node.url || node.mainEntityOfPage || pageUrl, pageUrl) || pageUrl;

  const event = {
    title,
    city,
    location: loc.venue || loc.address || null,
    starts_on: startsOn,
    description: compact(node.description || "", 4000) || null,
    source_url: sourceUrl,
    image_url: imageUrl(node.image, pageUrl),
    ends_on: validDate(node.endDate),
    address: loc.address,
    source_name: source.name
  };

  event.import_key = eventKey(event);
  return event;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"
      },
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}


const ITALIAN_MONTHS = {
  gen: 0,
  gennaio: 0,
  feb: 1,
  febbraio: 1,
  mar: 2,
  marzo: 2,
  apr: 3,
  aprile: 3,
  mag: 4,
  maggio: 4,
  giu: 5,
  giugno: 5,
  lug: 6,
  luglio: 6,
  ago: 7,
  agosto: 7,
  set: 8,
  settembre: 8,
  ott: 9,
  ottobre: 9,
  nov: 10,
  novembre: 10,
  dic: 11,
  dicembre: 11
};

function extractPointDate($, selector) {
  const field = $(selector).first();
  if (!field.length) return null;

  const year = Number(field.find(".point-year").first().text().trim());
  const day = Number(field.find(".point-date").first().text().trim());
  const monthText = field.find(".point-month").first().text().trim().toLowerCase();
  const month = ITALIAN_MONTHS[monthText];

  if (!year || !day || month === undefined) return null;

  const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractHtmlEvent(html, source, pageUrl) {
  const $ = cheerio.load(html);

  const title = compact(
    $('h1[data-element="page-name"]').first().text() ||
    $("h1").first().text() ||
    $('meta[property="og:title"]').attr("content") ||
    $("title").first().text(),
    300
  ).replace(/\s*\|\s*Comune.*$/i, "");

  const startsOn = extractPointDate(
    $,
    ".field--name-field-data-e-orario-di-inizio"
  );

  if (!title || !startsOn) return null;

  const endsOn = extractPointDate(
    $,
    ".field--name-field-data-e-orario-di-fine"
  );

  const description = compact(
    $('meta[property="og:description"]').attr("content") ||
    $(".field--name-body").first().text() ||
    $("article .field--type-text-long").first().text() ||
    "",
    4000
  ) || null;

  const address = compact(
    $(".field--type-address p").first().text() ||
    $('[itemprop="streetAddress"]').first().text() ||
    "",
    500
  ) || null;

  const image = absoluteUrl(
    $('meta[property="og:image"]').attr("content"),
    pageUrl
  );

  const event = {
    title,
    city: source.comune || null,
    location: address,
    starts_on: startsOn,
    ends_on: endsOn,
    description,
    source_url: pageUrl,
    image_url: image,
    address,
    source_name: source.name
  };

  event.import_key = eventKey(event);
  return event;
}

async function collectSourceEvents(source) {
  const firstHtml = await fetchText(source.url);
  const pages = [{ url: source.url, html: firstHtml }];

  for (const url of extractLinks(firstHtml, source.url)) {
    try {
      await sleep(300);
      pages.push({ url, html: await fetchText(url) });
    } catch (error) {
      console.warn(`  skip ${url}: ${error.message}`);
    }
  }

  const byKey = new Map();

  for (const page of pages) {
    const jsonLdNodes = extractJsonLdEvents(page.html);

    for (const node of jsonLdNodes) {
      const event = normalizeEvent(node, source, page.url);
      if (event) byKey.set(event.import_key, event);
    }

    const htmlEvent = extractHtmlEvent(page.html, source, page.url);
    if (htmlEvent) {
      byKey.set(htmlEvent.import_key, htmlEvent);
    }
  }

  return [...byKey.values()];
}

async function eventExists(event) {
  let query = supabase
    .from("events")
    .select("id")
    .eq("title", event.title)
    .eq("starts_on", event.starts_on)
    .limit(1);

  query = event.city ? query.eq("city", event.city) : query.is("city", null);
  const { data, error } = await query;
  if (error) throw error;
  return Boolean(data?.length);
}

async function insertCompatibleEvent(event) {
  // These five columns are already used by App.jsx.
  const row = {
    id: `AUTO_${event.import_key.slice(0, 20)}`,
    title: event.title,
    city: event.city,
    location: event.location,
    starts_on: event.starts_on,
    description: event.description
  };

  const { error } = await supabase.from("events").insert(row);
  if (error) throw error;
}

async function updateSource(source, patch) {
  const { error } = await supabase.from("sources").update(patch).eq("id", source.id);
  if (error) console.warn(`  source log not updated: ${error.message}`);
}


const FAMILY_KEYWORDS = [
  "bambin",
  "famigli",
  "ragazz",
  "genitor",
  "infanzia",
  "nido",
  "scuola",
  "laborator",
  "lettur",
  "fiab",
  "favol",
  "gioco",
  "giochi",
  "ludoteca",
  "parco",
  "museo",
  "spettacolo",
  "burattin",
  "marionett",
  "teatro per famiglie",
  "festa",
  "carnevale",
  "animazione",
  "giostra",
  "luna park",
  "centro estivo",
  "fattoria didattica",
  "biblioteca ragazzi",
  "open day"
];

const EXCLUDED_KEYWORDS = [
  "consiglio comunale",
  "seduta consiliare",
  "convocazione",
  "ordine del giorno",
  "conferenza stampa",
  "commissione consiliare",
  "assemblea comunale",
  "svuota la cantina",
];

function searchableEventText(event) {
  return [
    event.title,
    event.description,
    event.location,
    event.city
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isFamilyEvent(event) {
  const text = searchableEventText(event);

  if (EXCLUDED_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return false;
  }

  return FAMILY_KEYWORDS.some((keyword) => text.includes(keyword));
}

function isExpiredEvent(event) {
  const comparisonDate = new Date(event.ends_on || event.starts_on);

  if (Number.isNaN(comparisonDate.getTime())) {
    return true;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return comparisonDate.getTime() < today.getTime();
}

async function main() {
  console.log(WRITE ? "EVENT IMPORT: WRITE MODE" : "EVENT IMPORT: PREVIEW MODE");

  const { data: sources, error } = await supabase
    .from("sources")
    .select("*")
    .eq("category", "events")
    .eq("active", true)
    .order("id");

  if (error) throw error;
  console.log(`Active event sources: ${sources.length}`);

  let found = 0;
  let inserted = 0;
  let duplicates = 0;
  let failedSources = 0;

  for (const [index, source] of sources.entries()) {
    console.log(`[${index + 1}/${sources.length}] ${source.name}`);
    const startedAt = new Date().toISOString();

    try {
      const events = await collectSourceEvents(source);
      found += events.length;
      console.log(`  JSON-LD events found: ${events.length}`);

      for (const event of events) {
        if (isExpiredEvent(event)) {
          console.log(`  SKIP EXPIRED: ${event.title}`);
          continue;
        }

        if (!isFamilyEvent(event)) {
          console.log(`  SKIP NOT FAMILY: ${event.title}`);
          continue;
        }

        if (await eventExists(event)) {
          duplicates += 1;
          continue;
        }

        console.log(`  NEW: ${event.title} | ${event.city || "city unknown"} | ${event.starts_on}`);
        if (WRITE) {
          await insertCompatibleEvent(event);
          inserted += 1;
        }
      }

      await updateSource(source, {
        last_run: startedAt,
        last_success: new Date().toISOString(),
        last_error: null,
        items_found: events.length
      });
    } catch (sourceError) {
      failedSources += 1;
      console.error(`  ERROR: ${sourceError.message}`);
      await updateSource(source, {
        last_run: startedAt,
        last_error: String(sourceError.message).slice(0, 1000)
      });
    }
  }

  console.log("--- SUMMARY ---");
  console.log(`Found: ${found}`);
  console.log(`Duplicates: ${duplicates}`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Failed sources: ${failedSources}`);
  if (!WRITE) console.log("Preview only. Run with --write to insert new events.");

  if (failedSources === sources.length && sources.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
