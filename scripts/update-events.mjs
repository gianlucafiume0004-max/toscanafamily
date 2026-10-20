
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import { collectTeatroDanteEvents } from "./teatrodante-parser.mjs";
import { collectBibliotecheFirenzeEvents } from "./biblioteche-firenze-parser.mjs";
import { collectMuseoGalileoEvents } from "./museo-galileo-parser.mjs";
import { extractPalazzoLeggendaEvents } from "./palazzo-leggenda-parser.mjs";
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

async function fetchTextWithCurl(url) {
  const { execFile } =
    await import("node:child_process");

  const timeoutSeconds = Math.max(
    30,
    Math.ceil(REQUEST_TIMEOUT_MS / 1000)
  );

  return await new Promise(
    (resolve, reject) => {
      execFile(
        "curl",
        [
          "-L",
          "--fail",
          "--silent",
          "--show-error",
          "--compressed",
          "--connect-timeout",
          String(timeoutSeconds),
          "--max-time",
          String(timeoutSeconds),
          "--user-agent",
          USER_AGENT,
          "--header",
          "Accept: text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          String(url)
        ],
        {
          encoding: "utf8",
          maxBuffer: 25 * 1024 * 1024,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                "curl fallback failed: " +
                  String(
                    stderr ||
                    error.message ||
                    error
                  ).trim()
              )
            );

            return;
          }

          resolve(stdout);
        }
      );
    }
  );
}

async function fetchText(url) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        "HTTP " + response.status
      );
    }

    return await response.text();
  } catch (error) {
    const code =
      error?.cause?.code ||
      error?.code ||
      "";

    const fallbackCodes = new Set([
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_SOCKET",
      "ECONNRESET",
      "ETIMEDOUT"
    ]);

    if (!fallbackCodes.has(code)) {
      throw error;
    }

    console.warn(
      "  fetch " +
        code +
        ", retry with curl"
    );

    return await fetchTextWithCurl(url);
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


function parseVisitTuscanyDate(value) {
  const match = String(value || "")
    .toLowerCase()
    .match(/(\d{1,2})\s+([a-zà]+)\s+(\d{4})/i);

  if (!match) return null;

  const day = Number(match[1]);
  const month = ITALIAN_MONTHS[match[2]];
  const year = Number(match[3]);

  if (!day || month === undefined || !year) return null;

  const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseVisitTuscanyDates(value) {
  const matches = [
    ...String(value || "")
      .toLowerCase()
      .matchAll(/(\d{1,2})\s+([a-zà]+)\s+(\d{4})/gi)
  ];

  const dates = matches
    .map((match) => {
      const day = Number(match[1]);
      const month = ITALIAN_MONTHS[match[2]];
      const year = Number(match[3]);

      if (!day || month === undefined || !year) return null;

      const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    })
    .filter(Boolean);

  return {
    starts_on: dates[0] || parseVisitTuscanyDate(value),
    ends_on: dates[1] || dates[0] || null
  };
}

async function fetchVisitTuscanyPage(page) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const graphqlUrl =
    "https:" + "//www.visittuscany.com/graphql";

  const query =
    '{ allAssets(locale:"it",page:' +
    page +
    ',config:"agg_evento_turismo",params:{filters:[]}) {' +
    ' totalCount pagination { current total rows }' +
    ' assets { id type href title img { src alt }' +
    ' coords { lat lng } ... on Event {' +
    ' when where info { icon text } } } } }';

  try {
    const response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
        "User-Agent": USER_AGENT
      },
      body: JSON.stringify({ query }),
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `Visit Tuscany GraphQL HTTP ${response.status}`
      );
    }

    const json = await response.json();

    if (json.errors?.length) {
      throw new Error(
        "Visit Tuscany GraphQL: " +
        json.errors.map((item) => item.message).join("; ")
      );
    }

    return json?.data?.allAssets || null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeVisitTuscanyEvent(item, source) {
  const title = compact(item?.title || "", 300);
  const dates = parseVisitTuscanyDates(item?.when);

  if (!title || !dates.starts_on) return null;

  const city =
    compact(
      String(item?.where || "")
        .replace(/^\s*(a|ad|in)\s+/i, ""),
      150
    ) || null;

  const pageUrl = absoluteUrl(
    item?.href,
    "https:" + "//www.visittuscany.com"
  );

  const image = absoluteUrl(
    item?.img?.src,
    "https:" + "//www.visittuscany.com"
  );

  const category = compact(item?.info?.text || "", 300);
  const dateText = compact(item?.when || "", 300);

  const event = {
    title,
    city,
    location: city,
    starts_on: dates.starts_on,
    ends_on: dates.ends_on,
    description:
      [category, dateText].filter(Boolean).join(" - ") || null,
    source_url: pageUrl,
    image_url: image,
    address: null,
    latitude: item?.coords?.[0]?.lat ?? null,
    longitude: item?.coords?.[0]?.lng ?? null,
    source_name: source.name
  };

  event.import_key = eventKey(event);
  return event;
}

async function collectVisitTuscanyEvents(source) {
  const byKey = new Map();

  const firstPage = await fetchVisitTuscanyPage(1);
  if (!firstPage) return [];

  const totalPages = Math.min(
    Number(firstPage?.pagination?.total || 1),
    Number(process.env.VISIT_TUSCANY_MAX_PAGES || 10)
  );

  const processPage = (pageData) => {
    for (const item of pageData?.assets || []) {
      const event = normalizeVisitTuscanyEvent(item, source);
      if (event) byKey.set(event.import_key, event);
    }
  };

  processPage(firstPage);

  for (let page = 2; page <= totalPages; page += 1) {
    await sleep(350);
    const pageData = await fetchVisitTuscanyPage(page);
    processPage(pageData);
  }

  console.log(
    `  Visit Tuscany GraphQL pages: ${totalPages}, normalized events: ${byKey.size}`
  );

  return [...byKey.values()];
}


function openPaItalianData(item) {
  return item?.data?.["ita-IT"] || item?.data?.["it-IT"] || {};
}

function openPaText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(openPaText).filter(Boolean).join(", ") || null;
  }
  if (typeof value === "object") {
    return openPaText(
      value["ita-IT"] ||
      value.name ||
      value.title ||
      value.address ||
      value.content ||
      null
    );
  }
  return null;
}

function openPaOccurrence(timeInterval) {
  const recurrences = Array.isArray(timeInterval?.recurrences)
    ? timeInterval.recurrences
    : [];

  const now = Date.now();
  const valid = recurrences
    .map(function (item) {
      return {
        start: validDate(item?.start),
        end: validDate(item?.end)
      };
    })
    .filter(function (item) {
      return Boolean(item.start);
    })
    .sort(function (a, b) {
      return new Date(a.start) - new Date(b.start);
    });

  const future = valid.find(function (item) {
    return new Date(item.end || item.start).getTime() >= now;
  });

  if (future) return future;
  if (valid.length) return valid[valid.length - 1];

  return {
    start: validDate(timeInterval?.input?.startDateTime),
    end: validDate(timeInterval?.input?.endDateTime)
  };
}

function normalizeOpenPaEvent(item, source, baseUrl) {
  const data = openPaItalianData(item);
  const occurrence = openPaOccurrence(data.time_interval);
  const title = compact(
    data.event_title || data.short_event_title || item?.metadata?.name?.["ita-IT"] || "",
    300
  );

  if (!title || !occurrence.start) return null;

  const city = compact(
    source.comune || String(source.name || "").replace(/^Comune\s+/i, ""),
    150
  ) || null;

  const place = openPaText(data.takes_place_in);
  const description = compact(
    data.event_abstract || data.description || "",
    4000
  ) || null;

  const id = item?.metadata?.id;
  const event = {
    title,
    city,
    location: place || city,
    starts_on: occurrence.start,
    ends_on: occurrence.end || occurrence.start,
    description,
    source_url: id ? absoluteUrl("/openpa/object/" + id, baseUrl) : source.url,
    image_url: id ? absoluteUrl("/image/view/" + id, baseUrl) : null,
    address: place || null,
    source_name: source.name
  };

  event.import_key = eventKey(event);
  return event;
}

