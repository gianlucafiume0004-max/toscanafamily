  source_url: "https://example.com/toscanafamily-test",import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("Manca il secret SUPABASE_URL");
}

if (!serviceRoleKey) {
  throw new Error("Manca il secret SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

console.log("Avvio raccolta dati ToscanaFamily...");

const testCandidate = {
  entity_type: "test",
  title: "Test raccolta automatica",
  description: "Record tecnico creato dal workflow GitHub Actions",
  city: "Prato",
  source: "ToscanaFamily",
  source_url: "https://example.com/toscanafamily-test",
  external_id: "workflow-test-001",
  confidence_score: 100,
  review_status: "pending",
  raw_data: {
    generated_by: "collect-data.mjs",
    test: true
  }
};

const { data, error } = await supabase
  .from("import_candidates")
  .upsert(testCandidate, {
    onConflict: "entity_type,source_url"
  })
  .select();

if (error) {
  console.error("Errore Supabase:", error);
  process.exit(1);
}

console.log("Raccolta completata.");
console.log(data);
ort { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("Manca il secret SUPABASE_URL");
}

if (!serviceRoleKey) {
  throw new Error("Manca il secret SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

console.log("Avvio raccolta dati ToscanaFamily...");

const testCandidate = {
  entity_type: "test",
  title: "Test raccolta automatica",
  description: "Record tecnico creato dal workflow GitHub Actions",
  city: "Prato",
  source: "ToscanaFamily",
  source_url: "https://example.com/toscanafamily-test",
  external_id: "workflow-test-001",
  confidence_score: 100,
  review_status: "pending",
  raw_data: {
    generated_by: "collect-data.mjs",
    test: true
  },
  updated_at: new Date().toISOString()
};

const { data, error } = await supabase
  .from("import_candidates")
  .upsert(testCandidate, {
    onConflict: "entity_type,source_url"
  })
  .select();

if (error) {
  console.error("Errore Supabase:", error);
  process.exit(1);
}

console.log("Raccolta completata.");
console.log("Record inserito o aggiornato:", data);
