import { useEffect, useState } from "react";
import { fetchProviderRatingStats } from "../lib/providerReviews.js";

export default function useProviderRatingStats() {
  const [stats, setStats] = useState({});

  useEffect(() => {
    let cancelled = false;

    fetchProviderRatingStats()
      .then((nextStats) => { if (!cancelled) setStats(nextStats); })
      .catch((error) => console.error("Errore durante il caricamento delle valutazioni dei provider:", error));

    return () => { cancelled = true; };
  }, []);

  return stats;
}
