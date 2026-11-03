
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import { collectTeatroDanteEvents } from "./teatrodante-parser.mjs";
import { collectBibliotecheFirenzeEvents } from "./biblioteche-firenze-parser.mjs";
import { collectMuseoGalileoEvents } from "./museo-galileo-parser.mjs";
import { extractPalazzoLeggendaEvents } from "./palazzo-leggenda-parser.mjs";
import { classifyBookingText } from "./event-booking-classifier.mjs";
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

function absoluteHttpUrl(value, baseUrl) {
  if (typeof value !== "string" || !value.trim()) return null;
  const url = absoluteUrl(value, baseUrl);
  if (!url) return null;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol) ? url : null;
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

function entityName(value) {
  const entity = firstValue(value);
  if (typeof entity === "string") return compact(entity, 300) || null;
  return compact(entity?.name || "", 300) || null;
}

function contactValue(...values) {
  const value = values.find((item) => typeof item === "string" && item.trim());
  return value ? compact(value, 500) || null : null;
}

function validEmail(value) {
  const email = contactValue(value);
  return email &&
    /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z]{2,})+$/i.test(email)
    ? email
    : null;
}

function validPhone(value) {
  const phone = contactValue(value);
  const digits = phone?.replace(/\D/g, "") || "";
  return digits.length >= 8 && digits.length <= 15 ? phone : null;
}

function imageUrl(image, baseUrl) {
  const value = firstValue(image);
  if (typeof value === "string") return absoluteUrl(value, baseUrl);
  if (value && typeof value === "object") return absoluteUrl(value.url || value.contentUrl, baseUrl);
  return null;
}

function locationData(location) {
  const item = firstValue(location);
  if (!item) {
    return {
      city: null,
      venue: null,
      address: null,
      street_address: null,
      street_number: null,
      postal_code: null,
      province: null
    };
  }
  if (typeof item === "string") {
    const rawAddress = compact(item, 500);
    const parsedAddress = rawAddress.match(/^(.*?)[,\s]+(\d{5})\s+([^,]+)$/);
    const splitAddress = splitStreetAddress(parsedAddress?.[1] || rawAddress);
    const streetAddress = splitAddress.street_address;
    const streetNumber = splitAddress.street_number;
    return {
      city: compact(parsedAddress?.[3] || "", 150) || null,
      venue: rawAddress,
      address: rawAddress,
      street_address: streetAddress,
      street_number: streetNumber,
      postal_code: parsedAddress?.[2] || null,
      province: null
    };
  }

  const place = firstValue(item.location) || item;
  const address = firstValue(place.address || item.address);
  const addressText = typeof address === "string" ? compact(address, 500) : null;
  const parsedAddress = addressText?.match(/^(.*?)[,\s]+(\d{5})\s+([^,]+)$/);
  const city = compact(
    address?.addressLocality ||
    place.addressLocality ||
    item.addressLocality ||
    parsedAddress?.[3] ||
    "",
    150
  ) || null;
  const postalCode = compact(
    address?.postalCode ||
    place.postalCode ||
    item.postalCode ||
    parsedAddress?.[2] ||
    "",
    30
  ) || null;
  const streetAddress = compact(
    address?.streetAddress ||
    place.streetAddress ||
    item.streetAddress ||
    parsedAddress?.[1] ||
    addressText ||
    "",
    300
  ) || null;
  const streetNumber = compact(
    address?.streetNumber ||
    address?.street_number ||
    place.streetNumber ||
    place.street_number ||
    item.streetNumber ||
    item.street_number ||
    "",
    30
  ) || null;
  const splitAddress = splitStreetAddress(streetAddress, streetNumber);
  const province = compact(
    address?.addressRegion ||
    place.addressRegion ||
    item.addressRegion ||
    "",
    100
  ) || null;
  const numberMatch = streetAddress?.match(/(?:^|\s)(\d+[a-zA-Z]?(?:\/\d+[a-zA-Z]?)?)$/);
  const fullAddress = [
    splitAddress.street_address,
    splitAddress.street_number && splitAddress.street_address &&
      !splitAddress.street_address.endsWith(` ${splitAddress.street_number}`)
      ? splitAddress.street_number
      : "",
    postalCode,
    city,
    province
  ].filter(Boolean).join(", ");

  return {
    city,
    venue: compact(place.name || item.name || "", 300) || null,
    address: compact(fullAddress, 500) || null,
    street_address: splitAddress.street_address,
    street_number: splitAddress.street_number || numberMatch?.[1] || null,
    postal_code: postalCode,
    province
  };
}

function splitStreetAddress(value, explicitNumber = null) {
  const streetAddress = compact(value || "", 300) || null;
  if (!streetAddress) return { street_address: null, street_number: null };

  const trailingNumber = streetAddress.match(
    /(?:,\s*|\s+)(\d+[a-zA-Z]?(?:\/[0-9a-zA-Z]+)?)$/
  );
  const number = compact(explicitNumber || trailingNumber?.[1] || "", 30) || null;
  const normalizedStreet = trailingNumber &&
    (!explicitNumber || explicitNumber === trailingNumber[1])
    ? streetAddress.slice(0, trailingNumber.index).trim()
    : streetAddress;

  return {
    street_address: normalizedStreet || streetAddress,
    street_number: number
  };
}

function locationCoordinates(location) {
  const item = firstValue(location);
  const place = firstValue(item?.location) || item;
  const geo = firstValue(place?.geo || place?.location?.geo || item?.geo);
  const latitude = geo?.latitude == null ? NaN : Number(geo.latitude);
  const longitude = geo?.longitude == null ? NaN : Number(geo.longitude);
  return {
    latitude: Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : null,
    longitude: Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? longitude : null
  };
}

