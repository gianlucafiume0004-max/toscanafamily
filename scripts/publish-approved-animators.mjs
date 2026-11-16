import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { candidatesMatch, isApprovalEligible } from "./discover-animators.mjs";
import { loadMunicipalities, normalize } from "./animator-learning.mjs";

const STAGING_HOST = "eqonpqgazhmjbrjtexmg.supabase.co";
const PRODUCTION_HOST = "yihognpbnhdolsnmicwi.supabase.co";
const APPROVED_STATUSES = ["approved_auto", "approved_probable"];
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

async function loadAll(client, table, filters = {}, configure = (query) => query) {
  const rows = [];
  const ids = new Set();
  let total;
  for (;;) {
    let query = client.from(table).select("*", { count: "exact" })
      .order("id").range(rows.length, rows.length + PAGE_SIZE - 1);
    for (const [field, value] of Object.entries(filters)) query = query.eq(field, value);
    const { data, error, count } = await configure(query);
    if (error) throw new Error(`Lettura ${table}: ${error.message}`);
    if (!Array.isArray(data) || !Number.isInteger(count) || count < 0) {
      throw new Error(`Conteggio completo non disponibile per ${table}.`);
    }
    if (total !== undefined && total !== count) {
      throw new Error(`I dati di ${table} sono cambiati durante la lettura; riprovare.`);
    }
    total = count;
    for (const row of data) {
      if (row.id == null || ids.has(String(row.id))) {
        throw new Error(`Lettura incoerente di ${table}: ID mancante o ripetuto.`);
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

function loadApprovedCandidates(staging) {
  return loadAll(staging, "animator_candidates", {},
    (query) => query.in("status", APPROVED_STATUSES).is("published_at", null));
}

function canonicalName(value) {
  return normalize(value).replace(/&/g, " e ")
    .replace(/\b(animazione|animatori|animatore|feste|bambini|srl|snc|asd|di|e|il|la|per)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function slug(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function identityFields(record) {
  const socialUrls = String(record.social_url ?? "").split(/[;,\n]/).map((url) => url.trim());
  const validProfiles = (platform) => [...socialUrls, record[`${platform}_url`]]
    .filter((url) => candidatesMatch({ [`${platform}_url`]: url }, { [`${platform}_url`]: url }));
  return {
    name: record.name,
    normalized_name: canonicalName(record.normalized_name || record.name),
    slug: slug(record.slug || record.name),
    phone: String(record.phone ?? "").split(/[;,\n]|\s+[|/-]\s+/).map((phone) => phone.trim()),
    website: record.website,
    facebook_url: validProfiles("facebook"),
    instagram_url: validProfiles("instagram")
  };
}

function matchingFields(first, second) {
  const a = identityFields(first);
  const b = identityFields(second);
  const matches = ["name", "website"].filter((field) =>
    candidatesMatch({ [field]: a[field] }, { [field]: b[field] })
  );
  for (const field of ["slug", "normalized_name"]) {
    if (a[field] && b[field] && a[field] === b[field]) matches.push(field);
  }
  for (const field of ["phone", "facebook_url", "instagram_url"]) {
    if (a[field].some((left) => b[field].some((right) =>
      candidatesMatch({ [field]: left }, { [field]: right })
    ))) matches.push(field);
  }
  return matches;
}

function payloadFor(candidate, provider) {
  const social = [candidate.facebook_url, candidate.instagram_url].filter(Boolean).join("; ");
  return {
    id: candidate.id,
    animator_candidate_id: candidate.id,
    name: candidate.name,
    provider_kind: "feste",
    party_type: "animatore",
    city: candidate.city,
    province: candidate.province,
    address: provider?.address ?? null,
    phone: candidate.phone,
    email: provider?.email ?? null,
    website: candidate.website,
    social_url: social || provider?.social_url || null,
    services: Array.isArray(candidate.services) ? candidate.services.join("; ") : candidate.services,
    coverage_area: candidate.coverage_area ?? null,
    notes: provider?.notes ?? null,
    source_url: candidate.source_urls?.[0] ?? provider?.source_url ?? null,
    status: "partial",
    premium: false,
    active: true,
    source: "animator_discovery",
    slug: candidate.slug || slug(candidate.name),
    normalized_name: candidate.normalized_name || canonicalName(candidate.name)
  };
}

function isTestRecord(candidate, provider) {
  return [candidate.name, provider?.name, candidate.id, provider?.id]
    .some((value) => /(?:^|[\s_-])test(?:$|[\s_-])/i.test(String(value ?? "").trim()));
}

function syncApprovedAnimators(candidates, stagingProviders, productionProviders, sources, municipalities) {
  const approved = candidates.filter((candidate) =>
    APPROVED_STATUSES.includes(candidate.status) && candidate.published_at == null
  );
  const stagedById = new Map(stagingProviders.map((provider) => [String(provider.id), provider]));
  const entries = approved.map((candidate) => {
    const provider = stagedById.get(String(candidate.approved_provider_id));
    const entry = {
      name: candidate.name, candidate_id: candidate.id, candidate, provider,
      classification: "review_required", reasons: [], matches: [],
      payload: payloadFor(candidate, provider),
      identityRecords: provider ? [candidate, provider] : [candidate]
    };
    if (isTestRecord(candidate, provider)) {
      entry.reasons.push("Record identificato come test.");
      return entry;
    }
    const existing = productionProviders.filter((target) =>
      entry.identityRecords.some((source) => matchingFields(source, target).length) ||
      String(target.id) === String(candidate.id)
    );
    entry.matches = existing.map((target) => ({
      id: target.id, name: target.name,
      fields: [...new Set(entry.identityRecords.flatMap((source) => matchingFields(source, target)))]
    }));
    const own = existing.filter((target) =>
      String(target.animator_candidate_id) === String(candidate.id) &&
      target.source === "animator_discovery"
    );
    if (existing.length && !(existing.length === 1 && own.length === 1)) {
      entry.classification = "duplicate";
      entry.reasons.push("Identità già presente in produzione.");
      return entry;
    }
    if (!isApprovalEligible({ ...candidate, status: "pending_review" }, sources)) {
      entry.reasons.push("Qualità, contatti o fonti non validi.");
    }
    if (!municipalities || municipalities.get(normalize(candidate.city)) !== candidate.province) {
      entry.reasons.push("Comune e provincia toscana non verificati.");
    }
    if (!entry.reasons.length) entry.classification = own.length ? "recover" : "publishable";
    return entry;
  });
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const fields = [...new Set(entries[i].identityRecords.flatMap((first) =>
        entries[j].identityRecords.flatMap((second) => matchingFields(first, second))
      ))];
      if (fields.length) {
        for (const [entry, other] of [[entries[i], entries[j]], [entries[j], entries[i]]]) {
          if (entry.classification === "duplicate") continue;
          entry.classification = "review_required";
          entry.reasons.push(`Possibile duplicato nello staging con ${other.name}: ${fields.join(", ")}.`);
        }
      }
    }
  }
  return entries;
}

async function publishCandidates(staging, production, entries, log = console.log) {
  const summary = { total: entries.length, published: 0, duplicates: 0, errors: 0 };
  for (const entry of entries) {
    if (entry.classification === "duplicate") {
      summary.duplicates += 1;
      log(`[SKIP DUPLICATE] ${entry.name}`);
      continue;
    }
    if (!["publishable", "recover"].includes(entry.classification)) {
      summary.errors += 1;
      log(`[ERROR] ${entry.name}: ${entry.reasons.join("; ")}`);
      continue;
    }
    try {
      const currentCandidate = await staging.from("animator_candidates")
        .select("status,published_at").eq("id", entry.candidate_id).maybeSingle();
      if (currentCandidate.error) throw new Error(`Lettura candidato: ${currentCandidate.error.message}`);
      if (!currentCandidate.data || currentCandidate.data.status !== entry.candidate.status ||
          currentCandidate.data.published_at != null) {
        throw new Error("Candidato non più approvato o già pubblicato; verificare lo staging.");
      }
      const current = await loadAll(production, "providers");
      const matches = current.filter((target) =>
        entry.identityRecords.some((source) => matchingFields(source, target).length) ||
        String(target.id) === String(entry.payload.id)
      );
      const own = matches.filter((target) =>
        String(target.animator_candidate_id) === String(entry.candidate_id) &&
        target.source === "animator_discovery"
      );
      if (matches.length && !(matches.length === 1 && own.length === 1)) {
        summary.duplicates += 1;
        log(`[SKIP DUPLICATE] ${entry.name}`);
        continue;
      }
      if (!own.length) {
        const { data, error } = await production.from("providers")
          .upsert(entry.payload, { onConflict: "animator_candidate_id", ignoreDuplicates: true })
          .select("id,animator_candidate_id");
        if (error) throw new Error(`Upsert providers: ${error.message}`);
        if (!Array.isArray(data) || data.length !== 1 ||
            String(data[0].animator_candidate_id) !== String(entry.candidate_id)) {
          throw new Error("Provider non inserito: possibile pubblicazione concorrente; riprovare.");
        }
      }
      const { data, error } = await staging.from("animator_candidates")
        .update({ published_at: new Date().toISOString() })
        .eq("id", entry.candidate_id).eq("status", entry.candidate.status)
        .is("published_at", null).select("id");
      if (error) throw new Error(`Aggiornamento published_at: ${error.message}`);
      if (!Array.isArray(data) || data.length !== 1) {
        throw new Error("Candidato modificato contemporaneamente: verificare lo staging.");
      }
      summary.published += 1;
      log(`[PUBLISHED] ${entry.name}`);
    } catch (error) {
      summary.errors += 1;
      log(`[ERROR] ${entry.name}: ${error.message}`);
    }
  }
  return summary;
}

function createReport(summary) {
  return [
    "# Publish Approved Animators",
    "",
    `- Totale candidati: ${summary.total}`,
    `- Pubblicati: ${summary.published}`,
    `- Duplicati: ${summary.duplicates}`,
    `- Errori: ${summary.errors}`
  ].join("\n");
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return value;
}

async function main() {
  if (process.argv.slice(2).length !== 1 || process.argv[2] !== "--write") {
    throw new Error("La pubblicazione richiede esplicitamente --write; la modalità dry-run non è disponibile.");
  }
  const staging = createClient(assertProject(requiredEnv("STAGING_SUPABASE_URL"), STAGING_HOST),
    requiredEnv("STAGING_SUPABASE_SECRET_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const production = createClient(assertProject(requiredEnv("PRODUCTION_SUPABASE_URL"), PRODUCTION_HOST),
    requiredEnv("PRODUCTION_SUPABASE_SECRET_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const sources = JSON.parse(await readFile(new URL("../data/animator-sources.json", import.meta.url), "utf8"));
  const [candidates, stagingProviders, productionProviders, municipalities] = await Promise.all([
    loadApprovedCandidates(staging),
    loadAll(staging, "providers"),
    loadAll(production, "providers"),
    loadMunicipalities()
  ]);
  const entries = syncApprovedAnimators(candidates, stagingProviders, productionProviders, sources, municipalities);
  const summary = await publishCandidates(staging, production, entries);
  const report = createReport(summary);
  const reportPath = process.env.REPORT_PATH || "publish-approved-animators-report.md";
  await writeFile(reportPath, `${report}\n`, "utf8");
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`, { flag: "a" });
  }
  console.log(report);
  if (summary.errors) process.exitCode = 1;
}

export {
  assertProject, createReport, identityFields, loadAll, loadApprovedCandidates, matchingFields,
  payloadFor, publishCandidates, syncApprovedAnimators
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
