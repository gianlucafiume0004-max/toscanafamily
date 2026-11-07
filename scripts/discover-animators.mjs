import "dotenv/config";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

const SERVICE_TERMS = [
  ["animazione", /\banimazion[ei]?\b/i],
  ["feste per bambini", /\bfest[ae]\s+(?:di\s+)?compleanno\b|\bfest[ae]\s+per\s+bambini\b/i],
  ["baby dance", /\bbaby[\s-]?dance\b/i],
  ["truccabimbi", /\btruccabimbi\b|\bface[\s-]?painting\b/i],
  ["laboratori creativi", /\blaborator[io].{0,30}creativ/i],
  ["giochi", /\bgioch[io]\b/i],
  ["spettacoli", /\bspettacol[io]\b/i],
  ["magia", /\bmag[io]\b|\bmagia\b/i],
  ["burattini", /\bburattin[io]\b/i],
  ["mascotte", /\bmascott[ae]\b/i],
  ["gonfiabili", /\bgonfiabil[ei]\b/i]
];

const SOCIAL_HOSTS = {
  facebook: ["facebook.com", "fb.com"],
  instagram: ["instagram.com"]
};

const BLOCKED_HOSTS = [
  "paginegialle.it",
  "paginebianche.it",
  "prontopro.it",
  "tuttocitta.it",
  "yelp.com",
  "tripadvisor.com",
  "eventbrite.com",
  "wikipedia.org",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "pinterest.com"
];

const PROVINCES = new Map([
  ["arezzo", "AR"], ["ar", "AR"],
  ["firenze", "FI"], ["fi", "FI"], ["florence", "FI"],
  ["grosseto", "GR"], ["gr", "GR"],
  ["livorno", "LI"], ["li", "LI"], ["leghorn", "LI"],
  ["lucca", "LU"], ["lu", "LU"],
  ["massa carrara", "MS"], ["massa-carrara", "MS"], ["ms", "MS"],
  ["pisa", "PI"], ["pi", "PI"],
  ["pistoia", "PT"], ["pt", "PT"],
  ["prato", "PO"], ["po", "PO"],
  ["siena", "SI"], ["si", "SI"]
]);

const RUN_ID = new Date().toISOString();
const REPORT_PATH = process.env.REPORT_PATH || "animators-report.md";
const DRY_RUN = process.argv.includes("--dry-run");
const SOURCE_FILE = new URL("../data/animator-sources.json", import.meta.url);
const PAGE_SIZE = 500;
const REQUEST_TIMEOUT_MS = 12000;
const USER_AGENT =
  "ToscanaFamilyAnimatorDiscovery/1.0 (+https://github.com/gianlucafiume0004-max/toscanafamily)";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return value;
}

async function loadSourceUrls(sourceUrlFilter) {
  const parsed = JSON.parse(await readFile(SOURCE_FILE, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("data/animator-sources.json deve contenere un array.");
  }

  const sources = parsed.map((source, index) => {
    if (!source || typeof source.name !== "string" || !source.name.trim()) {
      throw new Error(`Fonte ${index + 1}: campo name obbligatorio.`);
    }

    let url;
    try {
      url = new URL(source.url);
    } catch {
      throw new Error(`Fonte ${index + 1} (${source.name}): URL non valido.`);
    }

    if (url.protocol !== "https:") {
      throw new Error(`Fonte ${index + 1} (${source.name}): è richiesto HTTPS.`);
    }

    if (source.coverageArea !== undefined && typeof source.coverageArea !== "string") {
      throw new Error(`Fonte ${index + 1} (${source.name}): coverageArea deve essere testo.`);
    }

    return {
      name: source.name.trim(),
      url: url.toString(),
      coverageArea: source.coverageArea?.trim() || null
    };
  });

  if (!sourceUrlFilter) return sources;

  const filteredSources = sources.filter((source) => source.url === sourceUrlFilter);
  if (filteredSources.length === 0) {
    throw new Error(`URL fonte non presente in data/animator-sources.json: ${sourceUrlFilter}`);
  }
  return filteredSources;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT")
    .replace(/\b(animazione|animatori|animatore|feste|bambini|srl|snc|asd|di|e|il|la|per)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0039")) return digits.slice(4);
  if (digits.startsWith("39") && digits.length > 10) return digits.slice(2);
  return digits.length >= 8 && digits.length <= 11 ? digits : null;
}

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    url.hash = "";
    if (isHost(url.hostname.toLowerCase(), SOCIAL_HOSTS.facebook)
      && /\/profile\.php$/i.test(url.pathname)) {
      const id = url.searchParams.get("id");
      url.search = "";
      if (id) url.searchParams.set("id", id);
    } else {
      url.search = "";
    }
    return url;
  } catch {
    return null;
  }
}

