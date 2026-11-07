import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const CANDIDATE_COLUMNS =
  "id,name,phone,website,facebook_url,instagram_url,city,province,services," +
  "coverage_area,source_urls,quality_score,missing_fields,status,created_at";
const TUSCANY_PROVINCES = new Set([
  "AR", "FI", "GR", "LI", "LU", "MS", "PI", "PO", "PT", "SI"
]);

function usage() {
  console.log([
    "Uso:",
    "  node scripts/approve-animator-candidate.mjs list",
    "  node scripts/approve-animator-candidate.mjs approve <candidate-id> --city=<comune> --province=<sigla>",
    "",
    "L'approvazione richiede la funzione SQL approve_animator_candidate e dati",
    "locali verificati da una fonte ufficiale."
  ].join("\n"));
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return value;
}

function parseOptions(args) {
  const options = new Map();
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) throw new Error(`Opzione non valida: ${arg}`);
    if (options.has(match[1])) throw new Error(`Opzione duplicata: --${match[1]}`);
    options.set(match[1], match[2].trim());
  }
  return options;
}

function createSupabaseClient() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

async function listPendingCandidates(supabase) {
  const { data, error } = await supabase
    .from("animator_candidates")
    .select(CANDIDATE_COLUMNS)
    .eq("status", "pending_review")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Lettura candidati: ${error.message}`);

  if (!data?.length) {
    console.log("Nessun candidato in pending_review.");
    return;
  }

  for (const candidate of data) {
    console.log(JSON.stringify(candidate));
  }
}

async function approveCandidate(supabase, candidateId, options) {
  const city = options.get("city");
  const province = options.get("province")?.toUpperCase();
  const unknownOptions = [...options.keys()].filter(
    (key) => key !== "city" && key !== "province"
  );

  if (unknownOptions.length) {
    throw new Error(`Opzioni non riconosciute: ${unknownOptions.join(", ")}`);
  }
  if (!city || !province) {
    throw new Error("--city e --province sono obbligatori e devono essere verificati.");
  }
  if (!TUSCANY_PROVINCES.has(province)) {
    throw new Error(`Sigla provincia toscana non valida: ${province}`);
  }

  const { data: candidate, error: candidateError } = await supabase
    .from("animator_candidates")
    .select(CANDIDATE_COLUMNS)
    .eq("id", candidateId)
    .maybeSingle();

  if (candidateError) {
    throw new Error(`Lettura candidato ${candidateId}: ${candidateError.message}`);
  }
  if (!candidate) throw new Error(`Candidato non trovato: ${candidateId}`);
  if (!["pending_review", "approved"].includes(candidate.status)) {
    throw new Error(
      `Candidato ${candidate.name} non approvabile: stato attuale ${candidate.status}.`
    );
  }

  const { data, error } = await supabase.rpc("approve_animator_candidate", {
    p_candidate_id: candidateId,
    p_city: city,
    p_province: province
  });

  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error(
        "Funzione SQL approve_animator_candidate non disponibile. " +
        "Nessun provider è stato creato; applicare prima la migration di approvazione."
      );
    }
    throw new Error(`Approvazione di ${candidate.name}: ${error.message}`);
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result || !["approved", "duplicate"].includes(result.status)) {
    throw new Error(
      "Risposta inattesa dalla funzione SQL: attesi status approved o duplicate."
    );
  }
  if (!result.provider_id) {
    throw new Error("La funzione SQL non ha restituito provider_id.");
  }

  console.log(JSON.stringify({
    candidate: candidate.name,
    status: result.status,
    provider_id: result.provider_id,
    provider_name: result.provider_name ?? null
  }, null, 2));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }

  const supabase = createSupabaseClient();
  if (command === "list" && args.length === 0) {
    await listPendingCandidates(supabase);
    return;
  }

  if (command === "approve" && args.length >= 1) {
    const [candidateId, ...optionArgs] = args;
    await approveCandidate(supabase, candidateId, parseOptions(optionArgs));
    return;
  }

  usage();
  throw new Error("Comando o argomenti non validi.");
}

main().catch((error) => {
  console.error(`Errore: ${error.message}`);
  process.exitCode = 1;
});
