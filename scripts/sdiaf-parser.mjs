import { execFileSync } from "node:child_process";
const SDIAF_HOST = "https://opac.comune.firenze.it";

const IT_MONTHS = {
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
  dicembre: 11,
};

const FAMILY_KEYWORDS = [
  "bambini",
  "bambine",
  "bambino",
  "bambina",
  "ragazzi",
  "ragazze",
  "famiglie",
  "famiglia",
  "laboratorio",
  "lettura animata",
  "letture animate",
  "letture ad alta voce",
  "favola",
  "favole",
  "fiaba",
  "fiabe",
  "gioco da tavolo",
  "giochi da tavolo",
  "gioco di ruolo",
  "biblioteche in gioco",
  "età consigliata",
  "eta consigliata",
  "genitori",
  "aquilone",
  "creativo",
  "creativa",
  "storie",
];

const EXCLUDE_KEYWORDS = [
  "chiusura",
  "ferie",
  "trasloco",
  "carta dei servizi",
  "tirocinio",
  "bando",
  "selezione pubblica",
  "avviso pubblico",
  "orario di apertura",
  "servizio sospeso",
];

function decodeEntities(value = "") {
  let text = String(value);

  const entities = {
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#34;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&amp;": "&",
    "&nbsp;": " ",
    "&#8217;": "’",
    "&#8216;": "‘",
    "&#8220;": "“",
    "&#8221;": "”",
    "&#8211;": "–",
    "&#8212;": "—",
  };

  for (let pass = 0; pass < 3; pass += 1) {
    const previous = text;

    for (const [encoded, decoded] of Object.entries(entities)) {
      text = text.split(encoded).join(decoded);
    }

    text = text.replace(/&#(\d+);/g, (_, number) => {
      const code = Number(number);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });

    text = text.replace(/&#x([0-9a-f]+);/gi, (_, number) => {
      const code = Number.parseInt(number, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });

    if (text === previous) break;
  }

  return text;
}

