import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase.js";
import Activities from "./pages/Activities.jsx";
import ProviderDetail from "./pages/ProviderDetail.jsx";
import Parks, { isTargetProvince } from "./pages/Parks.jsx";
import { getProviderCategories } from "./lib/providerCategories.js";
import ProviderFeatureCard from "./components/ProviderFeatureCard.jsx";
import useProviderRatingStats from "./hooks/useProviderRatingStats.js";
import { withProviderRatingStats } from "./lib/providerReviews.js";

const TABS = [
  { key: "parks", label: "Parchi", icon: "🌳" },
  { key: "events", label: "Eventi", icon: "🎉" },
  { key: "animatori", label: "Animatori", icon: "🎈" },
  { key: "sale_feste", label: "Sale Feste", icon: "🏠" },
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
    terms: ["natale", "natalizio", "natalizia", "babbo natale", "elfo", "elfi", "elfo di natale", "mercatino di natale", "mercatini di natale", "albero di natale", "villaggio di natale", "presepe", "presepi", "avvento"]
  },
  {
    value: "Befana",
    label: "🧹 Befana",
    className: "epiphany",
    terms: [
      "befana",
      "epifania",
      "calza",
      "calza della befana",
      "arriva la befana",
      "dolci della befana",
      "notte della befana",
      "festa della befana"
    ]
  },
  {
    value: "Carnevale",
    label: "🎭 Carnevale",
    className: "carnival",
    terms: ["carnevale", "carnevalesco", "carnevalesca", "mascherato", "mascherata", "maschera", "maschere", "mascherina", "sfilata mascherata", "coriandoli", "martedi grasso", "giovedi grasso"]
  },
  {
    value: "Festa del papà",
    label: "👔 Festa del papà",
    className: "fathers-day",
    terms: ["festa del papa", "festa dei papa", "19 marzo", "san giuseppe"]
  },
  {
    value: "Pasqua",
    label: "🐣 Pasqua",
    className: "easter",
    terms: ["pasqua", "pasquale", "uovo di pasqua", "uova di pasqua", "caccia alle uova", "coniglio pasquale", "coniglietto pasquale", "caccia all uovo"]
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
    terms: ["festa dei nonni", "giornata dei nonni", "festa dei nonni e degli anziani"]
  },
  {
    value: "Ritorno a scuola",
    label: "🎒 Ritorno a scuola",
    className: "back-to-school",
    terms: [
      "ritorno a scuola",
      "back to school",
      "inizio della scuola",
      "primo giorno di scuola",
      "materiale scolastico",
      "forniture scolastiche",
      "corredo scolastico",
      "zaino scolastico",
      "diario scolastico"
    ]
  },
  {
    value: "Halloween",
    label: "🎃 Halloween",
    className: "halloween",
    terms: [
      "halloween",
      "zucca",
      "zucche",
      "mostro",
      "mostri",
      "strega",
      "streghe",
      "fantasma",
      "fantasmi",
      "dolcetto o scherzetto",
      "trick or treat",
      "da paura"
    ]
  },
  {
    value: "Capodanno",
    label: "🎆 Capodanno",
    className: "new-year",
    terms: ["capodanno", "anno nuovo", "san silvestro", "notte di san silvestro", "veglione di fine anno", "festa di fine anno"]
  }
];

