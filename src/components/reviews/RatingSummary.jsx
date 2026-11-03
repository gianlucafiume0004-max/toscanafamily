import { formatRatingSummary } from "../../lib/providerReviews.js";

export default function RatingSummary({ stats, className = "location" }) {
  return <p className={className}>{formatRatingSummary(stats)}</p>;
}
