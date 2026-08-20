BEGIN;

ALTER TABLE public.membership_subscriptions
  ADD COLUMN IF NOT EXISTS purchase_type text NOT NULL DEFAULT 'weekly_subscription';

ALTER TABLE public.membership_subscriptions
  DROP CONSTRAINT IF EXISTS membership_subscriptions_purchase_type_check;
ALTER TABLE public.membership_subscriptions
  ADD CONSTRAINT membership_subscriptions_purchase_type_check
  CHECK (purchase_type IN ('weekly_subscription', 'season_upfront'));

UPDATE public.membership_subscriptions AS ms
SET purchase_type = CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.membership_payments AS payment
    WHERE payment.membership_id = ms.id
      AND payment.outcome IN ('succeeded', 'recovered')
      AND payment.amount_cents IN (30000, 44000)
  ) THEN 'season_upfront'
  ELSE 'weekly_subscription'
END;

ALTER TABLE public.membership_subscriptions
  ALTER COLUMN shopify_selling_plan_id DROP NOT NULL;

UPDATE public.membership_subscriptions
SET shopify_selling_plan_id = NULL,
    shopify_subscription_contract_gid = NULL
WHERE purchase_type = 'season_upfront';

ALTER TABLE public.membership_subscriptions
  DROP CONSTRAINT IF EXISTS membership_subscriptions_identifiers_match_plan;
ALTER TABLE public.membership_subscriptions
  ADD CONSTRAINT membership_subscriptions_identifiers_match_plan CHECK (
    (plan_code = 'one_set'
      AND shopify_product_id = 9212478029987
      AND shopify_variant_id = 47941773230243
      AND (
        (purchase_type = 'weekly_subscription' AND shopify_selling_plan_id = 3369599139)
        OR
        (purchase_type = 'season_upfront' AND shopify_selling_plan_id IS NULL AND shopify_subscription_contract_gid IS NULL)
      ))
    OR
    (plan_code = 'two_set'
      AND shopify_product_id = 9212478980259
      AND shopify_variant_id = 47941775458467
      AND (
        (purchase_type = 'weekly_subscription' AND shopify_selling_plan_id = 3387031715)
        OR
        (purchase_type = 'season_upfront' AND shopify_selling_plan_id IS NULL AND shopify_subscription_contract_gid IS NULL)
      ))
  );

CREATE OR REPLACE FUNCTION public.process_shopify_paid_membership(
  event_id text,
  order_gid text,
  customer_gid text,
  subscription_contract_gid text,
  product_id bigint,
  variant_id bigint,
  selling_plan_id bigint,
  order_buyer_email text,
  checkout_player_name text,
  checkout_player_email text,
  checkout_player_team text,
  paid_at timestamptz,
  paid_amount_cents integer,
  purchase_type text,
  verified_player_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  selected_plan public.membership_plans%ROWTYPE;
  normalized_purchase_type text := lower(trim(coalesce(purchase_type, '')));
  expected_upfront_cents integer;
  effective_contract_gid text;
  result jsonb;
  result_membership_id uuid;
BEGIN
  SELECT plan.* INTO selected_plan
  FROM public.membership_plans AS plan
  WHERE plan.shopify_product_id = product_id
    AND plan.shopify_variant_id = variant_id
    AND plan.is_active = true;

  IF selected_plan.code IS NULL THEN
    RAISE EXCEPTION 'Unknown or mismatched Shopify membership product and variant';
  END IF;

  expected_upfront_cents := CASE selected_plan.code
    WHEN 'one_set' THEN 30000
    WHEN 'two_set' THEN 44000
    ELSE NULL
  END;

  IF normalized_purchase_type = 'weekly_subscription' THEN
    IF paid_amount_cents <> selected_plan.price_cents THEN
      RAISE EXCEPTION 'Weekly membership amount does not match the configured plan';
    END IF;
    IF selling_plan_id IS DISTINCT FROM selected_plan.shopify_selling_plan_id THEN
      RAISE EXCEPTION 'Weekly membership selling plan does not match the configured plan';
    END IF;
    effective_contract_gid := NULLIF(trim(coalesce(subscription_contract_gid, '')), '');
  ELSIF normalized_purchase_type = 'season_upfront' THEN
    IF paid_amount_cents <> expected_upfront_cents THEN
      RAISE EXCEPTION 'Upfront membership amount does not match the configured season price';
    END IF;
    IF selling_plan_id IS NOT NULL THEN
      RAISE EXCEPTION 'Upfront membership must not include a selling plan';
    END IF;
    IF NULLIF(trim(coalesce(subscription_contract_gid, '')), '') IS NOT NULL THEN
      RAISE EXCEPTION 'Upfront membership must not include a subscription contract';
    END IF;
    effective_contract_gid := NULL;
  ELSE
    RAISE EXCEPTION 'Purchase type must be weekly_subscription or season_upfront';
  END IF;

  result := public.process_shopify_paid_membership(
    event_id => event_id,
    order_gid => order_gid,
    customer_gid => customer_gid,
    subscription_contract_gid => effective_contract_gid,
    product_id => product_id,
    variant_id => variant_id,
    selling_plan_id => selected_plan.shopify_selling_plan_id,
    order_buyer_email => order_buyer_email,
    checkout_player_name => checkout_player_name,
    checkout_player_email => checkout_player_email,
    checkout_player_team => checkout_player_team,
    paid_at => paid_at,
    paid_amount_cents => paid_amount_cents,
    verified_player_id => verified_player_id
  );

  result_membership_id := (result->>'membership_id')::uuid;
  UPDATE public.membership_subscriptions AS membership
  SET purchase_type = normalized_purchase_type,
      shopify_selling_plan_id = CASE
        WHEN normalized_purchase_type = 'weekly_subscription' THEN selected_plan.shopify_selling_plan_id
        ELSE NULL
      END,
      shopify_subscription_contract_gid = CASE
        WHEN normalized_purchase_type = 'weekly_subscription' THEN effective_contract_gid
        ELSE NULL
      END,
      entitlement_ends_at = CASE
        WHEN normalized_purchase_type = 'season_upfront'
          THEN (membership.season_end::timestamp + interval '1 day' - interval '1 second') AT TIME ZONE 'America/Chicago'
        ELSE membership.entitlement_ends_at
      END,
      updated_at = now()
  WHERE membership.id = result_membership_id;

  INSERT INTO public.membership_audit_log (
    membership_id, player_id, action, source, external_event_id, after_state
  )
  SELECT membership.id, membership.player_id, 'membership_purchase_type_classified',
    'shopify_webhook', trim(event_id),
    jsonb_build_object(
      'purchase_type', normalized_purchase_type,
      'paid_amount_cents', paid_amount_cents,
      'selling_plan_id', CASE WHEN normalized_purchase_type = 'weekly_subscription' THEN selected_plan.shopify_selling_plan_id ELSE NULL END,
      'has_subscription_contract', effective_contract_gid IS NOT NULL
    )
  FROM public.membership_subscriptions AS membership
  WHERE membership.id = result_membership_id;

  RETURN result || jsonb_build_object(
    'purchase_type', normalized_purchase_type,
    'paid_amount_cents', paid_amount_cents
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_shopify_paid_membership(
  text, text, text, text, bigint, bigint, bigint, text, text, text, text,
  timestamptz, integer, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_shopify_paid_membership(
  text, text, text, text, bigint, bigint, bigint, text, text, text, text,
  timestamptz, integer, text, uuid
) TO service_role;

COMMIT;