const SEASONAL_EVENT_CHIP_ORDER = [
  "Halloween",
  "Natale",
  "Capodanno",
  "Befana",
  "Carnevale",
  "Pasqua",
  "Festa del papà",
  "Festa della mamma",
  "Festa dei nonni",
  "Ritorno a scuola"
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

function seasonalChipVisibility(value, today) {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const year = day.getFullYear();
  const holidayWindowForYear = (holiday, holidayYear) => {
    const fixedWindow = (startMonth, startDay, endMonth, endDay) => {
      const start = new Date(holidayYear, startMonth, startDay);
      const endYear = endMonth < startMonth ? holidayYear + 1 : holidayYear;
      return {
        start,
        end: new Date(endYear, endMonth, endDay)
      };
    };

    if (holiday === "Halloween") {
      return { ...fixedWindow(9, 1, 10, 7), recurrence: new Date(holidayYear, 9, 31) };
    }
    if (holiday === "Natale") {
      return { ...fixedWindow(10, 25, 0, 6), recurrence: new Date(holidayYear, 11, 25) };
    }
    if (holiday === "Capodanno") {
      return { ...fixedWindow(11, 1, 0, 10), recurrence: new Date(holidayYear + 1, 0, 1) };
    }
    if (holiday === "Carnevale") {
      const recurrence = addLocalDays(easterSunday(holidayYear), -47);
      return { start: addLocalDays(recurrence, -30), end: recurrence, recurrence };
    }
    if (holiday === "Pasqua") {
      const recurrence = easterSunday(holidayYear);
      return { start: addLocalDays(recurrence, -30), end: addLocalDays(recurrence, 15), recurrence };
    }
    if (holiday === "Festa del papà") {
      return { ...fixedWindow(1, 19, 2, 19), recurrence: new Date(holidayYear, 2, 19) };
    }
    if (holiday === "Festa della mamma") {
      const firstOfMay = new Date(holidayYear, 4, 1);
      const secondSunday = new Date(
        holidayYear,
        4,
        1 + ((7 - firstOfMay.getDay()) % 7) + 7
      );
      return { start: addLocalDays(secondSunday, -30), end: secondSunday, recurrence: secondSunday };
    }
    if (holiday === "Festa dei nonni") {
      return { ...fixedWindow(8, 1, 9, 5), recurrence: new Date(holidayYear, 9, 2) };
    }
    if (holiday === "Ritorno a scuola") {
      return { ...fixedWindow(7, 15, 8, 30), recurrence: new Date(holidayYear, 8, 1) };
    }
    if (holiday === "Befana") {
      return { ...fixedWindow(11, 1, 0, 10), recurrence: new Date(holidayYear + 1, 0, 6) };
    }
    return null;
  };

  const activeWindows = [year - 1, year, year + 1]
    .map((holidayYear) => holidayWindowForYear(value, holidayYear))
    .filter(Boolean);
  const activeWindow = activeWindows.find(({ start, end }) => day >= start && day <= end);
  if (activeWindow) {
    return { priority: 1, windowEnd: activeWindow.end, recurrence: activeWindow.recurrence };
  }

  return null;
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

function eventText(event) {
  return [event.cost, event.description].filter(isUsableEventText).join(" ");
}

function eventPhoneData(event) {
  const description = [event.description, event.booking_notes]
    .filter(isUsableEventText)
    .join(" ");
  const phoneFromDescription = description.match(
    /(?:\+|00)?39[\s().-]*[03](?:[\s().-]*\d){7,10}|(?:\+|00)?[03](?:[\s().-]*\d){8,10}/
  )?.[0];
  const phone = isUsableEventText(event.phone)
    ? event.phone.trim()
    : phoneFromDescription || "";
  const digits = phone.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 15) {
    return { phone: "", phoneLink: "", whatsappUrl: "" };
  }

  const trimmedPhone = phone.trim();
  const explicitInternational = trimmedPhone.startsWith("+") || trimmedPhone.startsWith("00");
  let internationalDigits = digits;
  if (trimmedPhone.startsWith("00")) internationalDigits = internationalDigits.slice(2);
  if (!explicitInternational && /^[03]/.test(internationalDigits)) {
    internationalDigits = `39${internationalDigits}`;
  }

  if (internationalDigits.length < 8 || internationalDigits.length > 15) {
    return { phone: "", phoneLink: "", whatsappUrl: "" };
  }

  const localItalianNumber = internationalDigits.startsWith("39") ? internationalDigits.slice(2) : "";
  const isItalianMobile = localItalianNumber.startsWith("3") &&
    (localItalianNumber.length === 9 || localItalianNumber.length === 10);

  return {
    phone,
    phoneLink: `tel:+${internationalDigits}`,
    whatsappUrl: isItalianMobile ? `https://wa.me/${internationalDigits}` : ""
  };
}

function eventEmail(event) {
  if (isUsableEventText(event.email)) return event.email.trim();
  const found = [event.description, event.booking_notes]
    .filter(isUsableEventText)
    .join(" ")
    .match(
      /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z]{2,})+(?![A-Z0-9.-])/i
    )?.[0];
  if (!found) return "";

  const [localPart, ...domainParts] = found.split("@");
  const cleanedLocalPart = localPart.replace(/^\d{8,}(?=[A-Z])/i, "");
  const email = `${cleanedLocalPart}@${domainParts.join("@")}`;
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z]{2,})+$/i.test(email)
    ? email
    : "";
}

