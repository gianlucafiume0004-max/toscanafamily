import { canonicalProviderCategory } from "./providerCategories.js";

export const PARTY_TYPES = [
  { label: "Compleanno", keywords: ["compleanno", "birthday"] },
  { label: "Battesimo", keywords: ["battesimo"] },
  { label: "Comunione", keywords: ["comunione"] },
  { label: "Cresima", keywords: ["cresima"] },
  { label: "Festa privata", keywords: ["festa privata", "evento privato"] },
  { label: "Festa a tema", keywords: ["festa a tema", "tema"] },
  { label: "Evento aziendale", keywords: ["aziendale", "corporate"] },
  { label: "Matrimonio", keywords: ["matrimonio", "wedding"] },
  { label: "Altro", keywords: [] }
];

function providerText(provider) {
  return [provider.provider_kind, provider.name, provider.services, provider.notes]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT");
}

export function isPartyProvider(provider) {
  return canonicalProviderCategory(provider.provider_kind) === "feste";
}

export function getPartyTypes(provider) {
  const text = providerText(provider);
  const matches = PARTY_TYPES
    .filter(({ label, keywords }) => label !== "Altro" && keywords.some((keyword) => text.includes(keyword)))
    .map(({ label }) => label);
  return matches.length ? matches : ["Altro"];
}
