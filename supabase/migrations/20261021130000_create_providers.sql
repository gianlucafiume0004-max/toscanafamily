CREATE TABLE public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  provider_type text NOT NULL
    CHECK (
      provider_type IN (
        'animator',
        'party_room',
        'playroom',
        'inflatable_rental',
        'educational_farm',
        'baby_parking',
        'creative_workshop',
        'catering',
        'photographer',
        'other'
      )
    ),
  categories text[] NOT NULL DEFAULT '{}',
  city text NOT NULL,
  province text,
  service_areas text[] NOT NULL DEFAULT '{}',
  phone text,
  whatsapp text,
  email text,
  website text,
  facebook text,
  instagram text,
  description text,
  image_url text,
  source_url text,
  verified boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  premium boolean NOT NULL DEFAULT false,
  featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX providers_provider_type_idx ON public.providers (provider_type);
CREATE INDEX providers_city_idx ON public.providers (city);
CREATE INDEX providers_active_idx ON public.providers (active);
CREATE INDEX providers_premium_idx ON public.providers (premium);
CREATE UNIQUE INDEX providers_name_city_lower_uidx
  ON public.providers (lower(name), lower(city));

ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.providers FROM PUBLIC;
REVOKE ALL ON TABLE public.providers FROM anon;
REVOKE ALL ON TABLE public.providers FROM authenticated;

GRANT SELECT ON TABLE public.providers TO anon, authenticated;
GRANT ALL ON TABLE public.providers TO service_role;

CREATE POLICY "Active providers are publicly readable"
  ON public.providers
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

CREATE POLICY "Service role manages all providers"
  ON public.providers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE FUNCTION public.set_providers_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_providers_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_providers_updated_at() FROM anon;
REVOKE ALL ON FUNCTION public.set_providers_updated_at() FROM authenticated;

CREATE TRIGGER set_providers_updated_at
  BEFORE UPDATE ON public.providers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_providers_updated_at();
