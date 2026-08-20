# Brevo launch runbook

## Approved customer journey

1. Send one marketing campaign to the deduplicated union of ActiveCampaign contacts tagged `Reapers` or `Reapers Intro` and current Supabase `team_leads` for `chicago-reapers`.
2. Every campaign email shows both verified Shopify choices:
   - 1-Set: https://edgehockeyperformance.com/products/edge-1-set-membership
   - 2-Set: https://edgehockeyperformance.com/products/edge-2-set-membership
3. A paid Shopify membership is processed in Supabase.
4. Only a paid, matched membership with a player row and buyer email can provision portal access.
5. Supabase links the buyer to the paid player, generates a recipient-specific recovery/setup link, and asks Brevo to deliver it.
6. Supabase stores the Brevo message ID and skips duplicate sends.

## Required secrets

- `BREVO_API_KEY` in Supabase Edge Function secrets.
- Existing ActiveCampaign secrets exposed through `get_secret('ac_api_url')` and `get_secret('ac_api_key')`.
- Existing `EDGE_FLOW_SHARED_SECRET` for Shopify Flow.

Never commit or paste secret values.

## Marketing campaign copy

Subject: Chicago Reapers: choose your EDGE membership

Preview: Compare the 1-Set and 2-Set options, then complete your membership securely through Shopify.

Body:

Hi {{ contact.FNAME | default: "Reapers Parent" }},

You asked for more information about EDGE Performance’s weekly blade-management program for Chicago Reapers players.

Both membership options use the same documented EDGE process. The difference is the number of matching steel sets included in each weekly service cycle.

**EDGE 1-Set Membership**  
For players managing one matching pair of removable runners.  
$13 billed weekly or $300 paid upfront for the season.  
[View the 1-Set option](https://edgehockeyperformance.com/products/edge-1-set-membership)

**EDGE 2-Set Membership**  
For players who want up to two matching pairs included in each weekly service cycle.  
$19 billed weekly or $440 paid upfront for the season.  
[View the 2-Set option](https://edgehockeyperformance.com/products/edge-2-set-membership)

After payment is confirmed, we’ll email a secure invitation to set up the EDGE Portal. The portal keeps the player’s blade preferences, service details, and history connected to the membership.

If you are unsure which option fits the player’s current steel setup, reply to this email and Jordan will help.

Jordan  
EDGE Performance

## Pre-send gates

- Sync completes without failed contacts.
- Campaign uses the `Chicago Reapers` Brevo list.
- Send a campaign test to `jordan@edgehockeyperformance.com`.
- Verify both buttons, mobile layout, sender, reply-to, unsubscribe footer, and personalization fallback.
- Do not schedule or send to the audience until Jordan approves the test.

## Transactional test gates

- Apply the migration in a non-production branch or controlled production window.
- Deploy `portal-membership-invite` with service-role-only invocation.
- Update the paid-order processor to call it only after `process_shopify_paid_membership` returns a paid matched membership.
- Correct both paid-order code paths to selling plan `3387031715` for 2-Set.
- Test weekly and upfront purchases for 1-Set and 2-Set.
- Confirm one auth user, one player link, one membership, one payment, one invitation log, and one Brevo message ID per initial order.
- Confirm recurring charges and duplicate Shopify events do not send another invitation.
