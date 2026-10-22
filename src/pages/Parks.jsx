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

  const cities = useMemo(
    () => [...new Set(parks.map((park) => park.comune).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "it")),
    [parks]
  );
  const filteredParks = parks.filter((park) => !city || park.comune === city);
  const mappedParks = filteredParks.filter(hasCoordinates);

  useEffect(() => {
    if (selectedPark && !parks.some((park) => park.id === selectedPark.id)) {
      setSelectedPark(null);
    }
  }, [parks, selectedPark]);

  return (
    <>
      <section className="search-panel">
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
                <strong>{park.nome}</strong><br />
                📍 {park.comune} ({park.provincia})<br />
                🚻 {park.bagni || "Da verificare"}<br />
                🅿️ {park.parcheggio || "Da verificare"}<br />
                <div className="popup-actions">
                  <button type="button" onClick={() => setSelectedPark(park)}>Dettagli</button>
                  <a href={directionsUrl(park)} target="_blank" rel="noreferrer">🚗 Portami qui</a>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        {mappedParks.length === 0 && parks.length > 0 && (
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
  return (
    <article
      className="content-card park-card clickable"
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
      <div className="card-icon">🌳</div>
      <div className="card-body">
        <h3>{park.nome}</h3>
        <p className="location">📍 {park.comune} · {park.provincia}</p>
        <div className="chips">
          <span>🚻 {park.bagni || "Da verificare"}</span>
          <span>🅿️ {park.parcheggio || "Da verificare"}</span>
          <span>⛲ {park.fontanella || "Da verificare"}</span>
        </div>
        {park.note && <p className="description">{park.note}</p>}
        <span className="status">{park.stato || "Da verificare"}</span>
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
          {hasCoordinates(park) && (
            <a
              href={directionsUrl(park)}
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

  const details = [
    ["📍 Indirizzo", park.indirizzo],
    ["🏙️ Comune", [park.comune, park.provincia].filter(Boolean).join(" · ")],
    ["🚻 Bagni", park.bagni],
    ["🅿️ Parcheggio", park.parcheggio],
    ["⛲ Fontanella", park.fontanella],
    ["🧺 Area picnic", park.area_picnic],
    ["🐕 Area cani", park.area_cani],
    ["♿ Accessibilità", park.accessibilita],
    ["💡 Illuminazione", park.illuminazione],
    ["🎟️ Ingresso", park.ingresso],
    ["💶 Costo", park.costo],
    ["🏷️ Categoria", park.categoria],
    ["🚭 Fumatori", park.fumatori_stato],
    ["✅ Stato", park.stato]
  ];

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
            <h2 id="park-title">{park.nome}</h2>
            <p>📍 {park.comune} · {park.provincia}</p>
          </div>
        </div>
        <div className="details-grid">
          {details.map(([label, value]) => (
            <div className="detail-item" key={label}>
              <strong>{label}</strong><span>{value || "Da verificare"}</span>
            </div>
          ))}
        </div>
        {park.note && (
          <div className="park-notes"><strong>📝 Informazioni</strong><p>{park.note}</p></div>
        )}
        <div className="modal-actions">
          {hasCoordinates(park) && (
            <a className="directions-button" href={directionsUrl(park)} target="_blank" rel="noreferrer">
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
