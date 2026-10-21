import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROVIDER_KIND_MAP = new Map([
  ["feste", "feste"],
  ["animator", "feste"],
  ["animatori", "feste"],
  ["party_room", "feste"],
  ["party_venue", "feste"],
  ["sale-feste", "feste"],
  ["sale_feste", "feste"],
  ["sale feste", "feste"],
  ["inflatable_rental", "feste"],
  ["photographer", "feste"],
  ["catering", "feste"],
  ["playroom", "play_center"],
  ["baby_parking", "play_center"],
  ["creative_workshop", "play_center"],
  ["educational_farm", "play_center"],
  ["other", "play_center"]
]);

const EXISTING_COLUMNS =
  "id,name,city,provider_kind,phone,email,website,social_url,services,coverage_area,notes,source_url,premium,status";
const PAGE_SIZE = 500;

const HEADERS = [
  "name",
  "provider_type",
  "categories",
  "city",
  "province",
  "service_areas",
  "phone",
  "whatsapp",
  "email",
  "website",
  "facebook",
  "instagram",
  "description",
  "image_url",
  "source_url",
  "verified",
  "active",
  "premium",
  "featured"
];

const UPDATE_FIELDS = [
  "provider_kind",
  "name",
  "city",
  "services",
  "coverage_area",
  "notes",
  "social_url",
  "source_url",
  "phone",
  "email",
  "website",
  "province"
];

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const csvPath = resolve(projectRoot, "data", "providers.csv");
const stats = {
  found: 0,
  valid: 0,
  new: 0,
  existing: 0,
  updated: 0,
  duplicates: 0,
  skipped: 0,
  failed: 0
};
const rowErrors = [];
const warnings = [];

function parseArguments(args) {
  if (args.some((arg) => arg !== "--write")) {
    throw new Error("Argomento non riconosciuto. Usa --write per scrivere nel database.");
  }

  if (args.filter((arg) => arg === "--write").length > 1) {
    throw new Error("L'opzione --write può essere specificata una sola volta.");
  }

  return args.includes("--write");
}

function parseCsv(text) {
  const source = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;
  let physicalLine = 1;
  let rowLine = 1;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += character;
        if (character === "\n") physicalLine += 1;
      }
      continue;
    }

    if (afterQuote && character !== "," && character !== "\r" && character !== "\n" && !/\s/.test(character)) {
      throw new Error(`CSV non valido alla riga ${physicalLine}: caratteri dopo un campo tra virgolette.`);
    }

    if (character === '"' && field.length === 0 && !afterQuote) {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
      afterQuote = false;
    } else if (character === "\n") {
      row.push(field);
      rows.push({ values: row, line: rowLine });
      row = [];
      field = "";
      afterQuote = false;
      physicalLine += 1;
      rowLine = physicalLine;
    } else if (character !== "\r") {
      if (afterQuote && !/\s/.test(character)) {
        throw new Error(`CSV non valido alla riga ${physicalLine}.`);
      }
      if (!afterQuote) field += character;
    }
  }

  if (inQuotes) {
    throw new Error(`CSV non valido alla riga ${rowLine}: virgolette non chiuse.`);
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push({ values: row, line: rowLine });
  }

  const nonEmptyRows = rows.filter(({ values }) => values.some((value) => value.trim() !== ""));
  return {
    rows: nonEmptyRows,
    emptyRows: rows.length - nonEmptyRows.length
  };
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  return normalizeWhitespace(value) || null;
}

function normalizePhone(value) {
  const text = normalizeWhitespace(value);
  if (!text) return null;

  const digits = text.replace(/\D/g, "");
  if (!digits) throw new Error("numero di telefono non valido");
  return `${text.trim().startsWith("+") ? "+" : ""}${digits}`;
}

function normalizeUrl(value, field) {
  const text = normalizeWhitespace(value);
  if (!text) return null;

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${field}: URL non valido`);
  }

  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error(`${field}: URL non valido`);
  }

  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.toString();
}

function normalizeEmail(value) {
  const email = normalizeText(value);
  if (!email) return null;

  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) {
    throw new Error("email non valida");
  }
  return email.toLowerCase();
}

function normalizeArray(value, field) {
  const seen = new Set();
  const values = [];

  for (const item of value.split(";")) {
    const normalized = normalizeWhitespace(item);
    if (!normalized) continue;

    const key = normalized.toLocaleLowerCase("it-IT");
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
  }

  if (!values.length && value.trim()) {
    throw new Error(`${field}: valori non validi`);
  }
  return values;
}

function parseBoolean(value, field) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${field}: deve essere true o false`);
}

