function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withoutCitySuffix(address, city) {
  if (!address || !city) return address;
  const escapedCity = escapeRegExp(city);
  return address.replace(new RegExp(`[,\\s]+${escapedCity}\\s*$`, "i"), "").trim();
}

function withoutLocationParts(address, city, province) {
  const locationParts = new Set([city, province].filter(Boolean).map((part) =>
    part.toLocaleLowerCase("it-IT")
  ));
  const street = address
    .split(",")
    .map((part) => part.trim())
    .filter((part) => !locationParts.has(part.toLocaleLowerCase("it-IT")))
    .join(", ");
  return withoutCitySuffix(street, city);
}

function addressFromNotes(notes) {
  const streetPattern = "(?:via|viale|piazza|piazzale|corso|lungarno|strada|vicolo|borgo|localita|frazione)\\s+[^\\n.;]+";
  const labeledAddress = new RegExp(
    `(?:\\bsede(?:\\s+(?:pubblicata|legale))?\\s*:?\\s*|\\b[\\p{L}\\d'’ -]{1,40}\\bpoint\\s*:\\s*)(${streetPattern})`,
    "iu"
  );
  const match = notes.match(labeledAddress) ?? notes.match(new RegExp(`\\b(${streetPattern})`, "iu"));
  return match?.[1]?.trim().replace(/[,.]+$/, "") ?? "";
}

export function providerStreetAddress(provider) {
  const city = asText(provider?.city);
  const province = asText(provider?.province);
  const address = asText(provider?.address);
  if (address) return withoutLocationParts(address, city, province);

  const notes = asText(provider?.notes);
  const noteAddress = addressFromNotes(notes);
  return withoutLocationParts(noteAddress, city, province);
}

export function providerNotesWithoutAddress(provider) {
  const notes = asText(provider?.notes);
  const address = providerStreetAddress(provider);
  if (!notes || !address) return notes;

  const locationLabel = "(?:sede(?:\\s+(?:pubblicata|legale))?\\s*:?\\s*|[\\p{L}\\d'’ -]{1,40}\\bpoint\\s*:\\s*)";
  const city = asText(provider?.city);
  const citySuffix = city ? `(?:,\\s*${escapeRegExp(city)})?` : "";
  const addressMention = new RegExp(
    `(?:\\s*(?:[;,]\\s*)?)(?:${locationLabel})?${escapeRegExp(address)}${citySuffix}[.;]?`,
    "iu"
  );
  return notes
    .replace(addressMention, " ")
    .replace(/\s+([,;.])/g, "$1")
    .replace(/[;,]\s*[;,]\s*/g, "; ")
    .trim()
    .replace(/^[,;:.]+|[,;:.]+$/g, "")
    .trim();
}

export function providerFullAddress(provider) {
  const address = providerStreetAddress(provider);
  const city = asText(provider?.city);
  if (!address) return city;
  if (!city || address.toLocaleLowerCase("it-IT").split(/[,\n]/).some((part) =>
    part.trim().toLocaleLowerCase("it-IT") === city.toLocaleLowerCase("it-IT")
  )) return address;
  return `${address}, ${city}`;
}

export function providerDirectionsUrl(provider) {
  const hasCoordinates = provider?.latitude != null &&
    provider?.latitude !== "" &&
    provider?.longitude != null &&
    provider?.longitude !== "";
  const latitude = hasCoordinates ? Number(provider.latitude) : NaN;
  const longitude = hasCoordinates ? Number(provider.longitude) : NaN;
  const validCoordinates = Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    (latitude !== 0 || longitude !== 0);
  const destination = validCoordinates
    ? `${latitude},${longitude}`
    : [
        providerFullAddress(provider),
        asText(provider?.province),
        "Italia"
      ].filter(Boolean).join(", ");

  return destination
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`
    : "";
}
