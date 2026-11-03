import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import {
  getProviderCategories,
  providerCategoryName
} from "../lib/providerCategories.js";
import {
  providerDirectionsUrl,
  providerFullAddress,
  providerNotesWithoutAddress
} from "../lib/providerLocation.js";
import { providerServiceTags } from "../lib/providerServiceTags.js";
import ReviewsSection from "../components/reviews/ReviewsSection.jsx";

function asText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function phoneHref(value) {
  const trimmed = asText(value);
  if (!trimmed) return "";

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  const prefersInternational = trimmed.startsWith("+") || trimmed.startsWith("00");
  const normalizedDigits = digits.replace(/^00/, "");
  return `tel:${prefersInternational ? `+${normalizedDigits}` : normalizedDigits}`;
}

function whatsappHref(value) {
  const trimmed = asText(value);
  if (!trimmed) return "";

  let number = trimmed.replace(/\D/g, "");
  if (!number) return "";

  if (number.startsWith("00")) number = number.slice(2);
  else if (!trimmed.startsWith("+") && !number.startsWith("39")) number = `39${number}`;

  return `https://wa.me/${number}?text=Ciao%20ti%20ho%20trovato%20su%20ToscanaFamily`;
}

function websiteHref(value) {
  const trimmed = asText(value);
  if (!trimmed) return "";

  try {
    if (/\s/.test(trimmed)) return "";
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) && url.hostname.includes(".")
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function WhatsAppIcon() {
  return (
    <svg className="provider-whatsapp-icon" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3.2A12.6 12.6 0 0 0 5.2 22.3L3.5 28.5l6.4-1.7A12.7 12.7 0 1 0 16 3.2Zm0 22.8a10 10 0 0 1-5.1-1.4l-.4-.2-3.8 1 1-3.7-.3-.4A10.1 10.1 0 1 1 16 26Z" />
      <path d="M22 18.3c-.3-.2-1.8-.9-2.1-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.2 8.2 0 0 1-2.5-1.5 9.2 9.2 0 0 1-1.7-2.1c-.2-.3 0-.5.1-.7l.5-.5.3-.5c.1-.2 0-.4 0-.5s-.7-1.7-1-2.3-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4s-1 1-1 2.4 1 2.8 1.2 3 .2.4.4.6a11.2 11.2 0 0 0 4.3 3.8c.6.3 1.1.5 1.5.6.6.2 1.2.2 1.7.1s1.8-.7 2-1.4.3-1.2.2-1.4-.2-.2-.5-.4Z" />
    </svg>
  );
}

export default function ProviderDetail({ providerId }) {
  const [provider, setProvider] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadProvider() {
      const normalizedProviderId = asText(providerId);
      if (!normalizedProviderId) {
        setProvider(null);
        setLoading(false);
        setError("Il profilo provider non è stato trovato.");
        return;
      }

      setLoading(true);
      setError("");
      const { data, error: queryError } = await supabase
        .from("providers")
        .select("*")
        .eq("id", normalizedProviderId)
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

  const phone = asText(provider?.phone);
  const phoneNumbers = phone.split(/[;,\n]|\s+\boppure\b\s+/i).map((value) => value.trim()).filter(Boolean);
  const whatsappValue = asText(provider?.whatsapp || phoneNumbers[0]);
  const whatsapp = whatsappHref(whatsappValue);
  const telephones = phoneNumbers.map(phoneHref).filter(Boolean);
  const websiteValue = asText(provider?.website);
  const website = websiteHref(websiteValue);
  const description = asText(provider?.description);
  const notes = providerNotesWithoutAddress(provider);
  const services = asText(provider?.services);
  const serviceTags = providerServiceTags(provider?.services);
  const email = asText(provider?.email);
  const emailHref = email ? `mailto:${email}` : "";
  const directions = providerDirectionsUrl(provider);
  const fullAddress = providerFullAddress(provider);
  const socialLinks = [...new Set([provider?.social_url, provider?.facebook, provider?.instagram]
    .flatMap((value) => asText(value).split(/[;,]/))
    .map((value) => value.trim())
    .filter(Boolean))]
    .map((value) => {
      const href = websiteHref(value);
      if (!href) return null;
      const hostname = new URL(href).hostname.replace(/^www\./, "").toLocaleLowerCase("it-IT");
      const label = hostname.includes("facebook.com")
        ? "📘 Facebook"
        : hostname.includes("instagram.com")
          ? "📷 Instagram"
          : "🔗 Social";
      return { label, href };
    })
    .filter(Boolean);
  const additionalInfo = [
    ["Area servita", provider?.coverage_area],
    ["Provincia", provider?.province],
    ["Orari", provider?.hours],
    ["Capienza", provider?.capacity],
    ["Prezzo", provider?.price]
  ]
    .map(([label, value]) => ({ label, value: asText(value) }))
    .filter(({ value }) => value);
  const category = getProviderCategories(provider ?? {})
    .map(providerCategoryName)
    .join(" · ");
  const contactActions = [
    ...telephones.map((href) => ({ label: "Chiama", href, className: "call", icon: "📞" })),
    whatsapp && { label: "WhatsApp", href: whatsapp, className: "whatsapp", icon: <WhatsAppIcon /> },
    emailHref && { label: "Email", href: emailHref, className: "email", icon: "📧" },
    website && { label: "Sito", href: website, className: "website", icon: "🌐", external: true },
    directions && { label: "Portami qui", href: directions, className: "directions", icon: "📍", external: true }
  ].filter(Boolean);

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
            {contactActions.length > 0 && (
              <nav className="provider-detail-ctas" aria-label="Contatti e indicazioni">
                {contactActions.map(({ label, href, className, icon, external }) => (
                  <a
                    className={`provider-cta ${className}`}
                    href={href}
                    key={`${className}-${href}`}
                    target={external || className === "whatsapp" ? "_blank" : undefined}
                    rel={external || className === "whatsapp" ? "noopener noreferrer" : undefined}
                  >
                    {icon}
                    <span>{label}</span>
                  </a>
                ))}
              </nav>
            )}
            {fullAddress && (
              <section className="provider-detail-section" aria-labelledby="provider-location-title">
                <h2 id="provider-location-title">Dove siamo</h2>
                {fullAddress && <p className="provider-detail-city">📍 {fullAddress}</p>}
              </section>
            )}
            {socialLinks.length > 0 && (
              <section className="provider-detail-section" aria-labelledby="provider-contacts-title">
                <h2 id="provider-contacts-title">Social</h2>
                <div className="provider-detail-contact-list">
                  {socialLinks.map(({ label, href }) => (
                    <a key={`${label}-${href}`} href={href} target="_blank" rel="noopener noreferrer">
                      {label}
                    </a>
                  ))}
                </div>
              </section>
            )}
            {services && (
              <section className="provider-detail-section" aria-labelledby="provider-services-title">
                <h2 id="provider-services-title">Servizi</h2>
                {serviceTags.length > 0 && (
                  <ul className="provider-service-tags" aria-label="Categorie di servizio">
                    {serviceTags.map(({ id, label }) => (
                      <li className={`provider-service-tag provider-service-tag-${id}`} key={id}>
                        {label}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="provider-detail-long-text">{services}</p>
              </section>
            )}
            {notes && (
              <section className="provider-detail-section" aria-labelledby="provider-notes-title">
                <h2 id="provider-notes-title">Note</h2>
                <p className="provider-detail-long-text">{notes}</p>
              </section>
            )}
            {additionalInfo.length > 0 && (
              <section className="provider-detail-section" aria-labelledby="provider-more-title">
                <h2 id="provider-more-title">Altre informazioni</h2>
                <dl className="provider-detail-info-grid">
                  {additionalInfo.map(({ label, value }) => (
                    <div className="provider-detail-info-item" key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            {getProviderCategories(provider).includes("animatori") && (
              <ReviewsSection providerId={provider.id} providerName={provider.name} />
            )}
          </div>
        </article>
      )}

    </main>
  );
}
