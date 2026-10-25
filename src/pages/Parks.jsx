import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
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

export default function Parks({ parks, hasError }) {
  const [city, setCity] = useState("");
  const [selectedPark, setSelectedPark] = useState(null);

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
                📍 {park.comune} ({park.provincia})<br />
                🚻 {park.bagni || "Da verificare"}<br />
                🅿️ {park.parcheggio || "Da verificare"}<br />
                <div className="popup-actions">
                  <button type="button" onClick={() => setSelectedPark(park)}>Dettagli</button>
                  <a
                    href={directionsUrl(park)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    🚗 Portami qui
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
            <ParkCard key={park.id} park={park} onSelect={() => setSelectedPark(park)} />
          ))}
        </div>
      </div>

      {filteredParks.length === 0 && !hasError && (
        <div className="message empty">
          Nessun risultato per il comune selezionato. Prova un altro comune.
        </div>
      )}

      {selectedPark && (
        <ParkDetails park={selectedPark} onClose={() => setSelectedPark(null)} />
      )}
    </>
  );
}

function ParkCard({ park, onSelect }) {
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

function ParkDetails({ park, onClose }) {
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
        {isUsefulDetailValue(park.note) && (
          <div className="park-notes"><strong>📝 Informazioni</strong><p>{park.note}</p></div>
        )}
        <p className="park-notes">🌱 Conosci questo parco? Aiutaci ad aggiornare le informazioni</p>
        <div className="modal-actions">
          {directions && (
            <a className="directions-button" href={directions} target="_blank" rel="noreferrer">
              🚗 Portami qui
            </a>
          )}
          {park.fonte_url && (
            <a className="secondary-button" href={park.fonte_url} target="_blank" rel="noreferrer">
              Fonte ufficiale
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

function normalizeParkText(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT")
    .trim();
}

function isTargetProvince(provinceValue, cityValue) {
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
