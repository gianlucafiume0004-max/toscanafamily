import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase.js";
import Activities from "./pages/Activities.jsx";
import ProviderDetail from "./pages/ProviderDetail.jsx";
import Parks, { isTargetProvince } from "./pages/Parks.jsx";
import { canonicalProviderCategory } from "./lib/providerCategories.js";

const PARTY_PROVIDER_TYPES = [
  { value: "animatore", label: "Animatori" },
  { value: "sala_feste", label: "Sale Feste / Eventi" }
];

const PARTY_KIND_ALIASES = new Map([
  ["animator", "animator"],
  ["animatore", "animator"],
  ["animatori", "animator"],
  ["venue", "venue"],
  ["party_room", "venue"],
  ["party_venue", "venue"],
  ["sale_feste", "venue"],
  ["sala_feste", "venue"],
  ["animator_and_venue", "animator_and_venue"],
  ["animator_party_room", "animator_and_venue"],
  ["animator_and_party_room", "animator_and_venue"],
  ["animation_party_room", "animator_and_venue"],
  ["animazione_sala", "animator_and_venue"]
]);

function partyProviderKind(provider) {
  const kind = typeof provider.provider_kind === "string"
    ? provider.provider_kind.trim().toLocaleLowerCase("it-IT").replace(/[\s-]+/g, "_")
    : "";
  return PARTY_KIND_ALIASES.get(kind) ?? "";
}

function normalizedPartyType(provider) {
  return typeof provider.party_type === "string"
    ? provider.party_type.trim().toLocaleLowerCase("it-IT")
    : "";
}

function isPartyProvider(provider) {
  return canonicalProviderCategory(provider.provider_kind) === "feste" || Boolean(partyProviderKind(provider));
}

const TABS = [
  { key: "parks", label: "Parchi", icon: "🌳" },
  { key: "events", label: "Eventi", icon: "🎉" },
  { key: "feste", label: "Feste", icon: "🎉" },
  { key: "play_center", label: "Ludoteche", icon: "🧸" }
];

const AGE_FILTERS = [
  { value: "0-3", label: "0-3 anni", min: 0, max: 3 },
  { value: "3-6", label: "3-6 anni", min: 3, max: 6 },
  { value: "6-10", label: "6-10 anni", min: 6, max: 10 },
  { value: "10+", label: "10+ anni", min: 10, max: Infinity }
];

const EVENT_AGE_COLORS = [
  { value: "0-3", color: "#36a9e1" },
  { value: "3-6", color: "#42a66c" },
  { value: "6-10", color: "#ed9238" },
  { value: "10+", color: "#8957b5" }
];

const EVENT_WHEN_OPTIONS = [
  ["all", "Tutti"],
  ["today", "Oggi"],
  ["tomorrow", "Domani"],
  ["weekend", "Questo weekend"],
  ["next-7-days", "Prossimi 7 giorni"],
  ["date", "Scegli data"]
];

