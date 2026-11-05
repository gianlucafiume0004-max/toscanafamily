import { providerStreetAddress } from "../lib/providerLocation.js";
import { providerServiceTags } from "../lib/providerServiceTags.js";
import RatingSummary from "./reviews/RatingSummary.jsx";

export default function ProviderFeatureCard({ provider, variant }) {
  const address = providerStreetAddress(provider);
  const serviceTags = providerServiceTags(provider.services);
  const city = typeof provider.city === "string" ? provider.city.trim() : "";
  const description = typeof provider.description === "string"
    ? provider.description.trim()
    : typeof provider.services === "string" && provider.services.trim()
      ? provider.services.trim()
      : typeof provider.notes === "string" && !/^\s*Sede(?: pubblicata)?\s*:/i.test(provider.notes)
        ? provider.notes.trim()
        : "";

  return (
    <article className={`provider-feature-card${variant === "sale_feste" ? " provider-feature-card--sale-feste" : ""}`}>
      <h2 className="provider-feature-title">{provider.name}</h2>
      {address && <p className="provider-feature-address">📍 {address}</p>}
      {city && <p className="provider-feature-location">📍 {city}</p>}
      {variant === "animatori" && (
        <RatingSummary
          className="provider-feature-rating"
          stats={{
            count: provider.reviewCount,
            averageRating: provider.averageRating
          }}
        />
      )}
      {serviceTags.length > 0 && (
        <ul className="provider-service-tags" aria-label="Servizi principali">
          {serviceTags.map(({ id, label }) => (
            <li className={`provider-service-tag provider-service-tag-${id}`} key={id}>
              {label}
            </li>
          ))}
        </ul>
      )}
      {description && <p className="provider-feature-description">{description}</p>}
      <div className="card-actions provider-feature-card-actions">
        <a
          className="provider-feature-detail"
          href={`/provider/${encodeURIComponent(provider.id)}`}
        >
          ℹ️ Tutte le info
        </a>
      </div>
    </article>
  );
}
