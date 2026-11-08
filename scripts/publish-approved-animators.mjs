import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { candidatesMatch } from "./discover-animators.mjs";
import { getProviderCategories } from "../src/lib/providerCategories.js";

const STAGING_HOST = "eqonpqgazhmjbrjtexmg.supabase.co";
const PRODUCTION_HOST = "yihognpbnhdolsnmicwi.supabase.co";
const PROVINCES = new Set(["AR", "FI", "GR", "LI", "LU", "MS", "PI", "PO", "PT", "SI"]);
const COPY_FIELDS = [
  "id", "name", "provider_kind", "provider_type", "party_type", "city",
  "province", "phone", "website", "social_url", "services", "coverage_area",
  "notes", "source_url"
];
const PAGE_SIZE = 500;

function assertProject(value, expected) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`URL Supabase non valido per ${expected}.`);
  }
  if (url.protocol !== "https:" || url.hostname !== expected || url.port ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`URL Supabase non corrisponde al progetto atteso ${expected}.`);
  }
  return url.toString();
}

function readOnlyFetch(url, options = {}) {
  const method = (options.method ?? (url instanceof Request ? url.method : "GET")).toUpperCase();
  if (!["GET", "HEAD"].includes(method)) {
    throw new Error(`Operazione ${method} vietata: il workflow è esclusivamente read-only.`);
  }
  return fetch(url, options);
}

async function loadAll(client, table, filters = {}) {
  const rows = [];
  const ids = new Set();
  let total;
  for (;;) {
    let query = client.from(table).select("*", { count: "exact" })
      .order("id").range(rows.length, rows.length + PAGE_SIZE - 1);
    for (const [field, value] of Object.entries(filters)) query = query.eq(field, value);
    const { data, error, count } = await query;
    if (error) throw new Error(`Lettura ${table}: ${error.message}`);
    if (!Array.isArray(data) || !Number.isInteger(count) || count < 0) {
      throw new Error(`Conteggio completo non disponibile per ${table}.`);
    }
    if (total !== undefined && total !== count) {
      throw new Error(`I dati di ${table} sono cambiati durante la lettura; ripetere il dry-run.`);
    }
    total = count;
    for (const row of data) {
      if (row.id == null || ids.has(String(row.id))) {
        throw new Error(`Lettura incoerente di ${table}: ID mancante o ripetuto; ripetere il dry-run.`);
      }
      ids.add(String(row.id));
    }
    rows.push(...data);
    if (rows.length === total) return rows;
    if (!data.length || rows.length > total) {
      throw new Error(`Lettura incompleta di ${table}: ${rows.length}/${total}.`);
    }
  }
}

function identityFields(record) {
  const socialUrls = String(record.social_url ?? "").split(/[;,\n]/).map((url) => url.trim());
  const validProfiles = (platform) => [...socialUrls, record[`${platform}_url`]]
    .filter((url) => candidatesMatch({ [`${platform}_url`]: url }, { [`${platform}_url`]: url }));
  return {
    name: record.name,
    phone: String(record.phone ?? "").split(/[;,\n]|\s+[|/-]\s+/).map((phone) => phone.trim()),
    website: record.website,
    facebook_url: validProfiles("facebook"),
    instagram_url: validProfiles("instagram")
  };
}

function matchingFields(first, second) {
  const a = identityFields(first);
  const b = identityFields(second);
  const scalarMatches = ["name", "website"].filter((field) =>
    candidatesMatch({ [field]: a[field] }, { [field]: b[field] })
  );
  const listMatches = ["phone", "facebook_url", "instagram_url"].filter((field) =>
    a[field].some((left) => b[field].some((right) =>
      candidatesMatch({ [field]: left }, { [field]: right })
    ))
  );
  return [...scalarMatches, ...listMatches];
}

