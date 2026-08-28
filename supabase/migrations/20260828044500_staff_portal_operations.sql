BEGIN;
ALTER TABLE public.sharpenings ADD COLUMN IF NOT EXISTS service_request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS sharpenings_service_request_id_idx ON public.sharpenings(service_request_id) WHERE service_request_id IS NOT NULL;
COMMENT ON COLUMN public.sharpenings.service_request_id IS 'Client-generated idempotency key for staff service logging.';
DROP VIEW IF EXISTS public.staff_player_operations;
CREATE VIEW public.staff_player_operations WITH(security_invoker=true) AS
WITH current_membership AS (
 SELECT DISTINCT ON(ms.player_id) ms.player_id,ms.id membership_id,ms.status membership_status,ms.plan_code,ms.started_at,ms.created_at
 FROM public.membership_subscriptions ms WHERE ms.player_id IS NOT NULL
 ORDER BY ms.player_id,CASE WHEN ms.status IN('active','grace') THEN 0 ELSE 1 END,coalesce(ms.started_at,ms.created_at) DESC,ms.id
), service_totals AS (
 SELECT s.player_id,count(*)::integer sharpening_count,max(s.date) last_sharpening_date FROM public.sharpenings s GROUP BY s.player_id
), current_week_usage AS (
 SELECT msu.player_id,count(*)::integer used_sets,array_agg(msu.steel_set ORDER BY msu.steel_set)::smallint[] used_set_numbers
 FROM public.membership_service_usage msu WHERE msu.service_week_start=private.membership_week_start(now()) GROUP BY msu.player_id
), duplicate_groups AS (
 SELECT p.id,count(*) OVER(PARTITION BY lower(trim(concat_ws(' ',p.fname,p.lname))),lower(trim(coalesce(p.email,''))))::integer possible_duplicate_count FROM public.players p
), access_totals AS (
 SELECT pa.player_id,count(*) FILTER(WHERE pa.revoked_at IS NULL)::integer portal_access_count FROM public.player_access pa GROUP BY pa.player_id
)
SELECT p.id,p.source_profile_id,p.fname,p.lname,p.email,p.organization,p.team,p.hollow,p.position,p.skate_model,p.steel_brand,p.steel_model,p.steel_sets_count,p.steel_health_score,p.steel_health_notes,p.created_at,
 cm.membership_id,coalesce(cm.membership_status,'inactive') membership_status,cm.plan_code,mp.name membership_plan_name,coalesce(mp.weekly_set_allowance,0)::smallint weekly_set_allowance,
 coalesce(cwu.used_sets,0)::integer used_sets,coalesce(cwu.used_set_numbers,ARRAY[]::smallint[]) used_set_numbers,greatest(coalesce(mp.weekly_set_allowance,0)-coalesce(cwu.used_sets,0),0)::integer remaining_sets,
 coalesce(st.sharpening_count,0)::integer sharpening_count,st.last_sharpening_date,coalesce(at.portal_access_count,0)::integer portal_access_count,coalesce(dg.possible_duplicate_count,1)::integer possible_duplicate_count,
 (NULLIF(trim(concat_ws(' ',p.fname,p.lname)),'') IS NULL OR NULLIF(trim(coalesce(p.organization,'')),'') IS NULL OR NULLIF(trim(coalesce(p.team,'')),'') IS NULL OR NULLIF(trim(coalesce(p.hollow,'')),'') IS NULL) needs_data_review
FROM public.players p LEFT JOIN current_membership cm ON cm.player_id=p.id LEFT JOIN public.membership_plans mp ON mp.code=cm.plan_code LEFT JOIN service_totals st ON st.player_id=p.id LEFT JOIN current_week_usage cwu ON cwu.player_id=p.id LEFT JOIN duplicate_groups dg ON dg.id=p.id LEFT JOIN access_totals at ON at.player_id=p.id;
REVOKE ALL ON public.staff_player_operations FROM PUBLIC,anon;
GRANT SELECT ON public.staff_player_operations TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.staff_membership_activation_gaps()
RETURNS TABLE(membership_id uuid,player_id uuid,player_name text,player_email text,buyer_email text,plan_code text,membership_status text,paid_at timestamptz,gap_kind text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $f$
BEGIN
 IF NOT private.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Staff access required'; END IF;
 RETURN QUERY SELECT ms.id,ms.player_id,trim(concat_ws(' ',coalesce(p.fname,ms.player_first_name),coalesce(p.lname,ms.player_last_name))),coalesce(NULLIF(trim(p.email),''),NULLIF(trim(ms.player_email),'')),ms.buyer_email,ms.plan_code,ms.status,coalesce(ms.started_at,ms.created_at),
 CASE WHEN ms.player_id IS NULL THEN 'membership_not_linked_to_player' WHEN NOT EXISTS(SELECT 1 FROM public.player_access pa WHERE pa.player_id=ms.player_id AND pa.revoked_at IS NULL) THEN 'player_has_no_portal_access' ELSE 'unknown' END
 FROM public.membership_subscriptions ms LEFT JOIN public.players p ON p.id=ms.player_id
 WHERE ms.status IN('active','grace') AND(ms.player_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.player_access pa WHERE pa.player_id=ms.player_id AND pa.revoked_at IS NULL))
 ORDER BY coalesce(ms.started_at,ms.created_at) DESC,ms.id;
