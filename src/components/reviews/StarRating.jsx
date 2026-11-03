// Stelle identiche a quelle dei Parchi, riusabili per ogni entità recensibile.
export default function StarRating({ value, onChange, label, disabled = false }) {
  return (
    <div className="park-rating" role="group" aria-label={label}>
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
              color: isSelected ? "#f5a623" : "#aab3af",
              cursor: disabled ? "default" : "pointer",
              fontSize: "1.5rem",
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