async function fetchOpenPaPage(apiUrl, query) {
  const requestUrl = new URL(apiUrl);
  requestUrl.searchParams.set("q", query);

  const controller = new AbortController();
  const timer = setTimeout(function () {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(requestUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("OpenPA API HTTP " + response.status);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function collectOpenPaEvents(source) {
  const baseUrl = new URL(source.url).origin;
  const apiUrl = baseUrl + "/opendata/api/content/search/";
  const baseQuery = "classes [event] sort [time_interval=" + String.fromCharCode(62) + "asc]";

  const firstPage = await fetchOpenPaPage(apiUrl, baseQuery);
  const firstHits = Array.isArray(firstPage?.searchHits) ? firstPage.searchHits : [];
  const totalCount = Number(firstPage?.totalCount || firstHits.length);
  const pageSize = firstHits.length || 30;
  const maxPages = Math.max(1, Number(process.env.OPENPA_MAX_PAGES || 3));
  const startOffset = Math.max(0, totalCount - pageSize * maxPages);

  const byKey = new Map();
  let loadedPages = 0;

  for (let offset = startOffset; offset < totalCount && loadedPages < maxPages; offset += pageSize) {
    const query = offset === 0 ? baseQuery : baseQuery + " offset " + offset;
    const pageData = offset === 0 ? firstPage : await fetchOpenPaPage(apiUrl, query);
    loadedPages += 1;

    for (const item of pageData?.searchHits || []) {
      const event = normalizeOpenPaEvent(item, source, baseUrl);
      if (event) byKey.set(event.import_key, event);
    }

    await sleep(250);
  }

  console.log(
    "  OpenPA API pages: " + loadedPages +
    ", total available: " + totalCount +
    ", normalized events: " + byKey.size
  );

  return [...byKey.values()];
}

function extractPointDate($, selector) {
  let field = $(selector).first();

  const isEndDate =
    String(selector || "").toLowerCase().includes("fine");

  if (!field.length) {
    const points = $(".point-list");

    if (points.length) {
      field = isEndDate
        ? points.last()
        : points.first();
    }
  }

  if (!field.length) return null;

  const monthAliases = {
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
    sett: 8,
    settembre: 8,
    ott: 9,
    ottobre: 9,
    nov: 10,
    novembre: 10,
    dic: 11,
    dicembre: 11
  };

  const day = Number(
    field.find(".point-date").first().text().trim()
  );

  const monthText = field
    .find(".point-month")
    .first()
    .text()
    .trim()
    .toLowerCase()
    .replace(/\./g, "");

  const month =
    monthAliases[monthText] ??
    ITALIAN_MONTHS[monthText];

  const dateSectionText = $("#date-e-orari")
    .text()
    .replace(/\s+/g, " ")
    .trim();

  const pageText = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim();

  const labelPattern = isEndDate
    ? /Data\s+fine\s*:?\s*.{0,100}?\b(20\d{2})\b/i
    : /Data\s+inizio\s*:?\s*.{0,100}?\b(20\d{2})\b/i;

  const labeledYearMatch = pageText.match(labelPattern);
  const localYearMatch = field
    .parent()
    .text()
    .match(/\b(20\d{2})\b/);

  const sectionYearMatch =
    dateSectionText.match(/\b(20\d{2})\b/);

  const year =
    Number(
      field.find(".point-year").first().text().trim()
    ) ||
    Number(labeledYearMatch?.[1]) ||
    Number(localYearMatch?.[1]) ||
    Number(sectionYearMatch?.[1]) ||
    new Date().getFullYear();

  if (!day || month === undefined || !year) {
    return null;
  }

  const date = new Date(
    Date.UTC(year, month, day, 12, 0, 0)
  );

  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
}


function extractPratoEvent(html, source, pageUrl) {
  if (!String(pageUrl || "").includes("tempolibero2.comune.prato.it/event/")) {
    return null;
  }

  const $ = cheerio.load(html);

  const title = compact(
    $("h1").filter((_, element) => {
      const value = compact($(element).text(), 300).toLowerCase();
      return value && value !== "cartellone eventi" && value !== "eventi";
    }).first().text() ||
    $('meta[property="og:title"]').attr("content") ||
    $("title").first().text(),
    300
  ).replace(/\\s*-\\s*tempolibero.*$/i, "");

  const bodyText = compact($("body").text(), 12000);

  if (!title || !/bambin|ragazz|famigl/i.test(bodyText)) {
    return null;
  }

  const dateMatch = bodyText.match(
    /(?:Data\\s+)?(\\d{1,2})\\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\\s+(\\d{4})/i
  );

  if (!dateMatch) return null;

  const months = {
    gennaio: 0,
    febbraio: 1,
    marzo: 2,
    aprile: 3,
    maggio: 4,
    giugno: 5,
    luglio: 6,
    agosto: 7,
    settembre: 8,
    ottobre: 9,
    novembre: 10,
    dicembre: 11
  };

  const day = Number(dateMatch[1]);
  const month = months[dateMatch[2].toLowerCase()];

  const publishedDate = new Date(feedPublishedAt);
  const publishedYear = Number.isNaN(
    publishedDate.getTime()
  )
    ? new Date().getFullYear()
    : publishedDate.getUTCFullYear();

  let year = Number(dateMatch[3] || publishedYear);

  if (
    year < publishedYear - 1 ||
    year > publishedYear + 3
  ) {
    year = publishedYear;
  }

  const timeMatch = bodyText.match(
    /(?:Inizio ore|Dalle)\\s+(\\d{1,2})(?::|\\.)(\\d{2})/i
  );

  const hour = Number(timeMatch?.[1] || 12);
  const minute = Number(timeMatch?.[2] || 0);
  const startDate = new Date(Date.UTC(year, month, day, hour, minute));

  if (Number.isNaN(startDate.getTime())) return null;

  const placeMatch = bodyText.match(
    /Luogo\\s+(.+?)(?=\\s+(?:Ingresso|Prenotazione|Maggiori informazioni|Organizzato da))/i
  );

  const address = compact(placeMatch?.[1] || "", 500) || null;

  const event = {
    title,
    city: source.comune || "Prato",
    location: address,
    starts_on: startDate.toISOString(),
    ends_on: null,
    description: compact(
      $('meta[property="og:description"]').attr("content") ||
      $("main").text() ||
      $("article").text() ||
      "",
      4000
    ) || null,
    source_url: pageUrl,
    image_url: absoluteUrl(
      $('meta[property="og:image"]').attr("content") ||
      $("main img").first().attr("src"),
      pageUrl
    ),
    address,
    source_name: source.name
  };

  event.import_key = eventKey(event);
  return event;
}

function extractHtmlEvent(html, source, pageUrl) {
  const $ = cheerio.load(html);

  const title = compact(
    $('[data-element="event-title"]').first().text() ||
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
    $('[data-element="event-description"]').first().text() ||
    $("#article-general").first().text() ||
    $('meta[property="og:description"]').attr("content") ||
    $(".field--name-body").first().text() ||
    $("article .field--type-text-long").first().text() ||
    "",
    4000
  ) || null;

  const address = compact(
    $(".card-place .card-text").first().text() ||
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

function parseMuseDate(value) {
  const months = {
    gennaio: 0,
    gen: 0,
    febbraio: 1,
    feb: 1,
    marzo: 2,
    mar: 2,
    aprile: 3,
    apr: 3,
    maggio: 4,
    mag: 4,
    giugno: 5,
    giu: 5,
    luglio: 6,
    lug: 6,
    agosto: 7,
    ago: 7,
    settembre: 8,
    sett: 8,
    set: 8,
    ottobre: 9,
    ott: 9,
    novembre: 10,
    nov: 10,
    dicembre: 11,
    dic: 11
  };

  const match = String(value || "")
    .trim()
    .toLowerCase()
    .match(/(\d{1,2})\s+([a-zàèéìòù]+)\s+(\d{2,4})/i);

  if (!match) return null;

  const day = Number(match[1]);
  const month = months[match[2]];
  let year = Number(match[3]);

  if (year < 100) year += 2000;
  if (!day || month === undefined || !year) return null;

  const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractMuseEvent(html, source, pageUrl, feedTitle) {
  const $ = cheerio.load(html);

  const title = compact(
    $('[data-element="event-title"]').first().text() ||
    $("h1").first().text() ||
    feedTitle ||
    $('meta[property="og:title"]').attr("content") ||
    $("title").first().text(),
    300
  );

  const isRagionieri =
    String(source.name || "").toLowerCase().includes("ragionieri") ||
    String(pageUrl || "").includes(
      "biblioteca.comune.sesto-fiorentino.fi.it"
    );

  const isCalenzano =
    String(source.name || "").toLowerCase().includes("calenzano") ||
    String(pageUrl || "").includes(
      "comune.calenzano.fi.it"
    );

  const isFucini =
    String(source.name || "").toLowerCase().includes("fucini") ||
    String(pageUrl || "").includes(
      "biblioteca.comune.empoli.fi.it"
    );

  const articleText = compact(
    $("article").first().text() ||
    $(".entry-content").first().text() ||
    $(".post-content").first().text() ||
    $("main").first().text() ||
    $(".content").first().text() ||
    $("body").text(),
    15000
  );

  let dateText;

  if (isFucini) {
    /*
     * Nelle pagine Fucini, article/main contengono anche gli
     * articoli correlati. Cerchiamo la data solo nel contenuto
     * principale dell'evento per evitare date estranee.
     */
    dateText = compact(
      $(".e-content").first().text() ||
      $(".entry-content").first().text() ||
      $(".post-content").first().text() ||
      $('meta[property="og:description"]').attr("content") ||
      "",
      15000
    );
  } else if (isRagionieri || isCalenzano) {
    dateText = compact(
      [
        $(".data-evento").first().text(),
        $(".event_date").first().text(),
        articleText
      ]
        .filter(Boolean)
        .join(" "),
      15000
    );
  } else {
    dateText = $(".event-date")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
  }

  const months =
    "gennaio|gen|" +
    "febbraio|feb|" +
    "marzo|mar|" +
    "aprile|apr|" +
    "maggio|mag|" +
    "giugno|giu|" +
    "luglio|lug|" +
    "agosto|ago|" +
    "settembre|sett|set|" +
    "ottobre|ott|" +
    "novembre|nov|" +
    "dicembre|dic";

  const startRegex = new RegExp(
    "(?:dal|da|il|sabato|domenica|lunedì|martedì|mercoledì|" +
    "giovedì|venerdì)\\s+(?:il\\s+)?(\\d{1,2}\\s+(?:" +
    months +
    ")\\s+\\d{4})",
    "i"
  );

  const singleRegex = new RegExp(
    "(\\d{1,2}\\s+(?:" + months + ")\\s+\\d{4})",
    "i"
  );

  const endRegex = new RegExp(
    "(?:al|fino al)\\s+(\\d{1,2}\\s+(?:" +
    months +
    ")\\s+\\d{4})",
    "i"
  );

  let startMatch;
  let endMatch;

  if (isCalenzano) {
    const calenzanoDate =
      "(\\d{1,2}\\s+(?:" + months + ")\\s+\\d{4})";

    const calenzanoStartRegex = new RegExp(
      "Data\\s+inizio\\s*:?\\s*" + calenzanoDate,
      "i"
    );

    const calenzanoEndRegex = new RegExp(
      "Data\\s+fine\\s*:?\\s*" + calenzanoDate,
      "i"
    );

    startMatch =
      dateText.match(calenzanoStartRegex) ||
      dateText.match(singleRegex);

    endMatch = dateText.match(calenzanoEndRegex);
  } else if (isRagionieri) {
    startMatch =
      dateText.match(startRegex) ||
      dateText.match(singleRegex);

    endMatch = dateText.match(endRegex);
  } else if (isFucini) {
    const publishedTime =
      $('meta[property="article:published_time"]').attr("content") ||
      $('meta[property="article:modified_time"]').attr("content") ||
      "";

    const publishedYearMatch =
      String(publishedTime).match(/\b(20\d{2})\b/);

    const pageYearMatch =
      dateText.match(/\b(20\d{2})\b/);

    const referenceYear =
      Number(publishedYearMatch?.[1]) ||
      Number(pageYearMatch?.[1]) ||
      new Date().getFullYear();

    const fuciniStartRegex = new RegExp(
      "(?:lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|" +
      "giovedi|giovedì|venerdi|venerdì|sabato|domenica|il)?\\s*" +
      "(\\d{1,2}\\s+(?:" + months + ")(?:\\s+20\\d{2})?)",
      "i"
    );

    const fuciniRangeRegex = new RegExp(
      "(?:dal|da)\\s+(\\d{1,2})\\s+(?:al|a)\\s+" +
      "(\\d{1,2})\\s+(" + months + ")(?:\\s+(20\\d{2}))?",
      "i"
    );

    const rangeMatch = dateText.match(fuciniRangeRegex);
    const singleFuciniMatch = dateText.match(fuciniStartRegex);

    if (rangeMatch) {
      const rangeYear =
        Number(rangeMatch[4]) || referenceYear;

      startMatch = [
        rangeMatch[0],
        rangeMatch[1] + " " + rangeMatch[3] + " " + rangeYear
      ];

      endMatch = [
        rangeMatch[0],
        rangeMatch[2] + " " + rangeMatch[3] + " " + rangeYear
      ];
    } else if (singleFuciniMatch) {
      const value = singleFuciniMatch[1];

      startMatch = [
        singleFuciniMatch[0],
        /\\b20\\d{2}\\b/.test(value)
          ? value
          : value + " " + referenceYear
      ];
    }
  } else {
    startMatch = dateText.match(
      /dal?\s+(\d{1,2}\s+[a-zàèéìòù]+\s+\d{2,4})/i
    );

    endMatch = dateText.match(
      /al\s+(\d{1,2}\s+[a-zàèéìòù]+\s+\d{2,4})/i
    );

    const singleMatch = dateText.match(
      /(\d{1,2}\s+[a-zàèéìòù]+\s+\d{2,4})/i
    );

    startMatch = startMatch || singleMatch;
  }

  const startsOn = parseMuseDate(startMatch?.[1]);
  const endsOn = parseMuseDate(endMatch?.[1]) || startsOn;

  if (!title || !startsOn) {
    if (isRagionieri) {
      console.log(
        "  RAGIONIERI DATE NOT FOUND: " +
        title +
        " | testo: " +
        dateText.slice(0, 250)
      );
    }

    if (isFucini) {
      console.log(
        "  FUCINI DATE NOT FOUND: " +
        title +
        " | testo: " +
        dateText.slice(0, 350)
      );
    }

    return null;
  }

  const description = compact(
    $(".events-intro .content").first().text() ||
    $(".page-composer .content").first().text() ||
    $(".entry-content").first().text() ||
    $(".post-content").first().text() ||
    $("article").first().text() ||
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "",
    4000
  ) || null;

  const defaultLocation = isRagionieri
    ? "Biblioteca Ernesto Ragionieri"
    : source.comune || "Firenze";

  const location = compact(
    $(".is-pin").first().text() ||
    $(".event-location").first().text() ||
    $(".luogo").first().text() ||
    defaultLocation,
    300
  ) || defaultLocation;

  const image =
    absoluteUrl(
      $('meta[property="og:image"]').attr("content"),
      pageUrl
    ) || null;

  const event = {
    title,
    city:
      source.comune ||
      (isRagionieri ? "Sesto Fiorentino" : "Firenze"),
    location,
    starts_on: startsOn,
    ends_on: endsOn,
    description,
    source_url: pageUrl,
    image_url: image,
    address: null,
    source_name: source.name
  };

  event.import_key = eventKey(event);
  return event;
}


function extractRssContentEvent(
  rssText,
  html,
  source,
  pageUrl,
  feedTitle,
  feedPublishedAt
) {
  const rss$ = cheerio.load(
    "<article>" + (rssText || "") + "</article>"
  );

  const page$ = cheerio.load(html || "");

  const combinedText = compact(
    [
      feedTitle,
      rss$("article").text(),
      page$("article").first().text(),
      page$("main").first().text()
    ].filter(Boolean).join(" "),
    16000
  );

  const italianDatePattern =
    /(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?/i;

  const dateMatch =
    String(feedTitle || "").match(italianDatePattern) ||
    combinedText.match(italianDatePattern);

  if (!feedTitle || !dateMatch) {
    return null;
  }

  const months = {
    gennaio: 0,
    febbraio: 1,
    marzo: 2,
    aprile: 3,
    maggio: 4,
    giugno: 5,
    luglio: 6,
    agosto: 7,
    settembre: 8,
    ottobre: 9,
    novembre: 10,
    dicembre: 11
  };

  const day = Number(dateMatch[1]);
  const month = months[dateMatch[2].toLowerCase()];

  const publishedDate = new Date(feedPublishedAt);

  const publishedYear = Number.isNaN(
    publishedDate.getTime()
  )
    ? new Date().getFullYear()
    : publishedDate.getUTCFullYear();

  let year = dateMatch[3]
    ? Number(dateMatch[3])
    : publishedYear;

  if (
    !Number.isInteger(year) ||
    year < publishedYear - 1 ||
    year > publishedYear + 3
  ) {
    year = publishedYear;
  }

  const startTimeMatch =
    combinedText.match(
      /(?:dalle\s+ore|dalle|inizio\s+ore|ore)\s*(\d{1,2})(?::|\.)(\d{2})/i
    );

  const endTimeMatch =
    combinedText.match(
      /(?:alle\s+ore|alle|fine\s+ore)\s*(\d{1,2})(?::|\.)(\d{2})/i
    );

  const startHour = Number(startTimeMatch?.[1] || 12);
  const startMinute = Number(startTimeMatch?.[2] || 0);

  const startDate = new Date(
    Date.UTC(
      year,
      month,
      day,
      startHour,
      startMinute,
      0
    )
  );

  if (Number.isNaN(startDate.getTime())) {
    return null;
  }

  let endsOn = null;

  if (endTimeMatch) {
    const endDate = new Date(
      Date.UTC(
        year,
        month,
        day,
        Number(endTimeMatch[1]),
        Number(endTimeMatch[2]),
        0
      )
    );

    if (!Number.isNaN(endDate.getTime())) {
      endsOn = endDate.toISOString();
    }
  }

  const locationMatch = combinedText.match(
    /\b(?:presso|luogo|in)\s+((?:piazza|via|viale|parco|biblioteca|teatro|museo|centro)[^.;]{2,180})/i
  );

  const location =
    compact(locationMatch?.[1] || "", 500) || null;

  const image =
    absoluteUrl(
      page$('meta[property="og:image"]').attr("content") ||
      page$("article img").first().attr("src") ||
      rss$("img").first().attr("src"),
      pageUrl
    );

  const event = {
    title: feedTitle,
    city: source.comune || null,
    location,
    starts_on: startDate.toISOString(),
    ends_on: endsOn,
    description:
      compact(
        rss$("article").text() ||
        page$('meta[property="og:description"]').attr("content") ||
        page$("article").first().text() ||
        "",
        4000
      ) || null,
    source_url: pageUrl,
    image_url: image,
    address: location,
    source_name: source.name
  };

  event.import_key = eventKey(event);
  return event;
}

async function collectRssEvents(source) {
  const xml = await fetchText(source.url);
  const $ = cheerio.load(xml, { xmlMode: true });

  const items = $("item").toArray().slice(0, MAX_LINKS_PER_SOURCE);
  const byKey = new Map();

  console.log("  RSS items found: " + items.length);

  for (const item of items) {
    const feedTitle = compact(
      $(item).find("title").first().text(),
      300
    );

    const pageUrl = compact(
      $(item).find("link").first().text(),
      1000
    );

    const rssContent =
      $(item).find("content\\:encoded").first().text() ||
      $(item).find("description").first().text() ||
      "";

    const feedPublishedAt = compact(
      $(item).find("pubDate").first().text(),
      200
    );

    if (!pageUrl) continue;

    try {
      await sleep(300);

      const html = await fetchText(pageUrl);
      let event = extractMuseEvent(
        html,
        source,
        pageUrl,
        feedTitle
      );

      if (event) {
        const eventYear = new Date(
          event.starts_on
        ).getUTCFullYear();

        const publishedDate = new Date(
          feedPublishedAt
        );

        const publishedYear = Number.isNaN(
          publishedDate.getTime()
        )
          ? new Date().getFullYear()
          : publishedDate.getUTCFullYear();

        if (
          !Number.isFinite(eventYear) ||
          eventYear < publishedYear - 1 ||
          eventYear > publishedYear + 3
        ) {
          console.log(
            "  RSS DISCARD IMPLAUSIBLE DATE: " +
              feedTitle +
              " | " +
              event.starts_on
          );

          event = null;
        }
      }

      if (!event) {
        event = extractRssContentEvent(
          rssContent,
          html,
          source,
          pageUrl,
          feedTitle,
          feedPublishedAt
        );
      }

      if (event) {
        byKey.set(event.import_key, event);
        console.log(
          "  RSS EVENT: " +
            event.title +
            " | " +
            event.starts_on
        );
      } else {
        console.log(
          "  RSS SKIP NO EVENT DATE: " +
            feedTitle
        );
      }
    } catch (error) {
      console.warn(
        "  RSS skip " + pageUrl + ": " + error.message
      );
    }
  }

  console.log("  RSS normalized events: " + byKey.size);
  return [...byKey.values()];
}





function parseDrupalNewsDateParts(
  paragraph,
  defaultYear
) {
  const months = {
    gennaio: 0,
    febbraio: 1,
    marzo: 2,
    aprile: 3,
    maggio: 4,
    giugno: 5,
    luglio: 6,
    agosto: 7,
    settembre: 8,
    ottobre: 9,
    novembre: 10,
    dicembre: 11
  };

  const normalized = compact(
    String(paragraph || "")
      .replace(/[–—]/g, "-"),
    4000
  );

  const dateMatch = normalized.match(
    /^(?:lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica)?\s*(\d{1,2})(?:\s*(?:,|e|-)\s*(\d{1,2}))?\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?/i
  );

  if (dateMatch === null) {
    return [];
  }

  const firstDay = Number(dateMatch[1]);
  const secondDay = dateMatch[2]
    ? Number(dateMatch[2])
    : null;

  const month =
    months[dateMatch[3].toLowerCase()];

  const year = Number(
    dateMatch[4] || defaultYear
  );

  const timeMatch = normalized.match(
    /\b(?:dalle\s+ore|dalle|alle\s+ore|alle|ore)\s*(\d{1,2})(?::|\.|,)?(\d{2})?/i
  );

  const hour = Number(timeMatch?.[1] || 12);
  const minute = Number(timeMatch?.[2] || 0);

  const days = secondDay
    ? [firstDay, secondDay]
    : [firstDay];

  return days
    .map((day) => {
      const date = new Date(
        Date.UTC(
          year,
          month,
          day,
          hour,
          minute,
          0
        )
      );

      return Number.isNaN(date.getTime())
        ? null
        : date.toISOString();
    })
    .filter(Boolean);
}

function extractDrupalNewsEvents(
  html,
  source,
  pageUrl
) {
  const $ = cheerio.load(html);

  const articleTitle = compact(
    $("h1").first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").first().text(),
    300
  );

  const articleText = compact(
    $(".field--name-field-descrizione-completa").first().text() ||
      $(".field--name-body").first().text() ||
      $("article").first().text() ||
      $("main").first().text(),
    16000
  );

  const relevantText =
    articleTitle + " " + articleText;

  if (
    /\b(biblioteca|bambin|ragazz|famigli|lettur|laborator|burattin|favol|storie)\b/i.test(
      relevantText
    ) === false
  ) {
    return [];
  }

  const publicationText = compact(
    $("time").first().attr("datetime") ||
      $("time").first().text() ||
      $('[data-element="news-publication-date"]')
        .first()
        .text() ||
      "",
    200
  );

  const yearMatch =
    publicationText.match(/\b(20\d{2})\b/) ||
    articleText.match(
      /\b(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(20\d{2})\b/i
    ) ||
    articleTitle.match(/\b(20\d{2})\b/);

  const defaultYear = Number(
    yearMatch?.[1] ||
      new Date().getUTCFullYear()
  );

  const paragraphs = [];

  $(".field--name-field-descrizione-completa p, .field--name-body p, article p, main p").each(
    (_, element) => {
      const value = compact(
        $(element).text(),
        4000
      );

      if (value) {
        paragraphs.push(value);
      }
    }
  );

  const weekdayParts = articleText
    .split(
      /(?=(?:lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica)\s+\d{1,2}\b)/i
    )
    .map((value) => compact(value, 4000))
    .filter((value) =>
      /^(?:lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica)\s+\d{1,2}\b/i.test(
        value
      )
    );

  paragraphs.push(...weekdayParts);

  const uniqueParagraphs = [...new Set(paragraphs)];
  paragraphs.length = 0;
  paragraphs.push(...uniqueParagraphs);

  if (paragraphs.length === 0 && articleText) {
    paragraphs.push(articleText);
  }

  const events = [];

  for (const paragraph of paragraphs) {
    const dates = parseDrupalNewsDateParts(
      paragraph,
      defaultYear
    );

    if (dates.length === 0) {
      continue;
    }

    const titlePart = compact(
      paragraph
        .replace(
          /^(?:lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica)?\s*\d{1,2}(?:\s*(?:,|e|-)\s*\d{1,2})?\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+\d{4})?\s*,?\s*(?:alle\s+)?(?:ore\s+)?\d{0,2}(?:[:.,]\d{2})?\s*:?\s*/i,
          ""
        )
        .split(/\.\s/)[0],
      300
    );

    const eventTitle = compact(
      String(titlePart || articleTitle)
        .replace(/^[\s,;:'"]+/, "")
        .replace(/[\s,;:'"]+$/, "")
        .replace(/'+\s*:/g, ":")
        .replace(/\s{2,}/g, " ")
        .trim(),
      300
    );

    for (const startsOn of dates) {
      const event = {
        title: eventTitle,
        city: source.comune || "Scandicci",
        location: "Biblioteca di Scandicci",
        starts_on: startsOn,
        ends_on: null,
        description: paragraph,
        source_url: pageUrl,
        image_url:
          absoluteUrl(
            $('meta[property="og:image"]').attr(
              "content"
            ),
            pageUrl
          ) || null,
        address:
          "Via Roma 38/A, Scandicci",
        source_name: source.name
      };

      event.import_key = eventKey(event);
      events.push(event);
    }
  }

  return events;
}

async function collectDrupalNewsEvents(source) {
  const maxPages = Number(
    process.env.MAX_DRUPAL_NEWS_PAGES || 8
  );

  const articleUrls = new Set();

  for (
    let pageNumber = 0;
    pageNumber < maxPages;
    pageNumber += 1
  ) {
    const listingUrl = new URL(source.url);

    if (pageNumber > 0) {
      listingUrl.searchParams.set(
        "page",
        String(pageNumber)
      );
    }

    let html;

    try {
      html = await fetchText(
        listingUrl.href
      );
    } catch (error) {
      console.warn(
        "  Drupal news listing skip " +
          listingUrl.href +
          ": " +
          error.message
      );

      continue;
    }

    const $ = cheerio.load(html);

    $('a[href*="/novita/notizie/"]').each(
      (_, element) => {
        const href = $(element).attr("href");

        const url = absoluteUrl(
          href,
          listingUrl.href
        );

        if (
          url &&
          url !== source.url &&
          /\/novita\/notizie\/[^/?#]+/i.test(url)
        ) {
          articleUrls.add(
            url.split("#")[0]
          );
        }
      }
    );

    await sleep(250);
  }

  console.log(
    "  Drupal news links: " +
      articleUrls.size
  );

  const byKey = new Map();

  for (const pageUrl of articleUrls) {
    try {
      await sleep(300);

      const html = await fetchText(pageUrl);

      const events =
        extractDrupalNewsEvents(
          html,
          source,
          pageUrl
        );

      for (const event of events) {
        byKey.set(
          event.import_key,
          event
        );
      }
    } catch (error) {
      console.warn(
        "  Drupal news skip " +
          pageUrl +
          ": " +
          error.message
      );
    }
  }

  console.log(
    "  Drupal news normalized events: " +
      byKey.size
  );

  return [...byKey.values()];
}

async function collectDrupalEvents(source) {
  const firstHtml = await fetchText(source.url);

  const pages = await collectHtmlPages(
    source,
    firstHtml
  );

  const byKey = new Map();

  console.log(
    "  Drupal pages collected: " + pages.length
  );

  for (const page of pages) {
    const jsonLdNodes =
      extractJsonLdEvents(page.html);

    for (const node of jsonLdNodes) {
      const event = normalizeEvent(
        node,
        source,
        page.url
      );

      if (event) {
        byKey.set(event.import_key, event);
      }
    }

    const htmlEvent = extractHtmlEvent(
      page.html,
      source,
      page.url
    );

    if (htmlEvent) {
      byKey.set(
        htmlEvent.import_key,
        htmlEvent
      );
    }
  }

  console.log(
    "  Drupal normalized events: " +
      byKey.size
  );

  return [...byKey.values()];
}

async function collectWordPressEvents(source) {
  const baseUrl = new URL(source.url).origin;
  const maxPages = Number(
    process.env.MAX_WORDPRESS_PAGES || 3
  );

  const lookbackDays = Number(
    process.env.WORDPRESS_LOOKBACK_DAYS || 180
  );

  const afterDate = new Date(
    Date.now() - lookbackDays * 24 * 60 * 60 * 1000
  );

  const byKey = new Map();

  console.log(
    "  WordPress posts after: " +
      afterDate.toISOString()
  );

  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({
      per_page: "100",
      page: String(page),
      after: afterDate.toISOString(),
      order: "desc",
      orderby: "date",
      status: "publish",
      _embed: "1"
    });

    const apiUrl =
      baseUrl +
      "/wp-json/wp/v2/posts?" +
      params.toString();

    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json"
      }
    });

    if (response.status === 400) {
      break;
    }

    if (response.ok === false) {
      throw new Error(
        "WordPress API HTTP " + response.status
      );
    }

    const posts = await response.json();

    if (Array.isArray(posts) === false) {
      throw new Error("Risposta WordPress non valida");
    }

    console.log(
      "  WordPress API page " +
        page +
        ": " +
        posts.length +
        " posts"
    );

    if (posts.length === 0) {
      break;
    }

    for (const post of posts) {
      const title = compact(
        post.title?.rendered || "",
        300
      );

      const postUrl = post.link || baseUrl;

      const content =
        post.content?.rendered ||
        post.excerpt?.rendered ||
        "";

      const publishedAt =
        post.date_gmt ||
        post.date ||
        "";

      if (title.length === 0) {
        continue;
      }

      const isEmpoliLibrary =
        String(source.name || "")
          .toLowerCase() ===
        "biblioteca renato fucini empoli";

      const isPalazzoLeggendaPost =
        /palazzo leggenda|leggenda festival|iniziative di (?:maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)|estate da leggenda/i.test(
          title
        );

      if (
        isEmpoliLibrary &&
        isPalazzoLeggendaPost
      ) {
        const leggendaEvents =
          extractPalazzoLeggendaEvents(
            content,
            {
              postTitle: title,
              postUrl,
              publishedAt,
              source,
              compact,
              eventKey
            }
          );

        const media =
          post._embedded?.[
            "wp:featuredmedia"
          ]?.[0];

        for (
          const leggendaEvent
          of leggendaEvents
        ) {
          if (media?.source_url) {
            leggendaEvent.image_url =
              media.source_url;
          }

          leggendaEvent.city =
            source.comune ||
            leggendaEvent.city ||
            "Empoli";

          leggendaEvent.source_name =
            source.name;

          leggendaEvent.import_key =
            eventKey(leggendaEvent);

          byKey.set(
            leggendaEvent.import_key,
            leggendaEvent
          );
        }

        if (leggendaEvents.length > 0) {
          console.log(
            "  Palazzo Leggenda events: " +
              leggendaEvents.length +
              " | " +
              title
          );

          continue;
        }
      }

      const event = extractRssContentEvent(
        content,
        content,
        source,
        postUrl,
        title,
        publishedAt
      );

      if (event === null) {
        continue;
      }

      const media =
        post._embedded?.["wp:featuredmedia"]?.[0];

      if (media?.source_url) {
        event.image_url = media.source_url;
      }

      event.city = source.comune || event.city || null;
      event.source_url = postUrl;
      event.source_name = source.name;
      event.import_key = eventKey(event);

      byKey.set(event.import_key, event);
    }

    if (posts.length < 100) {
      break;
    }

    await sleep(300);
  }

  console.log(
    "  WordPress normalized events: " +
      byKey.size
  );

  return [...byKey.values()];
}

async function collectPratoApiEvents(source) {
  const baseUrl = "https://tempolibero2.comune.prato.it";
  const eventPageUrl = baseUrl + "/event";

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  let pageResponse;

  try {
    pageResponse = await fetch(eventPageUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml"
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!pageResponse.ok) {
    throw new Error(
      "Prato page HTTP " + pageResponse.status
    );
  }

  const pageHtml = await pageResponse.text();

  const page$ = cheerio.load(pageHtml);

  const token =
    page$('meta[name="csrf-token"]').attr("content") ||
    page$('input[name="_token"]').attr("value");

  if (!token) {
    throw new Error("Prato CSRF token non trovato");
  }

  const cookie =
    typeof pageResponse.headers.getSetCookie === "function"
      ? pageResponse.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ")
      : String(
          pageResponse.headers.get("set-cookie") || ""
        )
          .split(",")
          .map((value) => value.trim().split(";")[0])
          .filter(Boolean)
          .join("; ");

  const byKey = new Map();
  let currentPage = 1;
  let totalPages = 1;

  do {
    const body = new URLSearchParams({
      page: String(currentPage),
      per_page: "40",
      _token: token
    });

    const apiController = new AbortController();
    const apiTimeout = setTimeout(
      () => apiController.abort(),
      REQUEST_TIMEOUT_MS
    );

    let apiResponse;

    try {
      apiResponse = await fetch(
        baseUrl + "/ajax/events",
        {
          method: "POST",
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/json",
            "Content-Type":
              "application/x-www-form-urlencoded;charset=UTF-8",
            "X-CSRF-TOKEN": token,
            "X-Requested-With": "XMLHttpRequest",
            Referer: eventPageUrl,
            Cookie: cookie
          },
          body,
          signal: apiController.signal
        }
      );
    } finally {
      clearTimeout(apiTimeout);
    }

    if (!apiResponse.ok) {
      throw new Error(
        "Prato API HTTP " + apiResponse.status
      );
    }

    const data = await apiResponse.json();
    totalPages = Math.max(1, Number(data.pages || 1));

    const items = Array.isArray(data.datas)
      ? data.datas
      : [];

    console.log(
      "  Prato API page " +
        currentPage +
        "/" +
        totalPages +
        ": " +
        items.length +
        " items"
    );

    for (const item of items) {
      if (String(item.type || "") !== "appointment") {
        continue;
      }

      const resource = item.resource || {};
      const categories = Array.isArray(resource.categories)
        ? resource.categories
        : [];

      const isChildrenEvent = categories.some(
        (category) =>
          String(category?.title || "")
            .toLowerCase()
            .includes("bambin")
      );

      if (!isChildrenEvent) {
        continue;
      }

      const title = compact(
        resource.title || "",
        300
      );

      const startsOn = validDate(
        item.dates?.[0] ||
        item.start ||
        resource.start
      );

      if (!title || !startsOn) {
        continue;
      }

      const address = compact(
        resource.poi ||
        resource.address ||
        "",
        500
      ) || null;

      const description = compact(
        resource.description ||
        resource.short_description ||
        resource.subtitle ||
        "",
        4000
      ) || null;

      const sourceUrl =
        absoluteUrl(item.url, baseUrl) ||
        eventPageUrl;

      const event = {
        title,
        city: source.comune || "Prato",
        location: address,
        starts_on: startsOn,
        ends_on: validDate(
          item.end ||
          item.end_date ||
          resource.end
        ),
        description,
        source_url: sourceUrl,
        image_url: absoluteUrl(
          resource.image_preview ||
          resource.image ||
          "",
          baseUrl
        ),
        address,
        source_name: source.name
      };

      event.import_key = eventKey(event);
      byKey.set(event.import_key, event);
    }

    currentPage += 1;
    await sleep(250);
  } while (currentPage <= totalPages);

  console.log(
    "  Prato Bambini normalized events: " +
      byKey.size
  );

  return [...byKey.values()];
}


function extractPaginationLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const found = new Set();

  $('a[rel="next"], .pager__item--next a, .pagination a').each(
    (_, element) => {
      const href = $(element).attr("href");
      const url = absoluteUrl(href, pageUrl);

      if (!url || !sameHost(url, pageUrl)) {
        return;
      }

      try {
        const parsed = new URL(url);
        const current = new URL(pageUrl);

        if (parsed.pathname !== current.pathname) {
          return;
        }

        if (!parsed.searchParams.has("page")) {
          return;
        }

        found.add(parsed.href.split("#")[0]);
      } catch {
        // Collegamento non valido: ignoralo.
      }
    }
  );

  return [...found];
}

async function collectHtmlPages(source, firstHtml) {
  const MAX_PAGINATION_PAGES = Number(
    process.env.MAX_EVENT_PAGES || 20
  );

  const listingPages = [];
  const queued = [
    {
      url: source.url,
      html: firstHtml
    }
  ];

  const visitedListingUrls = new Set();
  const eventUrls = new Set();

  while (
    queued.length > 0 &&
    visitedListingUrls.size < MAX_PAGINATION_PAGES
  ) {
    const current = queued.shift();

    if (
      !current?.url ||
      visitedListingUrls.has(current.url)
    ) {
      continue;
    }

    visitedListingUrls.add(current.url);

    let html = current.html;

    if (!html) {
      try {
        await sleep(300);
        html = await fetchText(current.url);
      } catch (error) {
        console.warn(
          "  pagination skip " +
            current.url +
            ": " +
            error.message
        );
        continue;
      }
    }

    listingPages.push({
      url: current.url,
      html
    });

    for (const eventUrl of extractLinks(html, current.url)) {
      try {
        const parsed = new URL(eventUrl);
        const sourceParsed = new URL(source.url);

        const isPaginationUrl =
          parsed.pathname === sourceParsed.pathname &&
          parsed.searchParams.has("page");

        if (!isPaginationUrl) {
          eventUrls.add(eventUrl);
        }
      } catch {
        // Collegamento non valido: ignoralo.
      }
    }

    for (const paginationUrl of extractPaginationLinks(
      html,
      current.url
    )) {
      if (
        !visitedListingUrls.has(paginationUrl) &&
        !queued.some((item) => item.url === paginationUrl)
      ) {
        queued.push({
          url: paginationUrl,
          html: null
        });
      }
    }
  }

  console.log(
    "  HTML listing pages: " +
      visitedListingUrls.size
  );

  const detailUrls = [...eventUrls].slice(
    0,
    MAX_LINKS_PER_SOURCE
  );

  console.log(
    "  HTML event links: " +
      detailUrls.length
  );

  const detailPages = [];

  for (const url of detailUrls) {
    try {
      await sleep(300);

      detailPages.push({
        url,
        html: await fetchText(url)
      });
    } catch (error) {
      console.warn(
        "  skip " +
          url +
          ": " +
          error.message
      );
    }
  }

  return [...listingPages, ...detailPages];
}

async function collectTribeEventsApi(source) {
  const byKey = new Map();
  const maxPages = Number(
    process.env.MAX_TRIBE_EVENTS_PAGES || 10
  );

  for (
    let pageNumber = 1;
    pageNumber <= maxPages;
    pageNumber += 1
  ) {
    const apiUrl = new URL(source.url);

    apiUrl.searchParams.set(
      "page",
      String(pageNumber)
    );

    apiUrl.searchParams.set(
      "per_page",
      "50"
    );

    let payload;

    try {
      const raw = await fetchText(apiUrl.href);
      payload = JSON.parse(raw);
    } catch (error) {
      if (pageNumber === 1) {
        throw error;
      }

      console.warn(
        "  Tribe API page " +
          pageNumber +
          " skipped: " +
          error.message
      );

      break;
    }

    const items = Array.isArray(payload?.events)
      ? payload.events
      : [];

    console.log(
      "  Tribe API page " +
        pageNumber +
        ": " +
        items.length +
        " events"
    );

    for (const item of items) {
      const title = compact(
        item.title || "",
        300
      );

      const startsOn = validDate(
        item.start_date ||
          item.start_date_details?.year
      );

      if (!title || !startsOn) {
        continue;
      }

      const descriptionHtml =
        item.description || "";

      const description = compact(
        cheerio.load(
          "<div>" +
            descriptionHtml +
            "</div>"
        )("div").text(),
        4000
      ) || null;

      const venue = item.venue || {};

      const location = compact(
        venue.venue ||
          venue.address ||
          "",
        500
      ) || null;

      const address = compact(
        [
          venue.address,
          venue.city,
          venue.zip,
          venue.country
        ]
          .filter(Boolean)
          .join(", "),
        500
      ) || null;

      const event = {
        title,
        city:
          compact(
            venue.city ||
              source.comune ||
              "Pistoia",
            200
          ) || "Pistoia",
        location,
        starts_on: startsOn,
        ends_on: validDate(
          item.end_date
        ),
        description,
        source_url:
          item.url ||
          item.website ||
          source.url,
        image_url:
          item.image?.url ||
          item.image?.sizes?.medium?.url ||
          null,
        address,
        source_name: source.name
      };

      event.import_key = eventKey(event);

      byKey.set(
        event.import_key,
        event
      );
    }

    const totalPages = Number(
      payload?.total_pages || 0
    );

    if (
      items.length === 0 ||
      (totalPages > 0 &&
        pageNumber >= totalPages)
    ) {
      break;
    }

    await sleep(250);
  }

  console.log(
    "  Tribe API normalized events: " +
      byKey.size
  );

  return [...byKey.values()];
}

async function collectSourceEvents(source) {
  if (String(source.type || "").toLowerCase() === "museo-galileo") {
    return await collectMuseoGalileoEvents(source, {
      fetchText,
      compact,
      absoluteUrl,
      eventKey
    });
  }

  if (String(source.type || "").toLowerCase() === "biblioteche-firenze") {
    return await collectBibliotecheFirenzeEvents(source, {
      fetchText,
      compact,
      eventKey
    });
  }

  if (String(source.type || "").toLowerCase() === "teatrodante") {
    return await collectTeatroDanteEvents(source, {
      fetchText,
      compact,
      absoluteUrl,
      eventKey
    });
  }

  if (
    String(source.name || "")
      .toLowerCase() === "comune prato"
  ) {
    return await collectPratoApiEvents(source);
  }

  if (
    ["drupal-news", "drupal-news-events"].includes(
      String(source.type || "").toLowerCase()
    )
  ) {
    return await collectDrupalNewsEvents(source);
  }

  if (
    ["drupal", "drupal-events"].includes(
      String(source.type || "").toLowerCase()
    )
  ) {
    return await collectDrupalEvents(source);
  }

  if (
    ["wordpress", "wp-rest", "wordpress-rest"].includes(
      String(source.type || "").toLowerCase()
    )
  ) {
    return await collectWordPressEvents(source);
  }

  if (
    String(source.type || "").toLowerCase() ===
    "tribe_events_api"
  ) {
    return await collectTribeEventsApi(source);
  }

  if (String(source.type || "").toLowerCase() === "rss") {
    return await collectRssEvents(source);
  }

  if (String(source.name || "").toLowerCase() === "visit tuscany") {
    return collectVisitTuscanyEvents(source);
  }

  const firstHtml = await fetchText(source.url);
  const isOpenPa =
    firstHtml.includes("/opendata/api/content/search/") ||
    firstHtml.includes("remoteContentsGui") ||
    firstHtml.includes("openpa_bootstrapitalia");

  if (isOpenPa) {
    try {
      return await collectOpenPaEvents(source);
    } catch (error) {
      console.warn("  OpenPA API unavailable: " + error.message);
      console.warn("  Falling back to HTML and JSON-LD parsing");
    }
  }

  const pages = await collectHtmlPages(
    source,
    firstHtml
  );

  const byKey = new Map();

  for (const page of pages) {
    const jsonLdNodes = extractJsonLdEvents(page.html);

    for (const node of jsonLdNodes) {
      const event = normalizeEvent(node, source, page.url);
      if (event) byKey.set(event.import_key, event);
    }

    const pratoEvent = extractPratoEvent(page.html, source, page.url);

    if (pratoEvent) {
      byKey.set(pratoEvent.import_key, pratoEvent);
      continue;
    }

    const htmlEvent = extractHtmlEvent(page.html, source, page.url);
    if (htmlEvent) byKey.set(htmlEvent.import_key, htmlEvent);
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


function extractAgeRange(value) {
  const text = String(value || "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return null;
  }

  let match = text.match(
    /(?:eta|età)(?:\s+consigliata)?\s*(?:da|dai|dalle)?\s*(\d{1,2})\s*-\s*(\d{1,2})\s*anni/i
  );

  if (!match) {
    match = text.match(
      /(?:da|dai|dalle)?\s*(\d{1,2})\s*-\s*(\d{1,2})\s*anni/i
    );
  }

  if (!match) {
    match = text.match(
      /(?:da|dai|dalle)\s+(\d{1,2})\s+(?:a|ai|alle)\s+(\d{1,2})\s*anni/i
    );
  }

  if (match) {
    const minimum = Number(match[1]);
    const maximum = Number(match[2]);

    if (
      Number.isInteger(minimum) &&
      Number.isInteger(maximum) &&
      minimum >= 0 &&
      maximum >= minimum &&
      maximum <= 18
    ) {
      return minimum + "-" + maximum + " anni";
    }
  }

  match = text.match(
    /(?:a partire da|a partire dai|dai|da|eta minima|età minima)\s*(\d{1,2})\s*anni/i
  );

  if (match) {
    const minimum = Number(match[1]);

    if (
      Number.isInteger(minimum) &&
      minimum >= 0 &&
      minimum <= 18
    ) {
      return minimum + "+ anni";
    }
  }

  match = text.match(
    /(?:fino a|fino ai|massimo|max)\s*(\d{1,2})\s*anni/i
  );

  if (match) {
    const maximum = Number(match[1]);

    if (
      Number.isInteger(maximum) &&
      maximum >= 0 &&
      maximum <= 18
    ) {
      return "0-" + maximum + " anni";
    }
  }

  if (
    /(?:bebè|bebe|neonati|prima infanzia|0-3 anni)/i.test(
      text
    )
  ) {
    return "0-3 anni";
  }

  return null;
}

async function insertCompatibleEvent(event) {
  // These five columns are already used by App.jsx.

  const ageRange =
    event.age_range ||
    extractAgeRange(
      [
        event.title,
        event.description
      ]
        .filter(Boolean)
        .join(" ")
    );
  
const row = {
  id: `AUTO_${event.import_key.slice(0, 20)}`,
  title: event.title,
  city: event.city,
  location: event.location,
  starts_on: event.starts_on,
  ends_on: event.ends_on || null,
  source_url: event.source_url || null,
  description: event.description,
  age_range: ageRange || null
};

  const { error } = await supabase.from("events").insert(row);
  if (error) throw error;
}

async function updateSource(source, patch) {
  const { error } = await supabase.from("sources").update(patch).eq("id", source.id);
  if (error) console.warn(`  source log not updated: ${error.message}`);
}


const FAMILY_SCORE_THRESHOLD = Number(
  process.env.FAMILY_SCORE_THRESHOLD || 5
);

const FAMILY_SCORE_RULES = [
  {
    score: 8,
    keywords: [
      "per bambini",
      "per bambine",
      "per ragazzi",
      "per famiglie",
      "dedicato ai bambini",
      "dedicata ai bambini",
      "adatto ai bambini",
      "adatta ai bambini",
      "attivita per bambini",
      "evento per bambini",
      "festa per bambini",
      "festa dei bambini",
      "spettacolo per bambini",
      "teatro per bambini",
      "museo per famiglie",
      "visita per famiglie",
      "visita guidata per famiglie",
      "famiglie al museo",
      "genitori e figli",
      "mamme e bambini",
      "papa e bambini"
    ]
  },
  {
    score: 6,
    keywords: [
      "bambin",
      "famigli",
      "ragazz",
      "genitor",
      "prima infanzia",
      "infanzia",
      "piccoli lettori",
      "0-3 anni",
      "3-6 anni",
      "6-11 anni",
      "11-14 anni",
      "baby",
      "kids",
      "junior"
    ]
  },
  {
    score: 5,
    keywords: [
      "nati per leggere",
      "f@mu",
      "famu",
      "burattin",
      "marionett",
      "truccabimbi",
      "baby dance",
      "baby party",
      "raccontastorie",
      "cappuccetto",
      "cappuccetto rosso",
      "hansel",
      "gretel",
      "pierino",
      "pierino e il lupo",
      "contastorie",
      "storie animate",
      "teatro per famiglie",
      "spettacolo per famiglie",
      "piccoli spettatori",
      "letture animate",
      "teatro ragazzi",
      "museo dei bambini",
      "caccia al tesoro",
      "caccia alle uova",
      "ludoteca",
      "parco giochi",
      "baby parking",
      "psicomotricita"
    ]
  },
  {
    score: 3,
    keywords: [
      "laborator",
      "biblioteca",
      "biblioteche",
      "libreria",
      "librerie",
      "lettura",
      "letture",
      "fiaba",
      "fiabe",
      "favola",
      "favole",
      "narrazione",
      "storytelling",
      "pinocchio",
      "atelier",
      "origami",
      "fumetto",
      "argilla",
      "manualita",
      "disegno",
      "scuola",
      "scuole",
      "scolastic",
      "istituto comprensivo",
      "primaria",
      "secondaria",
      "elementar",
      "scuola media",
      "scuole medie",
      "materna",
      "asilo",
      "nido",
      "open day",
      "orientamento",
      "doposcuola",
      "affido",
      "genitorialita"
    ]
  },
  {
    score: 2,
    keywords: [
      "natale",
      "babbo natale",
      "villaggio di natale",
      "casa di babbo natale",
      "befana",
      "epifania",
      "carnevale",
      "halloween",
      "pasqua",
      "giostra",
      "giostre",
      "luna park",
      "centro estivo",
      "estate ragazzi",
      "camp estivo",
      "summer camp",
      "campus",
      "mini basket",
      "mini volley",
      "mini rugby",
      "scuola calcio",
      "avviamento sportivo",
      "animazione",
      "animatore",
      "animatori",
      "clown",
      "giocoleria",
      "mago",
      "magia"
    ]
  },
  {
    score: 1,
    keywords: [
      "festa",
      "fiera",
      "festival",
      "spettacolo",
      "teatro",
      "museo",
      "mostra",
      "mercatino",
      "mercato",
      "merenda",
      "gioco",
      "giochi",
      "sport"
    ]
  }
];

const SUPER_FAMILY_KEYWORDS = [
  "per bambini",
  "per bambine",
  "per bimbi",
  "per ragazzi",
  "per famiglie",
  "dedicato ai bambini",
  "dedicata ai bambini",
  "dedicato alle famiglie",
  "dedicata alle famiglie",
  "adatto ai bambini",
  "adatta ai bambini",
  "attivita per bambini",
  "evento per bambini",
  "eventi per bambini",
  "festa per bambini",
  "festa dei bambini",
  "spettacolo per bambini",
  "teatro per bambini",
  "teatro ragazzi",
  "museo per famiglie",
  "museo dei bambini",
  "visita per famiglie",
  "visita guidata per famiglie",
  "famiglie al museo",
  "genitori e figli",
  "mamme e bambini",
  "papa e bambini",

  "nati per leggere",
  "piccoli lettori",
  "letture animate",
  "raccontastorie",
      "cappuccetto",
      "cappuccetto rosso",
      "hansel",
      "gretel",
      "pierino",
      "pierino e il lupo",
      "contastorie",
      "storie animate",
      "teatro per famiglie",
      "spettacolo per famiglie",
      "piccoli spettatori",
  "storie per bambini",
  "fiabe per bambini",
  "favole per bambini",

  "burattini",
  "marionette",
  "truccabimbi",
  "baby dance",
  "baby party",
  "ludoteca",
  "ludobus",
  "bibliobus",
  "baby parking",
  "parco giochi",
  "giochi in piazza",
  "giochinpiazza",
  "caccia al tesoro",
  "caccia alle uova",
  "psicomotricita",

  "f@mu",
  "famu",

  "asilo nido",
  "scuola infanzia",
  "scuola dell infanzia",
  "open day nido",
  "open day infanzia",
  "open day primaria",
  "open day scuola",

  "centro estivo",
  "campus bambini",
  "camp estivo per bambini",
  "estate ragazzi",

  "carnevale dei bambini",
  "carnevale dei ragazzi",
  "halloween per bambini",
  "halloween per famiglie",
  "natale per bambini",
  "natale per famiglie",
  "villaggio di natale",
  "casa di babbo natale",
  "babbo natale",
  "befana in piazza",

  "notte dei bambini",
  "giornata dei bambini",
  "diritti dei bambini",
  "festa della mamma",
  "festa del papa",
  "festa dei nonni",

  "mini basket",
  "mini volley",
  "mini rugby",
  "scuola calcio",
  "sport per bambini",

  "affido familiare",
  "genitorialita",
  "prima infanzia",

  "età consigliata",
  "eta consigliata",
  "autore",
  "autrice",
  "laboratorio",
  "laboratori",
  "lettura",
  "letture",
  "spettacolo teatrale",
  "fiaba",
  "fiabe",
  "favola",
  "favole",
  "cappuccetto",
  "cappuccetto rosso",
  "hansel",
  "gretel",
  "pierino",
  "pierino e il lupo",
  "contastorie",
  "storie animate",
  "teatro per famiglie",
  "spettacolo per famiglie",
  "piccoli spettatori",
  "alieno",
  "drago",
  "nonni"
];

function hasSuperFamilySignal(event) {
  const text = normalizeSearchText(
    searchableEventText(event)
  );

  return SUPER_FAMILY_KEYWORDS.some((keyword) =>
    text.includes(normalizeSearchText(keyword))
  );
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function calculateFamilyScore(event) {
  const title = normalizeSearchText(event.title);

  const details = normalizeSearchText(
    [
      event.description,
      event.location,
      event.city,
      event.source_name
    ]
      .filter(Boolean)
      .join(" ")
  );

  const fullText = (title + " " + details).trim();
  const matchedKeywords = [];
  const alreadyMatched = new Set();
  let score = 0;

  for (const rule of FAMILY_SCORE_RULES) {
    for (const keyword of rule.keywords) {
      const normalizedKeyword = normalizeSearchText(keyword);

      if (
        !normalizedKeyword ||
        alreadyMatched.has(normalizedKeyword) ||
        !fullText.includes(normalizedKeyword)
      ) {
        continue;
      }

      const inTitle = title.includes(normalizedKeyword);
      const points = inTitle ? rule.score * 2 : rule.score;

      score += points;
      alreadyMatched.add(normalizedKeyword);

      matchedKeywords.push({
        keyword,
        points,
        inTitle
      });
    }
  }

  const strongSignals = [
    "per bambini",
    "per bambine",
    "per ragazzi",
    "per famiglie",
    "dedicato ai bambini",
    "dedicata ai bambini",
    "attivita per bambini",
    "evento per bambini",
    "festa per bambini",
    "spettacolo per bambini",
    "teatro per bambini",
    "famiglie al museo",
    "genitori e figli",
    "bambin",
    "famigli",
    "ragazz",
    "prima infanzia",
    "piccoli lettori",
    "nati per leggere",
    "burattin",
    "marionett",
    "truccabimbi",
    "baby dance",
    "baby party",
    "raccontastorie",
      "cappuccetto",
      "cappuccetto rosso",
      "hansel",
      "gretel",
      "pierino",
      "pierino e il lupo",
      "contastorie",
      "storie animate",
      "teatro per famiglie",
      "spettacolo per famiglie",
      "piccoli spettatori",
    "letture animate",
    "teatro ragazzi",
    "museo dei bambini",
    "caccia al tesoro",
    "caccia alle uova",
    "ludoteca",
    "parco giochi",
    "baby parking",
    "psicomotricita",
    "pinocchio",
    "asilo",
    "nido",
    "scuola materna",
    "affido",
    "centro estivo",
    "estate ragazzi"
  ];

  const hasStrongSignal = strongSignals.some((signal) =>
    fullText.includes(normalizeSearchText(signal))
  );

  /*
   * Biblioteca, libreria, lettura, scuola, museo, laboratorio,
   * Natale, Halloween e festa sono termini di contesto.
   * Senza almeno un segnale forte non bastano per importare.
   */
  if (!hasStrongSignal) {
    score = Math.min(score, FAMILY_SCORE_THRESHOLD - 1);
  }

  return {
    score: Math.min(score, 30),
    matchedKeywords,
    hasStrongSignal
  };
}

const EXCLUDED_KEYWORDS = [
  "consiglio comunale",
  "seduta consiliare",
  "convocazione",
  "ordine del giorno",
  "conferenza stampa",
  "commissione consiliare",
  "assemblea comunale",
  "svuota la cantina",
  "cineforum",
  "gruppo di lettura memoranda",
  "scrittura autobiografica",
  "storia dell arte",
  "storia dell'arte",
  "presentazione del libro",
  "presentazione libro",
  "conferenza",
  "conferenze",
  "seminario",
  "seminari",
  "fotografia",
  "werner bischof",
  "francesco d assisi",
  "francesco d'assisi",
  "reading and sharing in english",
  "between the lines",
  "impariamo l inglese",
  "impariamo l'inglese",
  "corso di inglese",
  "english",
  "club del libro",
  "gruppo di lettura",
  "circolo di lettura",
  "reading group"
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
  const text = normalizeSearchText(searchableEventText(event));

  const excludedKeyword = EXCLUDED_KEYWORDS.find((keyword) =>
    text.includes(normalizeSearchText(keyword))
  );

  if (
    excludedKeyword &&
    !Boolean(event.family_super)
  ) {
    event.family_score = 0;
    event.family_matches = [];
    event.family_exclusion = excludedKeyword;
    return false;
  }

  const result = calculateFamilyScore(event);

  event.family_score = result.score;
  event.family_matches = result.matchedKeywords.map(
    (item) => item.keyword
  );
  event.family_exclusion = null;

  event.family_super = Boolean(event.family_super) || hasSuperFamilySignal(event);

  return (
    event.family_super ||
    result.score >= FAMILY_SCORE_THRESHOLD
  );
}

function isExpiredEvent(event) {
  const expiryDate = new Date(
    event.ends_on || event.starts_on
  );

  if (Number.isNaN(expiryDate.getTime())) {
    return true;
  }

  return expiryDate.getTime() < Date.now();
}

async function main() {
  console.log(WRITE ? "EVENT IMPORT: WRITE MODE" : "EVENT IMPORT: PREVIEW MODE");

  let query = supabase
    .from("sources")
    .select("*")
    .eq("category", "events")
    .eq("active", true);

  const SOURCE_FILTER = process.env.SOURCE_FILTER;

  if (SOURCE_FILTER) {
    query = query.eq("name", SOURCE_FILTER);
  }

  const { data: sources, error } =
    await query.order("id");

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
      console.log(`  Events collected: ${events.length}`);

      for (const event of events) {
        if (isExpiredEvent(event)) {
          console.log(`  SKIP EXPIRED: ${event.title}`);
          continue;
        }

        const isPratoChildrenEvent =
          String(source.name || "").toLowerCase() === "comune prato";

        if (isPratoChildrenEvent) {
          event.family_score = 100;
          event.family_matches = ["categoria Bambini"];
          event.family_super = true;
          event.family_exclusion = null;
        } else if (!isFamilyEvent(event)) {
          console.log(
            "  SKIP NOT FAMILY: " +
            event.title +
            " | SCORE=" +
            (event.family_score || 0) +
            (event.family_exclusion
              ? " | EXCLUDED=" + event.family_exclusion
              : "")
          );
          continue;
        }

        console.log(
          "  FAMILY SCORE: " +
          event.family_score +
          " | " +
          event.title +
          " | MATCHES=" +
          event.family_matches.join(", ") +
          (event.family_super ? " | SUPER=YES" : "")
        );

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
