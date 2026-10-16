const fs = require("fs");

const file = "scripts/update-events.mjs";
const backup = "scripts/update-events.mjs.before-openpa-auto";
let source = fs.readFileSync(file, "utf8");

if (!fs.existsSync(backup)) {
  fs.copyFileSync(file, backup);
}

if (source.includes("async function collectOpenPaEvents(source)")) {
  console.log("collectOpenPaEvents e gia presente. Nessuna modifica eseguita.");
  process.exit(0);
}

const openPaBlock = String.raw`
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

`;

const marker = "function extractPointDate($, selector) {";
if (!source.includes(marker)) {
  throw new Error("Punto di inserimento extractPointDate non trovato");
}
source = source.replace(marker, openPaBlock + marker);

const startMarker = "async function collectSourceEvents(source) {";
const endMarker = "\nasync function eventExists(event) {";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) {
  throw new Error("Funzione collectSourceEvents non trovata");
}

const replacement = String.raw`async function collectSourceEvents(source) {
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

  const pages = [{ url: source.url, html: firstHtml }];

  for (const url of extractLinks(firstHtml, source.url)) {
    try {
      await sleep(300);
      pages.push({ url, html: await fetchText(url) });
    } catch (error) {
      console.warn("  skip " + url + ": " + error.message);
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
    if (htmlEvent) byKey.set(htmlEvent.import_key, htmlEvent);
  }

  return [...byKey.values()];
}
`;

source = source.slice(0, start) + replacement + source.slice(end);
source = source.replace(
  "console.log(`  JSON-LD events found: ${events.length}`);",
  "console.log(`  Events collected: ${events.length}`);"
);

fs.writeFileSync(file, source, "utf8");
console.log("Patch OpenPA applicata a " + file);
console.log("Backup creato in " + backup);
