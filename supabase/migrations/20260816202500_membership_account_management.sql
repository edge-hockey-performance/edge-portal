BEGIN;

ALTER TABLE public.players
  ALTER COLUMN profile_preference DROP DEFAULT;

CREATE TABLE IF NOT EXISTS public.membership_cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES public.membership_subscriptions(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'declined', 'withdrawn')),
  request_note text,
  resolution_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS membership_cancellation_requests_one_pending_idx
  ON public.membership_cancellation_requests (membership_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS membership_cancellation_requests_player_idx
  ON public.membership_cancellation_requests (player_id, requested_at DESC);

ALTER TABLE public.membership_cancellation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.membership_cancellation_requests FROM anon, authenticated;

ALTER TABLE public.membership_cancellation_requests
  DROP CONSTRAINT IF EXISTS membership_cancellation_requests_note_length_check;
ALTER TABLE public.membership_cancellation_requests
  ADD CONSTRAINT membership_cancellation_requests_note_length_check
  CHECK (request_note IS NULL OR char_length(request_note) <= 1000);

CREATE OR REPLACE FUNCTION public.membership_account_snapshot(
  check_player uuid,
  at_time timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  selected_membership public.membership_subscriptions%ROWTYPE;
  selected_plan public.membership_plans%ROWTYPE;
  current_entitlement jsonb;
  purchase_type text;
  payments jsonb := '[]'::jsonb;
  pending_request jsonb;
  latest_paid_amount integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT private.can_access_player(check_player) THEN RAISE EXCEPTION 'Player access denied'; END IF;

  SELECT ms.* INTO selected_membership
  FROM public.membership_subscriptions AS ms
  WHERE ms.player_id = check_player
  ORDER BY CASE WHEN ms.status IN ('active', 'grace', 'pending_activation') THEN 0 ELSE 1 END,
           coalesce(ms.started_at, ms.created_at) DESC, ms.id
  LIMIT 1;

  IF selected_membership.id IS NULL THEN
    RETURN jsonb_build_object('player_id', check_player, 'status', 'inactive', 'purchase_type', NULL,
      'payments', '[]'::jsonb, 'pending_cancellation_request', NULL, 'cancellation_eligible', false);
  END IF;

  SELECT mp.* INTO selected_plan
  FROM public.membership_plans AS mp
  WHERE mp.code = selected_membership.plan_code;

  current_entitlement := public.membership_entitlement_snapshot(check_player, at_time);
  purchase_type := CASE WHEN selected_membership.shopify_subscription_contract_gid IS NULL
    THEN 'season_upfront' ELSE 'weekly_subscription' END;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', payment.id, 'occurred_at', payment.occurred_at, 'outcome', payment.outcome,
    'amount_cents', payment.amount_cents, 'refunded_amount_cents', payment.refunded_amount_cents,
    'currency', payment.currency, 'shopify_order_gid', payment.shopify_order_gid,
    'billing_cycle_index', payment.billing_cycle_index
  ) ORDER BY payment.occurred_at DESC, payment.id), '[]'::jsonb)
  INTO payments
  FROM public.membership_payments AS payment
  WHERE payment.membership_id = selected_membership.id;

  SELECT payment.amount_cents INTO latest_paid_amount
  FROM public.membership_payments AS payment
  WHERE payment.membership_id = selected_membership.id
    AND payment.outcome IN ('succeeded', 'recovered')
  ORDER BY payment.occurred_at DESC, payment.id
  LIMIT 1;

  SELECT jsonb_build_object('id', request.id, 'status', request.status,
    'requested_at', request.requested_at, 'request_note', request.request_note)
  INTO pending_request
  FROM public.membership_cancellation_requests AS request
  WHERE request.membership_id = selected_membership.id AND request.status = 'pending'
  ORDER BY request.requested_at DESC
  LIMIT 1;

  RETURN current_entitlement || jsonb_build_object(
    'membership_id', selected_membership.id,
    'membership_status', selected_membership.status,
    'plan_code', selected_membership.plan_code,
    'plan_name', selected_plan.name,
    'purchase_type', purchase_type,
    'plan_price_cents', selected_plan.price_cents,
    'latest_paid_amount_cents', latest_paid_amount,
    'currency', coalesce(selected_plan.currency, 'USD'),
    'started_at', selected_membership.started_at,
    'season_start', selected_membership.season_start,
    'season_end', selected_membership.season_end,
    'entitlement_ends_at', selected_membership.entitlement_ends_at,
    'shopify_order_gid', selected_membership.shopify_order_gid,
    'has_recurring_contract', selected_membership.shopify_subscription_contract_gid IS NOT NULL,
    'payments', payments,
    'pending_cancellation_request', pending_request,
    'cancellation_eligible', purchase_type = 'weekly_subscription'
      AND selected_membership.status IN ('active', 'grace') AND pending_request IS NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_membership_cancellation(
  check_membership uuid,
  request_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  selected_membership public.membership_subscriptions%ROWTYPE;
  existing_request public.membership_cancellation_requests%ROWTYPE;
  created_request public.membership_cancellation_requests%ROWTYPE;
  normalized_note text := NULLIF(trim(coalesce(request_note, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF normalized_note IS NOT NULL AND char_length(normalized_note) > 1000 THEN
    RAISE EXCEPTION 'Cancellation request note must be 1,000 characters or fewer';
  END IF;

  SELECT ms.* INTO selected_membership
  FROM public.membership_subscriptions AS ms
  WHERE ms.id = check_membership
  FOR UPDATE;

  IF selected_membership.id IS NULL THEN RAISE EXCEPTION 'Membership not found'; END IF;
  IF selected_membership.player_id IS NULL OR NOT private.can_access_player(selected_membership.player_id) THEN
    RAISE EXCEPTION 'Player access denied';
  END IF;
  IF selected_membership.shopify_subscription_contract_gid IS NULL THEN
    RAISE EXCEPTION 'Prepaid season memberships do not renew and do not require cancellation';
  END IF;
  IF selected_membership.status NOT IN ('active', 'grace') THEN
    RAISE EXCEPTION 'Only active weekly memberships can request cancellation';
  END IF;

  SELECT request.* INTO existing_request
  FROM public.membership_cancellation_requests AS request
  WHERE request.membership_id = selected_membership.id AND request.status = 'pending'
  ORDER BY request.requested_at DESC LIMIT 1;

  IF existing_request.id IS NOT NULL THEN
    RETURN jsonb_build_object('request_id', existing_request.id, 'status', existing_request.status,
      'requested_at', existing_request.requested_at, 'already_pending', true);
  END IF;

  INSERT INTO public.membership_cancellation_requests (membership_id, player_id, requested_by, request_note)
  VALUES (selected_membership.id, selected_membership.player_id, auth.uid(), normalized_note)
  RETURNING * INTO created_request;

  INSERT INTO public.membership_audit_log (
    membership_id, player_id, action, source, actor_user_id, after_state
  ) VALUES (
    selected_membership.id, selected_membership.player_id, 'membership_cancellation_requested',
    'portal_player', auth.uid(), jsonb_build_object('request_id', created_request.id,
      'status', created_request.status, 'requested_at', created_request.requested_at,
      'request_note', normalized_note)
  );

  RETURN jsonb_build_object('request_id', created_request.id, 'status', created_request.status,
    'requested_at', created_request.requested_at, 'already_pending', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.membership_account_snapshot(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.membership_account_snapshot(uuid, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.request_membership_cancellation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_membership_cancellation(uuid, text) TO authenticated;

DO $profile_default_fix$
DECLARE
  v_membership_id uuid := '733f6249-276b-4a84-a7d5-1683b08b0db2';
  v_player_id uuid := '09baa6a0-c466-4fd3-8981-606145810bd9';
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.players AS p
    WHERE p.id = v_player_id AND p.profile_preference = '10ft Flat'
      AND p.created_at >= '2026-08-16 19:27:00+00'::timestamptz
      AND p.created_at < '2026-08-16 19:28:00+00'::timestamptz
  ) THEN
    UPDATE public.players SET profile_preference = NULL WHERE id = v_player_id;
    INSERT INTO public.membership_audit_log (
      membership_id, player_id, action, source, before_state, after_state
    ) VALUES (
      v_membership_id, v_player_id, 'profile_preference_default_cleared',
      'moby_authorized_portal_feedback_fix',
      jsonb_build_object('profile_preference', '10ft Flat'),
      jsonb_build_object('profile_preference', NULL, 'future_schema_default', NULL)
    );
  END IF;
END
$profile_default_fix$;

COMMIT;
