import { useCallback, useEffect, useState } from "react";
import {
  fetchParkReviews,
  fetchParkReviewStats,
  hasReviewedPark,
  submitParkReview
} from "../../lib/parkReviews.js";
import { REVIEW_COMMENT_MAX_LENGTH } from "../../lib/providerReviews.js";
import RatingSummary from "./RatingSummary.jsx";
import StarRating from "./StarRating.jsx";

const dateFormatter = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" });

export default function ParkReviewsSection({
  parkId,
  parkName,
  onStatsChange
}) {
  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState({ count: 0, sum: 0, averageRating: null });
  const [loadError, setLoadError] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [alreadyReviewed, setAlreadyReviewed] = useState(() => hasReviewedPark(parkId));

  const loadReviews = useCallback(async () => {
    try {
      const [nextReviews, nextStats] = await Promise.all([
        fetchParkReviews(parkId),
        fetchParkReviewStats(parkId)
      ]);
      setReviews(nextReviews);
      setStats(nextStats);
      onStatsChange((current) => ({ ...current, [parkId]: nextStats }));
      setLoadError("");
    } catch (error) {
      console.error("Errore durante il caricamento delle recensioni del parco:", error);
      setLoadError("Impossibile caricare le recensioni del parco.");
    }
  }, [parkId, onStatsChange]);

  useEffect(() => {
    setAlreadyReviewed(hasReviewedPark(parkId));
    loadReviews();
  }, [parkId, loadReviews]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFormError("");
    try {
      await submitParkReview({ parkId, rating, comment });
      setAlreadyReviewed(true);
      setRating(0);
      setComment("");
      await loadReviews();
    } catch (error) {
      if (/già inviato/.test(error.message)) setAlreadyReviewed(true);
      console.error("Errore durante l'invio della recensione del parco:", error);
      setFormError(error.message || "Impossibile inviare la recensione.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="park-reviews" aria-labelledby="park-reviews-title">
      <h2 id="park-reviews-title">⭐ Recensioni</h2>
      <StarRating
        value={stats.averageRating ?? 0}
        label={`Valutazione media di ${parkName}`}
        readOnly
      />
      <RatingSummary stats={stats} />

      {alreadyReviewed ? (
        <p className="provider-review-note" role="status">Grazie! Hai già recensito questo parco.</p>
      ) : (
        <form className="provider-review-form" onSubmit={handleSubmit}>
          <StarRating
            value={rating}
            onChange={setRating}
            label={`Valutazione di ${parkName}`}
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
      {reviews.length > 0 && (
        <ul className="provider-review-list">
          {reviews.map((review) => (
            <li className="provider-review-item" key={review.id}>
              <div className="provider-review-meta">
                <StarRating
                  value={review.rating}
                  label={`Valutazione recensione di ${parkName}`}
                  readOnly
                />
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
