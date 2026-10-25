import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import { supabase } from "../lib/supabase.js";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

const parkIcon = L.icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41],
  alt: "Parco"
});

const parkServiceFields = [
  ["bagni", "🚻 Bagni", "bagni"],
  ["parcheggio", "🅿️ Parcheggio", "parcheggio"],
  ["fontanella", "💧 Fontanella", "fontanella"],
  ["area_picnic", "🧺 Area picnic", "area_picnic"],
  ["area_cani", "🐕 Area cani", "area_cani"],
  ["accessibilita", "♿ Accessibilità", "accessibilita"],
  ["altri_servizi", "🛝 Altri servizi", null],
  ["presenza_fumatori", "🚬 Presenza fumatori", "fumatori_stato"]
];

export default function Parks({ parks, hasError }) {
  const [city, setCity] = useState("");
  const [selectedPark, setSelectedPark] = useState(null);
  const [parkRatings, setParkRatings] = useState({});
  const [parkRatingStats, setParkRatingStats] = useState({});
  const [parkServiceSelections, setParkServiceSelections] = useState({});

  const visibleParks = useMemo(
    () => parks.filter((park) =>
      park.outside_tuscany !== true && isTargetProvince(park.provincia, park.comune)
    ),
    [parks]
  );
  const cities = useMemo(
    () => [...new Set(visibleParks
      .map((park) => typeof park.comune === "string" ? park.comune.trim() : "")
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "it")),
    [visibleParks]
  );
  const filteredParks = visibleParks.filter((park) =>
    !city || (typeof park.comune === "string" && park.comune.trim() === city)
  );
  const mappedParks = filteredParks.filter(hasCoordinates);

  async function ratePark(parkId, rating) {
    setParkRatings((currentRatings) => ({
      ...currentRatings,
      [parkId]: rating
    }));

    try {
      const { error } = await supabase
        .from("park_ratings")
        .insert({ park_id: parkId, rating });

      if (error) {
        console.error("Errore durante il salvataggio della valutazione del parco:", error);
        return;
      }

      setParkRatingStats((currentStats) => {
        const current = currentStats[parkId] || { sum: 0, count: 0 };

        return {
          ...currentStats,
          [parkId]: {
            sum: current.sum + rating,
            count: current.count + 1
          }
        };
      });
    } catch (error) {
      console.error("Errore durante il salvataggio della valutazione del parco:", error);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadParkRatingStats() {
      try {
        const ratings = [];
        const pageSize = 1000;

        for (let from = 0; ; from += pageSize) {
          const { data, error } = await supabase
            .from("park_ratings")
            .select("park_id, rating")
            .range(from, from + pageSize - 1);

          if (cancelled) return;
          if (error) {
            console.error("Errore durante il caricamento delle valutazioni dei parchi:", error);
            return;
          }

          ratings.push(...(data || []));
          if (!data || data.length < pageSize) break;
        }

        const nextStats = ratings.reduce((stats, { park_id: parkId, rating }) => {
          const current = stats[parkId] || { sum: 0, count: 0 };
          stats[parkId] = {
            sum: current.sum + rating,
            count: current.count + 1
          };
          return stats;
        }, {});

        setParkRatingStats(nextStats);
      } catch (error) {
        if (!cancelled) {
          console.error("Errore durante il caricamento delle valutazioni dei parchi:", error);
        }
      }
    }

    loadParkRatingStats();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (selectedPark && !visibleParks.some((park) => park.id === selectedPark.id)) {
      setSelectedPark(null);
    }
  }, [visibleParks, selectedPark]);

  return (
    <>
      <section className="search-panel city-filter-panel park-filters">
        <div className="city-filter-wrapper">
          <label className="search-label" htmlFor="park-city-filter">📍 Comune</label>
          <select
            id="park-city-filter"
            className="town-select"
            value={city}
            onChange={(event) => setCity(event.target.value)}
          >
            <option value="">Tutti i comuni</option>
            {cities.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      </section>

      <section className="map-section">
        <div className="section-heading">
          <div><h2>🗺️ Parchi della Piana</h2></div>
          <span className="result-pill">{mappedParks.length} con coordinate</span>
        </div>
        <MapContainer center={[43.82, 11.08]} zoom={9} className="map">
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {mappedParks.map((park) => (
            <Marker
              key={park.id}
              position={[Number(park.latitudine), Number(park.longitudine)]}
              icon={parkIcon}
              alt="Parco"
            >
              <Popup>
                <strong>{displayParkName(park)}</strong><br />
                {park.comune} ({park.provincia})<br />
                {park.bagni}<br />
                {park.parcheggio}<br />
                <div className="popup-actions">
                  <button type="button" onClick={() => setSelectedPark(park)}>Dettagli</button>
                  <a
                    href={directionsUrl(park)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Portami qui
                  </a>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        {mappedParks.length === 0 && visibleParks.length > 0 && (
          <div className="message warning">
            I parchi sono presenti, ma non hanno ancora coordinate disponibili.
          </div>
        )}
      </section>

      <div className="results-list">
        <div className="grid">
          {filteredParks.map((park) => (
            <ParkCard
              key={park.id}
              park={park}
              rating={parkRatings[park.id] || 0}
              ratingStats={parkRatingStats[park.id]}
              onRate={(rating) => ratePark(park.id, rating)}
              onSelect={() => setSelectedPark(park)}
            />
          ))}
        </div>
      </div>

      {filteredParks.length === 0 && !hasError && (
        <div className="message empty">
          Nessun risultato per il comune selezionato. Prova un altro comune.
        </div>
      )}

      {selectedPark && (
        <ParkDetails
          park={selectedPark}
          serviceSelections={parkServiceSelections[selectedPark.id] || {}}
          onServiceSelectionChange={(field, value) => setParkServiceSelections((current) => ({
            ...current,
            [selectedPark.id]: {
              ...current[selectedPark.id],
              [field]: value
            }
          }))}
          onClose={() => setSelectedPark(null)}
        />
      )}
    </>
  );
}

function ParkCard({ park, rating, ratingStats, onRate, onSelect }) {
  const visualType = getParkVisualType(park);
  const directions = cardDirectionsUrl(park);

  return (
    <article
      className={`content-card park-card park-card--${visualType} clickable`}
      role="button"
      tabIndex="0"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="card-icon">{parkVisualIcons[visualType]}</div>
      <div className="card-body">
        <h3>{displayParkName(park)}</h3>
        <div className="park-rating" role="group" aria-label={`Valutazione di ${displayParkName(park)}`}>
          {Array.from({ length: 5 }, (_, index) => {
            const value = index + 1;
            const isSelected = value <= rating;

            return (
              <button
                key={value}
                type="button"
                aria-label={`${value} ${value === 1 ? "stella" : "stelle"} su 5`}
                aria-pressed={isSelected}
                onClick={(event) => {
                  event.stopPropagation();
                  onRate(value);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                style={{
                  background: "none",
                  border: 0,
                  padding: "0 2px",
                  color: isSelected ? "#f5a623" : "#aab3af",
                  cursor: "pointer",
                  fontSize: "1.5rem",
                  lineHeight: 1
                }}
              >
                {isSelected ? "★" : "☆"}
              </button>
            );
          })}
        </div>
        <p className="location">
          {ratingStats?.count
            ? `⭐ ${(ratingStats.sum / ratingStats.count).toLocaleString("it-IT", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1
              })} · ${ratingStats.count} ${ratingStats.count === 1 ? "valutazione" : "valutazioni"}`
            : "Nessuna valutazione"}
        </p>
        <p className="location">
          📍 {park.comune || "Comune non disponibile"}{park.provincia ? ` · ${park.provincia}` : ""}
        </p>
        {park.indirizzo && <p className="location">🏠 {park.indirizzo}</p>}
        <div className="card-actions">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
          >
            Tutte le info
          </button>
          {directions && (
            <a
              href={directions}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              🚗 Portami qui
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

const parkVisualIcons = {
  playground: "🛝",
  sports: "⚽",
  nature: "🌲",
  park: "🌳",
  other: "📍"
};

function getParkVisualType(park) {
  const searchableText = [park.nome, park.categoria]
    .filter((value) => typeof value === "string")
    .map((value) => value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("it-IT")
      .trim()
    )
    .join(" ");

  if (["area gioco", "area giochi", "parco giochi", "giochi"].some((term) =>
    searchableText.includes(term)
  )) return "playground";
  if (["sport", "sportiva", "campo sportivo", "fitness"].some((term) =>
    searchableText.includes(term)
  )) return "sports";
  if (["area naturale", "bosco", "pineta", "riserva"].some((term) =>
    searchableText.includes(term)
  )) return "nature";
  if (["parco", "giardino", "villa"].some((term) =>
    searchableText.includes(term)
  )) return "park";
  return "other";
}

function ParkDetails({ park, serviceSelections, onServiceSelectionChange, onClose }) {
  useEffect(() => {
    function closeWithEscape(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", closeWithEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeWithEscape);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const directions = cardDirectionsUrl(park);
  const details = [
    ["📍 Indirizzo", park.indirizzo],
    ["🏙️ Comune", [park.comune, park.provincia].filter(isUsefulDetailValue).join(" · ")],
    ["🚻 Bagni", park.bagni],
    ["🅿️ Parcheggio", park.parcheggio],
    ["⛲ Fontanella", park.fontanella],
    ["🧺 Area picnic", park.area_picnic],
    ["🐕 Area cani", park.area_cani],
    ["♿ Accessibilità", park.accessibilita],
    ["💡 Illuminazione", park.illuminazione],
    ["🎟️ Ingresso", getEntranceDescription(park)],
    ["🏷️ Categoria", isGenericParkCategory(park.categoria) ? "" : park.categoria],
    ["🚭 Fumatori", park.fumatori_stato],
    ["✅ Stato", park.stato]
  ].filter(([, value]) => isUsefulDetailValue(value));
  const location = [park.comune, park.provincia].filter(isUsefulDetailValue).join(" · ");
  const parkNotes = getVisibleParkNotes(park.note);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="park-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="park-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="Chiudi">×</button>
        <div className="modal-hero">
          <span>🌳</span>
          <div>
            <small>SCHEDA PARCO</small>
            <h2 id="park-title">{displayParkName(park)}</h2>
            {location && <p>📍 {location}</p>}
          </div>
        </div>
        <div className="details-grid">
          {details.map(([label, value]) => (
            <div className="detail-item" key={label}>
              <strong>{label}</strong><span>{String(value).trim()}</span>
            </div>
          ))}
        </div>
        {parkNotes && (
          <div className="park-notes"><strong>📝 Informazioni</strong><p>{parkNotes}</p></div>
        )}
        <div className="park-notes">
          <p>🌱 Conosci questo parco? Aiutaci ad aggiornarlo!</p>
          <p>Condividi ciò che sai e aiuta altre famiglie.</p>
          <p>Il tuo contributo può essere utile ad altre famiglie. 💚</p>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
            gap: "8px",
            marginTop: "14px"
          }}>
            {parkServiceFields
              .filter(([field, , parkField]) =>
                field === "altri_servizi" || !isUsefulDetailValue(park[parkField])
              )
              .map(([field, label]) => (
                <div
                  key={field}
                  role="group"
                  aria-label={label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "6px",
                    padding: "8px",
                    borderRadius: "12px",
                    background: "rgba(255, 255, 255, 0.7)"
                  }}
                >
                  <strong style={{ fontSize: ".85rem" }}>{label}</strong>
                  <div style={{ display: "flex", gap: "4px" }}>
                    {["Sì", "No"].map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={serviceSelections[field] === value}
                        onClick={(event) => {
                          event.stopPropagation();
                          onServiceSelectionChange(field, value);
                        }}
                        style={{
                          border: "1px solid #cbd8d1",
                          borderRadius: "8px",
                          padding: "5px 8px",
                          color: serviceSelections[field] === value ? "#fff" : "#385448",
                          background: serviceSelections[field] === value ? "#27845b" : "#fff",
                          fontSize: ".8rem",
                          cursor: "pointer"
                        }}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </div>
        <div className="modal-actions">
          {directions && (
            <a className="directions-button" href={directions} target="_blank" rel="noreferrer">
              🚗 Portami qui
            </a>
          )}
          <button className="secondary-button" type="button" onClick={onClose}>Chiudi</button>
        </div>
      </section>
    </div>
  );
}

function displayParkName(park) {
  const name = typeof park.nome === "string" ? park.nome.trim() : "";
  const normalizedName = normalizeParkText(name).replace(/[^a-z0-9]+/g, " ").trim();

  if (normalizedName !== "area gioco" && normalizedName !== "area giochi") return park.nome;

  const address = isUsefulDetailValue(park.indirizzo) ? String(park.indirizzo).trim() : "";
  const city = isUsefulDetailValue(park.comune) ? String(park.comune).trim() : "";
  const location = address || city;
  if (!location || normalizeParkText(name).includes(normalizeParkText(location))) return "Area giochi";
  return `Area giochi ${location}`;
}

function getVisibleParkNotes(note) {
  if (typeof note !== "string") return "";

  return note
    .replace(/\bFont(?:e|i):[\s\S]*$/i, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\r?\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function normalizeParkText(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT")
    .trim();
}

export function isTargetProvince(provinceValue, cityValue) {
  const normalize = (value) => typeof value === "string"
    ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it-IT").replace(/[^a-z0-9]/g, "")
    : "";
  const province = normalize(provinceValue);
  if (province) return ["firenze", "fi", "prato", "po", "pistoia", "pt"].includes(province);

  const cityProvince = {
    campibisenzio: "fi",
    firenze: "fi",
    pieveanievole: "pt",
    prato: "po"
  };
  return Boolean(cityProvince[normalize(cityValue)]);
}

function isUsefulDetailValue(value) {
  if (value == null || !String(value).trim()) return false;
  const normalized = normalizeParkText(value);
  return !["da verificare", "parziale", "n/a", "na", "non disponibile", "-"].includes(normalized);
}

function isGenericParkCategory(value) {
  return !isUsefulDetailValue(value) || normalizeParkText(value) === "entrambi";
}

function getEntranceDescription(park) {
  const entrance = isUsefulDetailValue(park.ingresso) ? String(park.ingresso).trim() : "";
  const cost = isUsefulDetailValue(park.costo) ? String(park.costo).trim() : "";
  const normalizedEntrance = normalizeParkText(entrance);
  const normalizedCost = normalizeParkText(cost);
  const costIsUnreliable = !cost ||
    normalizedCost.includes("da verificare") ||
    normalizedCost.includes("tariffa non pubblicata") ||
    normalizedCost.includes("non disponibile") ||
    normalizedCost === "n/a" ||
    normalizedCost === "-";
  const costIsZero = /^(?:€\s*)?0(?:[,.]0+)?(?:\s|$|[;,.])/.test(cost);
  const isFree = normalizedEntrance.includes("gratuit");
  const isPaid = normalizedEntrance.includes("pagament");

  if (isFree) {
    if (/(attrazion|percors|attivit|piscina|gonfiabil|gettoni).{0,50}pagament/.test(normalizedEntrance)) {
      return entrance;
    }
    if (
      !costIsUnreliable &&
      !costIsZero &&
      /(attrazion|percors|attivit|piscina|gonfiabil|gettoni|consumaz)/.test(normalizedCost)
    ) {
      return `Ingresso gratuito; ${cost}`;
    }
    return "Ingresso gratuito";
  }

  if (isPaid) {
    return !costIsUnreliable && !costIsZero
      ? `Ingresso: ${cost}`
      : "Ingresso a pagamento";
  }

  if (!entrance && costIsUnreliable) return "";
  if (cost && !costIsUnreliable && !costIsZero) return `Ingresso: ${cost}`;
  return entrance ? `Ingresso: ${entrance}` : "";
}

function hasCoordinates(park) {
  if (
    park.latitudine == null ||
    park.longitudine == null ||
    String(park.latitudine).trim() === "" ||
    String(park.longitudine).trim() === ""
  ) {
    return false;
  }

  const latitude = Number(park.latitudine);
  const longitude = Number(park.longitudine);
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;
}

function directionsUrl(park) {
  const destination = `${Number(park.latitudine)},${Number(park.longitudine)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

function cardDirectionsUrl(park) {
  if (hasCoordinates(park)) return directionsUrl(park);

  const isUsablePlace = (value) => {
    if (typeof value !== "string" || !value.trim()) return false;

    return !["-", "n/a", "non disponibile", "da verificare"]
      .includes(value.trim().toLocaleLowerCase("it-IT"));
  };

  const address = isUsablePlace(park.indirizzo) ? park.indirizzo.trim() : "";
  const city = isUsablePlace(park.comune) ? park.comune.trim() : "";
  const province = isUsablePlace(park.provincia) ? park.provincia.trim() : "";

  if (!address && !(city && province)) return null;

  const destination = [address, city, province, "Italia"]
    .filter(Boolean)
    .join(", ");

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}
