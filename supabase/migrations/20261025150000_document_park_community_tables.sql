CREATE TABLE public.park_ratings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  park_id text NOT NULL REFERENCES public.parks(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX park_ratings_park_id_idx
  ON public.park_ratings (park_id);

ALTER TABLE public.park_ratings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.park_ratings FROM PUBLIC;
REVOKE ALL ON TABLE public.park_ratings FROM anon;
REVOKE ALL ON TABLE public.park_ratings FROM authenticated;

GRANT SELECT, INSERT ON TABLE public.park_ratings TO anon, authenticated;

CREATE POLICY "Public can read park ratings"
  ON public.park_ratings
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can insert valid park ratings"
  ON public.park_ratings
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (rating BETWEEN 1 AND 5);

CREATE TABLE public.park_service_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  park_id text NOT NULL REFERENCES public.parks(id) ON DELETE CASCADE,
  service text NOT NULL
    CHECK (
      service IN (
        'bagni',
        'parcheggio',
        'fontanella',
        'area_picnic',
        'area_cani',
        'accessibilita',
        'altri_servizi',
        'presenza_fumatori'
      )
    ),
  is_present boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX park_service_reports_park_id_idx
  ON public.park_service_reports (park_id);

CREATE INDEX park_service_reports_park_service_idx
  ON public.park_service_reports (park_id, service);

ALTER TABLE public.park_service_reports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.park_service_reports FROM PUBLIC;
REVOKE ALL ON TABLE public.park_service_reports FROM anon;
REVOKE ALL ON TABLE public.park_service_reports FROM authenticated;

GRANT SELECT, INSERT ON TABLE public.park_service_reports TO anon, authenticated;

CREATE POLICY "Public can read park service reports"
  ON public.park_service_reports
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can insert allowed park service reports"
  ON public.park_service_reports
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    service IN (
      'bagni',
      'parcheggio',
      'fontanella',
      'area_picnic',
      'area_cani',
      'accessibilita',
      'altri_servizi',
      'presenza_fumatori'
    )
  );
