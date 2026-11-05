import { providerServiceTags } from "../lib/providerServiceTags.js";
import RatingSummary from "./reviews/RatingSummary.jsx";

export default function ProviderFeatureCard({ provider, variant }) {
  const serviceTags = providerServiceTags(provider.services);
  const city = typeof provider.city === "string" ? provider.city.trim() : "";
  const province = typeof provider.province === "string" ? provider.province.trim() : "";

  return (
    <article className={`provider-feature-card${variant === "sale_feste" ? " provider-feature-card--sale-feste" : ""}`}>
      <h2 className="provider-feature-title">{provider.name}</h2>
      <div className="provider-feature-info">
        {(variant === "animatori" || variant === "sale_feste") && (
          <RatingSummary
            className="rating-summary-badge provider-feature-rating"
            stats={{
              count: provider.reviewCount,
              averageRating: provider.averageRating
            }}
          />
        )}
        {(city || province) && (
          <p className="provider-feature-location">
            📍 {[city, province].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      {serviceTags.length > 0 && (
        <ul className="provider-service-tags" aria-label="Servizi principali">
          {serviceTags.map(({ id, label }) => (
            <li className={`provider-service-tag provider-service-tag-${id}`} key={id}>
              {label}
            </li>
          ))}
        </ul>
      )}
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
