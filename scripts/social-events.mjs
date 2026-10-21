import * as cheerio from "cheerio";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const SOCIAL_SOURCES = [
  {
    id: "amisuradibambino",
    name: "A Misura di Bambino",
    type: "event_calendar",
    enabled: false,
    priority: 10,
    city: "Toscana",
  },

  {
    id: "biblioteche_firenze",
    name: "Biblioteche Comunali Firenze",
    type: "calendar",
    enabled: true,
    priority: 10,
    city: "Firenze",
  },

  {
    id: "muse_firenze",
    name: "MUS.E Firenze",
    type: "rss",
    enabled: true,
    priority: 10,
    city: "Firenze",
  },

  {
    id: "pupi_di_stac",
    name: "Pupi di Stac",
    type: "website",
    enabled: true,
    priority: 9,
    city: "Toscana",
    calendarUrl: new URL(
      "appuntamenti/?ical=1",
      "https://www.pupidistac.it/"
    ).href,
    feedUrl: new URL(
      "appuntamenti/feed/",
      "https://www.pupidistac.it/"
    ).href,
    websiteUrl: new URL(
      "appuntamenti/",
      "https://www.pupidistac.it/"
    ).href,
  },

  {
    id: "tour_in_famiglia",
    name: "Tour in Famiglia",
    type: "website",
    enabled: true,
    priority: 9,
    city: "Toscana",
  },
];

export const FAMILY_KEYWORDS = [
  "bambini",
  "bambine",
  "famiglie",
  "famiglia",
  "laboratorio",
  "lettura",
  "letture",
  "teatro",
  "museo",
  "biblioteca",
  "pinocchio",
  "scienza",
  "esperimenti",
  "gioco",
  "giochi",
];

export function calculateFamilyScore(text = "") {
  const value = String(text).toLowerCase();

  let score = 0;

  for (const keyword of FAMILY_KEYWORDS) {
    if (value.includes(keyword)) {
      score += 2;
    }
  }

  return score;
}

export function eventFingerprint(event) {
  return [
    String(event.title || "").toLowerCase().trim(),
    String(event.city || "").toLowerCase().trim(),
    String(event.starts_on || "").slice(0, 10),
  ].join("|");
}

function unfoldIcsLines(value) {
  return String(value)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .reduce((lines, line) => {
      if (/^[ \t]/.test(line) && lines.length > 0) {
        lines[lines.length - 1] += line.slice(1);
      } else {
        lines.push(line);
      }

      return lines;
    }, []);
}

function unescapeIcsValue(value = "") {
  return String(value)
    .replace(/\\[nN]/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseIcsProperty(line) {
  let separator = -1;
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      quoted = !quoted;
    } else if (line[index] === ":" && !quoted) {
      separator = index;
      break;
    }
  }

  if (separator < 0) return null;

  const [rawName, ...rawParams] = line
    .slice(0, separator)
    .split(";");
  const params = {};

  for (const param of rawParams) {
    const equals = param.indexOf("=");
    if (equals < 0) continue;

    params[param.slice(0, equals).toUpperCase()] = param
      .slice(equals + 1)
      .replace(/^"|"$/g, "");
  }

  return {
    name: rawName.split(".").pop().toUpperCase(),
    params,
    value: unescapeIcsValue(line.slice(separator + 1)),
  };
}

function parseIcsDate(property) {
  if (!property) return null;

  const match = property.value.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/
  );
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, utc] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText || 0);
  const minute = Number(minuteText || 0);
  const second = Number(secondText || 0);
  const dateOnly =
    property.params.VALUE?.toUpperCase() === "DATE" ||
    !hourText;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const values = { year, month, day, hour, minute, second };
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(utcMillis);

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null;
  }

  if (dateOnly || utc) {
    return {
      date: new Date(utcMillis),
      dateOnly,
      values,
    };
  }

  const timeZone = property.params.TZID;
  if (!timeZone) {
    return {
      date: new Date(utcMillis),
      dateOnly: false,
      values,
    };
  }

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  let adjustedMillis = utcMillis;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(adjustedMillis))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)])
    );
    const representedMillis = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const correction = utcMillis - representedMillis;

    adjustedMillis += correction;
    if (correction === 0) break;
  }

  return {
    date: new Date(adjustedMillis),
    dateOnly: false,
    values,
  };
}

