// Stelle identiche a quelle dei Parchi, riusabili per ogni entità recensibile.
export default function StarRating({
  value,
  onChange,
  label,
  disabled = false,
  readOnly = false,
  className = ""
}) {
  if (readOnly) {
    const rating = Math.max(0, Math.min(5, Number(value) || 0));

    return (
      <div className={`park-rating park-rating--readonly ${className}`.trim()} role="img" aria-label={`${label}: ${rating.toFixed(1)} su 5`}>
        {Array.from({ length: 5 }, (_, index) => {
          const fill = Math.max(0, Math.min(1, rating - index));

          return (
            <span key={index} aria-hidden="true" className="park-rating-star">
              <span className="park-rating-star-empty">☆</span>
              {fill > 0 && (
                <span
                  className="park-rating-star-fill"
                  style={{ width: `${fill * 100}%` }}
                >
                  ★
                </span>
              )}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`park-rating ${className}`.trim()} role="group" aria-label={label}>
      {Array.from({ length: 5 }, (_, index) => {
        const star = index + 1;
        const isSelected = star <= value;

        return (
          <button
            key={star}
            type="button"
            disabled={disabled}
            aria-label={`${star} ${star === 1 ? "stella" : "stelle"} su 5`}
            aria-pressed={isSelected}
            onClick={(event) => {
              event.stopPropagation();
              onChange(star);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            style={{
              background: "none",
              border: 0,
              padding: "0 2px",
              color: isSelected ? "#b87400" : "#52645c",
              cursor: disabled ? "default" : "pointer",
              lineHeight: 1
            }}
          >
            {isSelected ? "★" : "☆"}
          </button>
        );
      })}
    </div>
  );
}
