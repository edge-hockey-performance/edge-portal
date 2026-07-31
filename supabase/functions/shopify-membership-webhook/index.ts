import { createClient } from "npm:@supabase/supabase-js@2";

const EXPECTED_SHOP = "edge-performance-3.myshopify.com";
const SUPPORTED_TOPIC = "orders/paid";
const encoder = new TextEncoder();

const PLAN_BY_VARIANT = new Map<number, { productId: number; variantId: number; sellingPlanId: number }>([
  [47941773230243, { productId: 9212478029987, variantId: 47941773230243, sellingPlanId: 3369599139 }],
  [47941775458467, { productId: 9212478980259, variantId: 47941775458467, sellingPlanId: 3369599139 }],
]);

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function timingSafeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

async function verifyShopifyHmac(rawBody: Uint8Array, secret: string, received: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  return timingSafeEqual(toBase64(signature), received.trim());
}

async function sha256Hex(rawBody: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", rawBody));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function numericId(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string") {
    const tail = value.split("/").pop() || value;
    const parsed = Number(tail);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function gid(kind: string, value: unknown): string | null {
  if (typeof value === "string" && value.startsWith("gid://")) return value;
  const id = numericId(value);
  return id ? `gid://shopify/${kind}/${id}` : null;
}

function lineProperties(line: Record<string, unknown>): Record<string, string> {
  const properties = Array.isArray(line.properties) ? line.properties : [];
  const result: Record<string, string> = {};
  for (const property of properties) {
    if (!property || typeof property !== "object") continue;
    const name = String((property as Record<string, unknown>).name ?? "").trim();
    const value = String((property as Record<string, unknown>).value ?? "").trim();
    if (name) result[name] = value;
  }
  return result;
}

function sellingPlanId(line: Record<string, unknown>): number | null {
  const allocation = line.selling_plan_allocation;
  if (allocation && typeof allocation === "object") {
    const record = allocation as Record<string, unknown>;
    const direct = numericId(record.selling_plan_id);
    if (direct) return direct;
    if (record.selling_plan && typeof record.selling_plan === "object") {
      return numericId((record.selling_plan as Record<string, unknown>).id);
    }
  }
  return numericId(line.selling_plan_id);
}

function contractGid(payload: Record<string, unknown>, line: Record<string, unknown>): string | null {
  const candidates = [
    line.subscription_contract_gid,
    line.subscription_contract_id,
    payload.subscription_contract_gid,
    payload.subscription_contract_id,
  ];
  for (const candidate of candidates) {
    const value = gid("SubscriptionContract", candidate);
    if (value) return value;
  }
  return null;
}

function cents(value: unknown, quantity = 1): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100 * quantity);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const secret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !supabaseUrl || !serviceRoleKey) {
    return json(503, { error: "webhook_not_configured" });
  }

  const webhookId = (req.headers.get("x-shopify-webhook-id") || "").trim();
  const topic = (req.headers.get("x-shopify-topic") || "").trim().toLowerCase();
  const shop = (req.headers.get("x-shopify-shop-domain") || "").trim().toLowerCase();
  const receivedHmac = (req.headers.get("x-shopify-hmac-sha256") || "").trim();
  if (!webhookId || !topic || !shop || !receivedHmac) {
    return json(400, { error: "missing_shopify_headers" });
  }
  if (shop !== EXPECTED_SHOP) return json(403, { error: "shop_not_allowed" });

  const rawBody = new Uint8Array(await req.arrayBuffer());
  if (!(await verifyShopifyHmac(rawBody, secret, receivedHmac))) {
    return json(401, { error: "invalid_hmac" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const payloadHash = await sha256Hex(rawBody);
  const rootContractGid = contractGid(payload, {});

  const { data: inboxResult, error: inboxError } = await supabase.rpc("record_shopify_webhook_event", {
    event_webhook_id: webhookId,
    event_topic: topic,
    event_shop_domain: shop,
    event_payload_sha256: payloadHash,
    event_subscription_contract_gid: rootContractGid,
  });
  if (inboxError) return json(500, { error: "webhook_inbox_failed" });
  if (inboxResult === "duplicate:processed" || inboxResult === "duplicate:ignored") {
    return json(200, { status: "duplicate_acknowledged" });
  }

  if (topic !== SUPPORTED_TOPIC) {
    await supabase.rpc("finish_shopify_webhook_event", {
      event_webhook_id: webhookId,
      event_status: "ignored",
      event_error_message: null,
      event_subscription_contract_gid: rootContractGid,
    });
    return json(200, { status: "topic_ignored" });
  }

  try {
    const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
    const membershipLines = lineItems.filter((item) => {
      if (!item || typeof item !== "object") return false;
      const variantId = numericId((item as Record<string, unknown>).variant_id);
      return variantId !== null && PLAN_BY_VARIANT.has(variantId);
    }) as Record<string, unknown>[];

    if (!membershipLines.length) {
      await supabase.rpc("finish_shopify_webhook_event", {
        event_webhook_id: webhookId,
        event_status: "ignored",
        event_error_message: null,
        event_subscription_contract_gid: rootContractGid,
      });
      return json(200, { status: "no_membership_lines" });
    }

    const orderGid = gid("Order", payload.admin_graphql_api_id ?? payload.id);
    const customerRecord = payload.customer && typeof payload.customer === "object"
      ? payload.customer as Record<string, unknown>
      : {};
    const customerGid = gid("Customer", customerRecord.admin_graphql_api_id ?? customerRecord.id);
    const buyerEmail = String(payload.email ?? customerRecord.email ?? "").trim();
    const paidAtRaw = String(payload.processed_at ?? payload.updated_at ?? payload.created_at ?? new Date().toISOString());
    const paidAt = new Date(paidAtRaw);
    if (!orderGid || Number.isNaN(paidAt.getTime())) throw new Error("Invalid Shopify order identity or timestamp");

    const results: unknown[] = [];
    for (let index = 0; index < membershipLines.length; index++) {
      const line = membershipLines[index];
      const productId = numericId(line.product_id);
      const variantId = numericId(line.variant_id);
      const plan = variantId ? PLAN_BY_VARIANT.get(variantId) : undefined;
      const actualSellingPlanId = sellingPlanId(line);
      const quantity = Number(line.quantity ?? 1);
      if (!plan || productId !== plan.productId || actualSellingPlanId !== plan.sellingPlanId) {
        throw new Error("Membership identifiers do not match the configured plan");
      }
      if (quantity !== 1) throw new Error("Membership line quantity must equal one");

      const properties = lineProperties(line);
      const verifiedPlayerId = properties["_EDGE player ID"] || properties["EDGE player ID"] || null;
      const lineContractGid = contractGid(payload, line);
      const eventLineId = membershipLines.length === 1 ? webhookId : `${webhookId}:${index + 1}`;

      const { data, error } = await supabase.rpc("process_shopify_paid_membership", {
        event_id: eventLineId,
        order_gid: orderGid,
        customer_gid: customerGid,
        subscription_contract_gid: lineContractGid,
        product_id: productId,
        variant_id: variantId,
        selling_plan_id: actualSellingPlanId,
        order_buyer_email: buyerEmail,
        checkout_player_name: properties["Player name"] || "",
        checkout_player_email: properties["Player email"] || "",
        checkout_player_team: properties["Team"] || "",
        paid_at: paidAt.toISOString(),
        paid_amount_cents: cents(line.price, quantity),
        verified_player_id: verifiedPlayerId,
      });
      if (error) throw new Error(error.message);
      results.push(data);
    }

    await supabase.rpc("finish_shopify_webhook_event", {
      event_webhook_id: webhookId,
      event_status: "processed",
      event_error_message: null,
      event_subscription_contract_gid: rootContractGid,
    });
    return json(200, { status: "processed", memberships: results.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook processing error";
    await supabase.rpc("finish_shopify_webhook_event", {
      event_webhook_id: webhookId,
      event_status: "failed",
      event_error_message: message,
      event_subscription_contract_gid: rootContractGid,
    });
    return json(500, { error: "membership_processing_failed" });
  }
});
