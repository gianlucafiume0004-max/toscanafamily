const SERVICE_TAGS = [
  {
    id: "magic",
    label: "🎩 Magia",
    pattern: /\b(?:mago|magia|illusion\w*|micromagia|prestigiator\w*)\b/
  },
  {
    id: "face-painting",
    label: "🎨 Truccabimbi",
    pattern: /\b(?:truccabimbi|trucco\s+(?:viso|bimbi|bambini)|face\s*painting)\b/
  },
  {
    id: "baby-dance",
    label: "🎈 Baby Dance",
    pattern: /\b(?:baby[\s-]*dance|babydance)\b/
  },
  {
    id: "giant-bubbles",
    label: "🫧 Bolle Giganti",
    pattern: /\bbolle(?:\s+(?:di\s+sapone|giganti))?\b/
  },
  {
    id: "mascots",
    label: "🎭 Mascotte",
    pattern: /\bmascott\w*\b/
  },
  {
    id: "inflatables",
    label: "🏰 Gonfiabili",
    pattern: /\bgonfiabil\w*\b/
  },
  {
    id: "birthdays",
    label: "🎂 Compleanni",
    pattern: /\bcompleann\w*\b/
  },
  {
    id: "workshops",
    label: "🧪 Laboratori",
    pattern: /\blaborator\w*\b|\bworkshop\w*\b/
  },
  {
    id: "shows",
    label: "🎤 Spettacoli",
    pattern: /\bspettacol\w*\b|\besibizion\w*\b/
  }
];

function normalizeServices(services) {
  const text = Array.isArray(services)
    ? services.filter((value) => typeof value === "string").join(" ")
    : typeof services === "string"
      ? services
      : "";

  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it-IT");
}

export function providerServiceTags(services) {
  const normalizedServices = normalizeServices(services);
  if (!normalizedServices) return [];

  return SERVICE_TAGS
    .filter(({ pattern }) => pattern.test(normalizedServices))
    .map(({ id, label }) => ({ id, label }));
}