function validWebsite(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isTestRecord(candidate, provider) {
  return [candidate.name, provider?.name, candidate.approved_provider_id, provider?.id]
    .some((value) => /(?:^|[\s_-])test(?:$|[\s_-])/i.test(String(value ?? "").trim()));
}

function payloadFor(provider) {
  return Object.fromEntries(COPY_FIELDS.map((field) => [field, provider[field] ?? null]));
}

function syncApprovedAnimators(candidates, stagingProviders, productionProviders) {
  const approved = candidates.filter((candidate) => candidate.status === "approved");
  const stagedById = new Map(stagingProviders.map((provider) => [String(provider.id), provider]));
  const entries = approved.map((candidate) => {
    const provider = stagedById.get(String(candidate.approved_provider_id));
    const entry = {
      name: candidate.name, candidate_id: candidate.id,
      provider_id: candidate.approved_provider_id, quality_score: candidate.quality_score,
      classification: "review_required", reasons: [], matches: [], payload: null,
      identityRecords: provider ? [provider, candidate] : [candidate]
    };
    if (isTestRecord(candidate, provider)) {
      entry.classification = "test_record";
      entry.reasons.push("Record identificato come test.");
      return entry;
    }
    if (!provider) {
      entry.reasons.push("Provider approvato non trovato nello staging.");
      return entry;
    }
    entry.payload = payloadFor(provider);
    for (const target of productionProviders) {
      const fields = [...new Set(entry.identityRecords.flatMap((source) => matchingFields(source, target)))];
      if (fields.length || String(target.id) === String(provider.id)) {
        entry.matches.push({ id: target.id, name: target.name,
          category: getProviderCategories(target), fields,
          id_collision: String(target.id) === String(provider.id) });
      }
    }
    const animatorMatches = entry.matches.filter((match) => match.category.includes("animatori"));
    const otherMatches = entry.matches.filter((match) => !match.category.includes("animatori"));
    if (animatorMatches.length === 1
      && animatorMatches[0].fields.some((field) => ["phone", "facebook_url", "instagram_url"].includes(field))
      && !otherMatches.length) {
      entry.classification = "duplicate";
      entry.reasons.push("Corrispondenza con animatore già presente in produzione.");
      return entry;
    }
    if (entry.matches.length) {
      entry.reasons.push("Corrispondenza ambigua, collisioni multiple, ID occupato o altre categorie: revisione manuale.");
      return entry;
    }
    if (!getProviderCategories(provider).includes("animatori")) entry.reasons.push("Categoria provider non animatore.");
    if (!provider.name?.trim()) entry.reasons.push("Nome mancante.");
    if (!provider.city?.trim()) entry.reasons.push("Città mancante.");
    if (!PROVINCES.has(provider.province)) entry.reasons.push("Provincia toscana mancante o non valida (usare la sigla maiuscola).");
    const identities = identityFields(provider);
    if (!identities.phone.some((phone) => candidatesMatch({ phone }, { phone }))) entry.reasons.push("Telefono mancante o non valido.");
    if (!validWebsite(provider.website)) entry.reasons.push("Sito mancante o non valido.");
    const copiedSocials = identityFields({ social_url: provider.social_url });
    if (!copiedSocials.facebook_url.length && !copiedSocials.instagram_url.length) entry.reasons.push("Social valido mancante.");
    if (!entry.reasons.length) entry.classification = "publishable";
    return entry;
  });

  const eligibleEntries = entries.filter((entry) => entry.classification !== "test_record");
  for (let i = 0; i < eligibleEntries.length; i += 1) {
    for (let j = i + 1; j < eligibleEntries.length; j += 1) {
      const fields = [...new Set(eligibleEntries[i].identityRecords.flatMap((first) =>
        eligibleEntries[j].identityRecords.flatMap((second) => matchingFields(first, second))
      ))];
      const sameId = eligibleEntries[i].provider_id
        && eligibleEntries[i].provider_id === eligibleEntries[j].provider_id;
      if (fields.length || sameId) {
        for (const [entry, other] of [[eligibleEntries[i], eligibleEntries[j]], [eligibleEntries[j], eligibleEntries[i]]]) {
          if (entry.classification === "duplicate") continue;
          entry.classification = "review_required";
          entry.reasons.push(`Possibile duplicato nello staging con ${other.name}: ${fields.join(", ") || "id"}.`);
        }
      }
    }
  }
  return entries;
}

function escapeMarkdown(value) {
  return String(value ?? "-").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function createReport(entries) {
  const sections = [
    ["publishable", "Nuovi animatori pubblicabili"],
    ["duplicate", "Duplicati"],
    ["review_required", "Record da revisionare"],
    ["test_record", "Record di test"]
  ];
  const lines = ["# Publish Approved Animators — DRY RUN", "",
    "Nessuna scrittura o pubblicazione effettuata.", "",
    "Il risultato è limitato ai record visibili alle credenziali utilizzate.", ""];
  for (const [status, title] of sections) {
    const items = entries.filter((entry) => entry.classification === status);
    lines.push(`## ${title} (${items.length})`, "", "| Nome | ID staging | Score | Motivi e corrispondenze |",
      "|---|---|---:|---|");
    for (const item of items) {
      const notes = [...item.reasons, ...item.matches.map((match) =>
        `${match.name} (${match.id}; ${match.category.join(", ") || "categoria sconosciuta"}): ${match.fields.join(", ") || "ID"}${match.id_collision ? ", ID occupato" : ""}`
      )].join("; ");
      lines.push(`| ${escapeMarkdown(item.name)} | ${escapeMarkdown(item.provider_id)} | ${escapeMarkdown(item.quality_score)} | ${escapeMarkdown(notes || "nessuna collisione rilevata")} |`);
    }
    lines.push("");
  }
  lines.push("## Payload proposto — solo simulazione", "", "```json",
    JSON.stringify(entries.filter((entry) => entry.classification === "publishable")
      .map((entry) => entry.payload), null, 2), "```", "");
  return lines.join("\n");
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return value;
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--dry-run")) {
    throw new Error("Unico argomento consentito: --dry-run. La pubblicazione non è implementata.");
  }
  const staging = createClient(assertProject(requiredEnv("STAGING_SUPABASE_URL"), STAGING_HOST),
    requiredEnv("STAGING_SUPABASE_READ_ONLY_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: readOnlyFetch } });
  const production = createClient(assertProject(requiredEnv("PRODUCTION_SUPABASE_URL"), PRODUCTION_HOST),
    requiredEnv("PRODUCTION_SUPABASE_READ_ONLY_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: readOnlyFetch } });
  const [candidates, stagingProviders, productionProviders] = await Promise.all([
    loadAll(staging, "animator_candidates", { status: "approved" }),
    loadAll(staging, "providers"),
    loadAll(production, "providers")
  ]);
  const report = createReport(syncApprovedAnimators(candidates, stagingProviders, productionProviders));
  const reportPath = process.env.REPORT_PATH || "publish-approved-animators-report.md";
  await writeFile(reportPath, `${report}\n`, "utf8");
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`, { flag: "a" });
  }
  console.log(report);
}

export { assertProject, createReport, identityFields, loadAll, matchingFields, readOnlyFetch, syncApprovedAnimators };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
