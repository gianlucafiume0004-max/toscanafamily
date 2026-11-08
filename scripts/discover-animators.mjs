import "dotenv/config";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
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
const SOURCE_FILE = new URL("../data/animator-sources.json", import.meta.url);
const PAGE_SIZE = 500;
const REQUEST_TIMEOUT_MS = 12000;
const USER_AGENT =
  "ToscanaFamilyAnimatorDiscovery/1.0 (+https://github.com/gianlucafiume0004-max/toscanafamily)";
const STAGING_PROJECT = "eqonpqgazhmjbrjtexmg.supabase.co";
const REQUIRED_FIELDS = [
  "phone", "website", "facebook_url", "instagram_url",
  "city", "province", "services", "coverage_area"
];

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
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0039")) digits = digits.slice(4);
  else if (digits.startsWith("39") && digits.length > 10) digits = digits.slice(2);
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
    ? new Set(["groups", "events", "watch", "share", "sharer", "login", "plugins", "privacy", "policies", "help"])
    : new Set(["p", "reel", "reels", "explore", "accounts", "stories", "about", "legal", "privacy", "developer", "help"]);
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
  if (firstFacebook && secondFacebook && firstFacebook === secondFacebook) return true;
  const firstInstagram = socialProfileKey(first.instagram_url, "instagram");
  const secondInstagram = socialProfileKey(second.instagram_url, "instagram");
  return Boolean(firstInstagram && secondInstagram && firstInstagram === secondInstagram);
}

function getQualityScore(candidate) {
  const socialCount = Number(Boolean(candidate.facebook_url)) + Number(Boolean(candidate.instagram_url));
  return (candidate.phone ? 40 : 0)
    + (candidate.website ? 30 : 0)
    + (socialCount > 0 ? 20 : 0)
    + (socialCount > 1 ? 10 : 0);
}

