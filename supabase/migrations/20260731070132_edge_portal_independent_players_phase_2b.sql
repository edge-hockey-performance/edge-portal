CREATE TABLE IF NOT EXISTS public.players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_profile_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  fname text NOT NULL DEFAULT '',
  lname text NOT NULL DEFAULT '',
  email text,
  team text DEFAULT '',
  position text,
  birth_year integer,
  organization text,
  skate_model text,
  hollow text DEFAULT '5/8"',
  steel_brand text,
  steel_model text,
  steel_install_date date,
  prior_sharpen_count integer DEFAULT 0,
  profile_preference text DEFAULT '10ft Flat',
  equipment_notes text,
  steel_height_toe_l numeric,
  steel_height_toe_r numeric,
  steel_height_mid_l numeric,
  steel_height_mid_r numeric,
  steel_height_heel_l numeric,
  steel_height_heel_r numeric,
  steel_edge_damage smallint DEFAULT 5,
  steel_profile_wear smallint DEFAULT 5,
  steel_condition smallint DEFAULT 5,
  steel_health_score smallint DEFAULT 100,
  steel_health_notes text,
  steel_sets_count smallint DEFAULT 1,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT players_birth_year_check CHECK (
    birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100
  ),
  CONSTRAINT players_steel_sets_count_check CHECK (
    steel_sets_count IS NULL OR steel_sets_count BETWEEN 1 AND 2
  )
);

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.players TO authenticated, service_role;
REVOKE ALL ON public.players FROM anon;

INSERT INTO public.players (
  id,
  source_profile_id,
  fname,
  lname,
  email,
  team,
  position,
  birth_year,
  organization,
  skate_model,
  hollow,
  steel_brand,
  steel_model,
  steel_install_date,
  prior_sharpen_count,
  profile_preference,
  equipment_notes,
  steel_height_toe_l,
  steel_height_toe_r,
  steel_height_mid_l,
  steel_height_mid_r,
  steel_height_heel_l,
  steel_height_heel_r,
  steel_edge_damage,
  steel_profile_wear,
  steel_condition,
  steel_health_score,
  steel_health_notes,
  steel_sets_count,
  created_by,
  created_at,
  updated_at
)
SELECT
  p.id,
  p.id,
  p.fname,
  p.lname,
  p.email,
  p.team,
  p.position,
  p.birth_year,
  p.organization,
  p.skate_model,
  p.hollow,
  p.steel_brand,
  p.steel_model,
  p.steel_install_date,
  p.prior_sharpen_count,
  p.profile_preference,
  p.equipment_notes,
  p.steel_height_toe_l,
  p.steel_height_toe_r,
  p.steel_height_mid_l,
  p.steel_height_mid_r,
  p.steel_height_heel_l,
  p.steel_height_heel_r,
  p.steel_edge_damage,
  p.steel_profile_wear,
  p.steel_condition,
  p.steel_health_score,
  p.steel_health_notes,
  p.steel_sets_count,
  p.id,
  p.created_at,
  now()
FROM public.profiles AS p
WHERE NOT private.is_staff(p.id)
ON CONFLICT (id) DO UPDATE
SET source_profile_id = EXCLUDED.source_profile_id,
    fname = EXCLUDED.fname,
    lname = EXCLUDED.lname,
    email = EXCLUDED.email,
    team = EXCLUDED.team,
    position = EXCLUDED.position,
    birth_year = EXCLUDED.birth_year,
    organization = EXCLUDED.organization,
    skate_model = EXCLUDED.skate_model,
    hollow = EXCLUDED.hollow,
    steel_brand = EXCLUDED.steel_brand,
    steel_model = EXCLUDED.steel_model,
    steel_install_date = EXCLUDED.steel_install_date,
    prior_sharpen_count = EXCLUDED.prior_sharpen_count,
    profile_preference = EXCLUDED.profile_preference,
    equipment_notes = EXCLUDED.equipment_notes,
    steel_height_toe_l = EXCLUDED.steel_height_toe_l,
    steel_height_toe_r = EXCLUDED.steel_height_toe_r,
    steel_height_mid_l = EXCLUDED.steel_height_mid_l,
    steel_height_mid_r = EXCLUDED.steel_height_mid_r,
    steel_height_heel_l = EXCLUDED.steel_height_heel_l,
    steel_height_heel_r = EXCLUDED.steel_height_heel_r,
    steel_edge_damage = EXCLUDED.steel_edge_damage,
    steel_profile_wear = EXCLUDED.steel_profile_wear,
    steel_condition = EXCLUDED.steel_condition,
    steel_health_score = EXCLUDED.steel_health_score,
    steel_health_notes = EXCLUDED.steel_health_notes,
    steel_sets_count = EXCLUDED.steel_sets_count,
    updated_at = now();

