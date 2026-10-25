ALTER TABLE public.parks
  ADD COLUMN IF NOT EXISTS outside_tuscany boolean NOT NULL DEFAULT false;
