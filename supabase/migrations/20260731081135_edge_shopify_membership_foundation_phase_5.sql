CREATE TABLE public.membership_plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  weekly_set_allowance smallint NOT NULL,
  shopify_product_id bigint NOT NULL UNIQUE,
  shopify_variant_id bigint NOT NULL UNIQUE,
  shopify_selling_plan_id bigint NOT NULL,
  sku text NOT NULL UNIQUE,
  price_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_plans_code_check CHECK (code IN ('one_set', 'two_set')),
  CONSTRAINT membership_plans_allowance_check CHECK (weekly_set_allowance IN (1, 2)),
  CONSTRAINT membership_plans_price_check CHECK (price_cents > 0)
);

INSERT INTO public.membership_plans (
  code, name, weekly_set_allowance, shopify_product_id,
  shopify_variant_id, shopify_selling_plan_id, sku, price_cents
)
VALUES
  ('one_set', 'EDGE 1-Set Membership', 1, 9212478029987, 47941773230243, 3369599139, 'EDGE-1SET-WK', 1300),
  ('two_set', 'EDGE 2-Set Membership', 2, 9212478980259, 47941775458467, 3369599139, 'EDGE-2SET-WK', 1900);

CREATE TABLE public.membership_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid REFERENCES public.players(id) ON DELETE RESTRICT,
  plan_code text NOT NULL REFERENCES public.membership_plans(code) ON DELETE RESTRICT,
  source_path text NOT NULL DEFAULT 'shopify',
  match_status text NOT NULL DEFAULT 'pending',
  status text NOT NULL DEFAULT 'pending_match',
  buyer_email text,
  player_email text,
  player_first_name text,
  player_last_name text,
  player_team text,
  shopify_customer_gid text,
  shopify_order_gid text,
  shopify_subscription_contract_gid text UNIQUE,
  shopify_product_id bigint NOT NULL,
  shopify_variant_id bigint NOT NULL,
  shopify_selling_plan_id bigint NOT NULL,
  successful_charge_count smallint NOT NULL DEFAULT 0,
  billing_stop_required boolean NOT NULL DEFAULT false,
  billing_stop_reason text,
  billing_stopped_at timestamptz,
  started_at timestamptz,
  grace_ends_at timestamptz,
  cancelled_at timestamptz,
  entitlement_ends_at timestamptz,
  season_start date NOT NULL DEFAULT DATE '2026-08-14',
  season_end date NOT NULL DEFAULT DATE '2027-02-28',
  last_event_at timestamptz,
  matched_at timestamptz,
  matched_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_subscriptions_source_path_check CHECK (source_path IN ('portal', 'shopify')),
  CONSTRAINT membership_subscriptions_match_status_check CHECK (match_status IN ('pending', 'matched', 'created', 'ambiguous', 'review_required')),
  CONSTRAINT membership_subscriptions_status_check CHECK (status IN ('pending_match', 'pending_activation', 'active', 'grace', 'cancelled', 'expired', 'review_required')),
  CONSTRAINT membership_subscriptions_charge_count_check CHECK (successful_charge_count BETWEEN 0 AND 26),
  CONSTRAINT membership_subscriptions_identifiers_match_plan CHECK (
    (plan_code = 'one_set'
      AND shopify_product_id = 9212478029987
      AND shopify_variant_id = 47941773230243
      AND shopify_selling_plan_id = 3369599139)
    OR
    (plan_code = 'two_set'
      AND shopify_product_id = 9212478980259
      AND shopify_variant_id = 47941775458467
      AND shopify_selling_plan_id = 3369599139)
  )
);

CREATE UNIQUE INDEX membership_subscriptions_one_current_per_player_idx
ON public.membership_subscriptions(player_id)
WHERE player_id IS NOT NULL
  AND status IN ('pending_activation', 'active', 'grace');

CREATE INDEX membership_subscriptions_player_idx
ON public.membership_subscriptions(player_id, status);

CREATE INDEX membership_subscriptions_customer_idx
ON public.membership_subscriptions(shopify_customer_gid);

CREATE INDEX membership_subscriptions_order_idx
ON public.membership_subscriptions(shopify_order_gid);

CREATE INDEX membership_subscriptions_match_idx
ON public.membership_subscriptions(match_status, status)
WHERE match_status <> 'matched' OR status IN ('pending_match', 'review_required');

CREATE TABLE public.membership_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES public.membership_subscriptions(id) ON DELETE CASCADE,
  shopify_event_id text NOT NULL UNIQUE,
  shopify_order_gid text,
  shopify_transaction_gid text,
  billing_cycle_index integer,
  outcome text NOT NULL,
  amount_cents integer,
  refunded_amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_payments_outcome_check CHECK (outcome IN ('succeeded', 'failed', 'recovered')),
  CONSTRAINT membership_payments_amount_check CHECK (amount_cents IS NULL OR amount_cents >= 0),
  CONSTRAINT membership_payments_refund_check CHECK (refunded_amount_cents >= 0)
);