function hostname(value) {
  return normalizedUrl(value)?.hostname.toLowerCase().replace(/^www\./, "") ?? null;
}

function isHost(host, allowedHosts) {
  return Boolean(host && allowedHosts.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`)
  ));
}

function isBlockedHost(host) {
  return BLOCKED_HOSTS.some((blocked) => isHost(host, [blocked]));
}

function socialProfileKey(value, platform) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || !isHost(url.hostname.toLowerCase(), SOCIAL_HOSTS[platform])) {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment).toLowerCase();
    } catch {
      return segment.toLowerCase();
    }
  });
  if (platform === "facebook") {
    const first = segments[0];
    if (first === "profile.php") {
      const id = url.searchParams.get("id");
      return id ? `facebook:id:${id.toLowerCase()}` : null;
    }
    if (first === "pages" && segments[1]) {
      return segments[2]
        ? `facebook:id:${segments[2]}`
        : `facebook:${segments[1]}`;
    }
    if (first === "people" && segments.length > 2) {
      return `facebook:id:${segments[2]}`;
    }
  }

  const segment = segments[0];
  const excluded = platform === "facebook"
    ? new Set(["groups", "events", "watch", "share", "sharer", "login", "plugins"])
    : new Set(["p", "reel", "reels", "explore", "accounts", "stories"]);
  return segment && !excluded.has(segment) ? `${platform}:${segment}` : null;
}

function namesMatch(left, right) {
  const first = normalizeText(left);
  const second = normalizeText(right);
  return Boolean(first && second && first === second);
}

function candidatesMatch(first, second) {
  if (namesMatch(first.name, second.name)) return true;

  const firstPhone = normalizePhone(first.phone ?? first.normalized_phone);
  const secondPhone = normalizePhone(second.phone ?? second.normalized_phone);
  if (firstPhone && secondPhone && firstPhone === secondPhone) return true;

  const firstWebsite = hostname(first.website);
  const secondWebsite = hostname(second.website);
  if (firstWebsite && secondWebsite && firstWebsite === secondWebsite) return true;

  const firstFacebook = socialProfileKey(first.facebook_url, "facebook");
  const secondFacebook = socialProfileKey(second.facebook_url, "facebook");
  return Boolean(firstFacebook && secondFacebook && firstFacebook === secondFacebook);
}

function getQualityScore(candidate) {
  return (candidate.phone ? 40 : 0)
    + (candidate.website ? 30 : 0)
    + (candidate.facebook_url ? 15 : 0)
    + (candidate.instagram_url ? 15 : 0);
}

function getMissingFields(candidate) {
  return [
    ["phone", candidate.phone],
    ["website", candidate.website],
    ["facebook_url", candidate.facebook_url],
    ["instagram_url", candidate.instagram_url],
    ["city", candidate.city],
    ["province", candidate.province],
    ["services", candidate.services.length > 0],
    ["coverage_area", candidate.coverage_area]
  ]
    .filter(([, value]) => !value)
    .map(([field]) => field);
}

function isPrivateIp(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::"
      || normalized === "::1"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith("::ffff:");
  }
  return true;
}

async function assertPublicUrl(value) {
  const url = normalizedUrl(value);
  if (!url || url.protocol !== "https:") {
    throw new Error("URL di origine non HTTPS o non valido.");
  }

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Host locale non consentito.");
  }

  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true });

  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Host di rete privata non consentito.");
  }
  return url;
}

async function fetchPublicHtml(value) {
  let url = await assertPublicUrl(value);

  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml"
      }
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirectCount === 3) {
        throw new Error(`Redirect non valido o eccessivo da ${url.hostname}.`);
      }
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status} da ${url.hostname}.`);
    if (!(response.headers.get("content-type") ?? "").includes("text/html")) {
      throw new Error(`La pagina ${url.hostname} non è HTML.`);
    }
    return { html: await response.text(), finalUrl: url.toString() };
  }

  throw new Error("Troppi redirect durante il caricamento della pagina.");
}

