ALTER TABLE public.membership_subscriptions
  ADD COLUMN shopify_revision_id bigint,
  ADD COLUMN last_billing_attempt_at timestamptz,
  ADD COLUMN last_billing_failure_code text,
  ADD COLUMN last_billing_failure_message text;

CREATE OR REPLACE FUNCTION public.process_shopify_contract_update(
  event_id text,
  contract_gid text,
  origin_order_gid text,
  revision_id bigint,
  contract_status text,
  occurred_at timestamptz,
  product_id bigint DEFAULT NULL,
  variant_id bigint DEFAULT NULL,
  selling_plan_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  selected_membership public.membership_subscriptions%ROWTYPE;
  selected_plan public.membership_plans%ROWTYPE;
  normalized_status text := upper(trim(coalesce(contract_status, '')));
  next_status text;
  stale_event boolean := false;
BEGIN
  IF NULLIF(trim(event_id), '') IS NULL
     OR NULLIF(trim(contract_gid), '') IS NULL
     OR normalized_status = ''
     OR occurred_at IS NULL THEN
    RAISE EXCEPTION 'Contract update metadata is incomplete';
  END IF;

  SELECT ms.* INTO selected_membership
  FROM public.membership_subscriptions AS ms
  WHERE ms.shopify_subscription_contract_gid = trim(contract_gid)
     OR (
       NULLIF(trim(coalesce(origin_order_gid, '')), '') IS NOT NULL
       AND ms.shopify_order_gid = trim(origin_order_gid)
     )
  ORDER BY CASE WHEN ms.shopify_subscription_contract_gid = trim(contract_gid) THEN 0 ELSE 1 END,
           ms.created_at
  LIMIT 1
  FOR UPDATE;

  IF selected_membership.id IS NULL THEN
    RAISE EXCEPTION 'Membership subscription was not found for this Shopify contract';
  END IF;

  IF revision_id IS NOT NULL
     AND selected_membership.shopify_revision_id IS NOT NULL
     AND revision_id <= selected_membership.shopify_revision_id THEN
    stale_event := true;
  END IF;

  IF stale_event THEN
    RETURN jsonb_build_object(
      'membership_id', selected_membership.id,
      'status', selected_membership.status,
      'result', 'stale_ignored'
    );
  END IF;

  IF product_id IS NOT NULL OR variant_id IS NOT NULL OR selling_plan_id IS NOT NULL THEN
    IF product_id IS NULL OR variant_id IS NULL OR selling_plan_id IS NULL THEN
      RAISE EXCEPTION 'Plan update identifiers must be supplied together';
    END IF;

    SELECT mp.* INTO selected_plan
    FROM public.membership_plans AS mp
    WHERE mp.shopify_product_id = product_id
      AND mp.shopify_variant_id = variant_id
      AND mp.shopify_selling_plan_id = selling_plan_id
      AND mp.is_active = true;

    IF selected_plan.code IS NULL THEN
      RAISE EXCEPTION 'Unknown or mismatched Shopify membership identifiers';
    END IF;
  END IF;

  next_status := CASE normalized_status
    WHEN 'ACTIVE' THEN CASE
      WHEN selected_membership.player_id IS NULL
        OR selected_membership.match_status IN ('ambiguous', 'review_required')
      THEN 'review_required'
      ELSE 'active'
    END
    WHEN 'PAUSED' THEN 'grace'
    WHEN 'FAILED' THEN 'grace'
    WHEN 'CANCELLED' THEN 'cancelled'
    WHEN 'EXPIRED' THEN 'expired'
    ELSE 'review_required'
  END;

  UPDATE public.membership_subscriptions AS ms
  SET shopify_subscription_contract_gid = trim(contract_gid),
      shopify_revision_id = coalesce(revision_id, ms.shopify_revision_id),
      plan_code = coalesce(selected_plan.code, ms.plan_code),
      shopify_product_id = coalesce(product_id, ms.shopify_product_id),
      shopify_variant_id = coalesce(variant_id, ms.shopify_variant_id),
      shopify_selling_plan_id = coalesce(selling_plan_id, ms.shopify_selling_plan_id),
      status = next_status,
      grace_ends_at = CASE
        WHEN next_status = 'grace' THEN greatest(coalesce(ms.grace_ends_at, occurred_at), occurred_at + interval '7 days')
        WHEN next_status = 'active' THEN NULL
        ELSE ms.grace_ends_at
      END,
      cancelled_at = CASE WHEN next_status = 'cancelled' THEN occurred_at ELSE ms.cancelled_at END,
      entitlement_ends_at = CASE
        WHEN next_status IN ('cancelled', 'expired') THEN occurred_at
        WHEN next_status = 'active' THEN NULL
        ELSE ms.entitlement_ends_at
      END,
      last_event_at = greatest(coalesce(ms.last_event_at, occurred_at), occurred_at)
  WHERE ms.id = selected_membership.id;

  INSERT INTO public.membership_audit_log (
    membership_id, player_id, action, source, external_event_id, before_state, after_state
  )
  VALUES (
    selected_membership.id,
    selected_membership.player_id,
    'shopify_contract_updated',
    'shopify_webhook',
    trim(event_id),
    jsonb_build_object(
      'status', selected_membership.status,
      'plan_code', selected_membership.plan_code,
      'revision_id', selected_membership.shopify_revision_id
    ),
    jsonb_build_object(
      'status', next_status,
      'shopify_status', normalized_status,
      'plan_code', coalesce(selected_plan.code, selected_membership.plan_code),
      'revision_id', coalesce(revision_id, selected_membership.shopify_revision_id)
    )
  );

  RETURN jsonb_build_object(
    'membership_id', selected_membership.id,
    'status', next_status,
    'plan_code', coalesce(selected_plan.code, selected_membership.plan_code),
    'result', 'processed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_shopify_contract_update(
  text, text, text, bigint, text, timestamptz, bigint, bigint, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_shopify_contract_update(
  text, text, text, bigint, text, timestamptz, bigint, bigint, bigint
) TO service_role;

CREATE OR REPLACE FUNCTION public.process_shopify_billing_attempt(
  event_id text,
  contract_gid text,
  renewal_order_gid text,
  attempt_outcome text,
  occurred_at timestamptz,
  amount_cents integer DEFAULT NULL,
  error_code text DEFAULT NULL,
  error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  selected_membership public.membership_subscriptions%ROWTYPE;
  normalized_outcome text := lower(trim(coalesce(attempt_outcome, '')));
  payment_outcome text;
  next_status text;
  inserted_payment uuid;
  event_is_current boolean;
BEGIN
  IF NULLIF(trim(event_id), '') IS NULL
     OR NULLIF(trim(contract_gid), '') IS NULL
     OR normalized_outcome NOT IN ('success', 'failure')
     OR occurred_at IS NULL THEN
    RAISE EXCEPTION 'Billing attempt metadata is invalid';
  END IF;

  SELECT ms.* INTO selected_membership
  FROM public.membership_subscriptions AS ms
  WHERE ms.shopify_subscription_contract_gid = trim(contract_gid)
  LIMIT 1
  FOR UPDATE;

  IF selected_membership.id IS NULL THEN
    RAISE EXCEPTION 'Membership subscription was not found for this Shopify contract';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.membership_payments AS mp
    WHERE mp.shopify_event_id = trim(event_id)
  ) THEN
    RETURN jsonb_build_object(
      'membership_id', selected_membership.id,
      'status', selected_membership.status,
      'result', 'duplicate_ignored'
    );
  END IF;

  payment_outcome := CASE
    WHEN normalized_outcome = 'failure' THEN 'failed'
    WHEN selected_membership.status = 'grace' THEN 'recovered'
    ELSE 'succeeded'
  END;

  INSERT INTO public.membership_payments (
    membership_id,
    shopify_event_id,
    shopify_order_gid,
    outcome,
    amount_cents,
    occurred_at
  )
  VALUES (
    selected_membership.id,
    trim(event_id),
    NULLIF(trim(coalesce(renewal_order_gid, '')), ''),
    payment_outcome,
    amount_cents,
    occurred_at
  )
  RETURNING id INTO inserted_payment;

  event_is_current := selected_membership.last_event_at IS NULL
    OR occurred_at >= selected_membership.last_event_at;

  IF normalized_outcome = 'failure' THEN
    next_status := CASE
      WHEN selected_membership.status IN ('cancelled', 'expired', 'review_required')
        THEN selected_membership.status
      ELSE 'grace'
    END;
  ELSE
    next_status := CASE
      WHEN selected_membership.status IN ('cancelled', 'expired', 'review_required')
        THEN selected_membership.status
      WHEN selected_membership.player_id IS NULL THEN 'review_required'
      ELSE 'active'
    END;
  END IF;

  UPDATE public.membership_subscriptions AS ms
  SET status = CASE WHEN event_is_current THEN next_status ELSE ms.status END,
      grace_ends_at = CASE
        WHEN NOT event_is_current THEN ms.grace_ends_at
        WHEN normalized_outcome = 'failure' AND next_status = 'grace' THEN occurred_at + interval '7 days'
        WHEN normalized_outcome = 'success' AND next_status = 'active' THEN NULL
        ELSE ms.grace_ends_at
      END,
      entitlement_ends_at = CASE
        WHEN event_is_current AND normalized_outcome = 'success' AND next_status = 'active' THEN NULL
        ELSE ms.entitlement_ends_at
      END,
      last_billing_attempt_at = greatest(coalesce(ms.last_billing_attempt_at, occurred_at), occurred_at),
      last_billing_failure_code = CASE
        WHEN event_is_current AND normalized_outcome = 'failure' THEN NULLIF(trim(coalesce(error_code, '')), '')
        WHEN event_is_current AND normalized_outcome = 'success' THEN NULL
        ELSE ms.last_billing_failure_code
      END,
      last_billing_failure_message = CASE
        WHEN event_is_current AND normalized_outcome = 'failure' THEN left(NULLIF(trim(coalesce(error_message, '')), ''), 1000)
        WHEN event_is_current AND normalized_outcome = 'success' THEN NULL
        ELSE ms.last_billing_failure_message
      END,
      last_event_at = greatest(coalesce(ms.last_event_at, occurred_at), occurred_at)
  WHERE ms.id = selected_membership.id;

  INSERT INTO public.membership_audit_log (
    membership_id, player_id, action, source, external_event_id, before_state, after_state
  )
  VALUES (
    selected_membership.id,
    selected_membership.player_id,
    CASE WHEN normalized_outcome = 'failure'
      THEN 'shopify_billing_failed'
      ELSE 'shopify_billing_succeeded'
    END,
    'shopify_webhook',
    trim(event_id),
    jsonb_build_object('status', selected_membership.status),
    jsonb_build_object(
      'status', CASE WHEN event_is_current THEN next_status ELSE selected_membership.status END,
      'payment_id', inserted_payment,
      'payment_outcome', payment_outcome,
      'renewal_order_gid', NULLIF(trim(coalesce(renewal_order_gid, '')), ''),
      'event_is_current', event_is_current
    )
  );

  RETURN jsonb_build_object(
    'membership_id', selected_membership.id,
    'status', CASE WHEN event_is_current THEN next_status ELSE selected_membership.status END,
    'payment_outcome', payment_outcome,
    'result', CASE WHEN event_is_current THEN 'processed' ELSE 'stale_payment_recorded' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_shopify_billing_attempt(
  text, text, text, text, timestamptz, integer, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_shopify_billing_attempt(
  text, text, text, text, timestamptz, integer, text, text
) TO service_role;
