CREATE OR REPLACE FUNCTION public.is_portal_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_staff(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.is_portal_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_portal_staff() TO authenticated, service_role;

CREATE OR REPLACE VIEW public.portal_player_context
WITH (security_invoker = true)
AS
SELECT
  pl.id,
  pl.source_profile_id,
  pl.fname,
  pl.lname,
  pl.email,
  pl.team,
  pl.position,
  pl.birth_year,
  pl.organization,
  pl.skate_model,
  pl.hollow,
  pl.steel_brand,
  pl.steel_model,
  pl.steel_install_date,
  pl.prior_sharpen_count,
  pl.profile_preference,
  pl.equipment_notes,
  pl.steel_height_toe_l,
  pl.steel_height_toe_r,
  pl.steel_height_mid_l,
  pl.steel_height_mid_r,
  pl.steel_height_heel_l,
  pl.steel_height_heel_r,
  pl.steel_edge_damage,
  pl.steel_profile_wear,
  pl.steel_condition,
  pl.steel_health_score,
  pl.steel_health_notes,
  pl.steel_sets_count,
  pl.created_by,
  pl.created_at,
  pl.updated_at,
  p.plan,
  p.sharpenings_used,
  p.sharpenings_allowed,
  p.member_since,
  p.internal_notes
FROM public.players AS pl
LEFT JOIN public.profiles AS p
  ON p.id = pl.source_profile_id;

REVOKE ALL ON public.portal_player_context FROM PUBLIC, anon;
GRANT SELECT ON public.portal_player_context TO authenticated, service_role;