function findJsonLdObjects(value, output = []) {
  if (!value) return output;
  if (Array.isArray(value)) {
    for (const item of value) findJsonLdObjects(item, output);
  } else if (typeof value === "object") {
    output.push(value);
    if (value["@graph"]) findJsonLdObjects(value["@graph"], output);
  }
  return output;
}

function extractBusinessData($) {
  const objects = [];
  $('script[type="application/ld+json"]').each((_, script) => {
    try {
      findJsonLdObjects(JSON.parse($(script).text()), objects);
    } catch (error) {
      console.warn(`JSON-LD non valido ignorato: ${error.message}`);
    }
  });

  const business = objects.find((item) => {
    const sameAs = Array.isArray(item.sameAs) ? item.sameAs : [];
    return item.name
      && item.address
      && sameAs.some((value) =>
        socialProfileKey(value, "facebook") || socialProfileKey(value, "instagram")
      );
  }) ?? {};
  const address = Array.isArray(business.address) ? business.address[0] : business.address;
  const provinceText = String(address?.addressRegion ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+\(.*\)$/, "");
  const province = PROVINCES.get(provinceText) ?? null;
  const city = typeof address?.addressLocality === "string"
    ? address.addressLocality.trim() || null
    : null;

  return {
    name: typeof business.name === "string" ? business.name.trim() : null,
    phone: typeof business.telephone === "string" ? business.telephone.trim() : null,
    city,
    province,
    sameAs: Array.isArray(business.sameAs) ? business.sameAs : []
  };
}

function extractPhone(text) {
  const labeledMatches = [
    ...text.matchAll(
      /(?:tel(?:efono)?|cell(?:ulare)?|mobile|whatsapp|chiama|chiamami|call)\s*[:.]?\s*((?:\+?39[\s./-]?)?(?:0\d{1,3}|3\d{2})[\s./()-]*\d[\d\s./()-]{5,10})/gi
    )
  ];
  const labeledPhone = labeledMatches
    .map((match) => normalizePhone(match[1]))
    .find(Boolean);
  if (labeledPhone) return labeledPhone;

  const matches = text.match(
    /(?:\+?39[\s./-]?)?(?:0\d{1,3}|3\d{2})[\s./()-]*\d[\d\s./()-]{5,10}/g
  ) ?? [];
  return matches
    .filter((match) => {
      const start = text.indexOf(match);
      const context = text.slice(Math.max(0, start - 32), start).toLowerCase();
      return !/(?:p\.?\s*i\.?\s*va|partita\s+iva|codice\s+fiscale|c\.?\s*f\.?)\s*:?$/i.test(context);
    })
    .map(normalizePhone)
    .find(Boolean) ?? null;
}

function cleanName(value) {
  return String(value ?? "")
    .replace(/\s*[|–—-]\s*(sito ufficiale|facebook|instagram).*$/i, "")
    .replace(/\s*[|–—-]\s*(animazione|animatori|feste per bambini).*$/i, "")
    .trim();
}

function extractSocialLinks($, businessSameAs = []) {
  const links = [...businessSameAs];
  $("a[href]").each((_, anchor) => links.push($(anchor).attr("href")));

  const result = { facebook_url: null, instagram_url: null };
  for (const link of links) {
    const url = normalizedUrl(link ?? "");
    if (!url) continue;

    const host = url.hostname.toLowerCase();
    if (!result.facebook_url && isHost(host, SOCIAL_HOSTS.facebook)) {
      result.facebook_url = url.toString();
    }
    if (!result.instagram_url && isHost(host, SOCIAL_HOSTS.instagram)) {
      result.instagram_url = url.toString();
    }
  }
  return result;
}

function extractServices(text) {
  return SERVICE_TERMS
    .filter(([, pattern]) => pattern.test(text))
    .map(([service]) => service);
}

function emptyPage() {
  return cheerio.load("<html><body></body></html>");
}

