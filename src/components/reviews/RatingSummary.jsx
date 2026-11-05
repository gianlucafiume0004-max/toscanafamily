import { formatRatingSummary } from "../../lib/providerReviews.js";

export default function RatingSummary({ stats, className = "rating-summary-badge" }) {
  return <p className={className}>{formatRatingSummary(stats)}</p>;
}