const EVENT_IDEA_CHIPS = [
  {
    value: "Letture",
    label: "📚 Letture",
    terms: ["lettura", "letture", "lettura animata", "leggere", "libro", "libri", "libreria", "storie", "storia", "racconto", "racconti", "fiaba", "fiabe", "biblioteca", "biblioteche", "narrazione", "narratore", "autore", "autrice", "autori", "autrici", "poesia", "poesie", "parola", "parole", "scrittura", "presentazione libro", "presentazione di un libro", "incontro con l'autore", "incontro con l'autrice"]
  },
  {
    value: "Laboratori",
    label: "🎨 Laboratori",
    terms: ["laboratorio", "laboratori", "laboratorio creativo", "attivita creativa", "attivita manuale", "atelier", "workshop", "costruire", "creare", "disegnare", "dipingere", "pittura", "ceramica", "manipolazione", "lavoretto", "lavoretti"]
  },
  {
    value: "Teatro",
    label: "🎭 Teatro",
    terms: ["teatro", "teatrale", "spettacolo", "spettacolo teatrale", "burattini", "burattino", "marionette", "marionetta", "teatro ragazzi", "teatro per bambini", "performance", "musical"]
  },
  {
    value: "Cinema",
    label: "🎬 Cinema",
    terms: ["cinema", "film", "proiezione", "proiezioni", "cartone animato", "cartoni animati", "animazione", "animazione cinematografica", "cortometraggio", "cortometraggi", "cineforum", "rassegna cinematografica"]
  },
  {
    value: "Musei",
    label: "🏛️ Musei",
    terms: ["museo", "musei", "mostra", "mostre", "visita guidata", "visite guidate", "visita al museo", "percorso museale", "esposizione", "esposizioni", "galleria", "archeologia", "patrimonio", "arte"]
  },
  {
    value: "Natura",
    label: "🌳 Natura",
    terms: ["natura", "ambiente", "bosco", "boschi", "fattoria", "fattorie", "animali", "animale", "escursione", "escursioni", "passeggiata", "passeggiate", "giardino", "giardini", "parco", "parchi", "orto", "ecologia", "all'aperto", "outdoor", "trekking", "sentiero", "sentieri"]
  },
  {
    value: "Sport",
    label: "⚽ Sport",
    terms: ["sport", "sportivo", "sportiva", "calcio", "basket", "pallavolo", "tennis", "nuoto", "piscina", "corsa", "atletica", "ginnastica", "yoga", "bicicletta", "bici", "ciclismo", "pattinaggio", "arrampicata", "torneo"]
  },
  {
    value: "Musica",
    label: "🎵 Musica",
    terms: ["musica", "musicale", "concerto", "concerti", "orchestra", "coro", "canto", "cantare", "strumento", "strumenti", "laboratorio musicale"]
  },
  {
    value: "Danza",
    label: "💃 Danza",
    terms: ["danza", "ballo", "balletto", "coreografia", "danzare", "ballare"]
  },
  {
    value: "Scienza",
    label: "🔬 Scienza",
    terms: ["scienza", "scientifico", "scientifica", "esperimento", "esperimenti", "astronomia", "spazio", "pianeti", "stelle", "tecnologia", "robot", "robotica", "matematica", "fisica", "chimica", "osservatorio"]
  },
  {
    value: "Circo",
    label: "🎪 Circo",
    terms: ["circo", "circense", "clown", "giocoleria", "giocoliere", "acrobata", "acrobazia", "magia", "mago", "illusionismo"]
  },
  {
    value: "Cucina",
    label: "🍳 Cucina",
    terms: ["cucina", "cucinare", "ricetta", "ricette", "pasticceria", "biscotti", "pane", "pizza", "cioccolato", "laboratorio di cucina"]
  },
  {
    value: "Storia e castelli",
    label: "🏰 Storia e castelli",
    terms: ["storia", "storico", "storica", "castello", "castelli", "cavaliere", "cavalieri", "principessa", "principesse", "medioevo", "medievale", "archeologia", "rievocazione", "rievocazioni"]
  },
  {
    value: "Feste e sagre",
    label: "🎉 Feste e sagre",
    terms: ["festa", "feste", "sagra", "sagre", "festival", "fiera", "fiere", "manifestazione", "celebrazione"]
  },
  {
    value: "Mercatini",
    label: "🛍️ Mercatini",
    terms: ["mercatino", "mercatini", "mercato", "bancarelle", "artigianato"]
  },
  {
    value: "Genitori e famiglie",
    label: "👨‍👩‍👧‍👦 Genitori e famiglie",
    terms: ["genitori", "genitore", "famiglie", "famiglia", "mamma", "mamme", "papà", "babbo", "adulti e bambini", "genitori e bambini", "incontro per genitori", "sostegno alla genitorialità", "genitorialità"]
  },
  {
    value: "Tradizioni e folklore",
    label: "🏇 Tradizioni e folklore",
    terms: ["folklore", "folkloristico", "folkloristica", "tradizione", "tradizioni", "giostra", "giostre", "palio", "palii", "rievocazione", "rievocazioni", "corteo storico", "sbandieratori", "festa storica", "gioco storico"]
  }
];

const SEASONAL_EVENT_CHIPS = [
  {
    value: "Natale",
    label: "🎄 Natale",
    className: "christmas",
    terms: ["natale", "natalizio", "natalizia", "babbo natale", "mercatino di natale", "mercatini di natale", "albero di natale", "villaggio di natale", "presepe", "presepi", "avvento"]
  },
  {
    value: "Befana",
    label: "🧹 Befana",
    className: "epiphany",
    terms: ["befana", "epifania", "calza", "calze", "re magi"]
  },
  {
    value: "Carnevale",
    label: "🎭 Carnevale",
    className: "carnival",
    terms: ["carnevale", "carnevalesco", "carnevalesca", "maschera", "maschere", "mascherina", "sfilata", "coriandoli", "martedi grasso", "giovedi grasso"]
  },
  {
    value: "Festa del papà",
    label: "👔 Festa del papà",
    className: "fathers-day",
    terms: ["festa del papa", "festa dei papa", "papa", "babbo", "san giuseppe"]
  },
  {
    value: "Pasqua",
    label: "🐣 Pasqua",
    className: "easter",
    terms: ["pasqua", "pasquale", "uovo", "uova", "coniglio", "coniglietto", "caccia alle uova"]
  },
  {
    value: "Festa della mamma",
    label: "💐 Festa della mamma",
    className: "mothers-day",
    terms: ["festa della mamma", "festa delle mamme", "mamma", "mamme"]
  },
  {
    value: "Festa dei nonni",
    label: "👵 Festa dei nonni",
    className: "grandparents-day",
    terms: ["festa dei nonni", "nonni", "nonno", "nonna"]
  },
  {
    value: "Halloween",
    label: "🎃 Halloween",
    className: "halloween",
    terms: ["halloween", "zucca", "zucche", "mostro", "mostri", "strega", "streghe", "fantasma", "fantasmi", "dolcetto o scherzetto"]
  }
];

