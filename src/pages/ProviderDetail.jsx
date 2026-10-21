import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import {
  canonicalProviderCategory,
  providerCategoryName
} from "../lib/providerCategories.js";

function phoneHref(value) {
  if (!value) return "";
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

function whatsappHref(value) {
  if (!value) return "";
  const trimmed = value.trim();
  let number = trimmed.replace(/\D/g, "");
  if (!number) return "";
  if (number.startsWith("00")) number = number.slice(2);
  else if (!trimmed.startsWith("+") && !number.startsWith("39")) number = `39${number}`;
  return `https://wa.me/${number}?text=Ciao%20ti%20ho%20trovato%20su%20ToscanaFamily`;
}

function websiteHref(value) {
  if (!value) return "";
  try {
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export default function ProviderDetail({ providerId }) {
  const [provider, setProvider] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadProvider() {
      setLoading(true);
      setError("");
      const { data, error: queryError } = await supabase
        .from("providers")
        .select("*")
        .eq("id", providerId)
        .maybeSingle();

      if (cancelled) return;
      if (queryError) {
        setError(`Impossibile caricare il profilo: ${queryError.message}`);
      } else if (!data) {
        setError("Il profilo provider non è stato trovato.");
      } else {
        setProvider(data);
      }
      setLoading(false);
    }

    loadProvider();
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  const phone = provider?.phone?.trim() ?? "";
  const whatsapp = whatsappHref(provider?.whatsapp || phone);
  const telephone = phoneHref(phone);
  const website = websiteHref(provider?.website);
  const description = provider?.description || provider?.notes || provider?.services;
  const category = providerCategoryName(canonicalProviderCategory(provider?.provider_kind));

  return (
    <main className="provider-detail-page">
      <a className="provider-detail-back" href="/">← Torna a ToscanaFamily</a>

      {loading && <p className="provider-detail-message" role="status">Caricamento profilo…</p>}
      {!loading && error && <p className="provider-detail-message error" role="alert">{error}</p>}

      {!loading && !error && provider && (
        <article className="provider-detail">
          {provider.image_url && (
            <img
              className="provider-detail-image"
              src={provider.image_url}
              alt={provider.name}
              onError={(event) => { event.currentTarget.hidden = true; }}
            />
          )}
          <div className="provider-detail-content">
            {category && <span className="activity-kind">{category}</span>}
            <h1>{provider.name}</h1>
            {description && <p className="provider-detail-description">{description}</p>}
            {provider.city && (
              <p className="provider-detail-city">📍 {[provider.city, provider.province].filter(Boolean).join(" · ")}</p>
            )}
            {phone && <p className="provider-detail-contact"><strong>Telefono</strong><a href={telephone}>{phone}</a></p>}
            {(provider.whatsapp || phone) && (
              <p className="provider-detail-contact"><strong>WhatsApp</strong><a href={whatsapp} target="_blank" rel="noreferrer">{provider.whatsapp || phone}</a></p>
            )}
            {website && (
              <p className="provider-detail-contact"><strong>Sito web</strong><a href={website} target="_blank" rel="noopener noreferrer">{provider.website}</a></p>
            )}
          </div>
        </article>
      )}

      {!loading && !error && provider && (
        <nav className="provider-detail-ctas" aria-label="Contatta il provider">
          {whatsapp
            ? <a className="provider-cta whatsapp" href={whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>
            : <span className="provider-cta disabled" aria-disabled="true">WhatsApp</span>}
          {telephone
            ? <a className="provider-cta call" href={telephone}>Chiama</a>
            : <span className="provider-cta disabled" aria-disabled="true">Chiama</span>}
          {website
            ? <a className="provider-cta website" href={website} target="_blank" rel="noopener noreferrer">Sito web</a>
            : <span className="provider-cta disabled" aria-disabled="true">Sito web</span>}
        </nav>
      )}
    </main>
  );
}
