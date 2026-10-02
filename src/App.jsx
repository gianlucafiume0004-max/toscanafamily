import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import { supabase } from "./lib/supabase.js";

L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

const TABS = [
  { key: "parks", label: "Parchi", icon: "🌳" },
  { key: "events", label: "Eventi", icon: "🎉" },
  { key: "animator", label: "Animatori", icon: "🎈" },
  { key: "party_venue", label: "Sale feste", icon: "🏰" },
  { key: "play_center", label: "Ludoteche", icon: "🧸" }
];

export default function App() {
  const [active, setActive] = useState("parks");
  const [parks, setParks] = useState([]);
  const [events, setEvents] = useState([]);
  const [providers, setProviders] = useState([]);
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);
  const [selectedPark, setSelectedPark] = useState(null);

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
    animator: providers.filter((item) => item.provider_kind === "animator").length,
    party_venue: providers.filter((item) => item.provider_kind === "party_venue").length,
    play_center: providers.filter((item) => item.provider_kind === "play_center").length
  }), [providers]);

  const counts = {
    parks: parks.length,
    events: events.length,
    ...providerCounts
  };

  const currentItems = active === "parks"
    ? parks
    : active === "events"
      ? events
      : providers.filter((item) => item.provider_kind === active);

  const cities = useMemo(() => {
    const values = currentItems
      .map((item) => active === "parks" ? item.comune : item.city)
      .filter(Boolean);
    return [...new Set(values)].sort((a, b) => a.localeCompare(b, "it"));
  }, [currentItems, active]);

  const filtered = currentItems.filter((item) => {
    const itemCity = active === "parks" ? item.comune : item.city;
    return !city || itemCity === city;
  });

  const mappedParks = active === "parks"
    ? filtered.filter((park) =>
        park.latitudine !== null &&
        park.longitudine !== null &&
        Number.isFinite(Number(park.latitudine)) &&
        Number.isFinite(Number(park.longitudine))
      )
    : [];

  function changeTab(key) {
    setActive(key);
    setCity("");
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
      </nav>

      <main>
        <section className="search-panel city-filter-panel">
          <div className="city-filter-wrapper">
            <label className="search-label" htmlFor="city-filter">📍 Scegli il comune</label>
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
            {city && (
              <button className="clear-button" type="button" onClick={() => setCity("")}>
                Mostra tutti i comuni
              </button>
            )}
          </div>
        </section>
        {loading && <div className="message loading">Caricamento delle migliori idee per la famiglia...</div>}
        {errors.map((error) => <div key={error} className="message error">{error}</div>)}

        {!loading && active === "parks" && (
          <section className="map-section">
            <div className="section-heading">
              <div><h2>🗺️ Parchi della Piana</h2></div>
              <span className="result-pill">{mappedParks.length} con coordinate</span>
            </div>
            <MapContainer center={[43.82, 11.08]} zoom={9} className="map">
              <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {mappedParks.map((park) => (
                <Marker key={park.id} position={[Number(park.latitudine), Number(park.longitudine)]}>
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
            {mappedParks.length === 0 && parks.length > 0 && <div className="message warning">I parchi sono presenti, ma non hanno ancora coordinate disponibili.</div>}
          </section>
        )}

        {!loading && (
          <section className="results-section">
            <div className="section-heading">
              <div><span className="eyebrow">SCELTI PER TE</span><h2>{TABS.find((tab) => tab.key === active)?.icon} {TABS.find((tab) => tab.key === active)?.label}</h2></div>
              <span className="result-pill">{filtered.length} risultati</span>
            </div>
            <div className="grid">
              {filtered.map((item) => <Card key={item.id} item={item} active={active} onSelectPark={setSelectedPark} />)}
            </div>
          </section>
        )}

        {!loading && filtered.length === 0 && errors.length === 0 && <div className="message empty">Nessun risultato per il comune selezionato. Prova un altro comune.</div>}
      </main>

      {selectedPark && (
        <ParkDetails park={selectedPark} onClose={() => setSelectedPark(null)} />
      )}

      <footer>
        <p><strong>© 2026 Gianluca Fiume · La Piana Family. Tutti i diritti riservati.</strong></p>
        <p>È vietata la riproduzione o riutilizzazione non autorizzata del codice, del database e dei contenuti proprietari.</p>
        <p>Le informazioni della community sono soggette a moderazione e verifica.</p>
      </footer>
    </div>
  );
}

function Card({ item, active, onSelectPark }) {
  if (active === "parks") {
    return (
      <article className="content-card park-card clickable" role="button" tabIndex="0" onClick={() => onSelectPark(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectPark(item); }}>
        <div className="card-icon">🌳</div>
        <div className="card-body">
          <h3>{item.nome}</h3>
          <p className="location">📍 {item.comune} · {item.provincia}</p>
          <div className="chips">
            <span>🚻 {item.bagni || "Da verificare"}</span>
            <span>🅿️ {item.parcheggio || "Da verificare"}</span>
            <span>⛲ {item.fontanella || "Da verificare"}</span>
          </div>
          {item.note && <p className="description">{item.note}</p>}
          <span className="status">{item.stato || "Da verificare"}</span>
          <div className="card-actions">
            <button type="button" onClick={(event) => { event.stopPropagation(); onSelectPark(item); }}>Tutte le info</button>
            {hasCoordinates(item) && <a href={directionsUrl(item)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>🚗 Portami qui</a>}
          </div>
        </div>
      </article>
    );
  }

  if (active === "events") {
    return (
      <article className="content-card event-card">
        <div className="card-icon">🎉</div>
        <div className="card-body">
          <h3>{item.title}</h3>
          <p className="location">📍 {item.city}{item.location ? ` · ${item.location}` : ""}</p>
          <p className="date">📅 {formatDate(item.starts_on)}</p>
          {item.description && <p className="description">{item.description}</p>}
        </div>
      </article>
    );
  }

  const icon = active === "animator" ? "🎈" : active === "party_venue" ? "🏰" : "🧸";
  return (
    <article className="content-card provider-card">
      <div className="card-icon">{icon}</div>
      <div className="card-body">
        <h3>{item.name}</h3>
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

function formatDate(value) {
  if (!value) return "Data da verificare";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "long", year: "numeric" }).format(date);
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
      <section className="park-modal" role="dialog" aria-modal="true" aria-labelledby="park-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Chiudi">×</button>
        <div className="modal-hero">
          <span>🌳</span>
          <div><small>SCHEDA PARCO</small><h2 id="park-title">{park.nome}</h2><p>📍 {park.comune} · {park.provincia}</p></div>
        </div>
        <div className="details-grid">
          {details.map(([label, value]) => (
            <div className="detail-item" key={label}><strong>{label}</strong><span>{value || "Da verificare"}</span></div>
          ))}
        </div>
        {park.note && <div className="park-notes"><strong>📝 Informazioni</strong><p>{park.note}</p></div>}
        <div className="modal-actions">
          {hasCoordinates(park) && <a className="directions-button" href={directionsUrl(park)} target="_blank" rel="noreferrer">🚗 Portami qui</a>}
          {park.fonte_url && <a className="secondary-button" href={park.fonte_url} target="_blank" rel="noreferrer">Fonte ufficiale</a>}
          <button className="secondary-button" type="button" onClick={onClose}>Chiudi</button>
        </div>
      </section>
    </div>
  );
}

function hasCoordinates(park) {
  return park.latitudine !== null && park.longitudine !== null && Number.isFinite(Number(park.latitudine)) && Number.isFinite(Number(park.longitudine));
}

function directionsUrl(park) {
  const destination = `${Number(park.latitudine)},${Number(park.longitudine)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}
