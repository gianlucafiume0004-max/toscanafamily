export const PROVIDER_CATEGORIES = [
  { id: "feste", name: "Feste" },
  { id: "play_center", name: "Ludoteche e centri gioco" }
];

const CATEGORY_ALIASES = new Map([
  ["feste", "feste"],
  ["animator", "feste"],
  ["animatori", "feste"],
  ["party_room", "feste"],
  ["party_venue", "feste"],
  ["sale-feste", "feste"],
  ["sale_feste", "feste"],
  ["sale feste", "feste"]
]);

export function canonicalProviderCategory(category) {
  if (typeof category !== "string" || !category.trim()) return "";
  const normalized = category.trim().toLocaleLowerCase("it-IT");
  return CATEGORY_ALIASES.get(normalized) ?? category.trim();
}

export function providerCategoryName(category) {
  return PROVIDER_CATEGORIES.find(({ id }) => id === category)?.name ?? category;
}