function getMissingFields(candidate) {
  return [
    ["phone", candidate.phone],
    ["website", candidate.website],
    ["facebook_url", candidate.facebook_url],
    ["instagram_url", candidate.instagram_url],
    ["city", candidate.city],
    ["province", candidate.province],
    ["services", (candidate.services ?? []).length > 0],
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

  let addresses;
  if (isIP(host)) {
    addresses = [{ address: host }];
  } else {
    let timer;
    try {
      addresses = await Promise.race([
        lookup(host, { all: true, verbatim: true }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timeout DNS per ${host}.`)), REQUEST_TIMEOUT_MS);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

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

  const businesses = objects.filter((item) => {
    const type = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
    return item.name && item.address && type.some((value) =>
      typeof value === "string" && /^(?:Organization|LocalBusiness|EntertainmentBusiness|EventPlanning)$/i.test(value)
    );
  });
  const business = businesses.find((item) => {
    const sameAs = Array.isArray(item.sameAs) ? item.sameAs : [];
    return sameAs.some((value) =>
        socialProfileKey(value, "facebook") || socialProfileKey(value, "instagram")
      );
  }) ?? (businesses.length === 1 ? businesses[0] : {});
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
    if (!result.facebook_url && isHost(host, SOCIAL_HOSTS.facebook) && socialProfileKey(link, "facebook")) {
      result.facebook_url = url.toString();
    }
    if (!result.instagram_url && isHost(host, SOCIAL_HOSTS.instagram) && socialProfileKey(link, "instagram")) {
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
      const final = normalizedUrl(fetched.finalUrl);
      if (!final || (website && hostname(fetched.finalUrl) !== hostname(sourceUrl)) ||
          (fromFacebook && !isHost(final.hostname, SOCIAL_HOSTS.facebook)) ||
          (fromInstagram && !isHost(final.hostname, SOCIAL_HOSTS.instagram))) {
        throw new Error("Redirect verso un dominio non verificato.");
      }
      $ = cheerio.load(fetched.html);
      finalSourceUrl = fetched.finalUrl;
    } catch (error) {
      throw new Error(`Pagina candidata non estratta (${source.hostname}): ${error.message}`);
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

  if (fromFacebook) social.facebook_url = socialProfileKey(finalSourceUrl, "facebook") ? finalSourceUrl : null;
  if (fromInstagram) social.instagram_url = socialProfileKey(finalSourceUrl, "instagram") ? finalSourceUrl : null;

  const rawPhone = extractOfficialPhone($, business);
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
  if (location) fieldSources.coverage_area = finalSourceUrl;

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
  merged.field_sources = { ...incoming.field_sources, ...(merged.field_sources ?? {}) };
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

function stagingUrl(value) {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === STAGING_PROJECT &&
    !url.port && !url.username && !url.password && url.pathname === "/" &&
    !url.search && !url.hash;
}

function isApprovalEligible(candidate, configuredSources = [], linkedPolicySources = []) {
  const sources = candidate.field_sources ?? {};
  const required = ["phone", "website", "city", "province"];
  const socials = ["facebook", "instagram"].filter((platform) =>
    Boolean(socialProfileKey(candidate[`${platform}_url`], platform))
  );
  const hasVerifiedSource = (field) => {
    const url = normalizedUrl(sources[field]);
    if (!url || url.protocol !== "https:" || isBlockedHost(url.hostname)) return false;
    if (hostname(url.toString()) === hostname(candidate.website)) return true;
    if (linkedPolicySources.includes(url.toString())) return true;
    if (["facebook", "instagram"].some((platform) => {
      const key = socialProfileKey(url.toString(), platform);
      return key && key === socialProfileKey(candidate[`${platform}_url`], platform);
    })) return true;
    return configuredSources.some((source) =>
      namesMatch(source.name, candidate.name) && normalizedUrl(source.url)?.toString() === url.toString()
    );
  };
  return candidate.status === "pending_review"
    && Number.isFinite(candidate.quality_score)
    && candidate.quality_score >= 90
    && typeof candidate.city === "string" && candidate.city.trim().length > 0
    && [...PROVINCES.values()].includes(candidate.province)
    && Boolean(normalizePhone(candidate.phone))
    && Boolean(normalizedUrl(candidate.website))
    && required.every(hasVerifiedSource)
    && socials.some((platform) => hasVerifiedSource(`${platform}_url`));
}

function addEnrichment(candidate, values, sourceUrl) {
  const result = { ...candidate, field_sources: { ...(candidate.field_sources ?? {}) } };
  for (const field of REQUIRED_FIELDS) {
    const current = field === "services" ? (result.services ?? []).length : result[field];
    const incoming = field === "services" ? (values.services ?? []).length : values[field];
    if (!current && incoming) {
      result[field] = values[field];
      result.field_sources[field] = sourceUrl;
    }
  }
  result.normalized_phone = normalizePhone(result.phone);
  result.website_domain = hostname(result.website);
  result.quality_score = getQualityScore(result);
  result.missing_fields = getMissingFields(result);
  result.source_urls = [...new Set([...(result.source_urls ?? []), sourceUrl])];
  return result;
}

function extractOfficialPhone($, business) {
  const phones = [business.phone];
  $('a[href^="tel:"]').each((_, anchor) => phones.push($(anchor).attr("href").slice(4)));
  $('a[href]').each((_, anchor) => {
    let url;
    try { url = new URL($(anchor).attr("href")); } catch { return; }
    if (isHost(url.hostname, ["wa.me"])) phones.push(url.pathname.slice(1));
    if (isHost(url.hostname, ["api.whatsapp.com"])) phones.push(url.searchParams.get("phone"));
  });
  const text = $("body").text().replace(/\s+/g, " ");
  const labeled = text.matchAll(
    /(?:tel(?:efono)?|cell(?:ulare)?|mobile|whatsapp|chiama|chiamami)\s*[:.]?\s*((?:\+?39[\s./-]?)?(?:0\d{1,3}|3\d{2})[\s./()-]*\d[\d\s./()-]{5,10})/gi
  );
  phones.push(...[...labeled].map((match) => match[1]));
  return phones.map(normalizePhone).find(Boolean) ?? null;
}

function extractAddress($, business) {
  const locations = [];
  if (business.city && business.province) locations.push([business.city, business.province]);
  const text = $("body").text().replace(/\s+/g, " ");
  const addressPattern = /\b(?:sede(?:\s+(?:legale|operativa|amministrativa))?|indirizzo|via|viale|piazza|corso|largo)\b[^|;\n]{0,100}?\b(?:\d{5}\s+)?([A-ZÀ-Ü][a-zà-ÿ]+(?:[ '\u2019-]+[A-Za-zÀ-ÿ]+){0,3})\s*[,(-]\s*(AR|FI|GR|LI|LU|MS|PI|PO|PT|SI)\b/giu;
  for (const match of text.matchAll(addressPattern)) {
    locations.push([match[1].trim(), match[2].toUpperCase()]);
  }
  const capitals = new Map([
    ["arezzo", ["521", "AR"]], ["firenze", ["501", "FI"]],
    ["grosseto", ["581", "GR"]], ["livorno", ["571", "LI"]],
    ["lucca", ["551", "LU"]], ["massa", ["541", "MS"]],
    ["pisa", ["561", "PI"]], ["pistoia", ["511", "PT"]],
    ["prato", ["591", "PO"]], ["siena", ["531", "SI"]]
  ]);
  const capitalPattern = /\b(?:sede|indirizzo|via|viale|piazza|corso|largo)\b[^|;.\n]{0,100}?\b(\d{5})\s*[-–,]?\s*(Arezzo|Firenze|Grosseto|Livorno|Lucca|Massa|Pisa|Pistoia|Prato|Siena)\b/giu;
  for (const match of text.matchAll(capitalPattern)) {
    const [prefix, province] = capitals.get(match[2].toLocaleLowerCase("it-IT"));
    if (match[1].startsWith(prefix)) locations.push([match[2], province]);
  }
  const unique = [...new Map(locations.map(([city, province]) =>
    [`${city.toLocaleLowerCase("it-IT")}|${province}`, { city, province }]
  )).values()];
  return unique.length === 1 ? unique[0] : null;
}

function extractCoverage(text) {
  const explicit = text.match(/\b(?:zone|comuni|province|aree)\s+servit[ei]\s*:\s*([^.!?;]{3,100})/i);
  if (explicit) return explicit[1].trim();
  const match = text.match(/\b(?:operiamo|lavoriamo|serviamo|disponibil[ei])\s+(?:in|a|su|nelle?|sul(?:la|le)?)\s+([^.!?;]{3,100})/i);
  if (!match || !/\b(?:toscana|provincia|province|arezzo|firenze|grosseto|livorno|lucca|massa|pisa|pistoia|prato|siena)\b/i.test(match[1])) return null;
  return match[1].trim();
}

function pageAttempt(label, url) {
  const parsed = normalizedUrl(url);
  const text = `${label} ${parsed?.pathname ?? ""}`.toLowerCase();
  if (/contatt|contact/.test(text)) return "contatti";
  if (/privacy/.test(text)) return "privacy policy";
  if (/cookie/.test(text)) return "cookie policy";
  if (/termin|condizion|terms/.test(text)) return "termini e condizioni";
  if (/chi.?siamo|about|azienda|impresa|sede|partita.?iva/.test(text)) return "informazioni aziendali";
  if (/serviz|service|fest[ae]|animazion|faq|copertura|zone/.test(text)) return "servizi e copertura";
  return "pagina ufficiale e footer";
}

function pagePriority(label, url) {
  const method = pageAttempt(label, url);
  return {
    "contatti": 0, "pagina ufficiale e footer": 1, "privacy policy": 2,
    "cookie policy": 3, "termini e condizioni": 4,
    "informazioni aziendali": 5, "servizi e copertura": 6
  }[method];
}

async function enrichCandidate(candidate, sources, fetchPage = fetchPublicHtml) {
  let result = { ...candidate };
  const failures = [];
  const enrichments = [];
  const linkedPolicySources = new Set();
  let enrichment_attempts = 0;
  const matchingSources = sources.filter((source) => namesMatch(source.name, candidate.name));
  const queue = [
    ...matchingSources.map((source) => source.url),
    candidate.website, candidate.facebook_url, candidate.instagram_url,
    ...(candidate.source_urls ?? []).filter((url) =>
      hostname(url) && hostname(url) === hostname(candidate.website))
  ].filter(Boolean);
  const seen = new Set();
  const labels = new Map();
  while (queue.length) {
    queue.sort((a, b) => pagePriority(labels.get(a) ?? "", a) - pagePriority(labels.get(b) ?? "", b));
    const original = normalizedUrl(queue.shift());
    if (!original || original.protocol !== "https:" || isBlockedHost(original.hostname)) continue;
    const key = original.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    enrichment_attempts += 1;
    const attempt = pageAttempt(labels.get(key) ?? "", key);
    let fetched;
    try {
      fetched = await fetchPage(key);
    } catch (error) {
      failures.push(`${key}: ${error.message}`);
      continue;
    }
    {
      const { html, finalUrl } = fetched;
      const final = normalizedUrl(finalUrl);
      if (!final) {
        failures.push(`${key}: URL finale non valido.`);
        continue;
      }
      const sourceIsSocial = Object.values(SOCIAL_HOSTS).some((hosts) => isHost(original.hostname, hosts));
      const finalIsSocial = Object.values(SOCIAL_HOSTS).some((hosts) => isHost(final.hostname, hosts));
      if (sourceIsSocial !== finalIsSocial ||
          (sourceIsSocial && !Object.values(SOCIAL_HOSTS).some((hosts) =>
            isHost(original.hostname, hosts) && isHost(final.hostname, hosts))) ||
          (!sourceIsSocial && hostname(key) !== hostname(finalUrl))) {
        failures.push(`${key}: Redirect verso un dominio non verificato.`);
        continue;
      }
      const $ = cheerio.load(html);
      const business = extractBusinessData($);
      $("script,style,noscript").remove();
      const text = [
        $('meta[property="og:description"]').attr("content"),
        $('meta[name="description"]').attr("content"),
        $("body").text()
      ].filter(Boolean).join(" ").replace(/\s+/g, " ");
      const values = {};
      if (!sourceIsSocial) {
        const isPolicyHost = linkedPolicySources.has(key);
        if (isPolicyHost) linkedPolicySources.add(final.toString());
        if (!result.website && !isPolicyHost) values.website = final.origin;
        const phone = extractOfficialPhone($, business);
        if (phone) values.phone = `+39${phone}`;
        const address = extractAddress($, business);
        if (address &&
            (!result.city || result.city.toLocaleLowerCase("it-IT") === address.city.toLocaleLowerCase("it-IT")) &&
            (!result.province || result.province === address.province)) {
          values.city = address.city;
          values.province = address.province;
        }
        values.services = extractServices(text);
        const configured = matchingSources.find((source) => source.url === key);
        values.coverage_area = configured?.coverageArea || extractCoverage(text);
        const social = extractSocialLinks($, business.sameAs);
        Object.assign(values, social);
        $("a[href]").each((_, anchor) => {
          const href = $(anchor).attr("href");
          const socialLink = normalizedUrl(href);
          if (socialLink && isHost(socialLink.hostname, SOCIAL_HOSTS.facebook) &&
              /^\/share\/[^/]+/i.test(socialLink.pathname)) {
            queue.push(href);
          }
          try {
            const linked = normalizedUrl(new URL(href, final).toString());
            if (!linked) return;
            const label = `${$(anchor).text()} ${linked.pathname}`;
            if (!/contatt|contact|privacy|cookie|termin|condizion|terms|chi.?siamo|about|azienda|impresa|sede|partita.?iva|serviz|service|fest[ae]|animazion|faq|copertura|zone/i.test(label)) return;
            const officialPolicy = !isPolicyHost && hostname(finalUrl) === hostname(result.website) &&
              isHost(linked.hostname, ["iubenda.com"]) &&
              /\/(?:privacy-policy|termini-e-condizioni)\//i.test(linked.pathname) &&
              /privacy|cookie|termin|condizion/i.test(label);
            if (officialPolicy || (!isPolicyHost && hostname(linked.toString()) === hostname(finalUrl))) {
              const linkedUrl = linked.toString();
              if (officialPolicy) linkedPolicySources.add(linkedUrl);
              if (!seen.has(linkedUrl)) {
                labels.set(linkedUrl, label);
                queue.push(linkedUrl);
              }
            }
          } catch {
            console.warn(`Link contatti non valido su ${final.hostname}.`);
          }
        });
        for (const link of Object.values(social)) if (link) queue.push(link);
      } else {
        for (const platform of ["facebook", "instagram"]) {
          if (isHost(final.hostname, SOCIAL_HOSTS[platform]) && socialProfileKey(finalUrl, platform)) {
            values[`${platform}_url`] = finalUrl;
          }
        }
      }
      const previous = result;
      result = addEnrichment(result, values, finalUrl);
      for (const field of REQUIRED_FIELDS) {
        const wasMissing = field === "services" ? !(previous.services ?? []).length : !previous[field];
        const found = field === "services" ? (result.services ?? []).length : result[field];
        if (wasMissing && found) {
          enrichments.push({ field, value: result[field], source_url: finalUrl,
            attempt: enrichment_attempts, method: attempt });
        }
      }
    }
  }
  result.normalized_phone = normalizePhone(result.phone);
  result.website_domain = hostname(result.website);
  result.quality_score = getQualityScore(result);
  result.missing_fields = getMissingFields(result);
  return { candidate: result, failures, enrichments, enrichment_attempts,
    enrichment_successes: enrichments.length, linkedPolicySources: [...linkedPolicySources] };
}

async function reviewPendingCandidates(supabase, candidates, sources, options = {}) {
  const results = [];
  const enriched = [];
  for (const stored of candidates.filter((candidate) => candidate.status === "pending_review")) {
    enriched.push({ stored, ...(await enrichCandidate(stored, sources, options.fetchPage)) });
  }
  const comparisonCandidates = candidates.map((stored) =>
    enriched.find((entry) => entry.stored === stored)?.candidate ?? stored
  );
  for (const { stored, candidate, failures, enrichments, enrichment_attempts, enrichment_successes, linkedPolicySources } of enriched) {
    let status = "pending_review";
    let approval = null;
    const conflicts = comparisonCandidates.filter((other) =>
      other !== candidate && (!other.id || !stored.id || other.id !== stored.id) &&
      candidatesMatch(candidate, other)
    );
    const providerConflicts = (options.providers ?? []).map(providerToCandidate).filter((provider) =>
      candidatesMatch(candidate, provider)
    );
    if (conflicts.length) {
      failures.push(`Possibili duplicati tra candidati: ${conflicts.map((item) => item.name).join(", ")}`);
    }
    if (providerConflicts.length) {
      failures.push(`Possibili duplicati tra provider: ${providerConflicts.map((item) => item.name).join(", ")}`);
    }
    if (!options.dryRun) {
      const { data, error } = await supabase.from("animator_candidates").update({
        phone: candidate.phone,
        normalized_phone: candidate.normalized_phone,
        website: candidate.website,
        website_domain: candidate.website_domain,
        facebook_url: candidate.facebook_url,
        instagram_url: candidate.instagram_url,
        city: candidate.city,
        province: candidate.province,
        services: candidate.services,
        coverage_area: candidate.coverage_area,
        source_urls: candidate.source_urls,
        field_sources: candidate.field_sources,
        missing_fields: candidate.missing_fields,
        quality_score: candidate.quality_score,
        updated_at: new Date().toISOString()
      }).eq("id", stored.id).eq("status", "pending_review").select("id");
      if (error) throw new Error(`Aggiornamento candidato ${stored.name}: ${error.message}`);
      if (data?.length !== 1) throw new Error(`Candidato ${stored.name} modificato contemporaneamente.`);
      if (options.autoApprove && conflicts.length === 0 && providerConflicts.length === 0 &&
          isApprovalEligible(candidate, sources, linkedPolicySources)) {
        const response = await supabase.rpc("approve_animator_candidate", {
          p_candidate_id: stored.id, p_city: candidate.city, p_province: candidate.province
        });
        if (response.error) throw new Error(`Approvazione ${stored.name}: ${response.error.message}`);
        approval = Array.isArray(response.data) ? response.data[0] : response.data;
        if (!approval || !["approved", "duplicate", "manual_review"].includes(approval.status) ||
            (approval.status !== "manual_review" && !approval.provider_id) ||
            (approval.status === "manual_review" && (!Array.isArray(approval.matches) ||
              approval.matches.length < 2 || approval.matches.some((match) =>
                !match.provider_id || !match.provider_name || !Array.isArray(match.identities) ||
                !match.identities.length || match.identities.some((identity) => !identity.kind || !identity.value))))) {
          throw new Error(`Risposta RPC non valida per ${stored.name}.`);
        }
        status = approval.status;
        if (status === "approved") {
          const provider = await supabase.from("providers")
            .select("id,provider_kind,party_type").eq("id", approval.provider_id).maybeSingle();
          if (provider.error) throw new Error(`Verifica provider ${stored.name}: ${provider.error.message}`);
          if (!provider.data || provider.data.provider_kind !== "feste" || provider.data.party_type !== "animatore") {
            throw new Error(`Provider approvato non trovato o categoria non valida per ${stored.name}.`);
          }
        }
      }
    } else if (options.autoApprove && conflicts.length === 0 && providerConflicts.length === 0 &&
               isApprovalEligible(candidate, sources, linkedPolicySources)) {
      status = "eligible";
    }
    Object.assign(stored, candidate, {
      status: status === "approved" || status === "duplicate" ? status : "pending_review"
    });
    results.push({ candidate, status, approval, failures, enrichments,
      enrichment_attempts, enrichment_successes, linkedPolicySources });
  }
  return results;
}

async function saveCandidates(supabase, plan, storedCandidates) {
  const saved = [];
  for (const entry of plan) {
    const now = new Date().toISOString();
    if (entry.action === "update") {
      const { stored, candidate: merged } = entry;
      const { data, error } = await supabase
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
        .eq("status", "pending_review")
        .select("id");

      if (error) throw new Error(`Aggiornamento candidato ${stored.name}: ${error.message}`);
      if (data?.length !== 1) throw new Error(`Candidato ${stored.name} modificato contemporaneamente.`);
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

function createReport(candidates, statistics, reviews = [], sources = []) {
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
    ),
    "",
    "## Revisione candidati",
    "",
    "| Candidato | Esito | Punteggio | Tentativi | Successi | Dati mancanti | Note |",
    "|---|---|---:|---:|---:|---|---|",
    ...reviews.map(({ candidate, status, approval, failures, linkedPolicySources, enrichment_attempts, enrichment_successes }) =>
      `| ${escapeMarkdown(candidate.name)} | ${status} | ${candidate.quality_score} | ` +
      `${enrichment_attempts} | ${enrichment_successes} | ` +
      `${escapeMarkdown(candidate.missing_fields.join(", ") || "nessuno")} | ` +
      `${escapeMarkdown([
        approval?.provider_id && `Provider: ${approval.provider_id}`,
        approval?.status === "manual_review" && JSON.stringify(approval.matches),
        !isApprovalEligible(candidate, sources, linkedPolicySources) &&
          "Provincia, contatti o fonti non validi per l'approvazione",
        ...failures
      ].filter(Boolean).join("; ") || "-")} |`
    ),
    "",
    `- Approvati: ${reviews.filter((review) => review.status === "approved").length}`,
    `- Duplicati: ${reviews.filter((review) => review.status === "duplicate").length}`,
    `- Revisione manuale (ancora pending_review): ${reviews.filter((review) => review.status === "manual_review").length}`,
    `- Pending_review: ${reviews.filter((review) => ["pending_review", "manual_review"].includes(review.status)).length}`,
    `- Idonei in dry run: ${reviews.filter((review) => review.status === "eligible").length}`,
    `- enrichment_attempts: ${reviews.reduce((sum, review) => sum + review.enrichment_attempts, 0)}`,
    `- enrichment_successes: ${reviews.reduce((sum, review) => sum + review.enrichment_successes, 0)}`,
    "",
    "## Campi arricchiti",
    "",
    "| Candidato | Campo | Valore | URL sorgente | Tentativo |",
    "|---|---|---|---|---|",
    ...reviews.flatMap(({ candidate, enrichments }) => enrichments.map((entry) =>
      `| ${escapeMarkdown(candidate.name)} | ${escapeMarkdown(entry.field)} | ` +
      `${escapeMarkdown(Array.isArray(entry.value) ? entry.value.join(", ") : entry.value)} | ` +
      `${escapeMarkdown(entry.source_url)} | ${entry.attempt}: ${escapeMarkdown(entry.method)} |`
    )),
    "",
    ...statistics.searchErrors.map((error) => `- Errore fonte: ${escapeMarkdown(error)}`)
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
  const allSources = await loadSourceUrls();
  const sourceUrls = sourceUrlFilter ? await loadSourceUrls(sourceUrlFilter) : allSources;
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const autoApprove = process.env.ANIMATOR_AUTO_APPROVE === "true";
  if (!dryRun && !stagingUrl(supabaseUrl)) {
    throw new Error("Discovery con scrittura consentita solo sul progetto staging eqonpqgazhmjbrjtexmg.");
  }
  if (autoApprove && !stagingUrl(supabaseUrl)) {
    throw new Error("Approvazione automatica consentita solo sul progetto staging eqonpqgazhmjbrjtexmg.");
  }
  const supabase = createClient(
    supabaseUrl,
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
    "id,name,phone,website,social_url"
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
    if (!dryRun || error.code !== "PGRST205") throw error;
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

  const pendingForReview = dryRun
    ? [
      ...storedCandidates.map((stored) =>
        plan.find((entry) => entry.action === "update" && entry.stored.id === stored.id)?.candidate ?? stored),
      ...plan.filter((entry) => entry.action === "insert").map((entry) => entry.candidate)
    ]
    : await loadAll(supabase, "animator_candidates",
      "id,name,normalized_name,phone,normalized_phone,website,website_domain," +
      "facebook_url,instagram_url,city,province,services,coverage_area,source_urls," +
      "field_sources,missing_fields,quality_score,discovery_locations," +
      "discovery_run_id,status,approved_provider_id");
  const reviews = await reviewPendingCandidates(supabase, pendingForReview, allSources, {
    dryRun, autoApprove, providers
  });
  const newCandidates = plan
    .filter(({ action }) => action === "insert")
    .map(({ candidate }) => candidate);
  const report = createReport(newCandidates, {
    sourcesAnalyzed: sourceUrls.length - searchErrors.length,
    rawCandidates: discovered.length,
    internalDuplicates: discovered.length - candidates.length,
    providerDuplicates,
    searchErrors
  }, reviews, allSources);
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

export { addEnrichment, candidatesMatch, createReport, enrichCandidate, fetchPublicHtml, getQualityScore, isApprovalEligible, reviewPendingCandidates, stagingUrl };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Discovery Animatori fallita: ${error.message}`);
    process.exitCode = 1;
  });
}