function firstText(...values) {
  const value = values.find((item) => typeof item === "string" && item.trim());
  return value ? compact(value, 500) || null : null;
}

function metaContent($, selectors) {
  for (const selector of selectors) {
    const value = $(selector).first().attr("content") ||
      $(selector).first().attr("value") ||
      $(selector).first().text();
    if (value?.trim()) return compact(value, 500);
  }
  return null;
}

function itempropValue($, property, scope = null) {
  const root = scope?.length ? scope : $("body");
  const selector = `[itemprop="${property}"]`;
  const element = root.find(selector).add(root.filter(selector)).first();
  const value = element.attr("content") ||
    element.attr("value") ||
    element.attr("datetime") ||
    element.attr("href") ||
    element.attr("data-value") ||
    element.text();
  return compact(value || "", 500) || null;
}

function resolveJsonLdReference(value, nodes) {
  const entity = firstValue(value);
  return resolveJsonLdEntity(entity, nodes, 0);
}

function resolveJsonLdEntity(entity, nodes, depth) {
  if (!entity || typeof entity !== "object" || depth > 4) return entity;
  const referenced = entity["@id"]
    ? nodes.find((node) => node["@id"] === entity["@id"])
    : null;
  const resolved = referenced ? { ...entity, ...referenced } : { ...entity };
  for (const key of ["location", "address", "geo", "organizer", "contactPoint", "offers"]) {
    if (!resolved[key]) continue;
    resolved[key] = Array.isArray(resolved[key])
      ? resolved[key].map((value) => resolveJsonLdEntity(value, nodes, depth + 1))
      : resolveJsonLdEntity(resolved[key], nodes, depth + 1);
  }
  return resolved;
}

