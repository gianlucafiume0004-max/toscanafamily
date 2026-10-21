export const SOCIAL_SOURCES = [
  {
    id: "amisuradibambino",
    name: "A Misura di Bambino",
    type: "event_calendar",
    enabled: true,
    priority: 10,
    city: "Toscana",
  },

  {
    id: "biblioteche_firenze",
    name: "Biblioteche Comunali Firenze",
    type: "calendar",
    enabled: true,
    priority: 10,
    city: "Firenze",
  },

  {
    id: "muse_firenze",
    name: "MUS.E Firenze",
    type: "rss",
    enabled: true,
    priority: 10,
    city: "Firenze",
  },

  {
    id: "pupi_di_stac",
    name: "Pupi di Stac",
    type: "website",
    enabled: true,
    priority: 9,
    city: "Toscana",
  },

  {
    id: "tour_in_famiglia",
    name: "Tour in Famiglia",
    type: "website",
    enabled: true,
    priority: 9,
    city: "Toscana",
  },
];

export const FAMILY_KEYWORDS = [
  "bambini",
  "bambine",
  "famiglie",
  "famiglia",
  "laboratorio",
  "lettura",
  "letture",
  "teatro",
  "museo",
  "biblioteca",
  "pinocchio",
  "scienza",
  "esperimenti",
  "gioco",
  "giochi",
];

export function calculateFamilyScore(text = "") {
  const value = String(text).toLowerCase();

  let score = 0;

  for (const keyword of FAMILY_KEYWORDS) {
    if (value.includes(keyword)) {
      score += 2;
    }
  }

  return score;
}

export function eventFingerprint(event) {
  return [
    String(event.title || "").toLowerCase().trim(),
    String(event.city || "").toLowerCase().trim(),
    String(event.start_date || "").slice(0, 10),
  ].join("|");
}

export async function collectSocialEvents() {
  console.log("SOCIAL EVENTS");
  console.log("Sources:", SOCIAL_SOURCES.length);

  return [];
}
