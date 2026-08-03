ALTER TABLE public.steel_history
  ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.steel_history.notes IS
  'Optional service-history note displayed by the EDGE portal.';
