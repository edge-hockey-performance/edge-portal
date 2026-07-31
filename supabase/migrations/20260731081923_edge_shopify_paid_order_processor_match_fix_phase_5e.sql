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
  verified_player_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  selected_plan public.membership_plans%ROWTYPE;
  selected_player uuid;
  candidate_count integer := 0;
  match_result text;
  subscription_status text;
  existing_membership uuid;
  conflicting_membership uuid;
  result_membership uuid;
  normalized_name text := lower(trim(coalesce(checkout_player_name, ''));
  normalized_email text := lower(trim(coalesce(checkout_player_email, ''));
  normalized_team text := trim(coalesce(checkout_player_team, ''));
  first_name text;
  last_name text;
BEGIN
  IF NULLIF(trim(event_id), '') IS NULL
     OR NULLIF(trim(order_gid), '') IS NULL THEN
    RAISE EXCEPTION 'Shopify event and order IDs are required';
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

  IF normalized_name = '' OR normalized_team = '' THEN
    RAISE EXCEPTION 'Player name and team are required';
  END IF;

  IF normalized_team NOT IN (
    'Chicago Reapers',
    'Chicago Mission',
    'St. Viator',
    'Glenbrook North'
  ) THEN
    RAISE EXCEPTION 'Invalid player team';
  END IF;

  IF verified_player_id IS NOT NULL THEN
    SELECT p.id INTO selected_player
    FROM public.players AS p
    WHERE p.id = verified_player_id;

    IF selected_player IS NULL THEN
      RAISE EXCEPTION 'Verified player does not exist';
    END IF;

    match_result := 'matched';
  ELSE
    SELECT count(*)::integer
    INTO candidate_count
    FROM public.players AS p
    WHERE lower(trim(concat_ws(' ', p.fname, p.lname))) = normalized_name
      AND lower(trim(coalesce(p.email, ''))) = normalized_email
      AND trim(coalesce(p.team, '')) = normalized_team;

    IF candidate_count = 1 THEN
      SELECT p.id INTO selected_player
      FROM public.players AS p
      WHERE lower(trim(concat_ws(' ', p.fname, p.lname))) = normalized_name
        AND lower(trim(coalesce(p.email, ''))) = normalized_email
        AND trim(coalesce(p.team, '')) = normalized_team
      ORDER BY p.created_at, p.id
      LIMIT 1;
      match_result := 'matched';
    ELSIF candidate_count > 1 THEN
      selected_player := NULL;
      match_result := 'ambiguous';
    ELSE
      first_name := split_part(trim(checkout_player_name), ' ', 1);
      last_name := trim(substr(trim(checkout_player_name), length(first_name) + 1));

      INSERT INTO public.players (fname, lname, email, team)
      VALUES (
        first_name,
        coalesce(last_name, ''),
        NULLIF(trim(coalesce(checkout_player_email, '')), ''),
        normalized_team
      )
      RETURNING id INTO selected_player;

      match_result := 'created';
    END IF;
  END IF;

  subscription_status := CASE
    WHEN match_result = 'ambiguous' THEN 'review_required'
    ELSE 'active'
  END;

  SELECT ms.id INTO existing_membership
  FROM public.membership_subscriptions AS ms
  WHERE (
      NULLIF(trim(coalesce(subscription_contract_gid, '')), '') IS NOT NULL
      AND ms.shopify_subscription_contract_gid = trim(subscription_contract_gid)
    )
    OR ms.shopify_order_gid = trim(order_gid)
  ORDER BY ms.created_at
  LIMIT 1
  FOR UPDATE;

  IF existing_membership IS NOT NULL THEN
    UPDATE public.membership_subscriptions AS ms
    SET player_id = coalesce(ms.player_id, selected_player),
        plan_code = selected_plan.code,
        match_status = CASE WHEN ms.match_status = 'matched' THEN ms.match_status ELSE match_result END,
        status = CASE WHEN ms.status IN ('cancelled', 'expired') THEN ms.status ELSE subscription_status END,
        buyer_email = coalesce(NULLIF(trim(order_buyer_email), ''), ms.buyer_email),
        player_email = coalesce(NULLIF(trim(checkout_player_email), ''), ms.player_email),
        player_first_name = split_part(trim(checkout_player_name), ' ', 1),
        player_last_name = trim(substr(trim(checkout_player_name), length(split_part(trim(checkout_player_name), ' ', 1)) + 1)),
        player_team = normalized_team,
        shopify_customer_gid = coalesce(NULLIF(trim(customer_gid), ''), ms.shopify_customer_gid),
        shopify_subscription_contract_gid = coalesce(NULLIF(trim(subscription_contract_gid), ''), ms.shopify_subscription_contract_gid),
        last_event_at = greatest(coalesce(ms.last_event_at, paid_at), paid_at),
        started_at = coalesce(ms.started_at, paid_at),
        matched_at = CASE WHEN selected_player IS NOT NULL THEN coalesce(ms.matched_at, now()) ELSE ms.matched_at END
    WHERE ms.id = existing_membership
    RETURNING ms.id INTO result_membership;
  ELSE
    IF selected_player IS NOT NULL THEN
      SELECT ms.id INTO conflicting_membership
      FROM public.membership_subscriptions AS ms
      WHERE ms.player_id = selected_player
        AND ms.status IN ('pending_activation', 'active', 'grace')
      LIMIT 1;
    END IF;

    IF conflicting_membership IS NOT NULL THEN
      subscription_status := 'review_required';
      match_result := 'review_required';
      selected_player := NULL;
    END IF;

    INSERT INTO public.membership_subscriptions (
      player_id, plan_code, source_path, match_status, status,
      buyer_email, player_email, player_first_name, player_last_name, player_team,
      shopify_customer_gid, shopify_order_gid, shopify_subscription_contract_gid,
      shopify_product_id, shopify_variant_id, shopify_selling_plan_id,
      started_at, last_event_at, matched_at
    )
    VALUES (
      selected_player,
      selected_plan.code,
      'shopify',
      match_result,
      subscription_status,
      NULLIF(trim(coalesce(order_buyer_email, '')), ''),
      NULLIF(trim(coalesce(checkout_player_email, '')), ''),
      split_part(trim(checkout_player_name), ' ', 1),
      trim(substr(trim(checkout_player_name), length(split_part(trim(checkout_player_name), ' ', 1)) + 1)),
      normalized_team,
      NULLIF(trim(coalesce(customer_gid, '')), ''),
      trim(order_gid),
      NULLIF(trim(coalesce(subscription_contract_gid, '')), ''),
      product_id,
      variant_id,
      selling_plan_id,
      paid_at,
      paid_at,
      CASE WHEN selected_player IS NOT NULL THEN now() ELSE NULL END
    )
    RETURNING id INTO result_membership;
  END IF;

  INSERT INTO public.membership_payments (
    membership_id, shopify_event_id, shopify_order_gid,
    outcome, amount_cents, occurred_at
  )
  VALUES (
    result_membership,
    trim(event_id),
    trim(order_gid),
    'succeeded',
    paid_amount_cents,
    paid_at
  )
  ON CONFLICT (shopify_event_id) DO NOTHING;

  INSERT INTO public.membership_audit_log (
    membership_id, player_id, action, source, external_event_id, after_state
  )
  VALUES (
    result_membership,
    selected_player,
    'shopify_paid_membership_processed',
    'shopify_webhook',
    trim(event_id),
    jsonb_build_object(
      'order_gid', trim(order_gid),
      'contract_gid', NULLIF(trim(coalesce(subscription_contract_gid, '')), ''),
      'plan_code', selected_plan.code,
      'match_status', match_result,
      'status', subscription_status
    )
  );

  RETURN jsonb_build_object(
    'membership_id', result_membership,
    'player_id', selected_player,
    'plan_code', selected_plan.code,
    'match_status', match_result,
    'status', subscription_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_shopify_paid_membership(
  text, text, text, text, bigint, bigint, bigint, text, text, text, text,
  timestamptz, integer, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_shopify_paid_membership(
  text, text, text, text, bigint, bigint, bigint, text, text, text, text,
  timestamptz, integer, uuid
) TO service_role;
