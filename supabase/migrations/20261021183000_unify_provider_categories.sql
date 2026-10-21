ALTER TABLE public.providers
  DROP CONSTRAINT providers_provider_type_check;

UPDATE public.providers
SET provider_type = 'feste'
WHERE provider_type IN ('animator', 'party_room');

ALTER TABLE public.providers
  ADD CONSTRAINT providers_provider_type_check
  CHECK (
    provider_type IN (
      'feste',
      'playroom',
      'inflatable_rental',
      'educational_farm',
      'baby_parking',
      'creative_workshop',
      'catering',
      'photographer',
      'other'
    )
  );
