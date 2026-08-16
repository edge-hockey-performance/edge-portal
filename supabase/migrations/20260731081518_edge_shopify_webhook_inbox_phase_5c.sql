CREATE OR REPLACE FUNCTION public.record_shopify_webhook_event(
  event_webhook_id text,
  event_topic text,
  event_shop_domain text,
  event_payload_sha256 text,
  event_subscription_contract_gid text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing_status text;
BEGIN
  IF NULLIF(trim(event_webhook_id), '') IS NULL
     OR NULLIF(trim(event_topic), '') IS NULL
     OR NULLIF(trim(event_shop_domain), '') IS NULL
     OR NULLIF(trim(event_payload_sha256), '') IS NULL THEN
    RAISE EXCEPTION 'Webhook metadata is incomplete';
  END IF;

  SELECT swe.status
  INTO existing_status
  FROM private.shopify_webhook_events AS swe
  WHERE swe.webhook_id = event_webhook_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE private.shopify_webhook_events AS swe
    SET attempt_count = swe.attempt_count + 1
    WHERE swe.webhook_id = event_webhook_id;
    RETURN 'duplicate:' || existing_status;
  END IF;

  INSERT INTO private.shopify_webhook_events (
    webhook_id,
    topic,
    shop_domain,
    payload_sha256,
    subscription_contract_gid,
    status
  )
  VALUES (
    trim(event_webhook_id),
    trim(event_topic),
    lower(trim(event_shop_domain)),
    lower(trim(event_payload_sha256)),
    NULLIF(trim(coalesce(event_subscription_contract_gid, '')), ''),
    'received'
  );

  RETURN 'accepted';
END;
$$;

REVOKE ALL ON FUNCTION public.record_shopify_webhook_event(text, text, text, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_shopify_webhook_event(text, text, text, text, text)
TO service_role;

CREATE OR REPLACE FUNCTION public.finish_shopify_webhook_event(
  event_webhook_id text,
  event_status text,
  event_error_message text DEFAULT NULL,
  event_subscription_contract_gid text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF event_status NOT IN ('processed', 'ignored', 'failed') THEN
    RAISE EXCEPTION 'Invalid webhook completion status';
  END IF;

  UPDATE private.shopify_webhook_events AS swe
  SET status = event_status,
      error_message = CASE
        WHEN event_status = 'failed' THEN left(event_error_message, 1000)
        ELSE NULL
      END,
      subscription_contract_gid = coalesce(
        NULLIF(trim(coalesce(event_subscription_contract_gid, '')), ''),
        swe.subscription_contract_gid
      ),
      processed_at = CASE
        WHEN event_status IN ('processed', 'ignored') THEN now()
        ELSE swe.processed_at
      END
  WHERE swe.webhook_id = event_webhook_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Webhook event not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_shopify_webhook_event(text, text, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_shopify_webhook_event(text, text, text, text)
TO service_role;
