import { useCallback, useEffect, useState } from "react";
import {
  REVIEW_COMMENT_MAX_LENGTH,
  fetchProviderRatingStat,
  fetchProviderReviews,
  hasReviewedProvider,
  submitProviderReview
} from "../../lib/providerReviews.js";
import RatingSummary from "./RatingSummary.jsx";
import StarRating from "./StarRating.jsx";

const dateFormatter = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" });

export default function ReviewsSection({ providerId, providerName }) {
  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState({ count: 0, sum: 0 });
  const [loadError, setLoadError] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [alreadyReviewed, setAlreadyReviewed] = useState(() => hasReviewedProvider(providerId));

  const loadReviews = useCallback(async () => {
    try {
      const [nextReviews, nextStats] = await Promise.all([
        fetchProviderReviews(providerId),
        fetchProviderRatingStat(providerId)
      ]);
      setReviews(nextReviews);
      setStats(nextStats);
      setLoadError("");
    } catch (error) {
      console.error("Errore durante il caricamento delle recensioni:", error);
      setLoadError("Impossibile caricare le recensioni.");
    }
  }, [providerId]);

  useEffect(() => {
    setAlreadyReviewed(hasReviewedProvider(providerId));
    loadReviews();
  }, [providerId, loadReviews]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFormError("");
    try {
      await submitProviderReview({ providerId, rating, comment });
      setAlreadyReviewed(true);
      setRating(0);
      setComment("");
      await loadReviews();
    } catch (error) {
      if (/già inviato/.test(error.message)) setAlreadyReviewed(true);
      console.error("Errore durante l'invio della recensione:", error);
      setFormError(error.message || "Impossibile inviare la recensione.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="provider-detail-section provider-reviews" aria-labelledby="provider-reviews-title">
      <h2 id="provider-reviews-title">⭐ Recensioni</h2>
      <RatingSummary stats={stats} />

      {alreadyReviewed ? (
        <p className="provider-review-note" role="status">Grazie! Hai già recensito questo profilo.</p>
      ) : (
        <form className="provider-review-form" onSubmit={handleSubmit}>
          <StarRating
            value={rating}
            onChange={setRating}
            label={`Valutazione di ${providerName}`}
            disabled={submitting}
          />
          <label className="provider-review-field">
            <span>Commento (facoltativo)</span>
            <textarea
              value={comment}
              maxLength={REVIEW_COMMENT_MAX_LENGTH}
              rows={3}
              disabled={submitting}
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
          {formError && <p className="provider-review-error" role="alert">{formError}</p>}
          <button type="submit" disabled={submitting || rating === 0}>
            {submitting ? "Invio…" : "Invia recensione"}
          </button>
        </form>
      )}

      {loadError && <p className="provider-review-error" role="alert">{loadError}</p>}
      {!loadError && reviews.length === 0 && <p className="provider-review-note">Ancora nessuna recensione.</p>}
      {reviews.length > 0 && (
        <ul className="provider-review-list">
          {reviews.map((review) => (
            <li className="provider-review-item" key={review.id}>
              <div className="provider-review-meta">
                <span className="provider-review-stars" aria-label={`${review.rating} stelle su 5`}>
                  {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
                </span>
                <time dateTime={review.created_at}>{dateFormatter.format(new Date(review.created_at))}</time>
              </div>
              {review.comment && <p>{review.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
