-- Recensioni pubbliche dei provider (Animatori ora; Sale Feste e attività future in seguito).
CREATE TABLE public.provider_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(btrim(comment)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('approved', 'pending', 'rejected')),
  -- Token anonimo salvato nel dispositivo: una recensione per provider e dispositivo.
  reviewer_token uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_reviews_one_per_device UNIQUE (provider_id, reviewer_token)
);

CREATE INDEX provider_reviews_provider_idx
  ON public.provider_reviews (provider_id, created_at DESC);

ALTER TABLE public.provider_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.provider_reviews FROM PUBLIC;
REVOKE ALL ON TABLE public.provider_reviews FROM anon;
REVOKE ALL ON TABLE public.provider_reviews FROM authenticated;

-- reviewer_token non è leggibile dai client pubblici.
GRANT SELECT (id, provider_id, rating, comment, status, created_at)
  ON TABLE public.provider_reviews TO anon, authenticated;
GRANT INSERT (provider_id, rating, comment, reviewer_token)
  ON TABLE public.provider_reviews TO anon, authenticated;
GRANT ALL ON TABLE public.provider_reviews TO service_role;

CREATE POLICY "Public can read approved provider reviews"
  ON public.provider_reviews
  FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

CREATE POLICY "Public can insert valid provider reviews"
  ON public.provider_reviews
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    rating BETWEEN 1 AND 5
    AND status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.active = true
    )
  );

CREATE POLICY "Service role manages provider reviews"
  ON public.provider_reviews
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE VIEW public.provider_review_stats
  WITH (security_invoker = true) AS
SELECT
  provider_id,
  count(*)::int AS review_count,
  round(avg(rating)::numeric, 1) AS average_rating
FROM public.provider_reviews
WHERE status = 'approved'
GROUP BY provider_id;

REVOKE ALL ON TABLE public.provider_review_stats FROM PUBLIC;
REVOKE ALL ON TABLE public.provider_review_stats FROM anon;
REVOKE ALL ON TABLE public.provider_review_stats FROM authenticated;
GRANT SELECT ON TABLE public.provider_review_stats TO anon, authenticated;
GRANT SELECT ON TABLE public.provider_review_stats TO service_role;
