import { useEffect, useState } from "react";
import { fetchProviderRatingStats } from "../lib/providerReviews.js";

export default function useProviderRatingStats() {
  const [result, setResult] = useState({ stats: {}, error: "" });

  useEffect(() => {
    let cancelled = false;

    fetchProviderRatingStats()
      .then((stats) => {
        if (!cancelled) setResult({ stats, error: "" });
      })
      .catch((error) => {
        console.error("Errore durante il caricamento delle valutazioni dei provider:", error);
        if (!cancelled) {
          setResult({
            stats: {},
            error: `Impossibile caricare le valutazioni dei provider: ${error.message}`
          });
        }
      });

    return () => { cancelled = true; };
  }, []);

  return result;
}
