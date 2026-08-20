import { createClient } from "npm:@supabase/supabase-js@2";

type Json = Record<string, unknown>;
type PaidPlan = {
  productId: number;
  variantId: number;
  weeklySellingPlanId: number;
  weeklyCents: number;
  upfrontCents: number;
};

const EXPECTED_SOURCE = "edge-performance-3.myshopify.com";
const encoder = new TextEncoder();
const PAID_PLANS = new Map<string, PaidPlan>([
  ["EDGE-1SET-WK", { productId: 9212478029987, variantId: 47941773230243, weeklySellingPlanId: 3369599139, weeklyCents: 1300, upfrontCents: 30000 }],
  ["EDGE-2SET-WK", { productId: 9212478980259, variantId: 47941775458467, weeklySellingPlanId: 3387031715, weeklyCents: 1900, upfrontCents: 44000 }],
]);

function json(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
function safeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left); const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
function requiredText(payload: Json, field: string): string {
  const value = String(payload[field] ?? "").trim();
  if (!value) throw new Error(`Missing ${field}`);
  return value;
}
function optionalText(payload: Json, field: string): string | null {
  const value = String(payload[field] ?? "").trim(); return value || null;
}
function optionalBoolean(payload: Json, field: string): boolean | null {
  const value = payload[field];
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  throw new Error(`Invalid ${field}`);
}
function normalizedTags(payload: Json): Set<string> {
  const value = payload.order_tags ?? payload.tags;
  const tags = Array.isArray(value) ? value : String(value ?? "").split(",");
  return new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean));
}
function typedGid(kind: string, value: unknown, required = true): string | null {
  const text = String(value ?? "").trim();
  if (!text) { if (required) throw new Error(`Missing ${kind} GID`); return null; }
  if (!(new RegExp(`^gid://shopify/${kind}/[0-9]+$`)).test(text)) throw new Error(`Invalid ${kind} GID`);
  return text;
}
function timestamp(payload: Json, field: string): string {
  const date = new Date(requiredText(payload, field));
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${field}`);
  return date.toISOString();
}
function optionalInteger(payload: Json, field: string): number | null {
  const value = payload[field];
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid ${field}`);
  return parsed;
}
function optionalShopifyId(payload: Json, field: string, kind: string): number | null {
  const value = String(payload[field] ?? "").trim();
  if (!value) return null;
  const prefix = `gid://shopify/${kind}/`;
  const numeric = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  if (!/^\d+$/.test(numeric)) throw new Error(`Invalid ${field}`);
  const parsed = Number(numeric);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid ${field}`);
  return parsed;
}
function optionalBigint(payload: Json, field: string): string | null {
  const value = String(payload[field] ?? "").trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${field}`);
  const normalized = value.replace(/^0+(?=\d)/, "");
  const max = "9223372036854775807";
  if (normalized.length > max.length || (normalized.length === max.length && normalized > max)) throw new Error(`${field} exceeds PostgreSQL bigint range`);
  return normalized;
}
function normalizedName(first: unknown, last: unknown): string {
  return `${String(first ?? "").trim()} ${String(last ?? "").trim()}`.trim().toLowerCase().replace(/\s+/g, " ");
}
async function sha256Hex(rawBody: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", rawBody));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sendPortalInvite(supabase: ReturnType<typeof createClient>, membership: Json | null) {
  const membershipId = String(membership?.membership_id ?? "").trim();
  const status = String(membership?.status ?? "");
  const playerId = String(membership?.player_id ?? "").trim();
  if (!membershipId || !playerId || status !== "active") return;
  const { data, error } = await supabase.functions.invoke("portal-membership-invite", { body: { membership_id: membershipId } });
  if (error || data?.error) throw new Error("Portal invitation delivery failed after membership provisioning");
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") return json(200, { status: "ok" });
  if (req.method === "HEAD") return new Response(null, { status: 200 });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const sharedSecret = Deno.env.get("EDGE_FLOW_SHARED_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!sharedSecret || !supabaseUrl || !serviceRoleKey) return json(503, { error: "flow_endpoint_not_configured" });

  const source = (req.headers.get("x-edge-flow-source") || "").trim().toLowerCase();
  const authorization = (req.headers.get("authorization") || "").trim();
  if (source !== EXPECTED_SOURCE) return json(403, { error: "source_not_allowed" });
  if (!authorization.startsWith("Bearer ")) return json(401, { error: "missing_bearer_token" });
  if (!safeEqual(authorization.slice(7).trim(), sharedSecret)) return json(401, { error: "invalid_bearer_token" });

  const rawBody = new Uint8Array(await req.arrayBuffer());
  let payload: Json;
  try { payload = JSON.parse(new TextDecoder().decode(rawBody)); }
  catch { return json(400, { error: "invalid_json" }); }

  const eventType = requiredText(payload, "event_type").toLowerCase();
  if (!["order_paid", "billing_success", "billing_failure", "contract_update"].includes(eventType)) return json(400, { error: "unsupported_event_type" });
  const externalEventId = requiredText(payload, "event_id");
  const eventId = `flow:${eventType}:${externalEventId}`;
  const contractGid = typedGid("SubscriptionContract", payload.contract_gid, eventType !== "order_paid");
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: inbox, error: inboxError } = await supabase.rpc("record_shopify_webhook_event", {
    event_webhook_id: eventId,
    event_topic: `flow/${eventType}`,
    event_shop_domain: EXPECTED_SOURCE,
    event_payload_sha256: await sha256Hex(rawBody),
    event_subscription_contract_gid: contractGid,
  });
  if (inboxError) return json(500, { error: "flow_inbox_failed" });
  if (inbox === "duplicate:processed" || inbox === "duplicate:ignored") return json(200, { status: "duplicate_acknowledged" });

  const finish = async (status: "processed" | "ignored" | "failed", message: string | null = null) => {
    await supabase.rpc("finish_shopify_webhook_event", {
      event_webhook_id: eventId, event_status: status, event_error_message: message,
      event_subscription_contract_gid: contractGid,
    });
  };

  try {
    if (eventType === "order_paid") {
      const sku = String(payload.sku ?? "").trim().toUpperCase();
      const plan = PAID_PLANS.get(sku);
      if (!plan) { await finish("ignored"); return json(200, { status: "non_membership_order_ignored" }); }

      const orderGid = typedGid("Order", payload.order_gid) as string;
      const firstOrderFlag = optionalBoolean(payload, "is_first_subscription_order");
      const tags = normalizedTags(payload);
      if (firstOrderFlag === false || tags.has("subscription recurring order")) {
        await finish("ignored"); return json(200, { status: "recurring_subscription_order_ignored" });
      }

      const { data: existing } = await supabase.from("membership_subscriptions")
        .select("id,player_id,status").eq("shopify_order_gid", orderGid).maybeSingle();
      if (existing) {
        await sendPortalInvite(supabase, { membership_id: existing.id, player_id: existing.player_id, status: existing.status });
        await finish("processed");
        return json(200, { status: "existing_membership_invitation_reconciled" });
      }

      const { data: renewalPayments, error: renewalError } = await supabase.from("membership_payments")
        .select("id").eq("shopify_order_gid", orderGid).like("shopify_event_id", "flow:billing_success:%").limit(1);
      if (renewalError) throw new Error(renewalError.message);
      if ((renewalPayments || []).length) { await finish("ignored"); return json(200, { status: "renewal_order_already_processed" }); }

      const quantity = optionalInteger(payload, "quantity") ?? 1;
      if (quantity !== 1) throw new Error("Membership quantity must equal one");
      const paidAmountCents = optionalInteger(payload, "amount_cents");
      if (paidAmountCents === null) throw new Error("Missing amount_cents for paid membership line");
      const suppliedSellingPlanId = optionalShopifyId(payload, "selling_plan_id", "SellingPlan");
      const purchaseType = paidAmountCents === plan.upfrontCents ? "season_upfront"
        : paidAmountCents === plan.weeklyCents ? "weekly_subscription" : null;
      if (!purchaseType) throw new Error("Paid amount is not an allowed weekly or upfront membership price");
      if (purchaseType === "season_upfront" && (suppliedSellingPlanId !== null || contractGid !== null))
        throw new Error("Upfront membership must not include a selling plan or subscription contract");
      if (purchaseType === "weekly_subscription" && suppliedSellingPlanId !== plan.weeklySellingPlanId)
        throw new Error("Weekly membership selling plan does not match the configured plan");

      const playerName = requiredText(payload, "player_name");
      const playerEmail = requiredText(payload, "player_email").toLowerCase();
      const playerTeam = requiredText(payload, "player_team");
      const desiredName = playerName.toLowerCase().replace(/\s+/g, " ");
      const { data: candidates, error: candidateError } = await supabase.from("players").select("id,fname,lname,email").ilike("email", playerEmail);
      if (candidateError) throw new Error(candidateError.message);
      const exactPlayers = (candidates || []).filter((player) => normalizedName(player.fname, player.lname) === desiredName && String(player.email || "").trim().toLowerCase() === playerEmail);
      if (exactPlayers.length > 1) throw new Error("Player identity is ambiguous");
      const verifiedPlayerId = exactPlayers.length === 1 ? exactPlayers[0].id : null;

      if (verifiedPlayerId) {
        const { data: currentMemberships, error: currentError } = await supabase.from("membership_subscriptions")
          .select("id").eq("player_id", verifiedPlayerId).in("status", ["pending_activation", "active", "grace"]).limit(1);
        if (currentError) throw new Error(currentError.message);
        if ((currentMemberships || []).length) { await finish("ignored"); return json(200, { status: "current_membership_order_ignored" }); }
      }

      const { data: membership, error } = await supabase.rpc("process_shopify_paid_membership", {
        event_id: eventId,
        order_gid: orderGid,
        customer_gid: typedGid("Customer", payload.customer_gid, false),
        subscription_contract_gid: contractGid,
        product_id: plan.productId,
        variant_id: plan.variantId,
        selling_plan_id: suppliedSellingPlanId,
        order_buyer_email: optionalText(payload, "buyer_email"),
        checkout_player_name: playerName,
        checkout_player_email: playerEmail,
        checkout_player_team: playerTeam,
        paid_at: timestamp(payload, "occurred_at"),
        paid_amount_cents: paidAmountCents,
        purchase_type: purchaseType,
        verified_player_id: verifiedPlayerId,
      });
      if (error) throw new Error(error.message);
      await sendPortalInvite(supabase, membership as Json);
    } else if (eventType === "contract_update") {
      const productId = optionalShopifyId(payload, "product_id", "Product");
      const variantId = optionalShopifyId(payload, "variant_id", "ProductVariant");
      const sellingPlanId = optionalShopifyId(payload, "selling_plan_id", "SellingPlan");
      const supplied = [productId, variantId, sellingPlanId].filter((value) => value !== null).length;
      if (supplied !== 0 && supplied !== 3) throw new Error("Plan identifiers must be omitted or supplied together");
      const { error } = await supabase.rpc("process_shopify_contract_update", {
        event_id: eventId,
        contract_gid: contractGid,
        origin_order_gid: typedGid("Order", payload.origin_order_gid, false),
        revision_id: optionalBigint(payload, "revision_id"),
        contract_status: requiredText(payload, "contract_status"),
        occurred_at: timestamp(payload, "occurred_at"),
        product_id: productId, variant_id: variantId, selling_plan_id: sellingPlanId,
      });
      if (error) throw new Error(error.message);
    } else {
      const successful = eventType === "billing_success";
      let amountCents = optionalInteger(payload, "amount_cents");
      if (successful && amountCents === null) {
        const { data: memberships, error: membershipError } = await supabase.from("membership_subscriptions")
          .select("plan_code,purchase_type").eq("shopify_subscription_contract_gid", contractGid).limit(1);
        if (membershipError) throw new Error(membershipError.message);
        if (memberships?.[0]?.purchase_type !== "weekly_subscription") throw new Error("Renewal target is not a weekly membership");
        const { data: plans, error: planError } = await supabase.from("membership_plans").select("price_cents")
          .eq("code", memberships[0].plan_code).eq("is_active", true).limit(1);
        if (planError) throw new Error(planError.message);
        amountCents = Number(plans?.[0]?.price_cents);
        if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error("Membership renewal amount was not found");
      }
      const { error } = await supabase.rpc("process_shopify_billing_attempt", {
        event_id: eventId,
        contract_gid: contractGid,
        renewal_order_gid: successful ? typedGid("Order", payload.renewal_order_gid, false) : null,
        attempt_outcome: successful ? "success" : "failure",
        occurred_at: timestamp(payload, "occurred_at"),
        amount_cents: amountCents,
        error_code: successful ? null : optionalText(payload, "error_code"),
        error_message: successful ? null : optionalText(payload, "error_message"),
      });
      if (error) throw new Error(error.message);
    }

    await finish("processed");
    return json(200, { status: "processed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Flow processing error";
    await finish("failed", message);
    return json(422, { error: "flow_processing_failed" });
  }
});
