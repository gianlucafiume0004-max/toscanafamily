import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase.js";

const KIND_LABELS = {
  animator: "Animatori",
  party_venue: "Sale feste",
  play_center: "Ludoteche e centri gioco"
};

export default function Activities() {
  const [providers, setProviders] = useState([]);
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [premiumOnly, setPremiumOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadProviders() {
      setLoading(true);
      setError("");

      const { data, error: queryError } = await supabase
        .from("providers")
        .select("id,provider_kind,name,city,province,services,website,premium")
        .order("name", { ascending: true });

      if (cancelled) return;
      if (queryError) {
        setError(`Impossibile caricare le attività: ${queryError.message}`);
        setProviders([]);
      } else {
        setProviders(data ?? []);
      }
      setLoading(false);
    }

    loadProviders();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(
    () => [...new Set(providers.map((provider) => provider.provider_kind).filter(Boolean))]
      .sort((a, b) => (KIND_LABELS[a] ?? a).localeCompare(KIND_LABELS[b] ?? b, "it")),
    [providers]
  );
  const cities = useMemo(
    () => [...new Set(providers.map((provider) => provider.city).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "it")),
    [providers]
  );

  const filteredProviders = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("it-IT");
    return providers
      .filter((provider) => {
        if (category && provider.provider_kind !== category) return false;
        if (city && provider.city !== city) return false;
        if (premiumOnly && !provider.premium) return false;
        if (!query) return true;
        return [provider.name, provider.provider_kind, provider.city, provider.services]
          .filter(Boolean)
          .some((value) => value.toLocaleLowerCase("it-IT").includes(query));
      })
      .sort((a, b) => Number(Boolean(b.premium)) - Number(Boolean(a.premium)) ||
        (a.name ?? "").localeCompare(b.name ?? "", "it"));
  }, [providers, category, city, premiumOnly, search]);

  return (
    <div className="activities-page">
      <header className="activities-hero">
        <a className="activities-brand" href="/">ToscanaFamily</a>
        <span className="activities-eyebrow">SCOPRI IL TERRITORIO</span>
        <h1>Attività per tutta la famiglia</h1>
        <p>Animatori, spazi gioco e servizi per organizzare momenti speciali.</p>
      </header>

      <nav className="activities-nav" aria-label="Menu principale">
        <a href="/">Esplora ToscanaFamily</a>
        <a className="active" href="/attivita" aria-current="page">Attività</a>
      </nav>

      <main className="activities-main">
        <section className="activities-filters" aria-label="Filtri attività">
          <label>
            <span>Categoria</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Tutte le categorie</option>
              {categories.map((kind) => (
                <option key={kind} value={kind}>{KIND_LABELS[kind] ?? kind}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Comune</span>
            <select value={city} onChange={(event) => setCity(event.target.value)}>
              <option value="">Tutti i comuni</option>
              {cities.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>

          <label className="activities-premium-filter">
            <input
              type="checkbox"
              checked={premiumOnly}
              onChange={(event) => setPremiumOnly(event.target.checked)}
            />
            <span>Solo Premium</span>
          </label>

          <label className="activities-search">
            <span>Ricerca libera</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nome, servizio o comune"
            />
          </label>
        </section>

        {loading && <p className="activities-message" role="status">Caricamento attività…</p>}
        {!loading && error && <p className="activities-message error" role="alert">{error}</p>}
        {!loading && !error && filteredProviders.length === 0 && (
          <p className="activities-message">Nessuna attività trovata con i filtri selezionati.</p>
        )}

        {!loading && !error && filteredProviders.length > 0 && (
          <>
            <p className="activities-count">{filteredProviders.length} attività trovate</p>
            <section className="activities-grid" aria-label="Elenco attività">
              {filteredProviders.map((provider) => (
                <article className="activity-card" key={provider.id}>
                  <div className="activity-card-heading">
                    <span className="activity-kind">
                      {KIND_LABELS[provider.provider_kind] ?? provider.provider_kind}
                    </span>
                    {provider.premium && <span className="activity-premium">Premium</span>}
                  </div>
                  <h2>{provider.name}</h2>
                  <p className="activity-city">
                    {[provider.city, provider.province].filter(Boolean).join(" · ")}
                  </p>
                  {provider.services && <p className="activity-services">{provider.services}</p>}
                  {provider.website && (
                    <a className="activity-website" href={provider.website} target="_blank" rel="noreferrer">
                      Visita il sito <span aria-hidden="true">↗</span>
                    </a>
                  )}
                </article>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
