CREATE OR REPLACE FUNCTION private.recalculate_membership_charge_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_membership uuid := coalesce(NEW.membership_id, OLD.membership_id);
  target_player uuid;
  target_season_start date;
  target_season_end date;
  successful_cycles integer;
BEGIN
  SELECT ms.player_id, ms.season_start, ms.season_end
  INTO target_player, target_season_start, target_season_end
  FROM public.membership_subscriptions AS ms
  WHERE ms.id = target_membership;

  IF target_player IS NULL THEN
    SELECT count(*)::integer
    INTO successful_cycles
    FROM public.membership_payments AS mp
    WHERE mp.membership_id = target_membership
      AND mp.outcome IN ('succeeded', 'recovered');

    UPDATE public.membership_subscriptions AS ms
    SET successful_charge_count = least(successful_cycles, 26),
        billing_stop_required = successful_cycles >= 26,
        billing_stop_reason = CASE WHEN successful_cycles >= 26 THEN 'charge_cap' ELSE NULL END
    WHERE ms.id = target_membership;
  ELSE
    SELECT count(*)::integer
    INTO successful_cycles
    FROM public.membership_payments AS mp
    JOIN public.membership_subscriptions AS counted_membership
      ON counted_membership.id = mp.membership_id
    WHERE counted_membership.player_id = target_player
      AND counted_membership.season_start = target_season_start
      AND counted_membership.season_end = target_season_end
      AND mp.outcome IN ('succeeded', 'recovered');

    UPDATE public.membership_subscriptions AS ms
    SET successful_charge_count = least(successful_cycles, 26),
        billing_stop_required = successful_cycles >= 26,
        billing_stop_reason = CASE WHEN successful_cycles >= 26 THEN 'charge_cap' ELSE NULL END
    WHERE ms.player_id = target_player
      AND ms.season_start = target_season_start
      AND ms.season_end = target_season_end;
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION private.recalculate_membership_charge_count() FROM PUBLIC, anon, authenticated;