function extractPageEnrichment(html, pageUrl) {
  const $ = cheerio.load(html || "");
  const jsonLdNodes = [];
  $('script[type="application/ld+json"]').each((_, script) => {
    try {
      jsonLdNodes.push(...flattenJsonLd(JSON.parse($(script).text())));
    } catch {
      // Ignore malformed structured data while continuing to inspect page metadata.
    }
  });
  const eventNode = jsonLdNodes.find(isEventNode) || {};
  const organizer = resolveJsonLdReference(eventNode.organizer, jsonLdNodes);
  const placeNode = jsonLdNodes.find((node) =>
    (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]])
      .some((type) => /(?:^|\/)Place$/i.test(String(type || "")))
  );
  const postalAddressNode = jsonLdNodes.find((node) =>
    (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]])
      .some((type) => /PostalAddress$/i.test(String(type || "")))
  );
  const place = resolveJsonLdReference(
    eventNode.location || placeNode || postalAddressNode,
    jsonLdNodes
  );
  const microdataEvent = $("[itemtype]").filter((_, element) =>
    /(?:^|\s)(?:https?:\/\/schema\.org\/)?[A-Za-z]*Event\b/i.test(
      $(element).attr("itemtype") || ""
    )
  ).first();
  const microdataLocation = microdataEvent.find(
    '[itemprop="location"], [itemtype*="Place"]'
  ).first();
  const microdataAddress = microdataLocation.find(
    '[itemprop="address"], [itemtype*="PostalAddress"]'
  ).first();
  const microdataPropertyScope = microdataAddress.length
    ? microdataAddress
    : microdataLocation.length
      ? microdataLocation
      : microdataEvent;
  const contactPoint = resolveJsonLdReference(
    organizer?.contactPoint ||
      eventNode.contactPoint ||
      jsonLdNodes.find((node) =>
        (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]])
          .some((type) => /contactpoint/i.test(String(type || "")))
      ),
    jsonLdNodes
  );
  const microdataContactScope = microdataEvent.length ? microdataEvent : $("body");
  const offer = resolveJsonLdReference(eventNode.offers, jsonLdNodes);
  const offerUrl = offer?.url || offer?.offers?.url;
  const addressData = locationData(place);
  const microdataAddressData = locationData({
    name: $("[itemprop='location'] [itemprop='name']").first().text(),
    address: {
      streetAddress: itempropValue($, "streetAddress", microdataPropertyScope),
      streetNumber: itempropValue($, "streetNumber", microdataPropertyScope) ||
        itempropValue($, "street_number", microdataPropertyScope),
      postalCode: itempropValue($, "postalCode", microdataPropertyScope),
      addressLocality: itempropValue($, "addressLocality", microdataPropertyScope),
      addressRegion: itempropValue($, "addressRegion", microdataPropertyScope)
    },
    geo: {
      latitude: itempropValue($, "latitude", microdataLocation.length ? microdataLocation : microdataEvent),
      longitude: itempropValue($, "longitude", microdataLocation.length ? microdataLocation : microdataEvent)
    }
  });
  const microdataAddressTextData = locationData(
    itempropValue($, "address", microdataLocation.length ? microdataLocation : microdataEvent)
  );
  const pageContentRoot = $("main, article").first();
  const pageContent = pageContentRoot.length ? pageContentRoot : $("body");
  const pageAddressText = pageContent.find("address, [itemprop='address'], [class*='address' i], [class*='venue' i], .field--type-address p, .card-place .card-text")
    .add(pageContent.filter("address, [itemprop='address'], [class*='address' i], [class*='venue' i], .field--type-address p, .card-place .card-text"))
    .map((_, element) => compact($(element).text(), 500))
    .get()
    .find((value) => value && value.length <= 500) || null;
  const pageAddressData = locationData(pageAddressText);
  const coordinates = locationCoordinates(place);
  const phoneLink = $('a[href^="tel:"]').map((_, link) => $(link).attr("href").slice(4)).get()[0];
  const emailLink = $('a[href^="mailto:"]').map((_, link) => $(link).attr("href").slice(7).split("?")[0]).get()[0];
  const contactText = pageContent.find("address, [itemprop='contactPoint'], [class*='contact' i], [id*='contact' i]")
    .add(pageContent.filter("address, [itemprop='contactPoint'], [class*='contact' i], [id*='contact' i]"))
    .map((_, element) => $(element).text())
    .get()
    .join(" ");
  const contentText = compact(pageContent.text(), 16000);
  const phoneFromContactText = contactText.match(
    /(?:\+|00)?39[\s().-]*[03](?:[\s().-]*\d){7,10}|(?:\+|00)?[03](?:[\s().-]*\d){8,10}/
  )?.[0] || contentText.match(
    /(?:\+|00)?39[\s().-]*[03](?:[\s().-]*\d){7,10}|(?:\+|00)?[03](?:[\s().-]*\d){8,10}/
  )?.[0];
  const emailSearchText = phoneFromContactText
    ? contactText.replace(phoneFromContactText, " ")
    : contactText;
  const pageEmailSearchText = phoneFromContactText
    ? contentText.replace(phoneFromContactText, " ")
    : contentText;
  const emailFromContactText = emailSearchText.match(
    /(?:^|[^A-Z0-9.!#$%&'*+/=?^_`{|}~-])([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z]{2,})+)/i
  )?.[1];
  const emailFromPageText = pageEmailSearchText.match(
    /(?:^|[^A-Z0-9.!#$%&'*+/=?^_`{|}~-])([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z]{2,})+)/i
  )?.[1];
  const bookingLink = $("a[href]").toArray().find((link) => {
    const href = $(link).attr("href") || "";
    const label = compact(
      `${$(link).text()} ${$(link).attr("aria-label") || ""} ${href}`,
      1000
    );
    return /prenot|booking|bigliett|ticket|acquist|iscrizion/i.test(label) &&
      !/^(?:mailto:|tel:|javascript:)/i.test(href);
  });
  const bookingUrl = bookingLink
    ? absoluteHttpUrl($(bookingLink).attr("href"), pageUrl)
    : null;
  const streetAddress = firstText(
    addressData.street_address,
    microdataAddressData.street_address,
    microdataAddressTextData.street_address,
    metaContent($, [
      'meta[itemprop="streetAddress"]',
      'meta[property="place:location:street_address"]',
      'meta[name="street-address"]',
      'meta[name="address"]'
    ]),
    itempropValue($, "streetAddress", microdataPropertyScope),
    pageAddressData.street_address,
    $("address").first().text(),
    $(".street-address").first().text()
  );
  const streetNumber = firstText(
    addressData.street_number,
    microdataAddressData.street_number,
    microdataAddressTextData.street_number,
    metaContent($, [
      'meta[itemprop="streetNumber"]',
      'meta[itemprop="street_number"]',
      'meta[name="street-number"]',
      'meta[name="house-number"]'
    ]),
    itempropValue($, "streetNumber", microdataPropertyScope),
    itempropValue($, "street_number", microdataPropertyScope),
    pageAddressData.street_number
  );
  const postalCode = firstText(
    addressData.postal_code,
    microdataAddressData.postal_code,
    microdataAddressTextData.postal_code,
    metaContent($, [
      'meta[itemprop="postalCode"]',
      'meta[name="postal-code"]',
      'meta[property="place:location:zip"]'
    ]),
    itempropValue($, "postalCode", microdataPropertyScope),
    pageAddressData.postal_code
  );
  const city = firstText(
    addressData.city,
    microdataAddressData.city,
    microdataAddressTextData.city,
    metaContent($, [
      'meta[itemprop="addressLocality"]',
      'meta[name="locality"]',
      'meta[property="place:location:locality"]'
    ]),
    itempropValue($, "addressLocality", microdataPropertyScope),
    pageAddressData.city
  );
  const province = firstText(
    addressData.province,
    microdataAddressData.province,
    microdataAddressTextData.province,
    metaContent($, [
      'meta[itemprop="addressRegion"]',
      'meta[name="region"]',
      'meta[property="place:location:region"]'
    ]),
    itempropValue($, "addressRegion", microdataPropertyScope),
    pageAddressData.province
  );
  const locationAddress = [
    streetAddress,
    streetNumber && streetAddress &&
      !new RegExp(`(?:^|\\s)${streetNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).test(streetAddress)
      ? streetNumber
      : "",
    postalCode,
    city,
    province
  ].filter(Boolean).join(", ");
  const geoPosition = metaContent($, [
    'meta[name="geo.position"]',
    'meta[name="ICBM"]'
  ]);
  const geoParts = geoPosition?.split(/[;,]\s*/) || [];
  const latitudeValue = metaContent($, [
    'meta[itemprop="latitude"]',
    'meta[property="place:location:latitude"]',
    'meta[property="og:latitude"]'
  ]) || itempropValue($, "latitude", microdataLocation.length ? microdataLocation : microdataEvent) || geoParts[0];
  const longitudeValue = metaContent($, [
    'meta[itemprop="longitude"]',
    'meta[property="place:location:longitude"]',
    'meta[property="og:longitude"]'
  ]) || itempropValue($, "longitude", microdataLocation.length ? microdataLocation : microdataEvent) || geoParts[1];
  const latitude = coordinates.latitude ?? microdataAddressData.latitude ?? Number(latitudeValue);
  const longitude = coordinates.longitude ?? microdataAddressData.longitude ?? Number(longitudeValue);
  const numberMatch = streetAddress?.match(/(?:^|\s)(\d+[a-zA-Z]?(?:\/\d+[a-zA-Z]?)?)$/);
  const canonicalUrl = $("link[rel='canonical']").first().attr("href");
  const ogUrl = metaContent($, [
    'meta[property="og:url"]',
    'meta[property="og:see_also"]'
  ]);
  const bookingMetadata = eventNode.bookingRequired ??
    itempropValue($, "bookingRequired") ??
    metaContent($, ['meta[name="booking-required"]', 'meta[property="event:booking_required"]']);
  const metadataRequiresBooking = bookingMetadata === true ||
    /^(?:true|required|obbligator\w*|richiest\w*)$/i.test(String(bookingMetadata || "").trim());
  const metadataDoesNotRequireBooking = bookingMetadata === false ||
    /^(?:false|optional|not required|non obbligator\w*|non richiest\w*)$/i.test(String(bookingMetadata || "").trim());
  const bookingClassification = classifyBookingText(contentText);
  const metadataBookingRequired = metadataRequiresBooking
    ? true
    : metadataDoesNotRequireBooking
      ? false
      : null;
  const bookingEvidenceConflicts = metadataBookingRequired !== null &&
    bookingClassification.booking_required !== null &&
    metadataBookingRequired !== bookingClassification.booking_required;
  const bookingRequired = bookingEvidenceConflicts
    ? null
    : bookingClassification.booking_required ?? metadataBookingRequired;
  const bookingNotes = bookingClassification.booking_notes ||
    (metadataBookingRequired === true
      ? "La pagina indica che la prenotazione è obbligatoria."
      : metadataBookingRequired === false
        ? "La pagina indica che la prenotazione non è obbligatoria."
        : null);

  return {
    organizer: entityName(organizer) ||
      entityName(contactPoint) ||
      metaContent($, [
        'meta[itemprop="organizer"]',
        'meta[name="organizer"]'
      ]) ||
      itempropValue($, "organizer", microdataContactScope) ||
      null,
    phone: validPhone(contactValue(
      eventNode.telephone,
      contactPoint?.telephone,
      organizer?.telephone,
      itempropValue($, "telephone", microdataContactScope),
      phoneLink,
      metaContent($, ['meta[property="og:phone_number"]']),
      phoneFromContactText
    )),
    email: validEmail(contactValue(
      eventNode.email,
      contactPoint?.email,
      organizer?.email,
      itempropValue($, "email", microdataContactScope),
      emailLink,
      metaContent($, ['meta[property="og:email"]']),
      emailFromContactText,
      emailFromPageText
    )),
    booking_url: (offerUrl && absoluteHttpUrl(offerUrl, pageUrl)) ||
      absoluteHttpUrl(bookingUrl, pageUrl),
    booking_required: bookingRequired,
    booking_notes: bookingNotes || (bookingUrl ? "Prenotazione online disponibile" : null),
    official_url: [
      eventNode.url,
      organizer?.url,
      canonicalUrl,
      ogUrl,
      pageUrl
    ].map((candidate) => absoluteHttpUrl(candidate, pageUrl)).find(Boolean) || null,
    address: addressData.address || locationAddress || streetAddress || null,
    street_address: addressData.street_address || streetAddress,
    street_number: streetNumber || addressData.street_number || numberMatch?.[1] || null,
    postal_code: postalCode,
    city,
    province,
    latitude: Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : null,
    longitude: Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? longitude : null
  };
}

function mergePageEnrichment(event, rawEnrichment, pageUrl, { sharedPage = false } = {}) {
  // A page listing several events describes none of them in particular:
  // its booking text must not be copied onto each event.
  const enrichment = sharedPage
    ? { ...rawEnrichment, booking_required: null, booking_notes: null }
    : rawEnrichment;
  const parsedEventAddress = locationData(event.address);
  const streetAddress = event.street_address ||
    enrichment.street_address ||
    parsedEventAddress.street_address;
  const streetNumber = event.street_number ||
    enrichment.street_number ||
    parsedEventAddress.street_number;
  const splitAddress = splitStreetAddress(streetAddress, streetNumber);
  return {
    ...event,
    _page_enriched: true,
    organizer: event.organizer || enrichment.organizer,
    phone: validPhone(event.phone) || enrichment.phone,
    email: validEmail(event.email) || enrichment.email,
    booking_url: absoluteHttpUrl(event.booking_url, pageUrl) || enrichment.booking_url,
    booking_required: event.booking_required ?? enrichment.booking_required,
    booking_notes: !event.booking_notes ||
      /^prenotazione online disponibile$/i.test(event.booking_notes.trim())
      ? enrichment.booking_notes || event.booking_notes
      : event.booking_notes,
    official_url: [
      event.official_url,
      enrichment.official_url,
      event.source_url
    ].map((candidate) => absoluteHttpUrl(candidate, pageUrl)).find(Boolean) || null,
    address: event.address || enrichment.address,
    street_address: splitAddress.street_address,
    street_number: splitAddress.street_number,
    postal_code: event.postal_code || enrichment.postal_code,
    city: enrichment.city || event.city,
    province: event.province || enrichment.province,
    latitude: event.latitude ?? enrichment.latitude,
    longitude: event.longitude ?? enrichment.longitude
  };
}

function enrichEventFromPage(event, html, pageUrl, options) {
  return mergePageEnrichment(
    event,
    extractPageEnrichment(html, pageUrl),
    pageUrl,
    options
  );
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
  const coordinates = locationCoordinates(node.location);
  const city = loc.city || source.comune || null;
  const mainEntityUrl = typeof node.mainEntityOfPage === "string"
    ? node.mainEntityOfPage
    : node.mainEntityOfPage?.url || node.mainEntityOfPage?.["@id"];
  const sourceUrl = [
    node.url,
    mainEntityUrl,
    pageUrl
  ].map((candidate) => absoluteHttpUrl(candidate, pageUrl)).find(Boolean) || pageUrl;
  const organizer = firstValue(node.organizer);
  const contactPoint = firstValue(organizer?.contactPoint || node.contactPoint);
  const offer = firstValue(node.offers);
  const offerUrl = offer?.url || offer?.offers?.url;

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
    street_address: loc.street_address,
    street_number: loc.street_number,
    postal_code: loc.postal_code,
    province: loc.province,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    source_name: source.name,
    organizer: entityName(organizer),
    phone: validPhone(contactValue(node.telephone, contactPoint?.telephone, organizer?.telephone)),
    email: validEmail(contactValue(node.email, contactPoint?.email, organizer?.email)),
    booking_url: offerUrl ? absoluteHttpUrl(offerUrl, pageUrl) : null,
    booking_required: null,
    booking_notes: null,
    website_url: organizer?.url ? absoluteUrl(organizer.url, pageUrl) : null,
    official_url: absoluteHttpUrl(sourceUrl, pageUrl)
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
    street_address: compact(venue.address || "", 300) || null,
    street_number: String(venue.address || "").match(/(?:^|\s)(\d+[a-zA-Z]?(?:\/\d+[a-zA-Z]?)?)$/)?.[1] || null,
    postal_code: compact(venue.zip || "", 30) || null,
    latitude: venue.geo_lat ? Number(venue.geo_lat) : null,
    longitude: venue.geo_lng ? Number(venue.geo_lng) : null,
    organizer: compact(item.organizer?.organizer || item.organizer?.name || "", 300) || null,
    phone: contactValue(venue.phone, item.organizer?.phone),
    email: contactValue(item.organizer?.email),
    official_url: absoluteHttpUrl(item.url || item.website || source.url, source.url),
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

async function collectWordPressMecEvents(source) {
  const baseUrl = new URL(source.url).origin;

  const maxPages = Number(
    process.env.MAX_WORDPRESS_MEC_PAGES || 3
  );

  const byKey = new Map();

  const monthNumbers = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12"
  };

  for (
    let pageNumber = 1;
    pageNumber <= maxPages;
    pageNumber += 1
  ) {
    const apiUrl =
      baseUrl +
      "/wp-json/wp/v2/mec-events" +
      "?per_page=100" +
      "&page=" +
      pageNumber +
      "&status=publish" +
      "&orderby=date" +
      "&order=desc" +
      "&_embed=1";

    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json"
      }
    });

    if (response.status === 400) {
      break;
    }

    if (!response.ok) {
      throw new Error(
        "WordPress MEC API HTTP " +
          response.status
      );
    }

    const posts = await response.json();

    if (!Array.isArray(posts)) {
      throw new Error(
        "Risposta WordPress MEC non valida"
      );
    }

    console.log(
      "  WordPress MEC page " +
        pageNumber +
        ": " +
        posts.length +
        " events"
    );

    if (posts.length === 0) {
      break;
    }

    for (const post of posts) {
      const title = compact(
        post.title?.rendered || "",
        300
      );

      const postUrl = post.link || "";

      if (!title || !postUrl) {
        continue;
      }

      let detailHtml;

      try {
        await sleep(200);
        detailHtml = await fetchText(postUrl);
      } catch (error) {
        console.warn(
          "  MEC detail skip " +
            postUrl +
            ": " +
            error.message
        );

        continue;
      }

      const $ = cheerio.load(detailHtml);

      const countdown = $(
        "[data-datetime]"
      ).first();

      const dateTimeText = compact(
        countdown.attr("data-datetime") || "",
        200
      );

      const offsetText = compact(
        countdown.attr("data-gmt_offset") || "",
        100
      );

      /*
       * Esempio MEC:
       * Tue Dec 22 2026 17:00:00
       */
      let dateMatch = dateTimeText.match(
        /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/i
      );

      /*
       * Fallback MEC sicuro.
       *
       * Non analizza l'intero body della pagina, perché potrebbe
       * contenere date di menu, calendari o altri eventi.
       *
       * Accetta una data soltanto quando:
       * 1. si trova vicino al titolo specifico dell'evento; oppure
       * 2. nel contenuto del singolo post esiste una sola data distinta.
       */
      if (!dateMatch) {
        const contentHtml =
          post.content?.rendered ||
          post.excerpt?.rendered ||
          "";

        const content$ = cheerio.load(
          "<div id=\"mec-safe-content\">" +
            contentHtml +
            "</div>"
        );

        const contentText = compact(
          content$("#mec-safe-content").text(),
          20000
        );

        const italianMonths = {
          gennaio: "Jan",
          febbraio: "Feb",
          marzo: "Mar",
          aprile: "Apr",
          maggio: "May",
          giugno: "Jun",
          luglio: "Jul",
          agosto: "Aug",
          settembre: "Sep",
          ottobre: "Oct",
          novembre: "Nov",
          dicembre: "Dec"
        };

        const datePattern =
          /(?:lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica)?\s*(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?/i;

        const normalizedTitle = normalizeSearchText(
          title
            .replace(/^[^–—:-]+[–—:-]\s*/, "")
            .replace(/\([^)]*\)/g, "")
        );

        const titleWords = normalizedTitle
          .split(/\s+/)
          .filter((word) => word.length >= 4)
          .slice(0, 6);

        let selectedText = "";

        content$(
          "#mec-safe-content h1, " +
          "#mec-safe-content h2, " +
          "#mec-safe-content h3, " +
          "#mec-safe-content h4, " +
          "#mec-safe-content h5, " +
          "#mec-safe-content h6, " +
          "#mec-safe-content p, " +
          "#mec-safe-content li"
        ).each((_, element) => {
          if (selectedText) {
            return;
          }

          const elementText = compact(
            content$(element).text(),
            2000
          );

          const normalizedElement =
            normalizeSearchText(elementText);

          const matchingWords = titleWords.filter(
            (word) =>
              normalizedElement.includes(word)
          );

          if (
            datePattern.test(elementText) &&
            (
              matchingWords.length >= 2 ||
              (
                titleWords.length === 1 &&
                matchingWords.length === 1
              )
            )
          ) {
            selectedText = elementText;
          }
        });

        /*
         * Se non trova una data vicino al titolo, accetta il fallback
         * soltanto quando il contenuto contiene una sola data distinta.
         */
        if (!selectedText) {
          const globalDatePattern =
            /(?:lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica)?\s*(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?/gi;

          const uniqueDates = new Map();

          for (
            const match of contentText.matchAll(
              globalDatePattern
            )
          ) {
            const key =
              String(Number(match[1])) +
              "-" +
              match[2].toLowerCase() +
              "-" +
              String(match[3] || "");

            if (!uniqueDates.has(key)) {
              uniqueDates.set(key, match[0]);
            }
          }

          if (uniqueDates.size === 1) {
            selectedText =
              [...uniqueDates.values()][0] +
              " " +
              contentText;
          }
        }

        const italianDateMatch =
          selectedText.match(datePattern);

        if (italianDateMatch) {
          const publishedDate = new Date(
            post.date_gmt ||
            post.date ||
            Date.now()
          );

          const fallbackYear =
            italianDateMatch[3] ||
            String(
              publishedDate.getUTCFullYear()
            );

          /*
           * Cerca l'orario prima nel testo selezionato e poi nel
           * contenuto del post. Non utilizza il body della pagina.
           */
          const timeSource = compact(
            selectedText + " " + contentText,
            22000
          );

          const fallbackTimeMatch =
            timeSource.match(
              /(?:orario(?:\s+attivita|\s+attività)?\s*:?|dalle\s+ore|alle\s+ore|ore)\s*(\d{1,2})(?::|\.)?(\d{2})?/i
            );

          /*
           * Se manca l'orario, non inventa le 12:00.
           * L'evento viene ignorato per evitare dati imprecisi.
           */
          if (fallbackTimeMatch) {
            const fallbackHour = String(
              Number(fallbackTimeMatch[1])
            ).padStart(2, "0");

            const fallbackMinute = String(
              Number(
                fallbackTimeMatch[2] || 0
              )
            ).padStart(2, "0");

            dateMatch = [
              italianDateMatch[0],
              italianMonths[
                italianDateMatch[2].toLowerCase()
              ],
              italianDateMatch[1],
              fallbackYear,
              fallbackHour,
              fallbackMinute,
              "00"
            ];

            console.log(
              "  MEC safe fallback: " +
                title +
                " | " +
                dateMatch[2] +
                " " +
                dateMatch[1] +
                " " +
                dateMatch[3] +
                " " +
                dateMatch[4] +
                ":" +
                dateMatch[5]
            );
          }
        }
      }

      if (!dateMatch) {
        console.warn(
          "  MEC date not found safely: " +
            title
        );

        continue;
      }

      const month =
        monthNumbers[
          dateMatch[1].toLowerCase()
        ];

      const day = String(
        Number(dateMatch[2])
      ).padStart(2, "0");

      const year = dateMatch[3];

      const hour = String(
        Number(dateMatch[4])
      ).padStart(2, "0");

      const minute = dateMatch[5];
      const second = dateMatch[6];

      const offsetMatch = offsetText.match(
        /([+-]\d{2}:\d{2})/
      );

      const timezoneOffset =
        offsetMatch?.[1] || "+01:00";

      const startsOn = validDate(
        year +
          "-" +
          month +
          "-" +
          day +
          "T" +
          hour +
          ":" +
          minute +
          ":" +
          second +
          timezoneOffset
      );

      if (!startsOn) {
        continue;
      }

      /*
       * Cerca un intervallo come:
       * 17:00 - 18:30
       */
      const timeRangeText = compact(
        $(".mec-events-abbr")
          .first()
          .text() ||
          $("body").text(),
        12000
      );

      const endTimeMatch =
        timeRangeText.match(
          /\b\d{1,2}:\d{2}\s*[-–]\s*(\d{1,2}):(\d{2})\b/
        );

      let endsOn = null;

      if (endTimeMatch) {
        const endHour = String(
          Number(endTimeMatch[1])
        ).padStart(2, "0");

        const endMinute =
          endTimeMatch[2];

        endsOn = validDate(
          year +
            "-" +
            month +
            "-" +
            day +
            "T" +
            endHour +
            ":" +
            endMinute +
            ":00" +
            timezoneOffset
        );
      }

      const contentHtml =
        post.content?.rendered ||
        post.excerpt?.rendered ||
        "";

      const description = compact(
        cheerio
          .load(
            "<div>" +
              contentHtml +
              "</div>"
          )("div")
          .text(),
        4000
      ) || null;

      const categories = Array.isArray(
        post.class_list
      )
        ? post.class_list.join(" ")
        : "";

      const locationMatch =
        description?.match(
          /(?:Luogo|Presso):\s*(.+?)(?=\s+(?:Ingresso|Costo|Orario|Prenotazione|Informazioni|$))/i
        );

      const location = compact(
        locationMatch?.[1] ||
          (
            /mmab/i.test(
              title +
                " " +
                description
            )
              ? "MMAB"
              : ""
          ),
        500
      ) || null;

      const media =
        post._embedded?.[
          "wp:featuredmedia"
        ]?.[0];

      const imageUrl =
        media?.source_url ||
        post.yoast_head_json
          ?.og_image?.[0]?.url ||
        null;

      const event = {
        title,
        city:
          source.comune ||
          "Montelupo Fiorentino",
        location,
        starts_on: startsOn,
        ends_on: endsOn,
        description:
          compact(
            [
              description,
              categories
            ]
              .filter(Boolean)
              .join(" "),
            4000
          ) || null,
        source_url: postUrl,
        image_url: imageUrl,
        address:
          /mmab/i.test(
            title +
              " " +
              description
          )
            ? "Piazza Vittorio Veneto 11, Montelupo Fiorentino"
            : null,
        source_name: source.name
      };

      event.import_key =
        eventKey(event);

      byKey.set(
        event.import_key,
        event
      );
    }

    if (posts.length < 100) {
      break;
    }

    await sleep(300);
  }

  console.log(
    "  WordPress MEC normalized events: " +
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
    ["wordpress-mec", "wordpress_mec", "wp-mec"].includes(
      String(source.type || "").toLowerCase()
    )
  ) {
    return await collectWordPressMecEvents(source);
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
      if (event) {
        byKey.set(
          event.import_key,
          enrichEventFromPage(event, page.html, page.url, {
            sharedPage: jsonLdNodes.length > 1
          })
        );
      }
    }

    const pratoEvent = extractPratoEvent(page.html, source, page.url);

    if (pratoEvent) {
      byKey.set(
        pratoEvent.import_key,
        enrichEventFromPage(pratoEvent, page.html, page.url)
      );
      continue;
    }

    const htmlEvent = extractHtmlEvent(page.html, source, page.url);
    if (htmlEvent) {
      byKey.set(
        htmlEvent.import_key,
        enrichEventFromPage(htmlEvent, page.html, page.url)
      );
    }
  }

  return [...byKey.values()];
}

async function findExistingEvent(event) {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("title", event.title)
    .eq("starts_on", event.starts_on)
    .limit(10);
  if (error) throw error;
  const matches = data || [];
  if (event.city) {
    return matches.find((item) => item.city === event.city) ||
      (matches.length === 1 && !matches[0].city ? matches[0] : null);
  }
  return matches.find((item) => !item.city) ||
    (matches.length === 1 ? matches[0] : null);
}

async function enrichExistingEvent(existing, event) {
  const patch = {};
  const values = {
    city: event.city,
    address: event.address,
    street_address: event.street_address,
    street_number: event.street_number,
    postal_code: event.postal_code,
    province: event.province,
    latitude: event.latitude,
    longitude: event.longitude,
    organizer: event.organizer,
    phone: event.phone,
    email: event.email,
    official_url: [
      event.official_url,
      event.source_url
    ].map((candidate) => absoluteHttpUrl(candidate, event.source_url)).find(Boolean) || null,
    booking_url: absoluteHttpUrl(event.booking_url, event.source_url),
    booking_required: event.booking_required,
    booking_notes: event.booking_notes
  };

  for (const [field, value] of Object.entries(values)) {
    const isPresent = typeof value === "number"
      ? Number.isFinite(value)
      : typeof value === "boolean"
        ? true
        : Boolean(value?.trim?.());
    const isEmpty = existing[field] == null || existing[field] === "";
    if (isPresent && isEmpty) patch[field] = value;
  }

  if (Object.keys(patch).length === 0) return false;
  const { error } = await supabase.from("events").update(patch).eq("id", existing.id);
  if (error) throw error;
  return true;
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
  address: event.address || null,
  street_address: event.street_address || null,
  street_number: event.street_number || null,
  postal_code: event.postal_code || null,
  province: event.province || null,
  latitude: event.latitude ?? null,
  longitude: event.longitude ?? null,
  organizer: event.organizer || null,
  phone: validPhone(event.phone),
  email: validEmail(event.email),
  booking_url: absoluteHttpUrl(event.booking_url, event.source_url),
  booking_required: event.booking_required ?? null,
  booking_notes: event.booking_notes || null,
  website_url: absoluteHttpUrl(event.website_url, event.source_url),
  official_url: [
    event.official_url,
    event.source_url
  ].map((candidate) => absoluteHttpUrl(candidate, event.source_url)).find(Boolean) || null,
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

async function reportEventEnrichment() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  const hasText = (value) => typeof value === "string" && Boolean(value.trim());
  const hasCoordinates = (event) => {
    const latitude = Number(event.latitude);
    const longitude = Number(event.longitude);
    return event.latitude !== null &&
      event.latitude !== undefined &&
      event.longitude !== null &&
      event.longitude !== undefined &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180;
  };
  const columns = new Set(Object.keys(rows[0] || {}));
  const countField = (field) => columns.has(field)
    ? rows.filter((event) => hasText(event[field])).length
    : null;
  const stats = {
    total: rows.length,
    address: countField("address"),
    street_number: countField("street_number"),
    postal_code: countField("postal_code"),
    city: countField("city"),
    province: countField("province"),
    latitude_longitude: columns.has("latitude") && columns.has("longitude")
      ? rows.filter(hasCoordinates).length
      : null,
    organizer: countField("organizer"),
    phone: countField("phone"),
    email: countField("email"),
    booking_url: countField("booking_url"),
    official_url: countField("official_url")
  };
  const exampleFields = [
    "address",
    "street_number",
    "postal_code",
    "city",
    "province",
    "latitude",
    "longitude",
    "organizer",
    "phone",
    "email",
    "booking_url",
    "official_url"
  ];
  const examples = rows
    .filter((event) => exampleFields.some((field) => hasText(event[field])))
    .slice(0, 10)
    .map((event) => Object.fromEntries([
      ["title", event.title],
      ...exampleFields
        .filter((field) => columns.has(field) && hasText(event[field]))
        .map((field) => [field, event[field]])
    ]));

  console.log("--- EVENT ENRICHMENT REPORT ---");
  for (const [field, count] of Object.entries(stats)) {
    console.log(`${field}: ${count ?? "unavailable (apply event enrichment migrations)"}`);
  }
  console.log("Examples:");
  for (const example of examples) console.log(JSON.stringify(example));
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

  /*
   * Queste parole descrivono soltanto il contesto.
   * Non possono rendere un evento SUPER FAMILY da sole.
   */
  const weakContextKeywords = new Set([
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
    "alieno",
    "drago",
    "nonni"
  ]);

  /*
   * Un'indicazione esplicita di eta rende l'evento family.
   * Esempi: 0-2 anni, 18-36 mesi, 4+, +5 anni,
   * da 5 a 10 anni, dai 7 agli 11 anni.
   */
  const hasFamilyAge =
    /\b\d{1,2}\s*[-–]\s*\d{1,2}\s*(?:anni|mesi)\b/i.test(text) ||
    /\b\d{1,2}\s*\+\s*(?:anni|mesi)?\b/i.test(text) ||
    /(?:^|\s)\+\s*\d{1,2}\s*(?:anni|mesi)?\b/i.test(text) ||
    /\b(?:da|dai|dagli)\s+\d{1,2}\s+(?:a|ai|agli)\s+\d{1,2}\s+(?:anni|mesi)\b/i.test(text) ||
    /\b(?:da|dai|dagli)\s+\d{1,2}\s*(?:anni|mesi)\b/i.test(text);

  if (hasFamilyAge) {
    return true;
  }

  return SUPER_FAMILY_KEYWORDS.some((keyword) => {
    const normalizedKeyword =
      normalizeSearchText(keyword);

    return (
      normalizedKeyword &&
      !weakContextKeywords.has(normalizedKeyword) &&
      text.includes(normalizedKeyword)
    );
  });
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
  "cineclub",
  "madame bovary",
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

  /*
   * Calcola subito SUPER FAMILY, prima delle esclusioni.
   * Le fasce d'eta come 0-2, 3-6, 4-7, 5-10,
   * 7-9, +3 e +4 anni possono quindi salvare
   * un evento family classificato genericamente
   * come gruppo o circolo di lettura.
   */
  event.family_super =
    Boolean(event.family_super) ||
    hasSuperFamilySignal(event);

  const excludedKeyword = EXCLUDED_KEYWORDS.find((keyword) =>
    text.includes(normalizeSearchText(keyword))
  );

  /*
   * Esclusioni adulte inderogabili:
   * restano escluse anche in presenza di altri segnali.
   */
  const hardAdultExclusions = new Set([
    "madame bovary",
    "cineforum",
    "cineclub"
  ]);

  if (
    excludedKeyword &&
    (
      hardAdultExclusions.has(
        normalizeSearchText(excludedKeyword)
      ) ||
      !event.family_super
    )
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

async function assertEnrichmentSchema() {
  const requiredColumns = [
    "address",
    "street_address",
    "street_number",
    "postal_code",
    "province",
    "latitude",
    "longitude",
    "organizer",
    "phone",
    "email",
    "booking_url",
    "booking_required",
    "booking_notes",
    "official_url"
  ];
  const { data, error } = await supabase.from("events").select("*").limit(1);
  if (error) throw error;
  const availableColumns = new Set(Object.keys(data?.[0] || {}));
  const missingColumns = requiredColumns.filter((column) => !availableColumns.has(column));
  if (missingColumns.length > 0) {
    throw new Error(
      `Cannot write event enrichment: apply Supabase event migrations first. Missing columns: ${missingColumns.join(", ")}`
    );
  }
}

async function main() {
  console.log(WRITE ? "EVENT IMPORT: WRITE MODE" : "EVENT IMPORT: PREVIEW MODE");
  if (WRITE) await assertEnrichmentSchema();

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
  let enriched = 0;
  let duplicates = 0;
  let failedSources = 0;
  const pageEnrichmentCache = new Map();

  for (const [index, source] of sources.entries()) {
    console.log(`[${index + 1}/${sources.length}] ${source.name}`);
    const startedAt = new Date().toISOString();

    try {
      const events = await collectSourceEvents(source);
      found += events.length;
      console.log(`  Events collected: ${events.length}`);

      const eventsPerPage = new Map();
      for (const item of events) {
        const pageUrl = absoluteHttpUrl(item.official_url || item.source_url, source.url);
        if (pageUrl) eventsPerPage.set(pageUrl, (eventsPerPage.get(pageUrl) || 0) + 1);
      }

      for (const event of events) {
        if (isExpiredEvent(event)) {
          console.log(`  SKIP EXPIRED: ${event.title}`);
          continue;
        }

        const eventPageUrl = absoluteHttpUrl(
          event.official_url || event.source_url,
          source.url
        );
        const sourcePageUrl = absoluteHttpUrl(event.source_url, source.url);
        const eventPageAlreadyEnriched = event._page_enriched &&
          eventPageUrl === sourcePageUrl;
        if (eventPageUrl && !eventPageAlreadyEnriched) {
          try {
            let pageEnrichment = pageEnrichmentCache.get(eventPageUrl);
            if (!pageEnrichment) {
              await sleep(300);
              const pageHtml = await fetchText(eventPageUrl);
              pageEnrichment = extractPageEnrichment(pageHtml, eventPageUrl);
              pageEnrichmentCache.set(eventPageUrl, pageEnrichment);
            }
            Object.assign(
              event,
              mergePageEnrichment(event, pageEnrichment, eventPageUrl, {
                sharedPage: eventsPerPage.get(eventPageUrl) > 1
              })
            );
          } catch (enrichmentError) {
            console.warn(
              `  ENRICHMENT SKIP ${event.title}: ${enrichmentError.message}`
            );
          }
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

        const existingEvent = await findExistingEvent(event);
        if (existingEvent) {
          duplicates += 1;
          if (WRITE && await enrichExistingEvent(existingEvent, event)) {
            enriched += 1;
          }
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
  console.log(`Existing events enriched: ${enriched}`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Failed sources: ${failedSources}`);
  if (!WRITE) console.log("Preview only. Run with --write to insert new events.");

  await reportEventEnrichment();

  if (failedSources === sources.length && sources.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
