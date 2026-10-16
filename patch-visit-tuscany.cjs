const fs = require("fs");

const file = "scripts/update-events.mjs";
let code = fs.readFileSync(file, "utf8");

if (code.includes("async function collectVisitTuscanyEvents")) {
  console.log("Parser Visit Tuscany già presente. Nessuna modifica eseguita.");
  process.exit(0);
}

const parserCode = `
function parseVisitTuscanyDate(value) {
  const match = String(value || "")
    .toLowerCase()
    .match(/(\\d{1,2})\\s+([a-zà]+)\\s+(\\d{4})/i);

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
      .matchAll(/(\\d{1,2})\\s+([a-zà]+)\\s+(\\d{4})/gi)
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
        \`Visit Tuscany GraphQL HTTP \${response.status}\`
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
        .replace(/^\\s*(a|ad|in)\\s+/i, ""),
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
    \`  Visit Tuscany GraphQL pages: \${totalPages}, normalized events: \${byKey.size}\`
  );

  return [...byKey.values()];
}

`;

const insertionMarker = "function extractPointDate($, selector) {";

if (!code.includes(insertionMarker)) {
  throw new Error("Punto di inserimento non trovato.");
}

code = code.replace(
  insertionMarker,
  parserCode + insertionMarker
);

const collectionMarker =
  "async function collectSourceEvents(source) {";

const collectionReplacement =
  `async function collectSourceEvents(source) {
  if (
    String(source.name || "").toLowerCase() ===
    "visit tuscany"
  ) {
    return collectVisitTuscanyEvents(source);
  }
`;

if (!code.includes(collectionMarker)) {
  throw new Error("Funzione collectSourceEvents non trovata.");
}

code = code.replace(
  collectionMarker,
  collectionReplacement
);

fs.writeFileSync(file, code);
console.log("Parser Visit Tuscany inserito correttamente.");
