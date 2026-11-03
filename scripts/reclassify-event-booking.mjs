import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import { isIP } from "node:net";
import { classifyBookingText } from "./event-booking-classifier.mjs";

const WRITE = process.argv.includes("--write");
const REQUEST_TIMEOUT_MS = Number(process.env.EVENT_REQUEST_TIMEOUT_MS || 15000);
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.BOOKING_SCAN_CONCURRENCY || 5)));
const USER_AGENT = process.env.EVENTS_USER_AGENT || "LaPianaFamily/1.0 event importer";
const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
const SUPABASE_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
const URL_FIELDS = ["official_url", "source_url", "booking_url", "website_url"];
const STATUS_ORDER = ["required", "recommended", "not_required", "free", "unclassified"];
const EXAMPLE_LIMIT = 10;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: null }
});

function cleanEnv(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "").replace(/\/$/, "");
}

function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
      return false;
    }

    const ipVersion = isIP(hostname);
    if (ipVersion === 4) {
      const octets = hostname.split(".").map(Number);
      if (
        octets[0] === 0 ||
        octets[0] === 10 ||
        octets[0] === 127 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        octets[0] >= 224
      ) return false;
    }
    if (
      ipVersion === 6 &&
      (hostname === "::" ||
        hostname === "::1" ||
        hostname.startsWith("fc") ||
        hostname.startsWith("fd") ||
        hostname.startsWith("fe8") ||
        hostname.startsWith("fe9") ||
        hostname.startsWith("fea") ||
        hostname.startsWith("feb"))
    ) return false;

    return true;
  } catch {
    return false;
  }
}

function getEventUrls(event) {
  return URL_FIELDS
    .map((field) => event[field])
    .filter((value) => typeof value === "string" && isPublicHttpUrl(value))
    .map((value) => new URL(value).href)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function normalizedWords(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 2 && !/^\d+$/.test(word));
}

function titleMatchScore(title, candidate) {
  const titleWords = [...new Set(normalizedWords(title))];
  if (!titleWords.length) return 0;

  const candidateWords = new Set(normalizedWords(candidate));
  const matches = titleWords.filter((word) => candidateWords.has(word)).length;
  return matches / titleWords.length;
}

function extractEventPageText(html, event) {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer, header, form, iframe").remove();

  const headings = $("h1, h2, h3, h4").toArray();
  const matchingHeading = headings
    .map((heading) => ({
      heading,
      score: titleMatchScore(event.title, $(heading).text())
    }))
    .filter((item) => item.score >= 0.6)
    .sort((left, right) => right.score - left.score)[0]?.heading;
  if (!matchingHeading) return "";

  const section = $(matchingHeading).parents().toArray().find((element) => {
    const tag = String(element.tagName || "").toLowerCase();
    const className = $(element).attr("class") || "";
    const isEventContainer = ["article", "li"].includes(tag) ||
      /(?:^|\s)(?:event|event-card|event-item|views-row)(?:\s|$)/i.test(className);
    if (!isEventContainer) return false;
    const text = $(element).text().replace(/\s+/g, " ").trim();
    return text.length >= 100 &&
      text.length <= 12000 &&
      titleMatchScore(event.title, text) >= 0.6;
  });
  if (section) {
    return $(section).text().replace(/\s+/g, " ").trim().slice(0, 16000);
  }

  const pageTitle = $("title").first().text();
  const h1 = $("h1").first();
  const main = $("main").first();
  const article = $("article").first();
  const pageContainer = article.length
    ? article
    : h1.length &&
        titleMatchScore(event.title, h1.text()) >= 0.8 &&
        (headings.length <= 2 || titleMatchScore(event.title, pageTitle) >= 0.8)
      ? main
      : $();
  if (!pageContainer.length) return "";

  const text = pageContainer.text().replace(/\s+/g, " ").trim();
  return text.length <= 20000 ? text : "";
}

