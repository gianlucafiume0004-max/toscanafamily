function getEvidence(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;

    let start = Math.max(0, match.index - 70);
    let end = Math.min(text.length, match.index + match[0].length + 90);
    if (
      start > 0 &&
      start < text.length &&
      text.charCodeAt(start) >= 0xdc00 &&
      text.charCodeAt(start) <= 0xdfff &&
      text.charCodeAt(start - 1) >= 0xd800 &&
      text.charCodeAt(start - 1) <= 0xdbff
    ) {
      start -= 1;
    }
    if (
      end > 0 &&
      end < text.length &&
      text.charCodeAt(end - 1) >= 0xd800 &&
      text.charCodeAt(end - 1) <= 0xdbff &&
      text.charCodeAt(end) >= 0xdc00 &&
      text.charCodeAt(end) <= 0xdfff
    ) {
      end += 1;
    }
    return text.slice(start, end).replace(/\s+/g, " ").trim();
  }

  return "";
}

const RESERVATION = "(?:prenotazion\\w*|iscrizion\\w*|registrazion\\w*)";
const REQUIRED_PATTERNS = [
  new RegExp(`${RESERVATION}\\s+(?:(?:online|anticipat\\w*|telefonic\\w*|preventiv\\w*)\\s+)*(?:(?:è|sono)\\s+)?(?:obbligator\\w*|richiest\\w*|necessar\\w*)`, "i"),
  new RegExp(`(?:obbligo|obbligator\\w*|necessit\\w*)\\s+di\\s+${RESERVATION}`, "i"),
  new RegExp(`(?:è|sono)\\s+(?:obbligator\\w*|richiest\\w*|necessar\\w*)\\s+(?:la\\s+)?${RESERVATION}`, "i"),
  /(?:prenotare|iscriversi|registrarsi)\s+(?:(?:è|sono)\s+)?obbligator\w*/i,
  /(?:è|sono)\s+(?:necessar\w*|obbligator\w*)\s+(?:prenotare|iscriversi|registrarsi)/i,
  /partecipazion\w*\s+previ\w*\s+(?:la\s+)?prenotazion\w*/i
];

const RECOMMENDED_PATTERNS = [
  new RegExp(`${RESERVATION}\\s+(?:(?:è|sono)\\s+)?(?:consigliat\\w*|raccomandat\\w*)`, "i"),
  new RegExp(`(?:consigliat\\w*|raccomandat\\w*)[^.!?]{0,60}${RESERVATION}`, "i"),
  new RegExp(`(?:si\\s+)?consigli\\w*[^.!?]{0,60}${RESERVATION}`, "i")
];

const NOT_REQUIRED_PATTERNS = [
  new RegExp(`${RESERVATION}\\s+(?:(?:non|nessuna)\\s+)(?:(?:è|sono)\\s+)?(?:necessar\\w*|obbligator\\w*|richiest\\w*)`, "i"),
  new RegExp(`non\\s+(?:(?:c['’]è|esiste)\\s+)?(?:alcun\\w*\\s+)?obbligo\\s+di\\s+${RESERVATION}`, "i"),
  new RegExp(`non\\s+(?:(?:è|sono)\\s+)?(?:necessar\\w*|obbligator\\w*|richiest\\w*)\\s+(?:alcuna?\\s+)?(?:la\\s+)?${RESERVATION}`, "i"),
  /non\s+(?:(?:è|sono)\s+)?necessar\w*\s+(?:prenotare|iscriversi|registrarsi)/i,
  new RegExp(`(?:senza|non\\s+serve)\\s+(?:alcuna\\s+)?${RESERVATION}`, "i"),
  /non\s+(?:occorre|serve|bisogna)\s+prenotare/i
];

const OPEN_ACCESS_PATTERNS = [
  /(?:accesso|ingresso|partecipazione)\s+(?:è\s+)?liber\w*/i,
  /(?:ingresso|accesso|partecipazione|event\w*|attivit[aà]\w*|laborator\w*)\s+(?:è\s+)?gratuit\w*/i
];

const LIMITED_PLACES_PATTERNS = [
  /post[oi]\s+limitati/i,
  /numero\s+(?:di\s+)?post[oi]\s+limitato/i,
  /disponibilit[aà]\s+limitata/i
];

function findEvidence(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return { index: match.index, evidence: match[0] };
  }
  return null;
}

export function classifyBookingText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return { status: "unclassified", booking_required: null, booking_notes: null };
  }

  const notRequired = findEvidence(text, NOT_REQUIRED_PATTERNS);
  const positiveText = NOT_REQUIRED_PATTERNS.reduce(
    (remaining, pattern) => remaining.replace(pattern, " "),
    text
  );
  const required = findEvidence(positiveText, REQUIRED_PATTERNS);
  const recommended = findEvidence(positiveText, RECOMMENDED_PATTERNS);
  const openAccess = findEvidence(text, OPEN_ACCESS_PATTERNS);
  const limitedPlaces = findEvidence(text, LIMITED_PLACES_PATTERNS);

  if ((required && recommended) || (required && notRequired) || (recommended && notRequired)) {
    const conflictingEvidence = [
      required,
      recommended,
      notRequired
    ].filter(Boolean);
    return {
      status: "unclassified",
      booking_required: null,
      booking_notes: [...new Set(conflictingEvidence.map((item) => item.evidence))].join(" | ")
    };
  }

  if (required) {
    return {
      status: "required",
      booking_required: true,
      booking_notes: getEvidence(positiveText, REQUIRED_PATTERNS)
    };
  }

  if (recommended) {
    return {
      status: "recommended",
      booking_required: false,
      booking_notes: getEvidence(positiveText, RECOMMENDED_PATTERNS)
    };
  }

  if (notRequired) {
    return {
      status: "not_required",
      booking_required: false,
      booking_notes: getEvidence(text, NOT_REQUIRED_PATTERNS)
    };
  }

  if (openAccess) {
    return {
      status: "free",
      booking_required: false,
      booking_notes: getEvidence(text, OPEN_ACCESS_PATTERNS)
    };
  }

  return {
    status: "unclassified",
    booking_required: null,
    booking_notes: limitedPlaces
      ? getEvidence(text, LIMITED_PLACES_PATTERNS)
      : null
  };
}
