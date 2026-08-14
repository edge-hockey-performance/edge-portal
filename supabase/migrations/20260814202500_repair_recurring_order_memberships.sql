-- Repair duplicate memberships created when recurring subscription orders reached
-- both Shopify billing_success and order_paid event paths.
-- Scope is intentionally locked to the two verified false memberships/orders.

DO $$
DECLARE
  false_membership_ids uuid[] := ARRAY[
    '13082106-8e54-4d1d-88c1-e12d58321a2e'::uuid,
    'cbf888d2-0152-407c-abe3-72452359d61a'::uuid
  ];
  false_order_gids text[] := ARRAY[
    'gid://shopify/Order/7020267536547',
    'gid://shopify/Order/7034992296099'
  ];
  real_membership_id uuid := '75f10b03-ee67-46f4-a6bb-a6d42c80842c'::uuid;
  affected integer;
BEGIN
  IF (
    SELECT count(*)
    FROM public.membership_subscriptions AS ms
    WHERE ms.id = ANY(false_membership_ids)
      AND ms.player_id IS NULL
      AND ms.status = 'review_required'
      AND ms.match_status = 'review_required'
      AND ms.shopify_subscription_contract_gid IS NULL
      AND ms.shopify_order_gid = ANY(false_order_gids)
  ) <> 2 THEN
    RAISE EXCEPTION 'Duplicate membership cleanup precondition failed';
  END IF;

  IF (
    SELECT count(*)
    FROM public.membership_service_usage AS msu
    WHERE msu.membership_id = ANY(false_membership_ids)
  ) <> 0 OR (
    SELECT count(*)
    FROM public.membership_refund_reviews AS mrr
    WHERE mrr.membership_id = ANY(false_membership_ids)
  ) <> 0 THEN
    RAISE EXCEPTION 'Duplicate memberships have unexpected operational children';
  END IF;

  IF (
    SELECT count(*)
    FROM public.membership_payments AS mp
    WHERE mp.membership_id = ANY(false_membership_ids)
      AND mp.outcome = 'succeeded'
      AND mp.amount_cents = 1300
      AND mp.shopify_order_gid = ANY(false_order_gids)
      AND mp.shopify_event_id LIKE 'flow:order_paid:%'
  ) <> 2 THEN
    RAISE EXCEPTION 'Duplicate payment cleanup precondition failed';
  END IF;

  IF (
    SELECT count(*)
    FROM public.membership_audit_log AS mal
    WHERE mal.membership_id = ANY(false_membership_ids)
      AND mal.action = 'shopify_paid_membership_processed'
      AND mal.external_event_id LIKE 'flow:order_paid:%'
  ) <> 2 THEN
    RAISE EXCEPTION 'Duplicate audit cleanup precondition failed';
  END IF;

  UPDATE public.membership_payments AS mp
  SET amount_cents = mplan.price_cents
  FROM public.membership_subscriptions AS ms
  JOIN public.membership_plans AS mplan ON mplan.code = ms.plan_code
  WHERE mp.membership_id = real_membership_id
    AND ms.id = real_membership_id
    AND mp.shopify_event_id IN (
      'flow:billing_success:gid://shopify/SubscriptionBillingAttempt/144945578147',
      'flow:billing_success:gid://shopify/SubscriptionBillingAttempt/145886773411'
    )
    AND mp.amount_cents IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN
    RAISE EXCEPTION 'Renewal amount backfill expected 2 rows, updated %', affected;
  END IF;

  UPDATE public.membership_audit_log AS mal
  SET membership_id = NULL,
      action = 'shopify_recurring_order_ignored_after_repair',
      source = 'system_remediation',
      after_state = coalesce(mal.after_state, '{}'::jsonb) || jsonb_build_object(
        'remediation', 'Removed false membership and duplicate payment created by recurring order_paid routing',
        'authoritative_membership_id', real_membership_id
      )
  WHERE mal.membership_id = ANY(false_membership_ids)
    AND mal.action = 'shopify_paid_membership_processed';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN
    RAISE EXCEPTION 'Duplicate audit reclassification expected 2 rows, updated %', affected;
  END IF;

  DELETE FROM public.membership_payments AS mp
  WHERE mp.membership_id = ANY(false_membership_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN
    RAISE EXCEPTION 'Duplicate payment deletion expected 2 rows, deleted %', affected;
  END IF;

  DELETE FROM public.membership_subscriptions AS ms
  WHERE ms.id = ANY(false_membership_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN
    RAISE EXCEPTION 'Duplicate membership deletion expected 2 rows, deleted %', affected;
  END IF;

  UPDATE private.shopify_webhook_events AS swe
  SET status = 'ignored',
      error_message = NULL,
      processed_at = coalesce(swe.processed_at, now())
  WHERE swe.webhook_id IN (
    'flow:order_paid:gid://shopify/Order/7020267536547',
    'flow:order_paid:gid://shopify/Order/7034992296099'
  )
    AND swe.topic = 'flow/order_paid';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN
    RAISE EXCEPTION 'Webhook inbox reclassification expected 2 rows, updated %', affected;
  END IF;
END;
$$;