async function buildCandidate({ result, location }) {
  const source = normalizedUrl(result.url);
  if (!source || isBlockedHost(source.hostname.toLowerCase())) return null;

  const sourceHost = source.hostname.toLowerCase();
  const fromFacebook = isHost(sourceHost, SOCIAL_HOSTS.facebook);
  const fromInstagram = isHost(sourceHost, SOCIAL_HOSTS.instagram);
  const website = !fromFacebook && !fromInstagram ? source.origin : null;
  const sourceUrl = source.toString();
  let $ = emptyPage();
  let finalSourceUrl = sourceUrl;

  if (website || fromFacebook || fromInstagram) {
    try {
      const fetched = await fetchPublicHtml(sourceUrl);
      $ = cheerio.load(fetched.html);
      finalSourceUrl = fetched.finalUrl;
    } catch (error) {
      console.warn(`Pagina candidata non estratta (${source.hostname}): ${error.message}`);
    }
  }

  const business = extractBusinessData($);
  const title = result.title
    || business.name
    || $("h1").first().text().trim()
    || $('meta[property="og:title"]').attr("content")?.trim()
    || $("title").text().trim()
    || "";
  const name = cleanName(title);
  if (name.length < 3) return null;

  $("script,style,noscript").remove();
  const pageText = $("body").text().replace(/\s+/g, " ");
  const searchText = [
    result.title,
    $('meta[property="og:description"]').attr("content"),
    $('meta[name="description"]').attr("content"),
    pageText
  ].filter(Boolean).join(" ");
  const social = extractSocialLinks($, business.sameAs);

  if (fromFacebook) social.facebook_url = sourceUrl;
  if (fromInstagram) social.instagram_url = sourceUrl;

  const rawPhone = business.phone || extractPhone(searchText);
  const normalizedPhone = normalizePhone(rawPhone);
  const services = extractServices(searchText);
  const fieldSources = { name: finalSourceUrl };
  if (normalizedPhone) fieldSources.phone = finalSourceUrl;
  if (website) fieldSources.website = finalSourceUrl;
  if (social.facebook_url) fieldSources.facebook_url = finalSourceUrl;
  if (social.instagram_url) fieldSources.instagram_url = finalSourceUrl;
  if (business.city && business.province) fieldSources.city = finalSourceUrl;
  if (business.city && business.province) fieldSources.province = finalSourceUrl;
  if (services.length) fieldSources.services = finalSourceUrl;

  const candidate = {
    name,
    phone: normalizedPhone ? `+39${normalizedPhone}` : null,
    website,
    facebook_url: social.facebook_url,
    instagram_url: social.instagram_url,
    city: business.city && business.province ? business.city : null,
    province: business.city && business.province ? business.province : null,
    services,
    coverage_area: location || null,
    source_urls: [sourceUrl],
    field_sources: fieldSources,
    discovery_locations: location ? [location] : [],
    status: "pending_review"
  };
  candidate.normalized_name = normalizeText(candidate.name);
  candidate.normalized_phone = normalizePhone(candidate.phone);
  candidate.website_domain = hostname(candidate.website);
  candidate.quality_score = getQualityScore(candidate);
  candidate.missing_fields = getMissingFields(candidate);
  return candidate;
}

function mergeCandidates(existing, incoming) {
  const merged = { ...existing };
  for (const field of [
    "phone", "normalized_phone", "website", "website_domain", "facebook_url",
    "instagram_url", "city", "province"
  ]) {
    if (!merged[field] && incoming[field]) merged[field] = incoming[field];
  }

  merged.services = [...new Set([...(merged.services ?? []), ...incoming.services])];
  merged.source_urls = [...new Set([
    ...(merged.source_urls ?? []),
    ...incoming.source_urls
  ])];
  merged.discovery_locations = [...new Set([
    ...(merged.discovery_locations ?? []),
    ...incoming.discovery_locations
  ])];
  merged.field_sources = { ...(merged.field_sources ?? {}), ...incoming.field_sources };
  merged.coverage_area = [...new Set([
    ...(merged.coverage_area ?? "").split(";").map((value) => value.trim()).filter(Boolean),
    incoming.coverage_area
  ].filter(Boolean))].join("; ") || null;
  merged.quality_score = getQualityScore(merged);
  merged.missing_fields = getMissingFields(merged);
  return merged;
}

function mergeDiscoveryResults(results) {
  const candidates = [];
  for (const incoming of results) {
    const existing = candidates.find((candidate) => candidatesMatch(candidate, incoming));
    if (existing) Object.assign(existing, mergeCandidates(existing, incoming));
    else candidates.push(incoming);
  }
  return candidates;
}

