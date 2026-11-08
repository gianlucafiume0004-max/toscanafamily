import { readFile } from "node:fs/promises";

const normalize = (value) => String(value ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");

async function loadMunicipalities() {
  const dataset = JSON.parse(await readFile(new URL("../data/istat-comuni-toscana.json", import.meta.url), "utf8"));
  if (!Array.isArray(dataset.municipalities) || dataset.municipalities.length < 200) {
    throw new Error("Dataset ISTAT dei comuni toscani non valido.");
  }
  const mapping = new Map();
  for (const { city, province } of dataset.municipalities) {
    if (typeof city !== "string" || !/^(AR|FI|GR|LI|LU|MS|PI|PO|PT|SI)$/.test(province)) {
      throw new Error("Voce non valida nel dataset ISTAT dei comuni toscani.");
    }
    const key = normalize(city);
    if (mapping.has(key) && mapping.get(key) !== province) mapping.set(key, null);
    else if (!mapping.has(key)) mapping.set(key, province);
  }
  return mapping;
}

function classifyAnimator(text) {
  const value = normalize(text);
  const signals = [
    ["animazione", /\banimazion[ei]?\b/, 25],
    ["animatore", /\banimator[ie]\b/, 25],
    ["feste bambini", /\bfest[ae]\s+(?:(?:per|di)\s+)?(?:i\s+)?bambin[io]\b/, 20],
    ["compleanni", /\bfest[ae]\s+(?:di\s+)?compleanno\b|\bcompleann[io]\b/, 20],
    ["baby dance", /\bbaby[\s-]?dance\b/, 20],
    ["truccabimbi", /\btruccabimbi\b|\bface[\s-]?painting\b/, 20],
    ["magia", /\bmagia\b|\bmag[io]\b/, 15],
    ["spettacoli", /\bspettacol[io]\b/, 15],
    ["laboratori creativi", /\blaborator[io].{0,30}creativ/, 20],
    ["intrattenimento", /\bintratteniment[oi]\b/, 15],
    ["giochi", /\bgioch[io]\b/, 10]
  ];
  const matchedSignals = signals.filter(([, pattern]) => pattern.test(value));
  const hasAnimatorTerm = matchedSignals.some(([name]) => ["animazione", "animatore"].includes(name));
  const hasChildrenContext = /\bbambin[io]\b|\bbimb[io]\b|\bcompleann[io]\b|\bbaby[\s-]?dance\b|\btruccabimbi\b/.test(value);
  const confidenceAnimator = Math.min(100,
    matchedSignals.reduce((score, [, , points]) => score + points, 0) +
    (hasAnimatorTerm && hasChildrenContext ? 35 : 0));
  const hall = /\b(?:sal[ae] (?:per )?fest[ae]|noleggio (?:delle? )?sale|affitto (?:delle? )?sale)\b/.test(value);
  const rental = /\b(?:noleggio|affitto)\s+(?:di\s+)?gonfiabili\b/.test(value);
  const inflatables = /\bgonfiabil[ei]\b/.test(value);
  const decoration = /\b(?:allestiment[io]|balloon[\s-]?art|balloon[\s-]?decor)\b/.test(value);
  const events = /\bevent[io]\b|\borganizzazion[ei]\s+(?:di\s+)?event[io]\b/.test(value);
  const categories = [];
  if (confidenceAnimator >= 60) categories.push("animatore");
  if (hall) categories.push("sala_feste");
  if (decoration) categories.push("allestimenti");
  if (inflatables) categories.push("gonfiabili");
  if (events) categories.push("eventi");

  return {
    confidence_animatore: confidenceAnimator,
    confidence_sala_feste: hall ? 80 : 0,
    confidence_noleggio: rental ? 80 : 0,
    confidence_gonfiabili: inflatables ? 80 : 0,
    confidence_allestimenti: decoration ? 80 : 0,
    confidence_eventi: events ? 80 : 0,
    categories
  };
}

function isAnimatorCategory(confidence) {
  return confidence.confidence_animatore >= 60;
}

function pageKind(url) {
  let path;
  try { path = new URL(url).pathname.toLowerCase(); } catch { return "altro"; }
  if (/contatt|contact/.test(path)) return "contatti";
  if (/privacy/.test(path)) return "privacy policy";
  if (/cookie/.test(path)) return "cookie policy";
  if (/termin|condizion|terms/.test(path)) return "termini e condizioni";
  if (/chi.?siamo|about|azienda|impresa|sede/.test(path)) return "informazioni aziendali";
  if (/serviz|service|fest[ae]|animazion|faq/.test(path)) return "servizi e copertura";
  return "pagina ufficiale e footer";
}

function learnApproved(candidates) {
  const records = candidates.filter((candidate) => candidate.status === "approved").map((candidate) => ({
    id: candidate.id,
    patterns: Object.fromEntries(["city", "province", "phone", "facebook_url", "instagram_url",
      "website", "services", "coverage_area"].filter((field) => candidate.field_sources?.[field])
      .map((field) => [field, { url: candidate.field_sources[field], page: pageKind(candidate.field_sources[field]) }]))
  }));
  return summarizeRecords(records);
}

function summarizeRecords(records) {
  const pages = {};
  const sources = {};
  for (const record of records) {
    for (const pattern of Object.values(record.patterns)) {
      pages[pattern.page] = (pages[pattern.page] ?? 0) + 1;
      try {
        const host = new URL(pattern.url).hostname;
        sources[host] = (sources[host] ?? 0) + 1;
      } catch {
        throw new Error(`URL di provenienza non valido per approved ${record.id}.`);
      }
    }
  }
  return { version: 1, generated_at: new Date().toISOString(), records, pages, sources };
}

function mergeLearning(previous, current) {
  if (previous && (previous.version !== 1 || !Array.isArray(previous.records))) {
    throw new Error("Storico animatori non valido.");
  }
  const records = new Map((previous?.records ?? []).map((record) => [record.id, record]));
  for (const record of current.records) records.set(record.id, record);
  return { ...summarizeRecords([...records.values()]), retries: previous?.retries ?? {} };
}

export { classifyAnimator, isAnimatorCategory, learnApproved, loadMunicipalities, mergeLearning, normalize, pageKind };