END;$f$;
REVOKE ALL ON FUNCTION public.staff_membership_activation_gaps() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_membership_activation_gaps() TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.log_staff_sharpening(request_id uuid,check_player uuid,service_date date,service_location text,service_hollow text,service_condition text,service_notes text,service_steel_set smallint,rating_steel_health smallint DEFAULT NULL,rating_blade_height smallint DEFAULT NULL,rating_edge_condition smallint DEFAULT NULL,rating_profile_shape smallint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE p public.players%ROWTYPE;m public.membership_subscriptions%ROWTYPE;pl public.membership_plans%ROWTYPE;existing uuid;usage public.membership_service_usage%ROWTYPE;sharp uuid;week_start date:=private.membership_week_start(now());loc text:=NULLIF(trim(coalesce(service_location,'')),'');hol text:=NULLIF(trim(coalesce(service_hollow,'')),'');cond text:=lower(NULLIF(trim(coalesce(service_condition,'')),''));notes text:=NULLIF(trim(coalesce(service_notes,'')),'');is_test boolean:=false;
BEGIN
 IF NOT private.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Staff access required';END IF;
 IF request_id IS NULL OR service_date IS NULL OR loc IS NULL OR hol IS NULL THEN RAISE EXCEPTION 'Service request, date, location, and hollow are required';END IF;
 IF cond NOT IN('excellent','good','fair','poor') THEN RAISE EXCEPTION 'Condition must be excellent, good, fair, or poor';END IF;
 IF service_steel_set NOT IN(1,2) THEN RAISE EXCEPTION 'Steel set must be 1 or 2';END IF;
 IF notes IS NOT NULL AND char_length(notes)>2000 THEN RAISE EXCEPTION 'Technician feedback must be 2,000 characters or fewer';END IF;
 SELECT s.id INTO existing FROM public.sharpenings s WHERE s.service_request_id=request_id;IF existing IS NOT NULL THEN RETURN jsonb_build_object('sharpening_id',existing,'duplicate',true);END IF;
 SELECT x.* INTO p FROM public.players x WHERE x.id=check_player FOR UPDATE;IF p.id IS NULL THEN RAISE EXCEPTION 'Player not found';END IF;
 is_test:=lower(trim(p.fname))='jordan' AND lower(trim(p.lname))='malin';
 SELECT ms.* INTO m FROM public.membership_subscriptions ms WHERE ms.player_id=check_player AND ms.status IN('active','grace') AND coalesce(ms.started_at,ms.created_at)<=now() AND(ms.entitlement_ends_at IS NULL OR now()<ms.entitlement_ends_at) AND(ms.status<>'grace' OR ms.grace_ends_at IS NULL OR now()<=ms.grace_ends_at) ORDER BY coalesce(ms.started_at,ms.created_at) DESC,ms.id LIMIT 1 FOR UPDATE;
 IF m.id IS NULL AND NOT is_test THEN RAISE EXCEPTION 'Player does not have an active paid membership';END IF;
 IF m.id IS NOT NULL THEN
  SELECT mp.* INTO pl FROM public.membership_plans mp WHERE mp.code=m.plan_code;IF pl.code IS NULL THEN RAISE EXCEPTION 'Membership plan is not configured';END IF;IF service_steel_set>pl.weekly_set_allowance THEN RAISE EXCEPTION 'This membership does not include set %',service_steel_set;END IF;
  SELECT u.* INTO usage FROM public.membership_service_usage u WHERE u.player_id=check_player AND u.service_week_start=week_start AND u.steel_set=service_steel_set FOR UPDATE;
  IF usage.id IS NULL THEN INSERT INTO public.membership_service_usage(membership_id,player_id,service_week_start,steel_set,status,received_at,in_service_at,returned_at,created_by,updated_by) VALUES(m.id,check_player,week_start,service_steel_set,'returned',now(),now(),now(),auth.uid(),auth.uid()) RETURNING * INTO usage;
  ELSIF usage.status<>'returned' THEN UPDATE public.membership_service_usage u SET status='returned',in_service_at=coalesce(u.in_service_at,now()),returned_at=now(),updated_by=auth.uid() WHERE u.id=usage.id RETURNING * INTO usage;
  ELSE RAISE EXCEPTION 'Set % has already been logged for this player in the current service week',service_steel_set;END IF;
 END IF;
 INSERT INTO public.sharpenings(player_id,date,location,hollow,condition,notes,steel_set,rating_steel_health,rating_blade_height,rating_edge_condition,rating_profile_shape,service_request_id) VALUES(check_player,service_date,loc,hol,cond,notes,service_steel_set,rating_steel_health,rating_blade_height,rating_edge_condition,rating_profile_shape,request_id) RETURNING id INTO sharp;
 IF m.id IS NOT NULL THEN INSERT INTO public.membership_audit_log(membership_id,player_id,action,source,actor_user_id,after_state) VALUES(m.id,check_player,'sharpening_logged','portal_admin',auth.uid(),jsonb_build_object('sharpening_id',sharp,'service_request_id',request_id,'service_week_start',week_start,'steel_set',service_steel_set,'usage_id',usage.id,'hollow',hol));END IF;
 RETURN jsonb_build_object('sharpening_id',sharp,'membership_usage_id',usage.id,'duplicate',false,'test_player',is_test);
END;$f$;
REVOKE ALL ON FUNCTION public.log_staff_sharpening(uuid,uuid,date,text,text,text,text,smallint,smallint,smallint,smallint,smallint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.log_staff_sharpening(uuid,uuid,date,text,text,text,text,smallint,smallint,smallint,smallint,smallint) TO authenticated,service_role;
COMMIT;
