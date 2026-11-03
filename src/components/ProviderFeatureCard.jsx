import { providerStreetAddress } from "../lib/providerLocation.js";

export default function ProviderFeatureCard({ provider }) {
  const address = providerStreetAddress(provider);
  const city = typeof provider.city === "string" ? provider.city.trim() : "";
  const description = typeof provider.description === "string"
    ? provider.description.trim()
    : typeof provider.services === "string" && provider.services.trim()
      ? provider.services.trim()
      : typeof provider.notes === "string" && !/^\s*Sede(?: pubblicata)?\s*:/i.test(provider.notes)
        ? provider.notes.trim()
        : "";

  return (
    <article className="provider-feature-card">
      <h2 className="provider-feature-title">{provider.name}</h2>
      {address && <p className="provider-feature-address">📍 {address}</p>}
      {city && <p className="provider-feature-location">📍 {city}</p>}
      {description && <p className="provider-feature-description">{description}</p>}
      <div className="card-actions provider-feature-card-actions">
        <a
          className="provider-feature-detail"
          href={`/provider/${encodeURIComponent(provider.id)}`}
        >
          📝 Tutte le info
        </a>
      </div>
    </article>
  );
}