async function loadAll(supabase, table, columns, filters = {}) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from(table)
      .select(columns)
      .range(offset, offset + PAGE_SIZE - 1);
    for (const [field, value] of Object.entries(filters)) {
      query = query.eq(field, value);
    }

    const { data, error } = await query;
    if (error) {
      const readError = new Error(`Lettura ${table}: ${error.message}`);
      readError.code = error.code;
      throw readError;
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

function providerToCandidate(provider) {
  const socials = String(provider.social_url ?? "")
    .split(";")
    .map((value) => normalizedUrl(value.trim()))
    .filter(Boolean);

  return {
    ...provider,
    facebook_url: socials.find((url) =>
      isHost(url.hostname.toLowerCase(), SOCIAL_HOSTS.facebook)
    )?.toString() ?? null,
    instagram_url: socials.find((url) =>
      isHost(url.hostname.toLowerCase(), SOCIAL_HOSTS.instagram)
    )?.toString() ?? null
  };
}

function planCandidateWrites(discovered, providers, storedCandidates) {
  const plan = [];
  let providerDuplicates = 0;
  const normalizedProviders = providers.map(providerToCandidate);
  for (const candidate of discovered) {
    const providerMatch = normalizedProviders.find((provider) =>
      candidatesMatch(candidate, provider)
    );
    if (providerMatch) {
      providerDuplicates += 1;
      continue;
    }

    const candidateMatches = storedCandidates.filter((stored) =>
      candidatesMatch(candidate, stored)
    );
    if (candidateMatches.length > 1) {
      continue;
    }

    if (candidateMatches.length === 1) {
      const stored = candidateMatches[0];
      if (stored.status !== "pending_review") continue;

      plan.push({
        action: "update",
        stored,
        candidate: mergeCandidates(stored, candidate)
      });
      continue;
    }

    plan.push({ action: "insert", candidate });
  }

  return { plan, providerDuplicates };
}

async function saveCandidates(supabase, plan, storedCandidates) {
  const saved = [];
  for (const entry of plan) {
    const now = new Date().toISOString();
    if (entry.action === "update") {
      const { stored, candidate: merged } = entry;
      const { error } = await supabase
        .from("animator_candidates")
        .update({
          phone: merged.phone,
          normalized_phone: merged.normalized_phone,
          website: merged.website,
          website_domain: merged.website_domain,
          facebook_url: merged.facebook_url,
          instagram_url: merged.instagram_url,
          city: merged.city,
          province: merged.province,
          services: merged.services,
          coverage_area: merged.coverage_area,
          source_urls: merged.source_urls,
          field_sources: merged.field_sources,
          missing_fields: merged.missing_fields,
          quality_score: merged.quality_score,
          discovery_locations: merged.discovery_locations,
          discovery_run_id: RUN_ID,
          updated_at: now,
          last_seen_at: now
        })
        .eq("id", stored.id)
        .eq("status", "pending_review");

      if (error) throw new Error(`Aggiornamento candidato ${stored.name}: ${error.message}`);
      Object.assign(stored, merged, { updated_at: now, last_seen_at: now });
      saved.push(merged);
      continue;
    }

    const { candidate } = entry;
    const row = {
      ...candidate,
      discovery_run_id: RUN_ID,
      approved_provider_id: null,
      created_at: now,
      updated_at: now,
      last_seen_at: now
    };
    const { error } = await supabase.from("animator_candidates").insert(row);
    if (error) throw new Error(`Inserimento candidato ${candidate.name}: ${error.message}`);

    storedCandidates.push(row);
    saved.push(row);
  }

  return saved;
}

function escapeMarkdown(value) {
  return String(value ?? "-").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function createReport(candidates, statistics) {
  return [
    `# NUOVI CANDIDATI — ${new Date().toISOString().slice(0, 10)}`,
    "",
    `- Fonti analizzate: ${statistics.sourcesAnalyzed}`,
    `- Candidati grezzi: ${statistics.rawCandidates}`,
    `- Duplicati interni: ${statistics.internalDuplicates}`,
    `- Già presenti in providers: ${statistics.providerDuplicates}`,
    `- Nuovi candidati validi: ${candidates.length}`,
    "",
    "| Candidato | Punteggio | Dati mancanti | Fonte |",
    "|---|---:|---|---|",
    ...candidates.map((candidate) =>
      `| ${escapeMarkdown(candidate.name)} | ${candidate.quality_score} | ` +
      `${escapeMarkdown(candidate.missing_fields.join(", ") || "nessuno")} | ` +
      `${escapeMarkdown(candidate.source_urls[0])} |`
    )
  ].join("\n");
}

async function main() {
  const argumentsList = process.argv.slice(2);
  const dryRun = argumentsList.includes("--dry-run");
  const sourceUrlArgument = argumentsList.find((argument) =>
    argument.startsWith("--source-url=")
  );
  const unsupportedArguments = argumentsList.filter((argument) =>
    argument !== "--dry-run" && argument !== sourceUrlArgument
  );
  if (unsupportedArguments.length > 0) {
    throw new Error(
      "Argomento non riconosciuto. Usa --dry-run e/o --source-url=<URL>."
    );
  }

  const sourceUrlFilter = sourceUrlArgument?.slice("--source-url=".length);
  const sourceUrls = await loadSourceUrls(sourceUrlFilter);
  const supabase = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const rawResults = sourceUrls.map((source) => ({
    result: { url: source.url, title: source.name, description: "" },
    location: source.coverageArea ?? null
  }));
  const searchErrors = [];
  const discovered = [];
  const batchSize = 5;
  for (let offset = 0; offset < rawResults.length; offset += batchSize) {
    const batch = rawResults.slice(offset, offset + batchSize);
    const results = await Promise.all(batch.map(async (item) => {
      try {
        return await buildCandidate(item);
      } catch (error) {
        searchErrors.push(`${item.result.url}: ${error.message}`);
        console.warn(`Risultato ignorato (${item.result.url}): ${error.message}`);
        return null;
      }
    }));
    discovered.push(...results.filter(Boolean));
  }

  const candidates = mergeDiscoveryResults(discovered);
  const providers = await loadAll(
    supabase,
    "providers",
    "id,name,phone,website,social_url",
    { provider_kind: "feste", party_type: "animatore" }
  );
  let candidatesTableAvailable = true;
  let storedCandidates;
  try {
    storedCandidates = await loadAll(
      supabase,
      "animator_candidates",
      "id,name,normalized_name,phone,normalized_phone,website,website_domain," +
        "facebook_url,instagram_url,city,province,services,coverage_area,source_urls," +
        "field_sources,missing_fields,quality_score,discovery_locations," +
        "discovery_run_id,status,approved_provider_id"
    );
  } catch (error) {
    if (!DRY_RUN || error.code !== "PGRST205") throw error;
    candidatesTableAvailable = false;
    storedCandidates = [];
    console.warn(
      "Tabella animator_candidates non disponibile; deduplicazione contro i candidati salvati non verificata."
    );
  }
  const { plan, providerDuplicates } = planCandidateWrites(
    candidates,
    providers,
    storedCandidates
  );

  if (dryRun) {
    console.log("DRY RUN: nessuna scrittura su Supabase.");
  } else {
    await saveCandidates(supabase, plan, storedCandidates);
  }

  const newCandidates = plan
    .filter(({ action }) => action === "insert")
    .map(({ candidate }) => candidate);
  const report = createReport(newCandidates, {
    sourcesAnalyzed: sourceUrls.length - searchErrors.length,
    rawCandidates: discovered.length,
    internalDuplicates: discovered.length - candidates.length,
    providerDuplicates
  });
  if (!dryRun) {
    await writeFile(REPORT_PATH, `${report}\n`, "utf8");
    if (process.env.GITHUB_STEP_SUMMARY) {
      await writeFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`, { flag: "a" });
    }
  }

  console.log(report);
  console.log(
    `Fonti analizzate: ${sourceUrls.length - searchErrors.length}; ` +
    `Candidati grezzi: ${discovered.length}; ` +
    `Duplicati interni: ${discovered.length - candidates.length}; ` +
    `Già presenti in providers: ${providerDuplicates}; ` +
    `Nuovi candidati validi: ${newCandidates.length}.`
  );
  if (!candidatesTableAvailable) {
    console.log("Nota: il conteggio non include possibili duplicati nella tabella animator_candidates.");
  }
}

main().catch((error) => {
  console.error(`Discovery Animatori fallita: ${error.message}`);
  process.exitCode = 1;
});