async function fetchPage(initialUrl) {
  let url = initialUrl;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (!isPublicHttpUrl(url)) throw new Error("URL or redirect is not public HTTP(S)");
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml"
      },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`HTTP ${response.status} without redirect location`);
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error(`Unsupported page content type: ${contentType || "unknown"}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    return {
      title: $("title").first().text(),
      html,
      url: response.url || url
    };
  }

  throw new Error("Too many redirects");
}

function bookingPatch(classification) {
  return {
    booking_required: classification.booking_required,
    booking_notes: classification.booking_notes
  };
}

function sameBookingValues(event, classification) {
  const patch = bookingPatch(classification);
  const currentNotes = String(event.booking_notes || "").trim();
  const classifiedNotes = String(patch.booking_notes || "").trim();
  const notesMatch = currentNotes === classifiedNotes ||
    (classifiedNotes.includes(currentNotes) &&
      currentNotes &&
      classifyBookingText(currentNotes).status === classification.status);
  return event.booking_required === patch.booking_required && notesMatch;
}

async function loadEvents() {
  const events = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("events")
      .select("id,title,source_url,official_url,booking_url,website_url,booking_required,booking_notes")
      .range(from, from + 999);
    if (error) throw error;
    events.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return events.filter((event) => getEventUrls(event).length > 0);
}

async function main() {
  console.log(WRITE ? "EVENT BOOKING SCAN: WRITE MODE" : "EVENT BOOKING SCAN: PREVIEW MODE");
  const events = await loadEvents();
  console.log(`Events with at least one public event/booking URL: ${events.length}`);

  const pageCache = new Map();
  const results = new Array(events.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= events.length) return;
      const event = events[index];
      const pageResults = [];

      for (const url of getEventUrls(event)) {
        let pagePromise = pageCache.get(url);
        if (!pagePromise) {
          pagePromise = fetchPage(url).catch((error) => ({ error: error.message }));
          pageCache.set(url, pagePromise);
        }

        const page = await pagePromise;
        if (page.error) continue;
        const eventText = extractEventPageText(page.html, event);
        if (!eventText) continue;

        const classification = classifyBookingText(eventText);
        if (classification.status !== "unclassified") {
          pageResults.push({ url, classification });
        }
      }

      const statuses = [...new Set(pageResults.map((item) => item.classification.status))];
      const classification = statuses.length === 1
        ? pageResults[0].classification
        : { status: "unclassified", booking_required: null, booking_notes: null };
      results[index] = {
        event,
        classification,
        evidencePages: pageResults
      };
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const cachedPages = await Promise.all(pageCache.values());
  const failedPages = cachedPages.filter((page) => page.error).length;

  const summary = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
  const examples = Object.fromEntries(STATUS_ORDER.map((status) => [status, []]));
  const changedExamples = [];
  let updated = 0;
  let unchanged = 0;
  let updateErrors = 0;
  let wouldUpdate = 0;

  for (const result of results) {
    const { event, classification } = result;
    summary[classification.status] += 1;
    if (examples[classification.status].length < EXAMPLE_LIMIT) {
      examples[classification.status].push({
        title: event.title,
        booking_required: classification.booking_required,
        booking_notes: classification.booking_notes,
        page: result.evidencePages[0]?.url || null
      });
    }
    if (classification.status === "unclassified") continue;
    const patch = bookingPatch(classification);
    if (sameBookingValues(event, classification)) {
      unchanged += 1;
      continue;
    }
    if (!WRITE) {
      wouldUpdate += 1;
      if (changedExamples.length < EXAMPLE_LIMIT) {
        changedExamples.push({
          title: event.title,
          booking_required: patch.booking_required,
          booking_notes: patch.booking_notes,
          page: result.evidencePages[0]?.url || null
        });
      }
      continue;
    }

    const { error } = await supabase
      .from("events")
      .update(patch)
      .eq("id", event.id)
      .select("id");
    if (error) {
      updateErrors += 1;
      console.error(`UPDATE FAILED for ${event.title}: ${error.message}`);
    } else {
      updated += 1;
      if (changedExamples.length < EXAMPLE_LIMIT) {
        changedExamples.push({
          title: event.title,
          booking_required: patch.booking_required,
          booking_notes: patch.booking_notes,
          page: result.evidencePages[0]?.url || null
        });
      }
    }
  }

  console.log(`Events analyzed: ${events.length}`);
  console.log(`Unique URLs fetched or attempted: ${pageCache.size}`);
  console.log(`Page fetch failures: ${failedPages}`);
  console.log(`Unchanged classified records: ${unchanged}`);
  console.log(`Records ${WRITE ? "updated" : "that would be updated"}: ${WRITE ? updated : wouldUpdate}`);
  console.log(`Update errors: ${updateErrors}`);
  console.log("--- CLASSIFICATION REPORT ---");
  for (const status of STATUS_ORDER) {
    console.log(`${status}: ${summary[status]}`);
    for (const example of examples[status]) console.log(`  ${JSON.stringify(example)}`);
  }
  console.log(`--- ${WRITE ? "UPDATED" : "PREVIEW"} EXAMPLES ---`);
  for (const example of changedExamples) console.log(`  ${JSON.stringify(example)}`);

  if (updateErrors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