const SEASONAL_EVENT_CHIP_PRIORITY = [
  "Halloween",
  "Natale",
  "Befana",
  "Carnevale",
  "Festa del papà",
  "Pasqua",
  "Festa della mamma",
  "Festa dei nonni"
];

const EVENT_IDEA_CHIP_PRIORITY = [
  "Genitori e famiglie",
  "Letture",
  "Laboratori",
  "Teatro",
  "Cinema",
  "Musei",
  "Scienza",
  "Natura",
  "Sport",
  "Musica",
  "Danza",
  "Circo",
  "Cucina",
  "Storia e castelli",
  "Tradizioni e folklore",
  "Mercatini",
  "Feste e sagre"
];

const OTHER_IDEA_CHIP = {
  id: "idea:altre_idee",
  value: "Altre idee",
  label: "✨ Altre idee"
};

function addLocalDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function secondSundayOfMay(year) {
  const firstOfMay = new Date(year, 4, 1);
  const daysUntilSunday = (7 - firstOfMay.getDay()) % 7;
  return new Date(year, 4, 1 + daysUntilSunday + 7);
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(year, month - 1, day);
}

function seasonalKeywordIsVisible(keyword, today) {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const year = day.getFullYear();

  const recurrenceForYear = (recurrenceYear) => {
    if (keyword === "Natale") return new Date(recurrenceYear, 11, 25);
    if (keyword === "Befana") return new Date(recurrenceYear, 0, 6);
    if (keyword === "Carnevale") return addLocalDays(easterSunday(recurrenceYear), -47);
    if (keyword === "Festa del papà") return new Date(recurrenceYear, 2, 19);
    if (keyword === "Pasqua") return easterSunday(recurrenceYear);
    if (keyword === "Festa della mamma") return secondSundayOfMay(recurrenceYear);
    if (keyword === "Festa dei nonni") return new Date(recurrenceYear, 9, 2);
    if (keyword === "Halloween") return new Date(recurrenceYear, 9, 31);
    return null;
  };

  return [year - 1, year, year + 1].some((recurrenceYear) => {
    const recurrence = recurrenceForYear(recurrenceYear);
    if (!recurrence) return false;
    const start = addLocalDays(recurrence, -45);
    const end = keyword === "Natale"
      ? new Date(recurrenceYear + 1, 0, 11)
      : addLocalDays(recurrence, 5);
    return day >= start && day <= end;
  });
}

function eventSearchText(event) {
  function flatten(value) {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(flatten);
    if (value && typeof value === "object") {
      return ["name", "label", "category", "title"].flatMap((key) => flatten(value[key]));
    }
    return [];
  }

  return flatten([
    event.title,
    event.description,
    event.category,
    event.categories,
    event.tags,
    event.city,
    event.location
  ])
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT");
}

function matchesQuickKeyword(searchableText, keyword) {
  const chip = [...EVENT_IDEA_CHIPS, ...SEASONAL_EVENT_CHIPS]
    .find((item) => item.value === keyword);
  let normalizedText = ` ${normalizeEventText(searchableText).replace(/[^a-z0-9]+/g, " ").trim()} `;
  if (keyword === "Genitori e famiglie") {
    normalizedText = normalizedText.replace(/\bbabbo natale\b/g, " ");
  }
  return Boolean(chip?.terms.some((term) => {
    const normalizedTerm = normalizeEventText(term).replace(/[^a-z0-9]+/g, " ").trim();
    return normalizedText.includes(` ${normalizedTerm} `);
  }));
}

function eventChipId(type, value) {
  const identifier = normalizeEventText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `${type}:${identifier}`;
}

function getPrimaryEventChip(event, visibleSeasonalChips) {
  const searchableText = eventSearchText(event);
  const visibleSeasonalValues = new Set(visibleSeasonalChips.map((chip) =>
    typeof chip === "string" ? chip : chip.value
  ));

  for (const value of SEASONAL_EVENT_CHIP_PRIORITY) {
    if (visibleSeasonalValues.has(value) && matchesQuickKeyword(searchableText, value)) {
      return eventChipId("seasonal", value);
    }
  }

  for (const value of EVENT_IDEA_CHIP_PRIORITY) {
    if (matchesQuickKeyword(searchableText, value)) {
      return eventChipId("idea", value);
    }
  }

  return OTHER_IDEA_CHIP.id;
}