function eventActionItems(event) {
  const { phoneLink, whatsappUrl } = eventPhoneData(event);
  const email = eventEmail(event);
  const officialUrl = getHttpUrl(event.official_url);
  const sourceUrl = getHttpUrl(event.source_url);
  const organizerUrl = getHttpUrl(event.website_url) ||
    [officialUrl, sourceUrl].find(isHomePageUrl) ||
    "";
  const eventPageUrl = [officialUrl, sourceUrl].find((url) => url && !isHomePageUrl(url)) || "";
  const mappedBookingUrl = getMappedEventBookingUrl(eventPageUrl);
  const bookingUrl = mappedBookingUrl ||
    (isEventBookingUrl(event.booking_url) ? getHttpUrl(event.booking_url) : "");
  const fallbackPageUrl = !eventPageUrl &&
    isGenericEventPageUrl(event.booking_url)
    ? getHttpUrl(event.booking_url)
    : "";
  return [
    phoneLink && {
      label: "📞 Chiama",
      href: phoneLink,
      className: "event-booking-button--phone"
    },
    whatsappUrl && {
      label: "🟢 WhatsApp",
      href: whatsappUrl,
      className: "event-booking-button--whatsapp",
      external: true
    },
    email && {
      label: "📧 Email",
      href: `mailto:${email}`,
      className: "event-booking-button--email"
    },
    organizerUrl && {
      label: "🌐 Sito organizzatore",
      href: organizerUrl,
      className: "event-booking-button--website",
      external: true
    },
    eventPageUrl && eventPageUrl !== organizerUrl && {
      label: "🌐 Pagina evento",
      href: eventPageUrl,
      className: "event-booking-button--event-page",
      external: true
    },
    fallbackPageUrl && fallbackPageUrl !== eventPageUrl && fallbackPageUrl !== organizerUrl && {
      label: isHomePageUrl(fallbackPageUrl) ? "🌐 Sito organizzatore" : "🌐 Pagina evento",
      href: fallbackPageUrl,
      className: isHomePageUrl(fallbackPageUrl)
        ? "event-booking-button--website"
        : "event-booking-button--event-page",
      external: true
    },
    bookingUrl && {
      label: "🎟️ Prenota ora",
      href: bookingUrl,
      className: "event-booking-button--online",
      external: true
    }
  ].filter(Boolean);
}

function getMappedEventBookingUrl(eventPageUrl) {
  const safeUrl = getHttpUrl(eventPageUrl);
  if (!safeUrl) return "";

  const url = new URL(safeUrl);
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const pathname = url.pathname.toLowerCase();

  if (hostname === "museogalileo.it" &&
    pathname.startsWith("/it/attivita/calendario/lista-attivita/")) {
    return "https://biglietteria.museogalileo.it/prenota-visita-guidata.php?visita_guidata_id=1";
  }

  if (hostname === "tempolibero2.comune.prato.it" &&
    pathname === "/event/81087590-d37b-11f1-b3ae-a92d549ee3df/appointment/14634480-d37d-11f1-85ea-5799608caed6") {
    return "https://forms.gle/MPC2JCjwwJfkzDBQ6";
  }

  return "";
}

function EventDirectActions({ actions, className = "" }) {
  if (!actions.length) return null;
  return (
    <div className={`event-direct-actions ${className}`.trim()}>
      {actions.map((action) => (
        <a
          className={`event-booking-button ${action.className}`}
          href={action.href}
          key={action.label}
          target={action.external ? "_blank" : undefined}
          rel={action.external ? "noopener noreferrer" : undefined}
        >
          {action.label}
        </a>
      ))}
    </div>
  );
}

function eventCostInfo(event) {
  const costText = [event.cost, event.description, event.booking_notes]
    .filter(isUsableEventText)
    .join(" ");
  if (!costText) return null;

  const priceMatch = costText.match(
    /(?:\bda\s*)?(?:€\s*|eur(?:o)?\s*)(\d+(?:[.,]\d{1,2})?|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?)(?!\d)|(?:\bda\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur(?:o)?\b)/i
  );
  const amount = priceMatch?.[1] || priceMatch?.[2];
  if (amount) {
    const isStartingPrice = /^\s*da\b/i.test(priceMatch[0]);
    const formattedAmount = amount.replace(/\.(?=\d{1,2}$)/, ",");
    return {
      type: "paid",
      title: "💰 A pagamento",
      price: `${isStartingPrice ? "Da " : ""}€ ${formattedAmount}`
    };
  }

  const freeAccess = /\b(?:ingresso|accesso|partecipazione|event\w*)\s+(?:è\s+|ad\s+)?(?:gratuit\w*|liber\w*)\b/i.test(costText);
  if (freeAccess) return { type: "free", title: "🆓 Gratuito", price: "" };
  const free = /\b(?:gratuit\w*|gratis|free)\b/i.test(costText);
  if (free) return { type: "free", title: "🆓 Gratuito", price: "" };
  if (/\b(?:a|con)\s+pagamento\b/i.test(costText)) {
    return { type: "paid", title: "💰 A pagamento", price: "" };
  }
  return null;
}

function eventAccessInfo(event) {
  const text = [event.booking_notes, event.cost, event.description]
    .filter(isUsableEventText)
    .join(" ");
  return /\b(?:ingresso|accesso|partecipazione|event\w*|attivit\w*|laborator\w*)\s+(?:è\s+|ad\s+)?(?:gratuit\w*|liber\w*)\b/i.test(text)
    ? { type: "free", title: "🆓 Gratuito", price: "" }
    : null;
}

