-- Restrict the private Shopify webhook inbox to trusted server-side access.
-- No anon/authenticated RLS policies are intentionally created.
-- The service-role Edge Function calls postgres-owned SECURITY DEFINER wrappers.

ALTER TABLE private.shopify_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.shopify_webhook_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE private.shopify_webhook_events TO service_role;

REVOKE ALL ON FUNCTION public.record_shopify_webhook_event(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_shopify_webhook_event(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_shopify_webhook_event(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_shopify_webhook_event(text, text, text, text) TO service_role;