function matchesAgeRange(eventAgeRange, selectedAge) {
  if (!selectedAge) return true;
  if (typeof eventAgeRange !== "string" || !eventAgeRange.trim()) return false;

  const normalized = normalizeEventText(eventAgeRange);
  const numbers = [...normalized.matchAll(/\d+(?:[.,]\d+)?/g)];
  const hasRange = numbers.length > 1 && /\d\s*(?:-|–|—|a)\s*\d/.test(normalized);
  const isOpenEnded = numbers.length === 1 && /(?:\+|oltre|piu|maggiore|dai|da)\s*\d|\d\s*\+/.test(normalized);
  const hasAgeUnit = /\b(?:mesi?|months?|anni?|years?|yrs?)\b/.test(normalized);
  if (/\bbambin\w*\b/.test(normalized) && !hasRange && !isOpenEnded && !hasAgeUnit) return true;
  if (!numbers.length) return false;
  if (!hasRange && !isOpenEnded && !hasAgeUnit) return false;

  const ages = numbers.map((match, index) => {
    const nextNumberIndex = numbers[index + 1]?.index ?? normalized.length;
    const suffix = normalized.slice(match.index + match[0].length, nextNumberIndex);
    const explicitUnit = suffix.match(/\b(mesi?|months?|anni?|years?|yrs?)\b/)?.[1];
    const inheritedUnit = normalized
      .slice(numbers[hasRange ? numbers.length - 1 : index].index)
      .match(/\b(mesi?|months?|anni?|years?|yrs?)\b/)?.[1];
    const unit = explicitUnit ?? inheritedUnit ?? "anni";
    return Number(match[0].replace(",", ".")) * (/^(mesi?|months?)/.test(unit) ? 1 / 12 : 1);
  });
  if (ages.some((age) => !Number.isFinite(age))) return false;

  const range = AGE_FILTERS.find((item) => item.value === selectedAge);
  if (!range) return false;

  const min = isOpenEnded ? ages[0] : Math.min(...ages);
  const max = isOpenEnded ? Infinity : Math.max(...ages);
  return min <= range.max && max >= range.min;
}

function getEventAgeColors(eventAgeRange) {
  const matchingBands = EVENT_AGE_COLORS.filter(({ value }) =>
    matchesAgeRange(eventAgeRange, value)
  );
  const normalized = typeof eventAgeRange === "string"
    ? normalizeEventText(eventAgeRange)
    : "";
  const numericRange = normalized.match(
    /(\d+(?:[.,]\d+)?)\s*(?:-|–|—|a)\s*(\d+(?:[.,]\d+)?)(?:\s*(mesi?|months?|anni?|years?|yrs?))?/
  );
  const openEndedAge = normalized.match(
    /(?:\b(?:oltre|piu|maggiore|dai|da)\s*)?(\d+(?:[.,]\d+)?)\s*\+(?:\s*(mesi?|months?|anni?|years?|yrs?))?/
  ) ?? normalized.match(
    /\b(?:oltre|piu|maggiore|dai|da)\s*(\d+(?:[.,]\d+)?)(?:\s*(mesi?|months?|anni?|years?|yrs?))?/
  );

  if (numericRange || openEndedAge) {
    const unit = (numericRange?.[3] ?? openEndedAge?.[2]) || "anni";
    const toYears = (value) =>
      Number(value.replace(",", ".")) * (/^(mesi?|months?)/.test(unit) ? 1 / 12 : 1);
    const min = toYears(numericRange?.[1] ?? openEndedAge[1]);
    const max = numericRange ? toYears(numericRange[2]) : Infinity;
    const preciseBands = EVENT_AGE_COLORS.filter(({ value }) => {
      const band = AGE_FILTERS.find((item) => item.value === value);
      return value === "10+"
        ? max > band.min || (min === band.min && max === band.min)
        : max > band.min && min < band.max;
    });
    if (preciseBands.length) return preciseBands.map(({ color }) => color);
  }

  return (matchingBands.length ? matchingBands : EVENT_AGE_COLORS).map(({ color }) => color);
}

function normalizeEventText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT");
}