CREATE UNIQUE INDEX membership_payments_successful_cycle_idx
ON public.membership_payments(membership_id, billing_cycle_index)
WHERE billing_cycle_index IS NOT NULL
  AND outcome IN ('succeeded', 'recovered');

CREATE INDEX membership_payments_membership_idx
ON public.membership_payments(membership_id, occurred_at DESC);

CREATE TABLE public.membership_refund_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES public.membership_subscriptions(id) ON DELETE CASCADE,
  shopify_event_id text NOT NULL UNIQUE,
  refund_kind text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  resolution text,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_refund_kind_check CHECK (refund_kind IN ('full', 'partial')),
  CONSTRAINT membership_refund_status_check CHECK (status IN ('pending', 'approved_end', 'no_entitlement_change', 'rejected')),
  CONSTRAINT membership_refund_amount_check CHECK (amount_cents >= 0)
);

CREATE INDEX membership_refund_reviews_pending_idx
ON public.membership_refund_reviews(status, created_at)
WHERE status = 'pending';

CREATE TABLE public.membership_service_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES public.membership_subscriptions(id) ON DELETE RESTRICT,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  service_week_start date NOT NULL,
  steel_set smallint NOT NULL,
  status text NOT NULL DEFAULT 'received',
  received_at timestamptz NOT NULL,
  in_service_at timestamptz,
  returned_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_service_usage_set_check CHECK (steel_set IN (1, 2)),
  CONSTRAINT membership_service_usage_status_check CHECK (status IN ('received', 'in_service', 'returned')),
  UNIQUE (player_id, service_week_start, steel_set)
);

CREATE INDEX membership_service_usage_membership_idx
ON public.membership_service_usage(membership_id, service_week_start DESC);

CREATE INDEX membership_service_usage_player_idx
ON public.membership_service_usage(player_id, service_week_start DESC);

CREATE TABLE public.membership_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  membership_id uuid REFERENCES public.membership_subscriptions(id) ON DELETE SET NULL,
  player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  action text NOT NULL,
  source text NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  external_event_id text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX membership_audit_log_membership_idx
ON public.membership_audit_log(membership_id, created_at DESC);

CREATE INDEX membership_audit_log_player_idx
ON public.membership_audit_log(player_id, created_at DESC);

CREATE TABLE private.shopify_webhook_events (
  webhook_id text PRIMARY KEY,
  topic text NOT NULL,
  shop_domain text NOT NULL,
  payload_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  attempt_count integer NOT NULL DEFAULT 1,
  subscription_contract_gid text,
  error_message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT shopify_webhook_events_status_check CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  CONSTRAINT shopify_webhook_events_attempt_check CHECK (attempt_count >= 1)
);

REVOKE ALL ON private.shopify_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON private.shopify_webhook_events TO service_role;

CREATE OR REPLACE FUNCTION private.set_membership_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.set_membership_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER membership_plans_set_updated_at
BEFORE UPDATE ON public.membership_plans
FOR EACH ROW EXECUTE FUNCTION private.set_membership_updated_at();

CREATE TRIGGER membership_subscriptions_set_updated_at
BEFORE UPDATE ON public.membership_subscriptions
FOR EACH ROW EXECUTE FUNCTION private.set_membership_updated_at();

CREATE TRIGGER membership_service_usage_set_updated_at
BEFORE UPDATE ON public.membership_service_usage
FOR EACH ROW EXECUTE FUNCTION private.set_membership_updated_at();