ALTER TABLE public.player_access
  DROP CONSTRAINT player_access_player_id_fkey;
ALTER TABLE public.player_access
  ADD CONSTRAINT player_access_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.appointments
  DROP CONSTRAINT appointments_player_id_fkey;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.blade_reports
  DROP CONSTRAINT blade_reports_player_id_fkey;
ALTER TABLE public.blade_reports
  ADD CONSTRAINT blade_reports_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.sharpenings
  DROP CONSTRAINT sharpenings_player_id_fkey;
ALTER TABLE public.sharpenings
  ADD CONSTRAINT sharpenings_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.skate_log
  DROP CONSTRAINT skate_log_player_id_fkey;
ALTER TABLE public.skate_log
  ADD CONSTRAINT skate_log_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.steel
  DROP CONSTRAINT steel_player_id_fkey;
ALTER TABLE public.steel
  ADD CONSTRAINT steel_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

ALTER TABLE public.steel_history
  DROP CONSTRAINT steel_history_player_id_fkey;
ALTER TABLE public.steel_history
  ADD CONSTRAINT steel_history_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION private.sync_profile_to_player()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF private.is_staff(NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.players (
    id,
    source_profile_id,
    fname,
    lname,
    email,
    team,
    position,
    birth_year,
    organization,
    skate_model,
    hollow,
    steel_brand,
    steel_model,
    steel_install_date,
    prior_sharpen_count,
    profile_preference,
    equipment_notes,
    steel_height_toe_l,
    steel_height_toe_r,
    steel_height_mid_l,
    steel_height_mid_r,
    steel_height_heel_l,
    steel_height_heel_r,
    steel_edge_damage,
    steel_profile_wear,
    steel_condition,
    steel_health_score,
    steel_health_notes,
    steel_sets_count,
    created_by,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.id,
    NEW.fname,
    NEW.lname,
    NEW.email,
    NEW.team,
    NEW.position,
    NEW.birth_year,
    NEW.organization,
    NEW.skate_model,
    NEW.hollow,
    NEW.steel_brand,
    NEW.steel_model,
    NEW.steel_install_date,
    NEW.prior_sharpen_count,
    NEW.profile_preference,
    NEW.equipment_notes,
    NEW.steel_height_toe_l,
    NEW.steel_height_toe_r,
    NEW.steel_height_mid_l,
    NEW.steel_height_mid_r,
    NEW.steel_height_heel_l,
    NEW.steel_height_heel_r,
    NEW.steel_edge_damage,
    NEW.steel_profile_wear,
    NEW.steel_condition,
    NEW.steel_health_score,
    NEW.steel_health_notes,
    NEW.steel_sets_count,
    NEW.id,
    NEW.created_at,
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET source_profile_id = EXCLUDED.source_profile_id,
      fname = EXCLUDED.fname,
      lname = EXCLUDED.lname,
      email = EXCLUDED.email,
      team = EXCLUDED.team,
      position = EXCLUDED.position,
      birth_year = EXCLUDED.birth_year,
      organization = EXCLUDED.organization,
      skate_model = EXCLUDED.skate_model,
      hollow = EXCLUDED.hollow,
      steel_brand = EXCLUDED.steel_brand,
      steel_model = EXCLUDED.steel_model,
      steel_install_date = EXCLUDED.steel_install_date,
      prior_sharpen_count = EXCLUDED.prior_sharpen_count,
      profile_preference = EXCLUDED.profile_preference,
      equipment_notes = EXCLUDED.equipment_notes,
      steel_height_toe_l = EXCLUDED.steel_height_toe_l,
      steel_height_toe_r = EXCLUDED.steel_height_toe_r,
      steel_height_mid_l = EXCLUDED.steel_height_mid_l,
      steel_height_mid_r = EXCLUDED.steel_height_mid_r,
      steel_height_heel_l = EXCLUDED.steel_height_heel_l,
      steel_height_heel_r = EXCLUDED.steel_height_heel_r,
      steel_edge_damage = EXCLUDED.steel_edge_damage,
      steel_profile_wear = EXCLUDED.steel_profile_wear,
      steel_condition = EXCLUDED.steel_condition,
      steel_health_score = EXCLUDED.steel_health_score,
      steel_health_notes = EXCLUDED.steel_health_notes,
      steel_sets_count = EXCLUDED.steel_sets_count,
      updated_at = now();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_profile_to_player() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_profile_to_player ON public.profiles;
CREATE TRIGGER sync_profile_to_player
AFTER INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION private.sync_profile_to_player();

CREATE OR REPLACE FUNCTION private.enforce_player_privilege_boundaries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_staff(auth.uid()) THEN
    NEW.id := OLD.id;
    NEW.source_profile_id := OLD.source_profile_id;
    NEW.steel_height_toe_l := OLD.steel_height_toe_l;
    NEW.steel_height_toe_r := OLD.steel_height_toe_r;
    NEW.steel_height_mid_l := OLD.steel_height_mid_l;
    NEW.steel_height_mid_r := OLD.steel_height_mid_r;
    NEW.steel_height_heel_l := OLD.steel_height_heel_l;
    NEW.steel_height_heel_r := OLD.steel_height_heel_r;
    NEW.steel_edge_damage := OLD.steel_edge_damage;
    NEW.steel_profile_wear := OLD.steel_profile_wear;
    NEW.steel_condition := OLD.steel_condition;
    NEW.steel_health_score := OLD.steel_health_score;
    NEW.steel_health_notes := OLD.steel_health_notes;
    NEW.steel_sets_count := OLD.steel_sets_count;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_player_privilege_boundaries()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_player_privileged_fields ON public.players;
CREATE TRIGGER protect_player_privileged_fields
BEFORE UPDATE ON public.players
FOR EACH ROW
EXECUTE FUNCTION private.enforce_player_privilege_boundaries();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.players (
    id,
    source_profile_id,
    email,
    created_by
  )
  VALUES (
    NEW.id,
    NEW.id,
    NEW.email,
    NEW.id
  )
  ON CONFLICT (id) DO UPDATE
  SET source_profile_id = EXCLUDED.source_profile_id,
      email = EXCLUDED.email,
      updated_at = now();

  INSERT INTO public.player_access (
    player_id,
    user_id,
    relationship,
    is_primary,
    created_by
  )
  VALUES (
    NEW.id,
    NEW.id,
    'self',
    true,
    NEW.id
  )
  ON CONFLICT (player_id, user_id) DO UPDATE
  SET relationship = EXCLUDED.relationship,
      is_primary = EXCLUDED.is_primary,
      revoked_at = NULL;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, supabase_auth_admin, service_role;

CREATE OR REPLACE FUNCTION public.create_managed_player(
  player_fname text,
  player_lname text,
  player_birth_year integer DEFAULT NULL,
  player_team text DEFAULT NULL,
  player_position text DEFAULT NULL,
  player_email text DEFAULT NULL,
  player_relationship text DEFAULT 'parent'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_player_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NULLIF(trim(player_fname), '') IS NULL
     OR NULLIF(trim(player_lname), '') IS NULL THEN
    RAISE EXCEPTION 'Player first and last name are required';
  END IF;

  IF player_relationship NOT IN ('parent', 'guardian') THEN
    RAISE EXCEPTION 'Relationship must be parent or guardian';
  END IF;

  IF player_birth_year IS NOT NULL
     AND (player_birth_year < 1900
          OR player_birth_year > EXTRACT(YEAR FROM CURRENT_DATE)::integer) THEN
    RAISE EXCEPTION 'Invalid birth year';
  END IF;

  IF NULLIF(trim(coalesce(player_team, '')), '') IS NOT NULL
     AND trim(player_team) NOT IN (
       'Chicago Reapers',
       'Chicago Mission',
       'St. Viator',
       'Glenbrook North'
     ) THEN
    RAISE EXCEPTION 'Invalid team';
  END IF;

  INSERT INTO public.players (
    id,
    fname,
    lname,
    birth_year,
    team,
    position,
    email,
    created_by
  )
  VALUES (
    new_player_id,
    trim(player_fname),
    trim(player_lname),
    player_birth_year,
    NULLIF(trim(coalesce(player_team, '')), ''),
    NULLIF(trim(coalesce(player_position, '')), ''),
    NULLIF(trim(coalesce(player_email, '')), ''),
    auth.uid()
  );

  INSERT INTO public.player_access (
    player_id,
    user_id,
    relationship,
    is_primary,
    created_by
  )
  VALUES (
    new_player_id,
    auth.uid(),
    player_relationship,
    true,
    auth.uid()
  );

  RETURN new_player_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_managed_player(text, text, integer, text, text, text, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_managed_player(text, text, integer, text, text, text, text)
TO authenticated, service_role;

DROP POLICY IF EXISTS players_select_authorized ON public.players;
DROP POLICY IF EXISTS players_insert_staff ON public.players;
DROP POLICY IF EXISTS players_update_authorized ON public.players;
DROP POLICY IF EXISTS players_delete_staff ON public.players;

CREATE POLICY players_select_authorized
ON public.players
FOR SELECT
TO authenticated
USING (private.can_access_player(id));

CREATE POLICY players_insert_staff
ON public.players
FOR INSERT
TO authenticated
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY players_update_authorized
ON public.players
FOR UPDATE
TO authenticated
USING (private.can_manage_player(id))
WITH CHECK (private.can_manage_player(id));

CREATE POLICY players_delete_staff
ON public.players
FOR DELETE
TO authenticated
USING (private.is_staff((SELECT auth.uid())));