function eventReservationStatus(event) {
  const notes = isUsableEventText(event.booking_notes) ? event.booking_notes : "";
  const text = [eventText(event), notes]
    .filter(isUsableEventText)
    .join(" ");
  if (event.booking_required === true) return "Obbligatoria";
  if (/prenotazion\w*\s+(?:è\s+)?consigliat\w*|si\s+consiglia\s+(?:la\s+)?prenotazion\w*|prenotazion\w*\s+raccomandat\w*/i.test(notes)) return "Consigliata";
  if (/prenotazion\w*\s+(?:obbligator\w*|richiest\w*)|obbligo\s+di\s+prenotazion\w*|prenotare\s+(?:è\s+)?obbligator\w*|su\s+prenotazion\w*|iscrizion\w*\s+obbligator\w*/i.test(text)) {
    return "Obbligatoria";
  }
  if (/prenotazion\w*\s+(?:è\s+)?consigliat\w*|si\s+consiglia\s+(?:la\s+)?prenotazion\w*|prenotazion\w*\s+raccomandat\w*/i.test(text)) {
    return "Consigliata";
  }
  if (
    event.booking_required === false &&
    /prenotazion\w*\s+(?:non\s+(?:è\s+)?(?:necessari\w*|obbligator\w*|richiest\w*)|non\s+occorre|non\s+serve)|non\s+(?:è\s+)?(?:necessari\w*|obbligator\w*|richiest\w*)\s+(?:la\s+)?prenotazion\w*|senza\s+(?:alcuna\s+)?prenotazion\w*|non\s+(?:occorre|serve|bisogna)\s+(?:prenotare|la\s+prenotazion\w*)/i.test(notes)
  ) return "Non richiesta";
  return "";
}

function eventBookingInstructions(event) {
  return [event.booking_notes, event.description].find((value) =>
    isUsableEventText(value) && (
      /(?:prenot\w*|iscrizion\w*|registrazion\w*|modul\w*|form\b|bigliett\w*|ticket)[\s\S]{0,120}(?:online|telefon|telefono|chiam|tel\b|email|e-mail|mail|scriv|contatt|presso|compil|link|sito|acquist|invia)/i.test(value) ||
      /(?:online|telefon|telefono|chiam|tel\b|email|e-mail|mail|scriv|contatt|presso|compil|link|sito|acquist|invia)[\s\S]{0,120}(?:prenot\w*|iscrizion\w*|registrazion\w*|modul\w*|form\b|bigliett\w*|ticket)/i.test(value)
    )
  )?.trim() || "";
}

function eventReservationText(event) {
  const status = eventReservationStatus(event);
  if (status === "Non richiesta") return "✅ Senza prenotazione";
  if (status === "Consigliata") return "⚠️ Prenotazione consigliata";
  if (status === "Obbligatoria") return "🎟️ Prenotazione obbligatoria";
  return "";
}

function eventReservationClass(status) {
  return {
    "Non richiesta": "event-reservation--not-required",
    Consigliata: "event-reservation--recommended",
    Obbligatoria: "event-reservation--required"
  }[status] || "";
}

