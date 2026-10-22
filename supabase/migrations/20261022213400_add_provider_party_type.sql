ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS party_type text;

ALTER TABLE public.providers
  DROP CONSTRAINT IF EXISTS providers_party_type_check;

ALTER TABLE public.providers
  ADD CONSTRAINT providers_party_type_check
  CHECK (
    party_type IS NULL
    OR party_type IN (
      'animatore',
      'sala_feste_e_eventi',
      'animatore_e_sala'
    )
  );

CREATE INDEX IF NOT EXISTS providers_party_type_idx
  ON public.providers (party_type);
