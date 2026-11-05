BEGIN;

ALTER TABLE public.park_ratings
  ADD COLUMN comment text,
  ADD COLUMN status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('approved', 'pending', 'rejected')),
  ADD COLUMN reviewer_token uuid,
  ADD CONSTRAINT park_ratings_comment_length_check
    CHECK (comment IS NULL OR char_length(btrim(comment)) BETWEEN 1 AND 500),
  ADD CONSTRAINT park_ratings_one_per_device
    UNIQUE (park_id, reviewer_token);

CREATE INDEX park_ratings_reviews_idx
  ON public.park_ratings (park_id, created_at DESC);

ALTER TABLE public.park_ratings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.park_ratings FROM PUBLIC;
REVOKE ALL ON TABLE public.park_ratings FROM anon;
REVOKE ALL ON TABLE public.park_ratings FROM authenticated;

GRANT SELECT (id, park_id, rating, comment, status, created_at)
  ON TABLE public.park_ratings TO anon, authenticated;
GRANT INSERT (park_id, rating, comment, reviewer_token)
  ON TABLE public.park_ratings TO anon, authenticated;
GRANT ALL ON TABLE public.park_ratings TO service_role;

DROP POLICY IF EXISTS "Public can read park ratings" ON public.park_ratings;
DROP POLICY IF EXISTS "Public can insert valid park ratings" ON public.park_ratings;

CREATE POLICY "Public can read approved park reviews"
  ON public.park_ratings
  FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

CREATE POLICY "Public can insert valid park reviews"
  ON public.park_ratings
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    rating BETWEEN 1 AND 5
    AND (comment IS NULL OR char_length(btrim(comment)) BETWEEN 1 AND 500)
    AND reviewer_token IS NOT NULL
    AND status = 'approved'
  );

CREATE POLICY "Service role manages park reviews"
  ON public.park_ratings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE VIEW public.park_review_stats
  WITH (security_invoker = true) AS
SELECT
  park_id,
  count(*)::int AS review_count,
  round(avg(rating)::numeric, 1) AS average_rating
FROM public.park_ratings
WHERE status = 'approved'
GROUP BY park_id;

REVOKE ALL ON TABLE public.park_review_stats FROM PUBLIC;
REVOKE ALL ON TABLE public.park_review_stats FROM anon;
REVOKE ALL ON TABLE public.park_review_stats FROM authenticated;
GRANT SELECT ON TABLE public.park_review_stats TO anon, authenticated;
GRANT SELECT ON TABLE public.park_review_stats TO service_role;

COMMIT;