function localEventDate(value) {
  if (!isUsableEventText(value)) return null;
  const dateOnly = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function eventDateRange(event) {
  const start = localEventDate(event.starts_on);
  if (!start) return null;

  const end = localEventDate(event.ends_on) || start;
  return end < start ? { start, end: start } : { start, end };
}

function dateRangeIntersects(event, start, end = start) {
  const range = eventDateRange(event);
  return Boolean(range && range.start <= end && range.end >= start);
}

function getWhenDateRange(when, selectedDate) {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

  if (when === "today") return [startOfToday, startOfToday];
  if (when === "tomorrow") {
    const tomorrow = addDays(startOfToday, 1);
    return [tomorrow, tomorrow];
  }
  if (when === "weekend") {
    const daysUntilSaturday = today.getDay() === 0 ? -1 : 6 - today.getDay();
    const saturday = addDays(startOfToday, daysUntilSaturday);
    return [saturday, addDays(saturday, 1)];
  }
  if (when === "next-7-days") return [startOfToday, addDays(startOfToday, 6)];
  if (when === "date") {
    const selected = localEventDate(selectedDate);
    return selected ? [selected, selected] : null;
  }
  return null;
}

function HomeApp() {
  const [active, setActive] = useState("parks");
  const [parks, setParks] = useState([]);
  const [events, setEvents] = useState([]);
  const [providers, setProviders] = useState([]);
  const [city, setCity] = useState("");
  const [providerType, setProviderType] = useState("");
  const [eventAge, setEventAge] = useState("");
  const [eventWhen, setEventWhen] = useState("all");
  const [eventDate, setEventDate] = useState("");
  const [eventQuickKeyword, setEventQuickKeyword] = useState("");
  const [ideaPanelOpen, setIdeaPanelOpen] = useState(false);
  const [today, setToday] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);

  useEffect(() => {
    let timeoutId;
    const updateAtNextMidnight = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timeoutId = window.setTimeout(() => {
        setToday(new Date());
        updateAtNextMidnight();
      }, nextMidnight.getTime() - now.getTime());
    };

    updateAtNextMidnight();
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setErrors([]);

      const [parksResult, eventsResult, providersResult] = await Promise.all([
        supabase.from("parks").select("*").order("nome"),
        supabase.from("events").select("*").order("starts_on", { ascending: true }),
        supabase.from("providers").select("*").order("name")
      ]);

      if (cancelled) return;

      const nextErrors = [
        parksResult.error && `Parchi: ${parksResult.error.message}`,
        eventsResult.error && `Eventi: ${eventsResult.error.message}`,
        providersResult.error && `Attività: ${providersResult.error.message}`
      ].filter(Boolean);

      setErrors(nextErrors);
      setParks(parksResult.data ?? []);
      setEvents(eventsResult.data ?? []);
      setProviders(providersResult.data ?? []);
      setLoading(false);
    }

    loadData();
    return () => { cancelled = true; };
  }, []);

  const providerCounts = useMemo(() => ({
    feste: providers.filter(isPartyProvider).length,
    play_center: providers.filter((item) => item.provider_kind === "play_center").length
  }), [providers]);

  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const visibleEvents = events.filter((event) => {
    const range = eventDateRange(event);
    return !range || range.end >= todayStart;
  });

  const counts = {
    parks: parks.filter((park) =>
      park.outside_tuscany !== true && isTargetProvince(park.provincia, park.comune)
    ).length,
    events: visibleEvents.length,
    ...providerCounts
  };

  const currentItems = active === "parks"
    ? parks
    : active === "events"
      ? visibleEvents
      : providers.filter((item) => active === "feste"
        ? isPartyProvider(item)
        : canonicalProviderCategory(item.provider_kind) === active);

  const cities = useMemo(() => {
    const values = currentItems
      .map((item) => active === "parks" ? item.comune : item.city)
      .filter(Boolean);
    return [...new Set(values)].sort((a, b) => a.localeCompare(b, "it"));
  }, [currentItems, active]);

  const selectedEventDateRange = active === "events"
    ? getWhenDateRange(eventWhen, eventDate)
    : null;
  const filteredWithoutQuickChip = currentItems.filter((item) => {
    const itemCity = active === "parks" ? item.comune : item.city;
    if (city && itemCity !== city) return false;
    if (active === "feste") {
      if (providerType && normalizedPartyType(item) !== providerType) return false;
    }
    if (active !== "events") return true;
    if (selectedEventDateRange &&
      !dateRangeIntersects(item, selectedEventDateRange[0], selectedEventDateRange[1])) return false;
    if (eventWhen === "date" && !selectedEventDateRange) return false;
    if (!matchesAgeRange(item.age_range, eventAge)) return false;
    return true;
  });
  const visibleSeasonalChips = SEASONAL_EVENT_CHIPS.filter(({ value }) =>
    seasonalKeywordIsVisible(value, today)
  );
  const primaryChipByEvent = new Map();
  const primaryChipCounts = new Map();
  filteredWithoutQuickChip.forEach((item) => {
    const primaryChip = getPrimaryEventChip(item, visibleSeasonalChips);
    primaryChipByEvent.set(item, primaryChip);
    primaryChipCounts.set(primaryChip, (primaryChipCounts.get(primaryChip) ?? 0) + 1);
  });
  const ideaChipDefinitions = [
    ...EVENT_IDEA_CHIP_PRIORITY
      .map((value) => EVENT_IDEA_CHIPS.find((chip) => chip.value === value))
      .filter(Boolean),
    OTHER_IDEA_CHIP
  ];
  const ideaChipCounts = ideaChipDefinitions
    .map((chip) => ({
      ...chip,
      id: chip.id ?? eventChipId("idea", chip.value),
      count: primaryChipCounts.get(chip.id ?? eventChipId("idea", chip.value)) ?? 0
    }))
    .filter((chip) => chip.count > 0);
  const seasonalEventChipCounts = SEASONAL_EVENT_CHIP_PRIORITY
    .map((value) => visibleSeasonalChips.find((chip) => chip.value === value))
    .filter(Boolean)
    .map((chip) => ({
      ...chip,
      id: eventChipId("seasonal", chip.value),
      count: primaryChipCounts.get(eventChipId("seasonal", chip.value)) ?? 0
    }))
    .filter((chip) => chip.count > 0);
  const availableQuickChips = [...ideaChipCounts, ...seasonalEventChipCounts];
  const selectedQuickChipCount = availableQuickChips
    .find((chip) => chip.id === eventQuickKeyword)?.count ?? 0;
  const filtered = active === "events" && eventQuickKeyword
    ? filteredWithoutQuickChip.filter((item) =>
      primaryChipByEvent.get(item) === eventQuickKeyword
    )
    : filteredWithoutQuickChip;

  useEffect(() => {
    if (eventQuickKeyword && selectedQuickChipCount === 0) {
      setEventQuickKeyword("");
      if (eventQuickKeyword.startsWith("idea:")) {
        setIdeaPanelOpen(false);
      }
    }
  }, [eventQuickKeyword, selectedQuickChipCount]);

  const hasEventFilters = Boolean(
    city || eventAge || eventWhen !== "all" || eventQuickKeyword
  );

  function changeTab(key) {
    setActive(key);
    setCity("");
    setProviderType("");
    setEventAge("");
    setEventWhen("all");
    setEventDate("");
    setEventQuickKeyword("");
    setIdeaPanelOpen(false);
  }

  function resetEventFilters() {
    setCity("");
    setEventAge("");
    setEventWhen("all");
    setEventDate("");
    setEventQuickKeyword("");
    setIdeaPanelOpen(false);
  }

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-badge">LA PIANA</div>
        <h1>🌈 La Piana Family</h1>
