-- Applied with Supabase migration add_player_blade_size_mm.
-- Nullable: existing player data and service history are not changed.
ALTER TABLE public.players ADD COLUMN blade_size_mm smallint;
ALTER TABLE public.players ADD CONSTRAINT players_blade_size_mm_allowed CHECK (blade_size_mm IN (210,220,230,238,246,254,263,272,280,288,296,306,312));
COMMENT ON COLUMN public.players.blade_size_mm IS 'Optional runner length in millimeters; allowed sizes supplied by EDGE. NULL means not specified.';
DO $migration$
DECLARE existing_definition text;
BEGIN
  SELECT pg_get_viewdef('public.portal_player_context'::regclass, true) INTO existing_definition;
  IF position('p.member_since' IN existing_definition) = 0 OR position('blade_size_mm' IN existing_definition) > 0 THEN
    RAISE EXCEPTION 'Unexpected portal_player_context definition; inspect before changing';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.portal_player_context AS ' || replace(existing_definition, 'p.member_since', 'p.member_since, pl.blade_size_mm');
END;
$migration$;
NOTIFY pgrst, 'reload schema';