function parseIcsEvents(icsText) {
  const events = [];
  let current = null;

  for (const line of unfoldIcsLines(icsText)) {
    if (line.toUpperCase() === "BEGIN:VEVENT") {
      current = {};
      continue;
    }

    if (line.toUpperCase() === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }

    if (!current) continue;
    const property = parseIcsProperty(line);
    if (!property) continue;

    current[property.name] = property;
  }

  return events;
}

function normalizeComparableUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href.toLowerCase();
  } catch {
    return "";
  }
}

function getRssField(item, localName) {
  const child = item.children.find(
    (element) =>
      element.type === "tag" &&
      element.name.split(":").pop().toLowerCase() ===
        localName.toLowerCase()
  );

  return child ? cheerio.load(child, { xmlMode: true }).root().text().trim() : "";
}

function getRssImage(item) {
  for (const child of item.children) {
    if (
      child.type !== "tag" ||
      !["enclosure", "content"].includes(
        child.name.split(":").pop().toLowerCase()
      )
    ) {
      continue;
    }

    const imageUrl = child.attribs?.url;
    if (imageUrl && (!child.attribs.type || child.attribs.type.startsWith("image/"))) {
      return imageUrl;
    }
  }

  const encodedContent = getRssField(item, "encoded");
  if (!encodedContent) return null;

  const $content = cheerio.load(encodedContent);
  const image = $content("img").first();
  return image.attr("src") || image.attr("data-src") || null;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const CITY_NAMES = [
  "Bagno a Ripoli",
  "Sesto Fiorentino",
  "Firenze",
  "Antella",
  "Paulilatino",
  "Oristano",
];

function extractCity(...values) {
  const text = normalizeText(values.filter(Boolean).join(" "));

  for (const city of CITY_NAMES) {
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[,\\s-])${escaped}(?=$|[,\\s\\d-])`, "i").test(text)) {
      return city;
    }
  }

  const parts = normalizeText(values[0])
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts.reverse()) {
    if (/^(?:\d{4,5}|italia|italy)$/i.test(part)) continue;
    if (/^(?:via|viale|piazza|corso|strada|località|loc\.?)\b/i.test(part)) {
      continue;
    }

    const locationCity = part
      .replace(/\b\d{4,5}\b/g, "")
      .replace(/\b(?:italia|italy)\b/gi, "")
      .trim();

    if (locationCity && /[a-zà-ÿ]/i.test(locationCity)) {
      return locationCity;
    }
  }

  return null;
}

function resolveEventUrl(value, baseUrl) {
  if (!value) return null;

  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function eventImportKey(uid, event) {
  const key = uid || eventFingerprint(event);
  return crypto.createHash("sha256").update(key.toLowerCase()).digest("hex");
}

export async function collectPupiDiStacEvents(source) {
  const sourceName = source.name || "Pupi di Stac";
  let icsText;

  try {
    if (!source.calendarUrl) {
      throw new Error("calendarUrl non configurato");
    }

    const response = await fetch(source.calendarUrl, {
      headers: { "user-agent": "ToscanaFamily event collector" },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    icsText = await response.text();

    if (!/BEGIN:VCALENDAR/i.test(icsText)) {
      throw new Error(
        `risposta HTTP ${response.status} priva di BEGIN:VCALENDAR`
      );
    }
  } catch (error) {
    console.error(`  ${sourceName} iCalendar error: ${error.message}`);
    console.log("  VEVENT trovati: 0");
    console.log("  Eventi attivi o futuri: 0");
    console.log("  Immagini RSS associate: 0");
    console.log("  Eventi normalizzati: 0");
    return [];
  }

  let icsEvents;
  let activeEvents;

  try {
    icsEvents = parseIcsEvents(icsText);
    const now = Date.now();
    activeEvents = icsEvents.filter((item) => {
      const start = parseIcsDate(item.DTSTART);
      if (!start) return false;

      const end = parseIcsDate(item.DTEND);
      if (end) return end.date.getTime() > now;
      if (start.dateOnly) return start.date.getTime() + 86400000 > now;
      return start.date.getTime() >= now;
    });
  } catch (error) {
    console.error(`  ${sourceName} iCalendar parse error: ${error.message}`);
    console.log("  VEVENT trovati: 0");
    console.log("  Eventi attivi o futuri: 0");
    console.log("  Immagini RSS associate: 0");
    console.log("  Eventi normalizzati: 0");
    return [];
  }

  let rssItems = [];

  if (source.feedUrl) {
    try {
      const response = await fetch(source.feedUrl, {
        headers: { "user-agent": "ToscanaFamily event collector" },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const $rss = cheerio.load(await response.text(), { xmlMode: true });
      rssItems = $rss("item").toArray();
    } catch (error) {
      console.warn(`  ${sourceName} RSS error: ${error.message}`);
    }
  }

  const rssByUrl = new Map();
  const rssByTitle = new Map();

  for (const item of rssItems) {
    const link = getRssField(item, "link");
    const title = normalizeText(getRssField(item, "title")).toLowerCase();
    const encodedContent = getRssField(item, "encoded");
    const data = {
      description:
        getRssField(item, "description") ||
        normalizeText(cheerio.load(encodedContent).text()),
      imageUrl: getRssImage(item),
    };

    if (link) rssByUrl.set(normalizeComparableUrl(link), data);
    if (title) rssByTitle.set(title, data);
  }

  const uniqueEvents = new Map();
  let associatedImages = 0;

  for (const item of activeEvents) {
    const title = normalizeText(item.SUMMARY?.value);
    const start = parseIcsDate(item.DTSTART);
    const end = parseIcsDate(item.DTEND);

    if (!title || !start) continue;

    const location = normalizeText(item.LOCATION?.value) || null;
    const city = extractCity(location, title);
    const sourceUrl =
      resolveEventUrl(item.URL?.value, source.websiteUrl || source.calendarUrl) ||
      null;
    const rssData =
      rssByUrl.get(normalizeComparableUrl(sourceUrl)) ||
      rssByTitle.get(title.toLowerCase()) ||
      null;
    const description =
      normalizeText(item.DESCRIPTION?.value) ||
      normalizeText(rssData?.description) ||
      null;
    const imageUrl = rssData?.imageUrl || null;

    if (imageUrl) associatedImages += 1;

    const event = {
      title,
      description,
      starts_on: start.date.toISOString(),
      ends_on: end?.date.toISOString() || null,
      city,
      location,
      age_range: null,
      family_score: calculateFamilyScore(
        [title, description, city, location].filter(Boolean).join(" ")
      ),
      source_name: sourceName,
      source_url: sourceUrl || source.websiteUrl || source.calendarUrl,
      image_url: imageUrl,
    };

    const uid = normalizeText(item.UID?.value);
    const dedupeKey = uid
      ? `uid:${uid.toLowerCase()}`
      : `fingerprint:${eventFingerprint(event)}`;

    if (uniqueEvents.has(dedupeKey)) continue;

    event.import_key = eventImportKey(uid, event);
    uniqueEvents.set(dedupeKey, event);
  }

  console.log(`  VEVENT trovati: ${icsEvents.length}`);
  console.log(`  Eventi attivi o futuri: ${activeEvents.length}`);
  console.log(`  Immagini RSS associate: ${associatedImages}`);
  console.log(`  Eventi normalizzati: ${uniqueEvents.size}`);

  return [...uniqueEvents.values()];
}

export async function collectSocialEvents() {
  console.log("SOCIAL EVENTS");
  const source = SOCIAL_SOURCES.find(
    (item) => item.id === "pupi_di_stac" && item.enabled
  );

  if (!source) {
    console.log("Pupi di Stac non è abilitato.");
    return [];
  }

  return collectPupiDiStacEvents(source);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const events = await collectSocialEvents();

  for (const event of events) {
    console.log(
      `${event.starts_on} | ${event.title} | ${event.city || ""} | ${event.location || ""} | ${event.source_url || ""}`
    );
  }
}
