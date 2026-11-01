ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS street_address text,
  ADD COLUMN IF NOT EXISTS province text,
  ADD COLUMN IF NOT EXISTS booking_required boolean,
  ADD COLUMN IF NOT EXISTS booking_notes text;
