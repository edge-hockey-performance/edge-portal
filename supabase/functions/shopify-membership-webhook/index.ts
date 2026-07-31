import { createClient } from "npm:@supabase/supabase-js@2";

const EXPECTED_SHOP = "edge-performance-3.myshopify.com";
const encoder = new TextEncoder();
const PLANS = new Map<number, { productId: number; variantId: number; sellingPlanId: number }>([
  [47941773230243, { productId: 9212478029987, variantId: 47941773230243, sellingPlanId: 3369599139 }],
  [47941775458467, { productId: 9212478980259, variantId: 47941775458467, sellingPlanId: 3369599139 }],
]);
const SUPPORTED = new Set([
  "orders/paid",
  "subscription_contracts/update",
  "subscription_billing_attempts/success",
  "subscription_billing_attempts/failure",
  "subscription_billing_attempts/challenged",
]);

type Json = Record<string, unknown>;
function response(status: number, body: Json) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
function record(value: unknown): Json { return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {}; }
function numericId(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.split("/").pop() || value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}
function gid(kind: string, value: unknown): string | null {
  const prefix = `gid://shopify/${kind}/`;
  if (typeof value === "string" && value.startsWith("gid://")) {
    return value.startsWith(prefix) && numericId(value) ? value : null;
  }
  const id = numericId(value);
  return id ? `${prefix}${id}` : null;
}
function iso(value: unknown): string {
  const date = new Date(String(value || new Date().toISOString()));
  if (Number.isNaN(date.getTime())) throw new Error("Invalid Shopify timestamp");
  return date.toISOString();
}
function cents(value: unknown, quantity = 1): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100 * quantity) : null;
}
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function safeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left); const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
async function validHmac(body: Uint8Array, secret: string, received: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return safeEqual(toBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, body))), received.trim());
}
async function digest(body: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", body)))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function properties(line: Json): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of Array.isArray(line.properties) ? line.properties : []) {
    const entry = record(item); const name = String(entry.name || "").trim();
    if (name) result[name] = String(entry.value || "").trim();
  }
  return result;
}
function sellingPlan(line: Json): number | null {
  const allocation = record(line.selling_plan_allocation);
  return numericId(allocation.selling_plan_id) || numericId(record(allocation.selling_plan).id) || numericId(line.selling_plan_id);
}
function contractGid(payload: Json): string | null {
  const contract = record(payload.subscription_contract);
  return gid("SubscriptionContract",
    payload.subscription_contract_gid ?? payload.subscription_contract_id ?? contract.admin_graphql_api_id ?? contract.id ?? payload.admin_graphql_api_id);
}
function firstContractLine(payload: Json): Json {
  const candidates = [payload.lines, payload.subscription_lines, record(payload.subscription_contract).lines];
  for (const candidate of candidates) if (Array.isArray(candidate) && candidate.length === 1) return record(candidate[0]);
  return {};
}
function planTriple(line: Json): { productId: number | null; variantId: number | null; sellingPlanId: number | null } {
  const merchandise = record(line.merchandise);
  const variantId = numericId(line.variant_id ?? merchandise.admin_graphql_api_id ?? merchandise.id);
  const configured = variantId ? PLANS.get(variantId) : undefined;
  return {
    productId: numericId(line.product_id ?? record(merchandise.product).admin_graphql_api_id ?? record(merchandise.product).id) ?? configured?.productId ?? null,
    variantId,
    sellingPlanId: sellingPlan(line) ?? configured?.sellingPlanId ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response(405, { error: "method_not_allowed" });
  const secret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !url || !key) return response(503, { error: "webhook_not_configured" });

  const webhookId = (req.headers.get("x-shopify-webhook-id") || "").trim();
  const topic = (req.headers.get("x-shopify-topic") || "").trim().toLowerCase();
  const shop = (req.headers.get("x-shopify-shop-domain") || "").trim().toLowerCase();
  const hmac = (req.headers.get("x-shopify-hmac-sha256") || "").trim();
  if (!webhookId || !topic || !shop || !hmac) return response(400, { error: "missing_shopify_headers" });
  if (shop !== EXPECTED_SHOP) return response(403, { error: "shop_not_allowed" });

  const raw = new Uint8Array(await req.arrayBuffer());
  if (!(await validHmac(raw, secret, hmac))) return response(401, { error: "invalid_hmac" });
  let payload: Json;
  try { payload = JSON.parse(new TextDecoder().decode(raw)); }
  catch { return response(400, { error: "invalid_json" }); }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const contract = contractGid(payload);
  const { data: inbox, error: inboxError } = await supabase.rpc("record_shopify_webhook_event", {
    event_webhook_id: webhookId,
    event_topic: topic,
    event_shop_domain: shop,
    event_payload_sha256: await digest(raw),
    event_subscription_contract_gid: contract,
  });
  if (inboxError) return response(500, { error: "webhook_inbox_failed" });
  if (inbox === "duplicate:processed" || inbox === "duplicate:ignored") return response(200, { status: "duplicate_acknowledged" });

  const finish = async (status: "processed" | "ignored" | "failed", message: string | null = null) => {
    await supabase.rpc("finish_shopify_webhook_event", {
      event_webhook_id: webhookId, event_status: status, event_error_message: message,
      event_subscription_contract_gid: contract,
    });
  };
  if (!SUPPORTED.has(topic)) {
    await finish("ignored");
    return response(200, { status: "topic_ignored" });
  }

  try {
    if (topic === "orders/paid") {
      const lines = (Array.isArray(payload.line_items) ? payload.line_items : []).map(record);
      const membershipLines = lines.filter((line) => {
        const variant = numericId(line.variant_id);
        return variant !== null && PLANS.has(variant);
      });
      if (!membershipLines.length) {
        await finish("ignored");
        return response(200, { status: "no_membership_lines" });
      }
      if (membershipLines.length !== 1) throw new Error("Order must contain exactly one membership line");

      const line = membershipLines[0]; const triple = planTriple(line);
      const configured = triple.variantId ? PLANS.get(triple.variantId) : undefined;
      const quantity = Number(line.quantity ?? 1);
      if (!configured || triple.productId !== configured.productId || triple.sellingPlanId !== configured.sellingPlanId)
        throw new Error("Membership identifiers do not match the configured plan");
      if (quantity !== 1) throw new Error("Membership line quantity must equal one");

      const orderGid = gid("Order", payload.admin_graphql_api_id ?? payload.id);
      if (!orderGid) throw new Error("Shopify order identity is invalid");
      const customer = record(payload.customer); const props = properties(line);
      const { error } = await supabase.rpc("process_shopify_paid_membership", {
        event_id: webhookId,
        order_gid: orderGid,
        customer_gid: gid("Customer", customer.admin_graphql_api_id ?? customer.id),
        subscription_contract_gid: contract,
        product_id: triple.productId,
        variant_id: triple.variantId,
        selling_plan_id: triple.sellingPlanId,
        order_buyer_email: String(payload.email ?? customer.email ?? "").trim(),
        checkout_player_name: props["Player name"] || "",
        checkout_player_email: props["Player email"] || "",
        checkout_player_team: props.Team || "",
        paid_at: iso(payload.processed_at ?? payload.updated_at ?? payload.created_at),
        paid_amount_cents: cents(line.price, quantity),
        verified_player_id: props["_EDGE player ID"] || props["EDGE player ID"] || null,
      });
      if (error) throw new Error(error.message);
    } else if (topic === "subscription_contracts/update") {
      if (!contract) throw new Error("Subscription contract identity is missing");
      const line = firstContractLine(payload); const triple = Object.keys(line).length ? planTriple(line) : { productId: null, variantId: null, sellingPlanId: null };
      const completeTriple = triple.productId !== null && triple.variantId !== null && triple.sellingPlanId !== null;
      const { error } = await supabase.rpc("process_shopify_contract_update", {
        event_id: webhookId,
        contract_gid: contract,
        origin_order_gid: gid("Order", payload.admin_graphql_api_origin_order_id ?? payload.origin_order_id),
        revision_id: numericId(payload.revision_id),
        contract_status: String(payload.status || ""),
        occurred_at: iso(payload.updated_at ?? payload.created_at),
        product_id: completeTriple ? triple.productId : null,
        variant_id: completeTriple ? triple.variantId : null,
        selling_plan_id: completeTriple ? triple.sellingPlanId : null,
      });
      if (error) throw new Error(error.message);
    } else {
      if (!contract) throw new Error("Subscription contract identity is missing");
      const successful = topic === "subscription_billing_attempts/success";
      const attempt = record(payload.subscription_billing_attempt);
      const eventKey = String(payload.idempotency_key ?? attempt.idempotency_key ?? webhookId).trim();
      const orderGid = gid("Order", payload.admin_graphql_api_order_id ?? payload.order_id ?? attempt.admin_graphql_api_order_id ?? attempt.order_id);
      const money = record(payload.amount ?? attempt.amount);
      const amount = cents(money.amount ?? payload.amount ?? attempt.amount);
      const { error } = await supabase.rpc("process_shopify_billing_attempt", {
        event_id: eventKey,
        contract_gid: contract,
        renewal_order_gid: orderGid,
        attempt_outcome: successful ? "success" : "failure",
        occurred_at: iso(payload.updated_at ?? payload.created_at ?? attempt.updated_at ?? attempt.created_at),
        amount_cents: amount,
        error_code: successful ? null : String(payload.error_code ?? attempt.error_code ?? (topic.endsWith("challenged") ? "PAYMENT_CHALLENGED" : "UNKNOWN")),
        error_message: successful ? null : String(payload.error_message ?? attempt.error_message ?? "Shopify billing attempt did not succeed"),
      });
      if (error) throw new Error(error.message);
    }

    await finish("processed");
    return response(200, { status: "processed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook processing error";
    await finish("failed", message);
    return response(500, { error: "membership_processing_failed" });
  }
});