CREATE OR REPLACE FUNCTION private.membership_week_start(at_time timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT date_trunc(
    'week',
    (at_time AT TIME ZONE 'America/Chicago') - interval '6 hours'
  )::date;
$$;

REVOKE ALL ON FUNCTION private.membership_week_start(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.membership_week_start(timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.recalculate_membership_charge_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_membership uuid := coalesce(NEW.membership_id, OLD.membership_id);
  successful_cycles integer;
BEGIN
  SELECT count(*)::integer
  INTO successful_cycles
  FROM public.membership_payments AS mp
  WHERE mp.membership_id = target_membership
    AND mp.outcome IN ('succeeded', 'recovered');

  UPDATE public.membership_subscriptions AS ms
  SET successful_charge_count = least(successful_cycles, 26),
      billing_stop_required = successful_cycles >= 26,
      billing_stop_reason = CASE
        WHEN successful_cycles >= 26 THEN 'charge_cap'
        ELSE NULL
      END
  WHERE ms.id = target_membership;

  RETURN coalesce(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION private.recalculate_membership_charge_count() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER membership_payments_recalculate_charge_count
AFTER INSERT OR UPDATE OR DELETE ON public.membership_payments
FOR EACH ROW EXECUTE FUNCTION private.recalculate_membership_charge_count();

ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_refund_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_service_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_audit_log ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.membership_plans TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.membership_subscriptions TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.membership_payments TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.membership_refund_reviews TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.membership_service_usage TO authenticated, service_role;
GRANT SELECT, INSERT ON public.membership_audit_log TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.membership_audit_log_id_seq TO authenticated, service_role;

CREATE POLICY membership_plans_read_authenticated
ON public.membership_plans
FOR SELECT TO authenticated
USING (true);

CREATE POLICY membership_subscriptions_read_authorized
ON public.membership_subscriptions
FOR SELECT TO authenticated
USING (
  player_id IS NOT NULL
  AND private.can_access_player(player_id)
);

CREATE POLICY membership_subscriptions_insert_staff
ON public.membership_subscriptions
FOR INSERT TO authenticated
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY membership_subscriptions_update_staff
ON public.membership_subscriptions
FOR UPDATE TO authenticated
USING (private.is_staff((SELECT auth.uid())))
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY membership_subscriptions_delete_staff
ON public.membership_subscriptions
FOR DELETE TO authenticated
USING (private.is_staff((SELECT auth.uid())));

CREATE POLICY membership_payments_read_staff
ON public.membership_payments
FOR SELECT TO authenticated
USING (private.is_staff((SELECT auth.uid())));

CREATE POLICY membership_payments_write_staff
ON public.membership_payments
FOR ALL TO authenticated
USING (private.is_staff((SELECT auth.uid())))
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY membership_refunds_read_staff
ON public.membership_refund_reviews
FOR SELECT TO authenticated
USING (private.is_staff((SELECT auth.uid())));

CREATE POLICY membership_refunds_write_staff
ON public.membership_refund_reviews
FOR ALL TO authenticated
USING (private.is_staff((SELECT auth.uid())))
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY membership_usage_read_authorized
ON public.membership_service_usage
FOR SELECT TO authenticated
USING (private.can_access_player(player_id));

CREATE POLICY membership_usage_write_staff
ON public.membership_service_usage
FOR ALL TO authenticated
USING (private.is_staff((SELECT auth.uid())))
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE POLICY membership_audit_read_staff
ON public.membership_audit_log
FOR SELECT TO authenticated
USING (private.is_staff((SELECT auth.uid())));

CREATE POLICY membership_audit_insert_staff
ON public.membership_audit_log
FOR INSERT TO authenticated
WITH CHECK (private.is_staff((SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.membership_entitlement_snapshot(
  check_player uuid,
  at_time timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  selected_membership public.membership_subscriptions%ROWTYPE;
  selected_plan public.membership_plans%ROWTYPE;
  week_start date := private.membership_week_start(at_time);
  used_sets integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT private.can_access_player(check_player) THEN
    RAISE EXCEPTION 'Player access denied';
  END IF;

  SELECT ms.*
  INTO selected_membership
  FROM public.membership_subscriptions AS ms
  WHERE ms.player_id = check_player
    AND ms.status IN ('active', 'grace')
    AND coalesce(ms.started_at, ms.created_at) <= at_time
    AND (ms.entitlement_ends_at IS NULL OR at_time < ms.entitlement_ends_at)
    AND (ms.status <> 'grace' OR ms.grace_ends_at IS NULL OR at_time <= ms.grace_ends_at)
  ORDER BY coalesce(ms.started_at, ms.created_at) DESC
  LIMIT 1;

  IF selected_membership.id IS NULL THEN
    RETURN jsonb_build_object(
      'player_id', check_player,
      'status', 'inactive',
      'plan_code', NULL,
      'weekly_set_allowance', 0,
      'service_week_start', week_start,
      'used_sets', 0,
      'remaining_sets', 0
    );
  END IF;

  SELECT mp.* INTO selected_plan
  FROM public.membership_plans AS mp
  WHERE mp.code = selected_membership.plan_code;

  SELECT count(*)::integer
  INTO used_sets
  FROM public.membership_service_usage AS msu
  WHERE msu.player_id = check_player
    AND msu.service_week_start = week_start;

  RETURN jsonb_build_object(
    'player_id', check_player,
    'membership_id', selected_membership.id,
    'status', selected_membership.status,
    'plan_code', selected_plan.code,
    'plan_name', selected_plan.name,
    'weekly_set_allowance', selected_plan.weekly_set_allowance,
    'service_week_start', week_start,
    'used_sets', used_sets,
    'remaining_sets', greatest(selected_plan.weekly_set_allowance - used_sets, 0),
    'successful_charge_count', selected_membership.successful_charge_count,
    'grace_ends_at', selected_membership.grace_ends_at,
    'entitlement_ends_at', selected_membership.entitlement_ends_at,
    'billing_stop_required', selected_membership.billing_stop_required
  );
END;
$$;

REVOKE ALL ON FUNCTION public.membership_entitlement_snapshot(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.membership_entitlement_snapshot(uuid, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.receive_membership_set(
  check_player uuid,
  set_number smallint,
  received_time timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  selected_membership public.membership_subscriptions%ROWTYPE;
  selected_plan public.membership_plans%ROWTYPE;
  week_start date := private.membership_week_start(received_time);
  usage_id uuid;
BEGIN
  IF NOT private.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Staff access required';
  END IF;

  IF set_number NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Set number must be 1 or 2';
  END IF;

  SELECT ms.*
  INTO selected_membership
  FROM public.membership_subscriptions AS ms
  WHERE ms.player_id = check_player
    AND ms.status IN ('active', 'grace')
    AND coalesce(ms.started_at, ms.created_at) <= received_time
    AND (ms.entitlement_ends_at IS NULL OR received_time < ms.entitlement_ends_at)
    AND (ms.status <> 'grace' OR ms.grace_ends_at IS NULL OR received_time <= ms.grace_ends_at)
  ORDER BY coalesce(ms.started_at, ms.created_at) DESC
  LIMIT 1;

  IF selected_membership.id IS NULL THEN
    RAISE EXCEPTION 'No active paid membership for this player';
  END IF;

  SELECT mp.* INTO selected_plan
  FROM public.membership_plans AS mp
  WHERE mp.code = selected_membership.plan_code;

  IF set_number > selected_plan.weekly_set_allowance THEN
    RAISE EXCEPTION 'This membership does not include set %', set_number;
  END IF;

  INSERT INTO public.membership_service_usage (
    membership_id,
    player_id,
    service_week_start,
    steel_set,
    status,
    received_at,
    created_by,
    updated_by
  )
  VALUES (
    selected_membership.id,
    check_player,
    week_start,
    set_number,
    'received',
    received_time,
    auth.uid(),
    auth.uid()
  )
  RETURNING id INTO usage_id;

  INSERT INTO public.membership_audit_log (
    membership_id,
    player_id,
    action,
    source,
    actor_user_id,
    after_state
  )
  VALUES (
    selected_membership.id,
    check_player,
    'set_received',
    'portal_admin',
    auth.uid(),
    jsonb_build_object(
      'usage_id', usage_id,
      'service_week_start', week_start,
      'steel_set', set_number,
      'status', 'received'
    )
  );

  RETURN usage_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Set % has already been received for this player in the current service week', set_number;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_membership_set(uuid, smallint, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_membership_set(uuid, smallint, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_membership_service_state(
  usage_record uuid,
  new_status text,
  changed_time timestamptz DEFAULT now()
)
RETURNS public.membership_service_usage
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_usage public.membership_service_usage%ROWTYPE;
  updated_usage public.membership_service_usage%ROWTYPE;
BEGIN
  IF NOT private.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Staff access required';
  END IF;

  SELECT * INTO current_usage
  FROM public.membership_service_usage
  WHERE id = usage_record
  FOR UPDATE;

  IF current_usage.id IS NULL THEN
    RAISE EXCEPTION 'Membership service record not found';
  END IF;

  IF NOT (
    (current_usage.status = 'received' AND new_status = 'in_service')
    OR (current_usage.status = 'in_service' AND new_status = 'returned')
  ) THEN
    RAISE EXCEPTION 'Invalid service transition from % to %', current_usage.status, new_status;
  END IF;

  UPDATE public.membership_service_usage
  SET status = new_status,
      in_service_at = CASE WHEN new_status = 'in_service' THEN changed_time ELSE in_service_at END,
      returned_at = CASE WHEN new_status = 'returned' THEN changed_time ELSE returned_at END,
      updated_by = auth.uid()
  WHERE id = usage_record
  RETURNING * INTO updated_usage;

  INSERT INTO public.membership_audit_log (
    membership_id,
    player_id,
    action,
    source,
    actor_user_id,
    before_state,
    after_state
  )
  VALUES (
    updated_usage.membership_id,
    updated_usage.player_id,
    'service_state_changed',
    'portal_admin',
    auth.uid(),
    jsonb_build_object('status', current_usage.status),
    jsonb_build_object('status', updated_usage.status, 'usage_id', updated_usage.id)
  );

  RETURN updated_usage;
END;
$$;

REVOKE ALL ON FUNCTION public.update_membership_service_state(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_membership_service_state(uuid, text, timestamptz) TO authenticated, service_role;
