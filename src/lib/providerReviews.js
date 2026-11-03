import { supabase } from "./supabase.js";

const TOKEN_KEY = "toscanafamily.reviewerToken";
const reviewedKey = (providerId) => `toscanafamily.reviewed.${providerId}`;

export const REVIEW_COMMENT_MAX_LENGTH = 500;

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage non disponibile: la protezione resta lato database.
  }
}

function getReviewerToken() {
  let token = readStorage(TOKEN_KEY);
  if (!token) {
    token = crypto.randomUUID();
    writeStorage(TOKEN_KEY, token);
  }
  return token;
}

export function hasReviewedProvider(providerId) {
  return readStorage(reviewedKey(providerId)) === "1";
}

// Stesso formato dei Parchi: "⭐ 4,8 · 12 valutazioni".
export function formatRatingSummary(stats) {
  if (!stats?.count) return "Nessuna valutazione";
  const average = (stats.sum / stats.count).toLocaleString("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
  return `⭐ ${average} · ${stats.count} ${stats.count === 1 ? "valutazione" : "valutazioni"}`;
}

function statsFromRow({ review_count: count, average_rating: average }) {
  return { count, sum: Number(average) * count };
}

export async function fetchProviderRatingStats() {
  const { data, error } = await supabase
    .from("provider_review_stats")
    .select("provider_id, review_count, average_rating");
  if (error) throw error;

  return Object.fromEntries((data || []).map((row) => [row.provider_id, statsFromRow(row)]));
}

export async function fetchProviderRatingStat(providerId) {
  const { data, error } = await supabase
    .from("provider_review_stats")
    .select("provider_id, review_count, average_rating")
    .eq("provider_id", providerId)
    .maybeSingle();
  if (error) throw error;
  return data ? statsFromRow(data) : { count: 0, sum: 0 };
}

export async function fetchProviderReviews(providerId, limit = 50) {
  const { data, error } = await supabase
    .from("provider_reviews")
    .select("id, rating, comment, created_at")
    .eq("provider_id", providerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function submitProviderReview({ providerId, rating, comment }) {
  const trimmedComment = (comment || "").trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("Seleziona una valutazione da 1 a 5 stelle.");
  }
  if (trimmedComment.length > REVIEW_COMMENT_MAX_LENGTH) {
    throw new Error(`Il commento può contenere al massimo ${REVIEW_COMMENT_MAX_LENGTH} caratteri.`);
  }

  const { error } = await supabase.from("provider_reviews").insert({
    provider_id: providerId,
    rating,
    comment: trimmedComment || null,
    reviewer_token: getReviewerToken()
  });

  if (error) {
    if (error.code === "23505") {
      writeStorage(reviewedKey(providerId), "1");
      throw new Error("Hai già inviato una recensione per questo profilo.");
    }
    throw error;
  }
  writeStorage(reviewedKey(providerId), "1");
}