</header>

      <section className="stats" aria-label="Contenuti disponibili">
        {TABS.map((tab) => (
          <button key={tab.key} className={`stat-card stat-${tab.key}`} onClick={() => changeTab(tab.key)}>
            <span className="stat-icon">{tab.icon}</span>
            <strong>{counts[tab.key] ?? 0}</strong>
            <small>{tab.label}</small>
          </button>
        ))}
      </section>

      <nav id="esplora" className="tabs" aria-label="Categorie">
        {TABS.map((tab) => (
          <button key={tab.key} className={active === tab.key ? "active" : ""} onClick={() => changeTab(tab.key)}>
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
        <a className="activities-menu-link" href="/attivita">Attività</a>
      </nav>

      <main>
        {active === "parks" ? (
          null
        ) : active === "feste" ? (
          <section className="activities-filters" aria-label="Filtri feste">
            <label>
              <span>Comune</span>
              <select value={city} onChange={(event) => setCity(event.target.value)}>
                <option value="">Tutti i comuni</option>
                {cities.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label>
              <span>Categoria</span>
              <select value={providerType} onChange={(event) => setProviderType(event.target.value)}>
                <option value="">Tutti</option>
                {PARTY_PROVIDER_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </section>
        ) : (
          <section className={`search-panel city-filter-panel ${active === "events" ? "event-filters" : ""}`}>
            <div className="city-filter-wrapper">
              <label className="search-label" htmlFor="city-filter">📍 Comune</label>
              <select
                id="city-filter"
                className="town-select"
                value={city}
                onChange={(event) => setCity(event.target.value)}
              >
                <option value="">Tutti i comuni</option>
                {cities.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            {active === "events" && (
              <>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
                  gap: "10px",
                  width: "100%",
                  minWidth: 0
                }}>
                  <div className="city-filter-wrapper">
                    <label className="search-label" htmlFor="event-when-filter">📅 Quando</label>
                    <select
                      id="event-when-filter"
                      className="town-select"
                      value={eventWhen}
                      onChange={(changeEvent) => setEventWhen(changeEvent.target.value)}
                    >
                      {EVENT_WHEN_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  {eventWhen === "date" && (
                    <div className="city-filter-wrapper">
                      <label className="search-label" htmlFor="event-date-filter">Scegli data</label>
                      <input
                        id="event-date-filter"
                        className="town-select"
                        type="date"
                        value={eventDate}
                        onChange={(changeEvent) => setEventDate(changeEvent.target.value)}
                      />
                    </div>
                  )}
                  <div className="city-filter-wrapper">
                    <label className="search-label" htmlFor="event-age-filter">👶 Età</label>
                    <select
                      id="event-age-filter"
                      className="town-select"
                      value={eventAge}
                      onChange={(changeEvent) => setEventAge(changeEvent.target.value)}
                    >
                      <option value="">Tutte</option>
                      {AGE_FILTERS.map((age) => (
                        <option key={age.value} value={age.value}>{age.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {ideaChipCounts.length > 0 && (
                  <div className="event-ideas-disclosure">
                    <button
                      className={`event-ideas-toggle${eventQuickKeyword.startsWith("idea:") ? " is-active" : ""}`}
                      type="button"
                      aria-expanded={ideaPanelOpen}
                      aria-controls="events-ideas-panel"
                      onClick={() => setIdeaPanelOpen((open) => !open)}
                    >
                      <span>
                        ✨ {ideaChipCounts.find((chip) => chip.id === eventQuickKeyword)?.value ?? "Idee"}
                      </span>
                      <span className="event-ideas-toggle-indicator" aria-hidden="true">
                        {ideaPanelOpen ? "▴" : "▾"}
                      </span>
                    </button>
                    <div
                      id="events-ideas-panel"
                      className="event-ideas-panel"
                      hidden={!ideaPanelOpen}
                    >
                      <div className="event-ideas-grid" role="group" aria-label="Idee">
                        {ideaChipCounts.map((chip) => {
                          const isActive = eventQuickKeyword === chip.id;
                          return (
                            <button
                              key={chip.id}
                              className={`event-quick-chip${isActive ? " is-active" : ""}`}
                              type="button"
                              aria-pressed={isActive}
                              onClick={() => {
                                setEventQuickKeyword(isActive ? "" : chip.id);
                                setIdeaPanelOpen(false);
                              }}
                            >
                              {chip.label} <span className="event-quick-chip-count">{chip.count}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
                {seasonalEventChipCounts.length > 0 && (
                  <div className="event-chip-group">
                    <h3>🎉 Periodi e feste</h3>
                    <div className="event-quick-keywords" role="group" aria-label="Periodi e feste">
                      {seasonalEventChipCounts.map((chip) => {
                        const isActive = eventQuickKeyword === chip.id;
                        return (
                          <button
                            key={chip.id}
                            className={`event-quick-chip event-quick-chip--${chip.className}${isActive ? " is-active" : ""}`}
                            type="button"
                            aria-pressed={isActive}
                            onClick={() => setEventQuickKeyword(isActive ? "" : chip.id)}
                          >
                            {chip.label} <span className="event-quick-chip-count">{chip.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {hasEventFilters && (
                  <button
                    type="button"
                    onClick={resetEventFilters}
                    style={{
                      alignSelf: "flex-start",
                      border: "0",
                      borderRadius: "10px",
                      padding: "8px 12px",
                      color: "#385448",
                      background: "#e8f3ed",
                      fontWeight: 800,
                      cursor: "pointer"
                    }}
                  >
                    Azzera filtri
                  </button>
                )}
              </>
            )}
          </section>
        )}
        {loading && <div className="message loading">Caricamento delle migliori idee per la famiglia...</div>}
        {errors.map((error) => <div key={error} className="message error">{error}</div>)}
        {!loading && active === "parks" && (
          <Parks parks={parks} hasError={errors.length > 0} />
        )}

        {!loading && active !== "parks" && (
          <div className="results-list">
            {active === "events" && <p className="events-shown-count">Risultati: {filtered.length}</p>}
            <div className="grid">
              {filtered.map((item) => (
                <Card
                  key={item.id}
                  item={item}
                  active={active}
                  onShowEventDetails={() => setSelectedEvent(item)}
                />
              ))}
            </div>
          </div>
        )}

        {!loading && active !== "parks" && filtered.length === 0 && errors.length === 0 && (
          <div className="message empty">
            {active === "events"
              ? "Nessun evento corrisponde ai filtri selezionati."
              : active === "feste"
                ? "Nessun provider corrisponde ai filtri selezionati. Prova a modificarli."
                : "Nessun risultato per il comune selezionato. Prova un altro comune."}
          </div>
        )}
        {selectedEvent && (
          <EventDetails event={selectedEvent} onClose={() => setSelectedEvent(null)} />
        )}
      </main>

      <footer>
        <p><strong>© 2026 Gianluca Fiume · La Piana Family. Tutti i diritti riservati.</strong></p>
        <p>È vietata la riproduzione o riutilizzazione non autorizzata del codice, del database e dei contenuti proprietari.</p>
        <p>Le informazioni della community sono soggette a moderazione e verifica.</p>
      </footer>
    </div>
  );
}

function Card({ item, active, onShowEventDetails }) {
  if (active === "events") {
    const directions = eventDirectionsUrl(item);
    const eventLocation = [item.city, item.location].filter(isUsableEventText).join(" · ");
    const ageColors = getEventAgeColors(item.age_range);

    return (
      <article
        className="content-card event-card"
        style={{ "--event-age-colors": ageColors.join(", ") }}
      >
        <div className="card-body">
          <h3>{item.title}</h3>
          {isUsableEventText(item.starts_on) && (
            <p className="date">📅 {formatEventDateTime(item.starts_on)}</p>
          )}
          {eventLocation && <p className="location">📍 {eventLocation}</p>}
          <div className="card-actions event-card-actions">
            <button type="button" onClick={onShowEventDetails}>ℹ️ Tutte le info</button>
            {directions && (
              <a href={directions} target="_blank" rel="noreferrer">🚗 Portami qui</a>
            )}
          </div>
        </div>
      </article>
    );
  }

  const icon = active === "feste" ? "🎉" : "🧸";
  return (
    <article className="content-card provider-card">
      <div className="card-icon">{icon}</div>
      <div className="card-body">
        <h3><a className="provider-card-link" href={`/provider/${encodeURIComponent(item.id)}`}>{item.name}</a></h3>
        <p className="location">📍 {item.city} · {item.province}</p>
        {item.services && <p className="description">{item.services}</p>}
        {item.hours && <p>🕒 {item.hours}</p>}
        {item.price && <p>💶 {item.price}</p>}
        <div className="card-actions">
          {item.phone && <a href={`tel:${item.phone}`}>Chiama</a>}
          {item.website && <a href={item.website} target="_blank" rel="noreferrer">Sito ufficiale</a>}
        </div>
      </div>
    </article>
  );
}

function EventDetails({ event, onClose }) {
  useEffect(() => {
    function closeWithEscape(keyEvent) {
      if (keyEvent.key === "Escape") onClose();
    }

    document.addEventListener("keydown", closeWithEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeWithEscape);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const schedule = [...new Set([event.starts_on, event.ends_on]
    .filter(isUsableEventText)
    .map(formatEventDateTime)
    .filter(Boolean))]
    .join(" – ");
  const location = [...new Set([event.city, event.location].filter(isUsableEventText))]
    .join(" · ");
  const ageRange = formatEventAgeRange(event.age_range);
  const cost = isUsableEventText(event.cost) &&
    normalizeEventText(event.cost) !== "non pubblicato"
    ? event.cost.trim()
    : "";
  const officialUrl = getHttpUrl(event.source_url);
  const details = [
    { label: "📅 Quando", value: schedule },
    { label: "📍 Dove", value: location },
    { label: "👶 Età consigliata", value: ageRange },
    { label: "💶 Costo", value: cost }
  ].filter(({ value }) => isUsableEventText(value));
  if (officialUrl) {
    details.push({
      label: "🔗 Pagina ufficiale",
      value: (
        <a href={officialUrl} target="_blank" rel="noopener noreferrer">
          Apri la pagina ufficiale
        </a>
      )
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="park-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-details-title"
        onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="Chiudi">×</button>
        <div className="modal-hero">
          <span>🎉</span>
          <div>
            <small>DETTAGLI EVENTO</small>
            <h2 id="event-details-title">{event.title}</h2>
          </div>
        </div>
        <div className="event-details-content">
          {isUsableEventText(event.description) && (
            <section className="event-detail-description">
              <h3>Descrizione</h3>
              <p>{event.description}</p>
            </section>
          )}
          {details.length > 0 && (
            <div className="details-grid event-details-grid">
              {details.map(({ label, value }) => (
                <div className="detail-item" key={label}>
                  <strong>{label}</strong>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Chiudi</button>
        </div>
      </section>
    </div>
  );
}

function isUsableEventText(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function formatEventAgeRange(value) {
  if (!isUsableEventText(value)) return "";
  if (/\bbambini\s+e\s+famiglie\b/i.test(value)) return "👨‍👩‍👧‍👦 Per tutta la famiglia";

  return value.trim();
}

function getHttpUrl(value) {
  if (!isUsableEventText(value)) return "";

  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function eventDirectionsUrl(event) {
  const latitude = Number(event.latitude);
  const longitude = Number(event.longitude);
  const hasCoordinates = isUsableEventText(String(event.latitude ?? "")) &&
    isUsableEventText(String(event.longitude ?? "")) &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;
  const destination = hasCoordinates
    ? `${latitude},${longitude}`
    : [event.address, event.city].filter(isUsableEventText).join(", ");

  return destination
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`
    : "";
}

function formatEventDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const dateText = new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
  const containsTime = typeof value === "string" && /T\d{2}:\d{2}/.test(value);

  return containsTime
    ? `${dateText}, ${new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(date)}`
    : dateText;
}


export default function App() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    function updatePathname() {
      setPathname(window.location.pathname);
    }
    window.addEventListener("popstate", updatePathname);
    return () => window.removeEventListener("popstate", updatePathname);
  }, []);

  if (pathname === "/attivita") return <Activities />;
  const providerMatch = pathname.match(/^\/provider\/([^/]+)\/?$/);
  if (providerMatch) {
    let providerId;
    try {
      providerId = decodeURIComponent(providerMatch[1]);
    } catch {
      return <p className="provider-detail-message error" role="alert">Indirizzo provider non valido.</p>;
    }
    return <ProviderDetail providerId={providerId} />;
  }
  return <HomeApp />;
}
