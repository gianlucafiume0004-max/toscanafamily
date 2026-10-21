import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase.js";
import {
  canonicalProviderCategory,
  providerCategoryName
} from "../lib/providerCategories.js";

const PARTY_TYPES = [
  { label: "Compleanno", keywords: ["compleanno", "birthday"] },
  { label: "Battesimo", keywords: ["battesimo"] },
  { label: "Comunione", keywords: ["comunione"] },
  { label: "Cresima", keywords: ["cresima"] },
  { label: "Festa privata", keywords: ["festa privata", "evento privato"] },
  { label: "Festa a tema", keywords: ["festa a tema", "tema"] },
  { label: "Evento aziendale", keywords: ["aziendale", "corporate"] },
  { label: "Matrimonio", keywords: ["matrimonio", "wedding"] },
  { label: "Altro", keywords: [] }
];

function providerText(provider) {
  return [provider.provider_kind, provider.name, provider.services, provider.notes]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT");
}

function isPartyProvider(provider) {
  return canonicalProviderCategory(provider.provider_kind) === "feste";
}

function getPartyTypes(provider) {
  const text = providerText(provider);
  const matches = PARTY_TYPES
    .filter(({ label, keywords }) => label !== "Altro" && keywords.some((keyword) => text.includes(keyword)))
    .map(({ label }) => label);
  return matches.length ? matches : ["Altro"];
}

export default function Activities() {
  const [providers, setProviders] = useState([]);
  const [category, setCategory] = useState("");
  const [partyType, setPartyType] = useState("");
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
        .select("*")
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
      .map((provider) => canonicalProviderCategory(provider.provider_kind))
      .filter(Boolean))]
      .sort((a, b) => providerCategoryName(a).localeCompare(providerCategoryName(b), "it")),
    [providers]
  );
  const cities = useMemo(
    () => [...new Set(providers.map((provider) => provider.city).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "it")),
    [providers]
  );
  const showPartyTypeFilter = providers.some((provider) =>
    (!category || canonicalProviderCategory(provider.provider_kind) === category) &&
    (!city || provider.city === city) &&
    isPartyProvider(provider)
  );

  const filteredProviders = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("it-IT");
    return providers
      .filter((provider) => {
        if (category && canonicalProviderCategory(provider.provider_kind) !== category) return false;
        if (city && provider.city !== city) return false;
        if (partyType && (!isPartyProvider(provider) || !getPartyTypes(provider).includes(partyType))) return false;
        if (premiumOnly && !provider.premium) return false;
        if (!query) return true;
        return [provider.name, canonicalProviderCategory(provider.provider_kind), provider.city, provider.services]
          .filter(Boolean)
          .some((value) => value.toLocaleLowerCase("it-IT").includes(query));
      })
      .sort((a, b) => Number(Boolean(b.premium)) - Number(Boolean(a.premium)) ||
        (a.name ?? "").localeCompare(b.name ?? "", "it"));
  }, [providers, category, city, partyType, premiumOnly, search]);

  useEffect(() => {
    if (!showPartyTypeFilter) setPartyType("");
  }, [showPartyTypeFilter]);

  return (
    <div className="activities-page">
      <header className="activities-hero">
        <a className="activities-brand" href="/">ToscanaFamily</a>
        <span className="activities-eyebrow">SCOPRI IL TERRITORIO</span>
        <h1>Attività per tutta la famiglia</h1>
        <p>Feste, spazi gioco e servizi per organizzare momenti speciali.</p>
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

          {showPartyTypeFilter && (
            <label>
              <span>Tipo di festa</span>
              <select value={partyType} onChange={(event) => setPartyType(event.target.value)}>
                <option value="">Tutte</option>
                {PARTY_TYPES.map(({ label }) => <option key={label} value={label}>{label}</option>)}
              </select>
            </label>
          )}

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
              {filteredProviders.map((provider) => (
                <article className="activity-card" key={provider.id}>
                  <div className="activity-card-heading">
                    <span className="activity-kind">
                      {providerCategoryName(canonicalProviderCategory(provider.provider_kind))}
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
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
