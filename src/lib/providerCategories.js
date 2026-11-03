export const PROVIDER_CATEGORIES = [
  { id: "animatori", name: "Animatori" },
  { id: "sale_feste", name: "Sale Feste" },
  { id: "play_center", name: "Ludoteche e centri gioco" }
];

const CATEGORY_ALIASES = new Map([
  ["animator", ["animatori"]],
  ["animatore", ["animatori"]],
  ["animatori", ["animatori"]],
  ["venue", ["sale_feste"]],
  ["party_room", ["sale_feste"]],
  ["party_venue", ["sale_feste"]],
  ["sala_feste", ["sale_feste"]],
  ["sale_feste", ["sale_feste"]],
  ["animator_and_venue", ["animatori", "sale_feste"]],
  ["animator_party_room", ["animatori", "sale_feste"]],
  ["animator_and_party_room", ["animatori", "sale_feste"]],
  ["animation_party_room", ["animatori", "sale_feste"]],
  ["animazione_sala", ["animatori", "sale_feste"]]
]);

function normalizeCategory(value) {
  return value.trim().toLocaleLowerCase("it-IT").replace(/[\s-]+/g, "_");
}

export function canonicalProviderCategories(category) {
  if (typeof category !== "string" || !category.trim()) return [];
  const value = category.trim();
  return CATEGORY_ALIASES.get(normalizeCategory(value)) ?? [value];
}

export function getProviderCategories(provider) {
  if (!provider || typeof provider !== "object") return [];

  const providerKind = typeof provider.provider_kind === "string"
    ? normalizeCategory(provider.provider_kind)
    : "";
  if (providerKind === "feste") {
    const partyType = typeof provider.party_type === "string"
      ? normalizeCategory(provider.party_type)
      : "";
    if (partyType === "animatore") return ["animatori"];
    if (partyType === "sala_feste" || partyType === "sala_feste_e_eventi") return ["sale_feste"];
    if (partyType === "animatore_e_sala") return ["animatori", "sale_feste"];
    return [];
  }

  return canonicalProviderCategories(provider.provider_kind);
}

export function canonicalProviderCategory(category) {
  return canonicalProviderCategories(category)[0] ?? "";
}

export function providerCategoryName(category) {
  return PROVIDER_CATEGORIES.find(({ id }) => id === category)?.name ?? category;
}