function stripHtml(value = "") {
  return decodeEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSpace(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value = "") {
  const url = decodeEntities(value).trim();

  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;

  return new URL(url, SDIAF_HOST).href;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function fetchText(url, timeoutMs = 45000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let fetchContent = "";
  let fetchError = null;

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; ToscanaFamily/1.0; event importer)",
        accept: "text/html,application/xhtml+xml",
      },
    });

    fetchContent = await response.text();

    const decoded = decodeEntities(fetchContent);

    if (
      response.ok &&
      decoded.length >= 1000 &&
      (
        decoded.includes("<html") ||
        decoded.includes("<!doctype") ||
        decoded.includes("/evento/")
      )
    ) {
      return decoded;
    }

    console.log(
      `  SDIAF fetch incompleto (${response.status}, ${decoded.length} caratteri), uso curl`,
    );
  } catch (error) {
    fetchError = error;

    console.log(
      `  SDIAF fetch fallito, uso curl: ${error.message}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  try {
    const seconds = Math.max(10, Math.ceil(timeoutMs / 1000));

    const curlContent = execFileSync(
      "curl",
      [
        "-L",
        "--silent",
        "--show-error",
        "--max-time",
        String(seconds),
        "-A",
        "Mozilla/5.0 (compatible; ToscanaFamily/1.0; event importer)",
        url,
      ],
      {
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
      },
    );

    const decoded = decodeEntities(curlContent);

    if (decoded.length < 1000) {
      throw new Error(
        `risposta curl troppo corta: ${decoded.length} caratteri`,
      );
    }

    return decoded;
  } catch (curlError) {
    if (fetchContent) {
      return decodeEntities(fetchContent);
    }

    throw new Error(
      `fetch: ${fetchError?.message || "risposta non valida"}; curl: ${curlError.message}`,
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSdiafDetail(url, timeoutMs = 45000) {
  let lastHtml = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const html = await fetchText(url, timeoutMs);
    lastHtml = html;

    const text = stripHtml(html);
    const hasTitle =
      /<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(html) ||
      /<h2\b[^>]*>[\s\S]*?<\/h2>/i.test(html) ||
      /<title\b[^>]*>[\s\S]*?<\/title>/i.test(html);

    const hasUsefulContent =
      text.length >= 400 &&
      !/access denied|too many requests|temporarily unavailable/i.test(text);

    if (hasTitle && hasUsefulContent) {
      if (attempt > 1) {
        console.log(`  SDIAF RETRY OK: ${url}`);
      }

      return html;
    }

    console.log(
      `  SDIAF INVALID DETAIL attempt ${attempt}/3: ${url}`,
    );

    if (attempt < 3) {
      await sleep(attempt * 1500);
    }
  }

  return lastHtml;
}

function extractEventLinks(listHtml, allowedLibraries = []) {
  const html = decodeEntities(listHtml);
  const links = [];

  const hrefRegex = new RegExp(
    'href=["\\\']([^"\\\']*\\/it\\/now\\/[^"\\\']+\\/evento\\/[^"\\\']+)["\\\']',
    'gi',
  );

  for (const match of html.matchAll(hrefRegex)) {
    const href = match[1];
    if (href) links.push(absoluteUrl(href));
  }

  let filteredLinks = unique(links);

  if (allowedLibraries.length > 0) {
    const filters = allowedLibraries.map((item) =>
      String(item).toLowerCase().trim(),
    );

    filteredLinks = filteredLinks.filter((url) => {
      const lowered = url.toLowerCase();
      return filters.some((filter) => lowered.includes(filter));
    });
  }

  return unique(filteredLinks);
}

function extractTitle(html, fallback = "Evento in biblioteca") {
  const decoded = decodeEntities(html);

  const h1 =
    decoded.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    decoded.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1];

  if (h1) return normalizeSpace(stripHtml(h1));

  const title = decoded.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) {
    return normalizeSpace(stripHtml(title).split("||")[0]);
  }

  return fallback;
}

function extractMainContent(html) {
  const decoded = decodeEntities(html);

  const candidates = [
    decoded.match(
      /<div\b[^>]*class=["'][^"']*\btesto\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    )?.[1],
    decoded.match(
      /<div\b[^>]*class=["'][^"']*\bnews-details\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    )?.[1],
    decoded.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1],
  ].filter(Boolean);

  return candidates[0] || decoded;
}

function inferCity(url, text = "") {
  const loweredUrl = url.toLowerCase();
  const loweredText = text.toLowerCase();

  if (
    loweredUrl.includes("biblioteca-comunale-incisa") ||
    loweredText.includes("biblioteca di incisa")
  ) {
    return "Incisa Valdarno";
  }

  if (
    loweredUrl.includes("biblioteca-comunale-figline") ||
    loweredText.includes("biblioteca marsilio ficino") ||
    loweredText.includes("biblioteca di figline")
  ) {
    return "Figline Valdarno";
  }

  return "Figline e Incisa Valdarno";
}

function inferLocation(url, text = "") {
  const lowered = `${url} ${text}`.toLowerCase();

  if (lowered.includes("marsilio ficino")) {
    return "Biblioteca Marsilio Ficino";
  }

  if (lowered.includes("biblioteca-comunale-incisa")) {
    return "Biblioteca Comunale di Incisa Valdarno";
  }

  return "Biblioteche comunali di Figline e Incisa Valdarno";
}

function inferYear(text, url) {
  const urlYear = url.match(/(?:19|20)\d{2}/)?.[0];
  if (urlYear) return Number(urlYear);

  const textYear = text.match(/\b(?:19|20)\d{2}\b/)?.[0];
  if (textYear) return Number(textYear);

  return new Date().getFullYear();
}

function parseTime(value = "") {
  const match = String(value).match(
    /\b(?:ore|dalle)\s+([01]?\d|2[0-3])(?:[.:]([0-5]\d))?/i,
  );

  if (!match) return null;

  return {
    hour: Number(match[1]),
    minute: Number(match[2] || 0),
  };
}

function parseItalianDate(value, defaultYear) {
  const lowered = String(value).toLowerCase();

  const match = lowered.match(
    /\b(?:luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)?\s*(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+((?:19|20)\d{2}))?/i,
  );

  if (!match) return null;

  const day = Number(match[1]);
  const month = IT_MONTHS[match[2].toLowerCase()];
  const year = Number(match[3] || defaultYear);
  const time = parseTime(value);

  const date = new Date(
    year,
    month,
    day,
    time?.hour ?? 9,
    time?.minute ?? 0,
    0,
    0,
  );

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function extractAgeRange(value = "") {
  const text = String(value).toLowerCase();

  let match = text.match(
    /et[aà]\s+consigliata\s*:\s*(?:da(?:i|lle)?\s*)?(\d{1,2})\s*(?:-|–|a)\s*(\d{1,2})\s*anni/i,
  );

  if (match) return `${match[1]}-${match[2]} anni`;

  match = text.match(/(?:da(?:i|lle)?\s+)(\d{1,2})\s+anni/i);
  if (match) return `${match[1]}+ anni`;

  match = text.match(/(\d{1,2})\s*(?:-|–)\s*(\d{1,2})\s*anni/i);
  if (match) return `${match[1]}-${match[2]} anni`;

  return null;
}

function familyScore(value = "") {
  const lowered = String(value).toLowerCase();

  let score = 0;

  for (const keyword of FAMILY_KEYWORDS) {
    if (lowered.includes(keyword)) score += 2;
  }

  if (/et[aà]\s+consigliata/i.test(lowered)) score += 4;
  if (/\b\d{1,2}\s*(?:-|–|a)\s*\d{1,2}\s*anni\b/i.test(lowered)) score += 3;

  for (const keyword of EXCLUDE_KEYWORDS) {
    if (lowered.includes(keyword)) score -= 8;
  }

  return score;
}

function isAdministrative(value = "") {
  const lowered = String(value).toLowerCase();
  return EXCLUDE_KEYWORDS.some((keyword) => lowered.includes(keyword));
}

function cleanEventTitle(value = "") {
  return normalizeSpace(stripHtml(value))
    .replace(/^[-–•:|\s]+/, "")
    .replace(/[-–•:|\s]+$/, "")
    .slice(0, 180);
}

function splitProgrammeItems(text, defaultYear) {
  const lines = String(text)
    .split(/\n+/)
    .map(normalizeSpace)
    .filter(Boolean);

  const items = [];
  const datePattern =
    /\b(?:luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)\s+\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b/i;

  for (let index = 0; index < lines.length; index += 1) {
    const dateLine = lines[index];

    if (!datePattern.test(dateLine)) continue;

    const startDate = parseItalianDate(dateLine, defaultYear);
    if (!startDate) continue;

    const candidateLines = lines.slice(index + 1, index + 6);

    const title =
      candidateLines.find((line) => {
        if (line.length < 3 || line.length > 180) return false;
        if (parseItalianDate(line, defaultYear)) return false;
        if (/^(partecipazione|prenotazione|a cura di|et[aà]\s)/i.test(line)) {
          return false;
        }

        const letters = line.replace(/[^A-Za-zÀ-ÿ]/g, "");
        if (!letters) return false;

        const uppercaseLetters = letters.replace(/[^A-ZÀ-Þ]/g, "");
        return uppercaseLetters.length / letters.length >= 0.55;
      }) ||
      candidateLines.find((line) => {
        return (
          line.length >= 3 &&
          line.length <= 180 &&
          !parseItalianDate(line, defaultYear) &&
          !/^(partecipazione|prenotazione|a cura di|et[aà]\s)/i.test(line)
        );
      });

    if (!title) continue;

    const nextDateIndex = lines.findIndex(
      (line, candidateIndex) =>
        candidateIndex > index && datePattern.test(line),
    );

    const endIndex =
      nextDateIndex > index ? Math.min(nextDateIndex, index + 18) : index + 18;

    const block = lines.slice(index, endIndex).join("\n");

    items.push({
      title: cleanEventTitle(title),
      startDate,
      description: block.slice(0, 4000),
      ageRange: extractAgeRange(block),
      score: familyScore(block),
    });
  }

  const seen = new Set();

  return items.filter((item) => {
    const key = `${item.title.toLowerCase()}|${item.startDate.toISOString()}`;

    if (seen.has(key)) return false;
    seen.add(key);

    return true;
  });
}

function findSingleDate(text, defaultYear) {
  const cleanedText = String(text)
    .replace(
      /NOW è stato realizzato secondo le disposizioni normative vigenti[\s\S]*$/i,
      " ",
    )
    .replace(
      /D\.lgs\.?\s+\d{1,3}\s+[a-zàèéìòù]+\s+\d{4}/gi,
      " ",
    )
    .replace(
      /direttiva\s+UE\s+\d{4}\/\d+/gi,
      " ",
    );

  const dateRegex =
    /(?:luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)?\s*\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(?:19|20)\d{2})?(?:\s*,?\s*(?:ore|dalle)\s+\d{1,2}(?:[.:]\d{2})?)?/gi;

  const matches = cleanedText.match(dateRegex) || [];

  for (const match of matches) {
    const parsed = parseItalianDate(match, defaultYear);

    if (!parsed) continue;

    const year = parsed.getFullYear();
    const currentYear = new Date().getFullYear();

    if (year < currentYear - 1 || year > currentYear + 2) {
      continue;
    }

    return parsed;
  }

  return null;
}

function normalizeEvent({
  title,
  description,
  startDate,
  ageRange,
  url,
  source,
  location,
  city,
}) {
  return {
    title: cleanEventTitle(title),
    description: normalizeSpace(description).slice(0, 5000),
    start_date: startDate.toISOString(),
    end_date: null,
    location,
    city,
    province: "Firenze",
    region: "Toscana",
    age_range: ageRange || null,
    category: "Biblioteca",
    source: source.name,
    source_url: url,
    url,
    image_url: null,
    is_free: /\bgratuit[oaie]\b/i.test(description),
  };
}

async function parseDetailPage(url, source) {
  const html = await fetchSdiafDetail(url, source.timeoutMs);
  const pageTitle = extractTitle(html);
  const contentHtml = extractMainContent(html);
  const contentText = stripHtml(contentHtml);
  const year = inferYear(contentText, url);
  const city = inferCity(url, contentText);
  const location = inferLocation(url, contentText);

  if (isAdministrative(`${pageTitle} ${contentText.slice(0, 1000)}`)) {
    console.log(`  SDIAF SKIP ADMIN: ${pageTitle}`);
    return [];
  }

  const programmeItems = splitProgrammeItems(contentText, year);
  const familyProgrammeItems = programmeItems.filter(
    (item) => item.score >= source.minimumFamilyScore,
  );

  if (familyProgrammeItems.length > 0) {
    console.log(
      `  SDIAF PROGRAMME: ${pageTitle} -> ${familyProgrammeItems.length} eventi family`,
    );

    return familyProgrammeItems.map((item) =>
      normalizeEvent({
        title: item.title,
        description: item.description,
        startDate: item.startDate,
        ageRange: item.ageRange,
        url,
        source,
        location,
        city,
      }),
    );
  }

  const score = familyScore(`${pageTitle}\n${contentText}`);

  if (score < source.minimumFamilyScore) {
    console.log(`  SDIAF SKIP NOT FAMILY (${score}): ${pageTitle}`);
    return [];
  }

  const startDate = findSingleDate(contentText, year);

  if (!startDate) {
    console.log(`  SDIAF DATE NOT FOUND: ${pageTitle}`);
    return [];
  }

  return [
    normalizeEvent({
      title: pageTitle,
      description: contentText,
      startDate,
      ageRange: extractAgeRange(contentText),
      url,
      source,
      location,
      city,
    }),
  ];
}

function isFutureOrRecent(event, graceDays = 1) {
  const start = new Date(event.start_date);
  const threshold = new Date();

  threshold.setHours(0, 0, 0, 0);
  threshold.setDate(threshold.getDate() - graceDays);

  return Number.isFinite(start.getTime()) && start >= threshold;
}

export async function collectSdiafEvents(source = {}) {
  const normalizedSource = {
    name: source.name || "SDIAF Figline e Incisa",
    url: source.url || "https://opac.comune.firenze.it/it/now/collettivo/eventi",
    libraryFilters: source.libraryFilters || [
      "biblioteca-comunale-figline",
      "biblioteca-comunale-incisa",
    ],
    minimumFamilyScore: Number(source.minimumFamilyScore ?? 2),
    concurrency: Math.max(1, Number(source.concurrency ?? 3)),
    timeoutMs: Number(source.timeoutMs ?? 45000),
    maxPages: Math.max(1, Number(source.maxPages ?? 50)),
  };

  console.log(`  SDIAF listing: ${normalizedSource.url}`);

  const listingHtml = await fetchText(
    normalizedSource.url,
    normalizedSource.timeoutMs,
  );

  const links = extractEventLinks(
    listingHtml,
    normalizedSource.libraryFilters,
  ).slice(0, normalizedSource.maxPages);

  console.log(`  SDIAF detail links: ${links.length}`);

  const events = [];

  for (
    let index = 0;
    index < links.length;
    index += normalizedSource.concurrency
  ) {
    const batch = links.slice(index, index + normalizedSource.concurrency);

    const results = await Promise.allSettled(
      batch.map((url) => parseDetailPage(url, normalizedSource)),
    );

    for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
      const result = results[resultIndex];

      if (result.status === "fulfilled") {
        events.push(...result.value);
      } else {
        console.error(
          `  SDIAF DETAIL ERROR ${batch[resultIndex]}:`,
          result.reason?.message || result.reason,
        );
      }
    }
  }

  const includePast = process.env.SDIAF_INCLUDE_PAST === "1";

  const futureEvents = includePast
    ? events
    : events.filter((event) => isFutureOrRecent(event));

  console.log(
    `  SDIAF date filter: ${includePast ? "INCLUDE PAST" : "FUTURE ONLY"}`,
  );
  const deduplicated = [];
  const seen = new Set();

  for (const event of futureEvents) {
    const key = [
      event.title.toLowerCase(),
      event.start_date.slice(0, 10),
      event.city.toLowerCase(),
    ].join("|");

    if (seen.has(key)) continue;

    seen.add(key);
    deduplicated.push(event);
  }

  console.log(`  SDIAF normalized events: ${deduplicated.length}`);

  return deduplicated;
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const events = await collectSdiafEvents({
    name: "SDIAF Tutte le biblioteche",
    libraryFilters: [],
    maxPages: 100,
    concurrency: 3,
  });

  console.log("\n--- SDIAF PREVIEW ---");

  for (const event of events) {
    console.log(
      `${event.start_date} | ${event.title} | ${event.age_range || "età n/d"} | ${event.city}`,
    );
  }

  console.log(`\nTotale: ${events.length}`);
}
