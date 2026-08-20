BEGIN;

ALTER TABLE public.membership_subscriptions
  DROP CONSTRAINT IF EXISTS membership_subscriptions_identifiers_match_plan;

UPDATE public.membership_plans
SET shopify_selling_plan_id = 3387031715,
    updated_at = now()
WHERE code = 'two_set'
  AND shopify_product_id = 9212478980259
  AND shopify_variant_id = 47941775458467;

UPDATE public.membership_subscriptions
SET shopify_selling_plan_id = 3387031715
WHERE plan_code = 'two_set'
  AND shopify_product_id = 9212478980259
  AND shopify_variant_id = 47941775458467
  AND shopify_selling_plan_id = 3369599139;

ALTER TABLE public.membership_subscriptions
  ADD CONSTRAINT membership_subscriptions_identifiers_match_plan CHECK (
    (plan_code = 'one_set'
      AND shopify_product_id = 9212478029987
      AND shopify_variant_id = 47941773230243
      AND shopify_selling_plan_id = 3369599139)
    OR
    (plan_code = 'two_set'
      AND shopify_product_id = 9212478980259
      AND shopify_variant_id = 47941775458467
      AND shopify_selling_plan_id = 3387031715)
  );

CREATE TABLE IF NOT EXISTS public.membership_portal_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL UNIQUE REFERENCES public.membership_subscriptions(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  brevo_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS membership_portal_invitations_status_idx
  ON public.membership_portal_invitations(status, updated_at);

ALTER TABLE public.membership_portal_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.membership_portal_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.membership_portal_invitations TO service_role;

COMMIT;