function EventCostBadge({ event, showReservation = true }) {
  const cost = eventCostInfo(event);
  const access = eventAccessInfo(event);
  const costs = access
    ? [access, ...(cost?.type === "paid" ? [cost] : [])]
    : cost ? [cost] : [];
  const reservationStatus = showReservation ? eventReservationStatus(event) : "";
  const reservationClass = eventReservationClass(reservationStatus);
  const reservationText = reservationClass ? eventReservationText(event) : "";
  if (!costs.length && !reservationClass) return null;
  return (
    <div className="event-cost-badges">
      {costs.map((badge, index) => (
        <div className={`event-cost-badge event-cost--${badge.type}`} key={`${badge.title}-${index}`}>
          <strong>{badge.title}</strong>
          {badge.price && <span>{badge.price}</span>}
        </div>
      ))}
      {reservationClass && (
        <div className={`event-cost-badge event-reservation-badge ${reservationClass}`}>
          <strong>{reservationText}</strong>
        </div>
      )}
    </div>
  );
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

function matchesSeasonalEvent(event, chip) {
  const normalize = (value) => normalizeEventText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const flatten = (value) => {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(flatten);
    if (value && typeof value === "object") {
      return ["name", "label", "category", "title"].flatMap((key) => flatten(value[key]));
    }
    return [];
  };
  const mainDescription = String(event.description || "")
    .split(/condividi su:|eventi e notizie/i)[0];
  const searchableText = normalize([
    ...flatten([event.title, event.category, event.categories, event.tags]),
    mainDescription
  ].join(" "));
  const paddedText = ` ${searchableText} `;
  return chip.terms.some((term) => paddedText.includes(` ${normalize(term)} `));
}

function eventChipId(type, value) {
  const identifier = normalizeEventText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `${type}:${identifier}`;
}

function getPrimaryIdeaChip(event) {
  const searchableText = eventSearchText(event);
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

function decodeHtmlEntities(value) {
  if (typeof value !== "string" || !value.includes("&")) return value;
  const decoder = document.createElement("textarea");
  let decoded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    decoder.innerHTML = decoded;
    const next = decoder.value.replace(/\u00a0/g, " ");
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function decodeEventHtmlEntities(event) {
  const textFields = new Set([
    "title",
    "description",
    "location",
    "address",
    "street_address",
    "city",
    "organizer",
    "booking_notes"
  ]);
  return Object.fromEntries(
    Object.entries(event).map(([key, value]) => [
      key,
      textFields.has(key) ? decodeHtmlEntities(value) : value
    ])
  );
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

function eventEndDateTime(event) {
  const start = localEventDate(event.starts_on);
  if (!start) return null;

  const end = localEventDate(event.ends_on) || start;
  const normalizedEnd = end < start ? start : end;
  const hasEndTime = isUsableEventText(event.ends_on) &&
    typeof event.ends_on === "string" &&
    /T\d{2}:\d{2}/.test(event.ends_on);

  if (hasEndTime && end >= start) {
    const parsedEnd = new Date(event.ends_on);
    const parsedStart = new Date(event.starts_on);
    if (
      !Number.isNaN(parsedEnd.getTime()) &&
      !Number.isNaN(parsedStart.getTime()) &&
      parsedEnd >= parsedStart &&
      (parsedEnd.getHours() !== 0 ||
        parsedEnd.getMinutes() !== 0 ||
        parsedEnd.getSeconds() !== 0 ||
        parsedEnd.getMilliseconds() !== 0)
    ) {
      return parsedEnd;
    }
  }

  return addLocalDays(normalizedEnd, 1);
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
  const { stats: providerRatingStats, error: providerRatingStatsError } = useProviderRatingStats();
  const [active, setActive] = useState("parks");
  const [parks, setParks] = useState([]);
  const [events, setEvents] = useState([]);
  const [providers, setProviders] = useState([]);
  const [city, setCity] = useState("");
  const [eventAge, setEventAge] = useState("");
  const [eventWhen, setEventWhen] = useState("all");
  const [eventDate, setEventDate] = useState("");
  const [eventQuickKeyword, setEventQuickKeyword] = useState("");
  const [ideaPanelOpen, setIdeaPanelOpen] = useState(false);
  const [today, setToday] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const providersWithRatingStats = useMemo(
    () => providers.map((provider) =>
      withProviderRatingStats(provider, providerRatingStats[provider.id])
    ),
    [providers, providerRatingStats]
  );

  useEffect(() => {
    let timeoutId;
    const minuteInterval = window.setInterval(() => setToday(new Date()), 60_000);
    const updateAtNextMidnight = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timeoutId = window.setTimeout(() => {
        setToday(new Date());
        updateAtNextMidnight();
      }, nextMidnight.getTime() - now.getTime());
    };

    updateAtNextMidnight();
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(minuteInterval);
    };
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
      setEvents((eventsResult.data ?? []).map(decodeEventHtmlEntities));
      setProviders(providersResult.data ?? []);
      setLoading(false);
    }

    loadData();
    return () => { cancelled = true; };
  }, []);

  const providerCounts = useMemo(() => ({
    animatori: providersWithRatingStats.filter((item) => getProviderCategories(item).includes("animatori")).length,
    sale_feste: providersWithRatingStats.filter((item) => getProviderCategories(item).includes("sale_feste")).length,
    play_center: providersWithRatingStats.filter((item) => item.provider_kind === "play_center").length
  }), [providersWithRatingStats]);

  const filteredVisibleEvents = events.filter((event) => {
    const endsAt = eventEndDateTime(event);
    return !endsAt || endsAt > today;
  });

  const counts = {
    parks: parks.filter((park) =>
      park.outside_tuscany !== true && isTargetProvince(park.provincia, park.comune)
    ).length,
    events: filteredVisibleEvents.length,
    ...providerCounts
  };

  const currentItems = active === "parks"
    ? parks
    : active === "events"
      ? filteredVisibleEvents
      : providersWithRatingStats.filter((item) => getProviderCategories(item).includes(active));

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
    if (active !== "events") return true;
    if (selectedEventDateRange &&
      !dateRangeIntersects(item, selectedEventDateRange[0], selectedEventDateRange[1])) return false;
    if (eventWhen === "date" && !selectedEventDateRange) return false;
    if (!matchesAgeRange(item.age_range, eventAge)) return false;
    return true;
  });
  const primaryChipByEvent = new Map();
  const primaryChipCounts = new Map();
  filteredWithoutQuickChip.forEach((item) => {
    const primaryChip = getPrimaryIdeaChip(item);
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
  const seasonalEventChipCounts = SEASONAL_EVENT_CHIP_ORDER
    .map((value) => SEASONAL_EVENT_CHIPS.find((chip) => chip.value === value))
    .map((chip) => {
      const matchingEvents = filteredWithoutQuickChip.filter((item) =>
        matchesSeasonalEvent(item, chip)
      );
      return {
        ...chip,
        id: eventChipId("seasonal", chip.value),
        visibility: seasonalChipVisibility(chip.value, today),
        count: matchingEvents.length
      };
    })
    .filter((chip) => chip.visibility)
    .sort((a, b) => {
      if (a.visibility.priority !== b.visibility.priority) {
        return a.visibility.priority - b.visibility.priority;
      }
      if (a.visibility.recurrence && b.visibility.recurrence) {
        return Math.abs(a.visibility.recurrence - today) -
          Math.abs(b.visibility.recurrence - today);
      }
      return b.count - a.count;
    })
    .map(({ visibility, ...chip }) => chip);
  const availableQuickChips = [...ideaChipCounts, ...seasonalEventChipCounts];
  const selectedSeasonalChip = eventQuickKeyword.startsWith("seasonal:")
    ? SEASONAL_EVENT_CHIPS.find((chip) =>
      eventChipId("seasonal", chip.value) === eventQuickKeyword
    )
    : null;
  const filtered = active === "events" && eventQuickKeyword
    ? filteredWithoutQuickChip.filter((item) =>
      selectedSeasonalChip
        ? matchesSeasonalEvent(item, selectedSeasonalChip)
        : primaryChipByEvent.get(item) === eventQuickKeyword
    )
    : filteredWithoutQuickChip;

  useEffect(() => {
    if (eventQuickKeyword && !availableQuickChips.some((chip) => chip.id === eventQuickKeyword)) {
      setEventQuickKeyword("");
      if (eventQuickKeyword.startsWith("idea:")) {
        setIdeaPanelOpen(false);
      }
    }
  }, [eventQuickKeyword, availableQuickChips]);

  const hasEventFilters = Boolean(
    city || eventAge || eventWhen !== "all" || eventQuickKeyword
  );

  function changeTab(key) {
    setActive(key);
    setCity("");
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
        ) : active === "animatori" || active === "sale_feste" ? (
          <section className="activities-filters" aria-label={`Filtri ${active === "animatori" ? "animatori" : "sale feste"}`}>
            <label>
              <span>Comune</span>
              <select value={city} onChange={(event) => setCity(event.target.value)}>
                <option value="">Tutti i comuni</option>
                {cities.map((name) => <option key={name} value={name}>{name}</option>)}
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
        {providerRatingStatsError && <div className="message error" role="alert">{providerRatingStatsError}</div>}
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
              : active === "animatori" || active === "sale_feste"
                ? "Nessun provider corrisponde ai filtri selezionati. Prova a modificarli."
                : "Nessun risultato per il comune selezionato. Prova un altro comune."}
          </div>
        )}
        {selectedEvent && (
          (!eventEndDateTime(selectedEvent) || eventEndDateTime(selectedEvent) > today) && (
          <EventDetails event={selectedEvent} onClose={() => setSelectedEvent(null)} />
          )
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
    const ageColors = getEventAgeColors(item.age_range);
    const ageRange = formatEventAgeRange(item.age_range);

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
          {isUsableEventText(item.location) || isUsableEventText(item.city) ? (
            <p className="location">
              📍 {[item.location, item.city]
                .filter(isUsableEventText)
                .filter((value, index, values) => values.indexOf(value) === index)
                .join(" · ")}
            </p>
          ) : null}
          {ageRange && <p className="event-age-badge">{ageRange}</p>}
          <EventCostBadge event={item} />
          <div className="card-actions event-card-actions">
            <button type="button" onClick={onShowEventDetails}>ℹ️ Tutte le info</button>
          </div>
        </div>
      </article>
    );
  }

  if (active === "animatori" || active === "sale_feste") {
    return (
      <ProviderFeatureCard
        provider={item}
        variant={active}
      />
    );
  }

  const icon = active === "animatori" ? "🎈" : active === "sale_feste" ? "🏠" : "🧸";
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

  const startDate = localEventDate(event.starts_on);
  const endDate = localEventDate(event.ends_on);
  const date = startDate
    ? `${formatEventDateOnly(startDate)}${endDate && endDate > startDate ? ` – ${formatEventDateOnly(endDate)}` : ""}`
    : "";
  const startTime = formatEventTime(event.starts_on);
  const endTime = formatEventTime(event.ends_on);
  const time = [...new Set([startTime, endTime].filter(Boolean))].join(" – ");
  const location = [event.location, event.city].filter(isUsableEventText).join(" · ");
  const address = isUsableEventText(event.street_address)
    ? event.street_address.trim()
    : isUsableEventText(event.address)
      ? event.address.split(",")[0].trim()
      : "";
  const streetNumber = [
    event.street_number,
    event.civic_number,
    event.house_number
  ].find(isUsableEventText)?.trim() ||
    address.split(",")[0].match(/(?:^|\s)(\d+[a-zA-Z]?(?:\/[0-9a-zA-Z]+)?)$/)?.[1] ||
    "";
  const directions = eventDirectionsUrl(event);
  const ageRange = formatEventAgeRange(event.age_range);
  const cost = eventCostInfo(event);
  const reservationStatus = eventReservationStatus(event);
  const bookingInstructions = eventBookingInstructions(event);
  const organizer = isUsableEventText(event.organizer) ? event.organizer.trim() : "";
  const actionItems = eventActionItems(event);
  const canShowBookingDetails = reservationStatus === "Obbligatoria" ||
    reservationStatus === "Consigliata" ||
    Boolean(bookingInstructions) ||
    actionItems.some((action) => [
      "event-booking-button--phone",
      "event-booking-button--whatsapp",
      "event-booking-button--email",
      "event-booking-button--event-page",
      "event-booking-button--online"
    ].includes(action.className));
  const addressStreet = streetNumber
    ? address.replace(new RegExp(`(?:\\s|,)${streetNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "").trim()
    : address;
  const addressLines = [
    addressStreet,
    streetNumber ? `Numero civico: ${streetNumber}` : "",
    isUsableEventText(event.postal_code) ? `CAP: ${event.postal_code.trim()}` : "",
    isUsableEventText(event.city) ? `Comune: ${event.city.trim()}` : "",
    isUsableEventText(event.province) ? `Provincia: ${event.province.trim()}` : ""
  ].filter(Boolean);
  const highlightedActions = [
    directions && {
      label: "📍 Portami qui",
      href: directions,
      className: "event-booking-button--phone",
      external: true
    },
    ...actionItems.filter((action) => action.className === "event-booking-button--website" ||
      (!canShowBookingDetails && [
        "event-booking-button--phone",
        "event-booking-button--whatsapp",
        "event-booking-button--email"
      ].includes(action.className)))
  ].filter(Boolean);
  const bookingActionTypes = new Set([
    "event-booking-button--phone",
    "event-booking-button--whatsapp",
    "event-booking-button--email",
    "event-booking-button--event-page",
    "event-booking-button--online"
  ]);
  const seenBookingActionHrefs = new Set();
  const bookingActions = canShowBookingDetails
    ? actionItems.filter((action) => {
      if (!bookingActionTypes.has(action.className) || seenBookingActionHrefs.has(action.href)) {
        return false;
      }
      seenBookingActionHrefs.add(action.href);
      return true;
    })
    : [];
  const bookingContent = bookingActions.length > 0
    ? <EventDirectActions actions={bookingActions} />
    : null;
  const details = [
    { label: "📅 Data", value: date },
    { label: "⏰ Orario", value: time },
    { label: "📍 Luogo", value: location },
    addressLines.length > 0 && {
      label: "📍 Indirizzo",
      value: <div className="event-address-lines">{addressLines.map((line) => <span key={line}>{line}</span>)}</div>
    },
    cost && {
      label: "💰 Costo",
      value: <EventCostBadge event={event} showReservation={false} />
    },
    reservationStatus && {
      label: "🎟️ Prenotazione",
      value: (
        <span className={`event-cost-badge event-reservation-badge ${eventReservationClass(reservationStatus)}`}>
          <strong>{eventReservationText(event)}</strong>
        </span>
      )
    },
    canShowBookingDetails && {
      label: "🎟️ Come prenotare",
      value: bookingContent && <div className="event-booking-content">{bookingContent}</div>
    },
    organizer && { label: "👤 Organizzatore", value: organizer },
    ageRange && { label: "Età consigliata", value: ageRange }
  ].filter(Boolean);

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
        {highlightedActions.length > 0 && (
          <div className="event-highlighted-actions" aria-label="Azioni rapide evento">
            {highlightedActions.map((action) => (
              <a
                className={`event-booking-button ${action.className}`}
                href={action.href}
                key={action.label}
                target={action.external ? "_blank" : undefined}
                rel={action.external ? "noopener noreferrer" : undefined}
              >
                {action.label}
              </a>
            ))}
          </div>
        )}
        <div className="event-details-content">
          {details.length > 0 && (
            <div className="details-grid event-details-grid">
              {details.map(({ label, value }) => (
                <div
                  className={`detail-item${label === "💰 Costo" ? " event-cost-detail" : ""}${label === "🎟️ Prenotazione" ? " event-reservation-detail" : ""}${label === "🎟️ Come prenotare" ? " event-booking-detail" : ""}`}
                  key={label}
                >
                  <strong>{label}</strong>
                  {value !== null && value !== undefined && <span>{value}</span>}
                </div>
              ))}
            </div>
          )}
          {isUsableEventText(event.description) && (
            <section className="event-detail-description">
              <h3>Descrizione</h3>
              <p>{event.description}</p>
            </section>
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
  const text = value.trim().replace(/[–—]/g, "-").replace(/\s+/g, " ");
  const normalized = normalizeEventText(text);
  if (/\b(?:per tutti|tutta la famiglia|bambini e famiglie|tutte le eta)\b/.test(normalized)) {
    return "👨‍👩‍👧 Per tutti";
  }

  const range = text.match(/(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)(?:\s*(mesi?|anni?|months?|years?))?/i);
  if (range) {
    const min = Number(range[1].replace(",", "."));
    const max = Number(range[2].replace(",", "."));
    const unit = range[3] || "anni";
    const isMonths = /^(mesi?|months?)$/i.test(unit);
    const minYears = isMonths ? min / 12 : min;
    const maxYears = isMonths ? max / 12 : max;
    const icon = maxYears <= 3 ? "👶" : minYears >= 6 ? "👦" : "🧒";
    return `${icon} ${range[1]}-${range[2]} ${unit}`;
  }

  const startingAge = text.match(/(?:dai?|a partire da|eta minima|età minima)\s*(\d+(?:[.,]\d+)?)\s*(mesi?|anni?)?/i);
  if (startingAge) {
    const age = Number(startingAge[1].replace(",", "."));
    const unit = startingAge[2] || "anni";
    const isMonths = /^mesi?$/i.test(unit);
    return `${isMonths && age <= 36 ? "👶" : age >= (isMonths ? 72 : 6) ? "👦" : "🧒"} ${startingAge[1]}+ ${unit}`;
  }

  return `🧒 ${text}`;
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

function isEventBookingUrl(value) {
  const safeUrl = getHttpUrl(value);
  if (!safeUrl) return false;

  const url = new URL(safeUrl);
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const pathname = url.pathname.toLowerCase();
  const isMunicipalAppointmentUrl = /(?:^|\.)comune\.[a-z.]+$/.test(hostname) &&
    /appuntament|appuntamento|appointment|prenota_appuntamento|prenotazione-appuntamenti|suggerimento-acquisti|\/it\/book/.test(pathname);
  if (isMunicipalAppointmentUrl || hostname === "calendar.google.com") return false;

  const trustedTicketingHost = [
    "eventbrite.com",
    "eventbrite.it",
    "ticketone.it",
    "vivaticket.com",
    "coopculture.it",
    "ticketmaster.com",
    "ticketmaster.it"
  ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  if (trustedTicketingHost) {
    const hasEventSpecificTicketPath =
      /^\/e\/[^/]+/.test(pathname) ||
      /\/(?:events?|eventi|tickets?|biglietti|prenota|booking|checkout|acquist\w*)\/[^/]+/.test(pathname);
    return hasEventSpecificTicketPath;
  }

  if (hostname === "biglietteria.museogalileo.it") return true;
  if (hostname === "teatrodante.it" && /^\/biglietti\/?$/.test(pathname)) return true;
  if (hostname === "biblioteca.comune.sesto-fiorentino.fi.it" &&
    /^\/prenotare-un-evento\/?$/.test(pathname)) return true;

  return /\/(?:events?|eventi)\/[^/]+\/(?:tickets?|biglietti|checkout|booking|prenota)(?:\/|$)|\/(?:checkout|order|registration|iscrizione)\/[^/]+/i.test(pathname);
}

function isGenericEventPageUrl(value) {
  const safeUrl = getHttpUrl(value);
  if (!safeUrl) return false;
  const url = new URL(safeUrl);
  return url.hostname.toLowerCase() !== "calendar.google.com";
}

function isHomePageUrl(value) {
  const safeUrl = getHttpUrl(value);
  if (!safeUrl) return false;
  const pathname = new URL(safeUrl).pathname.toLowerCase();
  return /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/?)?$/.test(pathname) ||
    /^\/(?:home(?:page)?|index(?:\.html?)?)\/?$/.test(pathname);
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
  if (hasCoordinates) {
    return `https://www.google.com/maps?q=${latitude},${longitude}`;
  }

  const streetAddress = event.address || event.street_address || event.location;
  const addressParts = String(streetAddress || "").split(",");
  const streetName = addressParts[0].trim();
  const streetNumber = isUsableEventText(event.street_number)
    ? event.street_number.trim()
    : "";
  const addressWithNumber = streetAddress && streetNumber &&
    !/(?:^|\s)\d+[a-zA-Z]?(?:\/\d+[a-zA-Z]?)?$/.test(streetName)
    ? [`${streetName} ${streetNumber}`, ...addressParts.slice(1).map((part) => part.trim())].join(", ")
    : streetAddress;
  const destination = [
    addressWithNumber,
    event.postal_code,
    event.city
  ]
    .filter(isUsableEventText)
    .join(", ");
  return destination
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`
    : "";
}

function formatEventDateOnly(date) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
}

function formatEventTime(value) {
  if (!isUsableEventText(value) || !/T\d{2}:\d{2}/.test(value)) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
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
