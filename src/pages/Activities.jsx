import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase.js";
import {
  getProviderCategories,
  providerCategoryName
} from "../lib/providerCategories.js";
import ProviderFeatureCard from "../components/ProviderFeatureCard.jsx";

function normalizeFilterValue(value) {
  return String(value || "").trim().toLowerCase();
}

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
        .select("id, name, provider_kind, party_type, city, province, address, latitude, longitude, notes, services, phone, website, premium")
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
    () => [...new Set(providers
      .flatMap(getProviderCategories)
      .filter(Boolean))]
      .sort((a, b) => providerCategoryName(a).localeCompare(providerCategoryName(b), "it")),
    [providers]
  );
  const cities = useMemo(
    () => [...new Set(providers.map((provider) => provider.city).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "it")),
    [providers]
  );
  const filteredProviders = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("it-IT");
    const selectedCategory = normalizeFilterValue(category);
    const results = providers
      .filter((provider) => {
        const providerCategories = getProviderCategories(provider);

        if (!providerCategories.length && normalizeFilterValue(provider.provider_kind) === "feste") {
          return false;
        }
        if (selectedCategory && !providerCategories.includes(selectedCategory)) return false;
        if (city && provider.city !== city) return false;
        if (premiumOnly && !provider.premium) return false;
        if (!query) return true;
        return [
          provider.name,
          ...providerCategories.map(providerCategoryName),
          provider.city,
          provider.services
        ]
          .filter(Boolean)
          .some((value) => value.toLocaleLowerCase("it-IT").includes(query));
      })
      .sort((a, b) => Number(Boolean(b.premium)) - Number(Boolean(a.premium)) ||
        (a.name ?? "").localeCompare(b.name ?? "", "it"));

    return results;
  }, [providers, category, city, premiumOnly, search]);

  return (
    <div className="activities-page">
      <header className="activities-hero">
        <a className="activities-brand" href="/">ToscanaFamily</a>
        <span className="activities-eyebrow">SCOPRI IL TERRITORIO</span>
        <h1>Attività per tutta la famiglia</h1>
        <p>Animatori, sale feste, spazi gioco e servizi per organizzare momenti speciali.</p>
      </header>

      <nav className="activities-nav" aria-label="Menu principale">
        <a href="/">Esplora ToscanaFamily</a>
        <a className="active" href="/attivita" aria-current="page">Attività</a>
      </nav>

      <main className="activities-main">
        <section className="activities-filters" aria-label="Filtri attività">
          <label>
            <span>Comune</span>
            <select value={city} onChange={(event) => setCity(event.target.value)}>
              <option value="">Tutti i comuni</option>
              {cities.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>

          <label>
            <span>Categoria</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Tutte le categorie</option>
              {categories.map((kind) => (
                <option key={kind} value={kind}>{providerCategoryName(kind)}</option>
              ))}
            </select>
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

          <label className="activities-premium-filter">
            <input
              type="checkbox"
              checked={premiumOnly}
              onChange={(event) => setPremiumOnly(event.target.checked)}
            />
            <span>Solo Premium</span>
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
              {filteredProviders.map((provider) => {
                const providerCategories = getProviderCategories(provider);
                const featureCategory = providerCategories.find((kind) =>
                  kind === "animatori" || kind === "sale_feste"
                );

                if (featureCategory) {
                  return (
                    <ProviderFeatureCard
                      key={provider.id}
                      provider={provider}
                    />
                  );
                }

                return (
                  <article className="activity-card" key={provider.id}>
                    <div className="activity-card-heading">
                      <span className="activity-kind">
                        {providerCategories.map(providerCategoryName).join(" · ")}
                      </span>
                      {provider.premium && <span className="activity-premium">Premium</span>}
                    </div>
                    <h2><a className="provider-card-link" href={`/provider/${encodeURIComponent(provider.id)}`}>{provider.name}</a></h2>
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
                );
              })}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
