import { supabase } from "./supabase.js";

const TOKEN_KEY = "toscanafamily.reviewerToken";
const REVIEW_COMMENT_MAX_LENGTH = 500;

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
    // The database uniqueness constraint still prevents duplicate reviews.
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

const reviewedKey = (parkId) => `toscanafamily.parkReviewed.${parkId}`;

export function hasReviewedPark(parkId) {
  return readStorage(reviewedKey(parkId)) === "1";
}

function statsFromRow(row) {
  const count = Number(row?.review_count ?? 0);
  const averageRating = count > 0 ? Number(row.average_rating) : null;

  return {
    count,
    averageRating,
    sum: averageRating === null ? 0 : averageRating * count
  };
}

export async function fetchParkReviewStats(parkId) {
  const { data, error } = await supabase
    .from("park_review_stats")
    .select("park_id, review_count, average_rating")
    .eq("park_id", parkId)
    .maybeSingle();
  if (error) throw error;
  return statsFromRow(data);
}

export async function fetchParkReviews(parkId, limit = 50) {
  const { data, error } = await supabase
    .from("park_ratings")
    .select("id, rating, comment, created_at")
    .eq("park_id", parkId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function submitParkReview({ parkId, rating, comment }) {
  const trimmedComment = (comment || "").trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("Seleziona una valutazione da 1 a 5 stelle.");
  }
  if (trimmedComment.length > REVIEW_COMMENT_MAX_LENGTH) {
    throw new Error(`Il commento può contenere al massimo ${REVIEW_COMMENT_MAX_LENGTH} caratteri.`);
  }

  const { error } = await supabase.from("park_ratings").insert({
    park_id: parkId,
    rating,
    comment: trimmedComment || null,
    reviewer_token: getReviewerToken()
  });

  if (error) {
    if (error.code === "23505") {
      writeStorage(reviewedKey(parkId), "1");
      throw new Error("Hai già inviato una recensione per questo parco.");
    }
    throw error;
  }
  writeStorage(reviewedKey(parkId), "1");
}