function normalizeProvider(row) {
  const name = normalizeText(row.name);
  const providerType = normalizeText(row.provider_type);
  const city = normalizeText(row.city);
  const providerTypeKey = providerType?.toLocaleLowerCase("it-IT");

  if (!name) throw new Error("name obbligatorio");
  if (!providerTypeKey || !PROVIDER_KIND_MAP.has(providerTypeKey)) {
    throw new Error("provider_type non valido");
  }
  if (!city) throw new Error("city obbligatoria");

  return {
    name,
    provider_kind: PROVIDER_KIND_MAP.get(providerTypeKey),
    city,
    province: normalizeText(row.province),
    services: normalizeArray(row.categories, "categories").join("; ") || null,
    coverage_area: normalizeArray(row.service_areas, "service_areas").join("; ") || null,
    phone: normalizePhone(row.phone),
    email: normalizeEmail(row.email),
    website: normalizeUrl(row.website, "website"),
    social_url:
      normalizeUrl(row.facebook, "facebook") ??
      normalizeUrl(row.instagram, "instagram"),
    notes: normalizeText(row.description),
    source_url: normalizeUrl(row.source_url, "source_url"),
    premium: parseBoolean(row.premium, "premium")
  };
}

function identityKey(name, city) {
  return `${normalizeWhitespace(name).toLocaleLowerCase("it-IT")}\u0000${normalizeWhitespace(city).toLocaleLowerCase("it-IT")}`;
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function providerId(provider, existingIds) {
  const base = `provider-${slugify(provider.name)}-${slugify(provider.city)}`;
  const current = existingIds.get(base);
  if (!current || current === identityKey(provider.name, provider.city)) return base;

  const suffix = createHash("sha256")
    .update(identityKey(provider.name, provider.city))
    .digest("hex");
  for (let length = 8; length <= suffix.length; length += 4) {
    const candidate = `${base}-${suffix.slice(0, length)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  throw new Error(`impossibile generare un ID univoco per ${provider.name}`);
}

function hasCsvValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function buildUpdate(provider) {
  const update = {};
  for (const field of UPDATE_FIELDS) {
    if (hasCsvValue(provider[field])) update[field] = provider[field];
  }
  return update;
}

function buildInsert(provider, existingIds) {
  return {
    id: providerId(provider, existingIds),
    ...buildUpdate(provider),
    premium: provider.premium
  };
}

function normalizeDomain(value) {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizedPhone(value) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits || null;
}

function secondaryMatch(provider, records) {
  const domain = normalizeDomain(provider.website);
  const email = provider.email?.toLocaleLowerCase("it-IT") ?? null;
  const phone = normalizedPhone(provider.phone);
  if (!domain && !email && !phone) return null;

  return records.find((record) => {
    if (domain && normalizeDomain(record.website) === domain) return true;
    if (email && record.email?.toLocaleLowerCase("it-IT") === email) return true;
    return phone && normalizedPhone(record.phone) === phone;
  }) ?? null;
}

function findExactMatches(provider, records) {
  const key = identityKey(provider.name, provider.city);
  return records.filter((record) => identityKey(record.name, record.city) === key);
}

async function loadExistingProviders(supabase) {
  const records = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("providers")
      .select(EXISTING_COLUMNS)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`lettura providers: ${error.message}`);
    records.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return records;
}

function mapCsvRow(values, headerIndexes) {
  if (values.length !== HEADERS.length) {
    throw new Error(`numero di colonne non valido (attese ${HEADERS.length}, trovate ${values.length})`);
  }

  const row = {};
  for (const header of HEADERS) row[header] = values[headerIndexes.get(header)];
  return row;
}

function assertHeaders(headerRow) {
  if (!headerRow || headerRow.values.length !== HEADERS.length) {
    throw new Error("Intestazioni CSV mancanti o non valide.");
  }

  const actual = headerRow.values.map(normalizeWhitespace);
  if (actual.some((header, index) => header !== HEADERS[index])) {
    throw new Error("Le intestazioni CSV non corrispondono allo schema providers richiesto.");
  }

  return new Map(actual.map((header, index) => [header, index]));
}

function printSummary(writeMode) {
  console.log(`PROVIDERS IMPORT: ${writeMode ? "WRITE MODE" : "PREVIEW MODE"}`);
  console.log("");
  console.log(`Found: ${stats.found}`);
  console.log(`Valid: ${stats.valid}`);
  console.log(`New: ${stats.new}`);
  console.log(`Existing: ${stats.existing}`);
  console.log(`Updated: ${stats.updated}`);
  console.log(`Duplicates: ${stats.duplicates}`);
  console.log(`Skipped: ${stats.skipped}`);
  console.log(`Failed: ${stats.failed}`);
}

function printPreview(entries) {
  console.log("");
  console.log("Preview:");
  for (const { provider, id, action } of entries) {
    console.log(
      `- ${provider.name} | ${provider.provider_kind} | ${provider.city} | ${action}${id ? ` | ${id}` : ""}`
    );
  }
}

function changedFields(provider, existing) {
  return Object.fromEntries(
    Object.entries(buildUpdate(provider)).filter(([field, value]) => existing[field] !== value)
  );
}

async function applyProvider(supabase, provider, existingRecord, existingRecords, insert, id) {
  if (existingRecord) {
    const update = changedFields(provider, existingRecord);
    if (!Object.keys(update).length) {
      stats.skipped += 1;
      return;
    }

    const { error } = await supabase
      .from("providers")
      .update(update)
      .eq("id", existingRecord.id);
    if (error) throw new Error(`aggiornamento record: ${error.message}`);
    stats.updated += 1;
    Object.assign(existingRecord, update);
    return;
  }

  const { error } = await supabase.from("providers").insert(insert);
  if (error) throw new Error(`inserimento record: ${error.message}`);
  existingRecords.push({ ...insert, id });
}

async function main() {
  const writeMode = parseArguments(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) throw new Error("Variabile SUPABASE_URL mancante.");
  if (!serviceRoleKey) throw new Error("Variabile SUPABASE_SERVICE_ROLE_KEY mancante.");

  const csvText = await readFile(csvPath, "utf8");
  const { rows, emptyRows } = parseCsv(csvText);
  stats.skipped = emptyRows;

  if (rows.length === 0) throw new Error("Il CSV providers è vuoto.");

  const headerIndexes = assertHeaders(rows[0]);
  const inputKeys = new Set();
  const validProviders = [];

  for (const { values, line } of rows.slice(1)) {
    if (values.every((value) => value.trim() === "")) {
      stats.skipped += 1;
      continue;
    }

    stats.found += 1;
    try {
      const provider = normalizeProvider(mapCsvRow(values, headerIndexes));
      stats.valid += 1;

      const key = identityKey(provider.name, provider.city);
      if (inputKeys.has(key)) {
        stats.duplicates += 1;
        stats.skipped += 1;
        continue;
      }
      inputKeys.add(key);
      validProviders.push(provider);
    } catch (error) {
      stats.failed += 1;
      rowErrors.push(`Riga ${line}: ${error.message}`);
    }
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
  const existing = await loadExistingProviders(supabase);
  const existingIds = new Map(
    existing.map((record) => [record.id, identityKey(record.name, record.city)])
  );
  const previewEntries = [];

  for (const provider of validProviders) {
    try {
      const exactMatches = findExactMatches(provider, existing);
      if (exactMatches.length > 1) {
        stats.duplicates += 1;
        stats.skipped += 1;
        warnings.push(`${provider.name} saltato, più record corrispondono a nome e città.`);
        continue;
      }

      if (exactMatches.length === 1) {
        const record = exactMatches[0];
        stats.existing += 1;
        const update = changedFields(provider, record);
        if (Object.keys(update).length) {
          if (writeMode) {
            await applyProvider(supabase, provider, record, existing, null, record.id);
          } else {
            stats.updated += 1;
          }
        } else {
          stats.skipped += 1;
        }
        previewEntries.push({ provider, action: "existing", id: record.id });
        continue;
      }

      const possibleDuplicate = secondaryMatch(provider, existing);
      if (possibleDuplicate) {
        stats.duplicates += 1;
        stats.skipped += 1;
        warnings.push(`${provider.name} saltato per possibile duplicato.`);
        continue;
      }

      const id = providerId(provider, existingIds);
      const insert = buildInsert(provider, existingIds);
      stats.new += 1;
      existingIds.set(id, identityKey(provider.name, provider.city));
      previewEntries.push({ provider, action: "new", id });
      if (writeMode) {
        await applyProvider(supabase, provider, null, existing, insert, id);
      }
    } catch (error) {
      stats.failed += 1;
      rowErrors.push(`${provider.name}: ${error.message}`);
    }
  }

  printSummary(writeMode);
  if (!writeMode) printPreview(previewEntries);

  if (rowErrors.length) {
    console.log("");
    console.log("Errors:");
    for (const rowError of rowErrors) console.error(`- ${rowError}`);
    process.exitCode = 1;
  }
  if (warnings.length) {
    console.log("");
    console.log("Warnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }
}

main().catch((error) => {
  stats.failed += 1;
  console.error(`Importazione providers fallita: ${error.message}`);
  printSummary(process.argv.slice(2).includes("--write"));
  process.exitCode = 1;
});
