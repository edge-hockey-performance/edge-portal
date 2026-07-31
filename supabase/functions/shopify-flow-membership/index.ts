import { createClient } from "npm:@supabase/supabase-js@2";

type Json = Record<string, unknown>;
type PaidPlan = {
  productId: number;
  variantId: number;
  sellingPlanId: number;
  priceCents: number;
};

const EXPECTED_SOURCE = "edge-performance-3.myshopify.com";
const encoder = new TextEncoder();
const PAID_PLANS = new Map<string, PaidPlan>([
  ["EDGE-1SET-WK", { productId: 9212478029987, variantId: 47941773230243, sellingPlanId: 3369599139, priceCents: 1300 }],
  ["EDGE-2SET-WK", { productId: 9212478980259, variantId: 47941775458467, sellingPlanId: 3369599139, priceCents: 1900 }],
]);

function json(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function safeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
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
  const value = String(payload[field] ?? "").trim();
  return value || null;
}

function typedGid(kind: string, value: unknown, required = true): string | null {
  const text = String(value ?? "").trim();
  if (!text) {
    if (required) throw new Error(`Missing ${kind} GID`);
    return null;
  }
  const pattern = new RegExp(`^gid://shopify/${kind}/[0-9]+$`);
  if (!pattern.test(text)) throw new Error(`Invalid ${kind} GID`);
  return text;
}

function timestamp(payload: Json, field: string): string {
  const value = requiredText(payload, field);
  const date = new Date(value);
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
  const postgresMax = "9223372036854775807";
  if (normalized.length > postgresMax.length ||
      (normalized.length === postgresMax.length && normalized > postgresMax)) {
    throw new Error(`${field} exceeds PostgreSQL bigint range`);
  }
  return normalized;
}

function normalizedName(first: unknown, last: unknown): string {
  return `${String(first ?? "").trim()} ${String(last ?? "").trim()}`.trim().toLowerCase().replace(/\s+/g, " ");
}

async function sha256Hex(rawBody: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", rawBody));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") return json(200, { status: "ok" });
  if (req.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const sharedSecret = Deno.env.get("EDGE_FLOW_SHARED_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!sharedSecret || !supabaseUrl || !serviceRoleKey) {
    return json(503, { error: "flow_endpoint_not_configured" });
  }

  const source = (req.headers.get("x-edge-flow-source") || "").trim().toLowerCase();
  const authorization = (req.headers.get("authorization") || "").trim();
  if (source !== EXPECTED_SOURCE) return json(403, { error: "source_not_allowed" });
  if (!authorization.startsWith("Bearer ")) return json(401, { error: "missing_bearer_token" });
  if (!safeEqual(authorization.slice(7).trim(), sharedSecret)) {
    return json(401, { error: "invalid_bearer_token" });
  }

  const rawBody = new Uint8Array(await req.arrayBuffer());
  let payload: Json;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const eventType = requiredText(payload, "event_type").toLowerCase();
  if (!["order_paid", "billing_success", "billing_failure", "contract_update"].includes(eventType)) {
    return json(400, { error: "unsupported_event_type" });
  }

  const externalEventId = requiredText(payload, "event_id");
  const eventId = `flow:${eventType}:${externalEventId}`;
  const contractGid = typedGid("SubscriptionContract", payload.contract_gid, eventType !== "order_paid");
  const topic = `flow/${eventType}`;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: inbox, error: inboxError } = await supabase.rpc("record_shopify_webhook_event", {
    event_webhook_id: eventId,
    event_topic: topic,
    event_shop_domain: EXPECTED_SOURCE,
    event_payload_sha256: await sha256Hex(rawBody),
    event_subscription_contract_gid: contractGid,
  });
  if (inboxError) return json(500, { error: "flow_inbox_failed" });
  if (inbox === "duplicate:processed" || inbox === "duplicate:ignored") {
    return json(200, { status: "duplicate_acknowledged" });
  }

  const finish = async (status: "processed" | "failed", message: string | null = null) => {
    await supabase.rpc("finish_shopify_webhook_event", {
      event_webhook_id: eventId,
      event_status: status,
      event_error_message: message,
      event_subscription_contract_gid: contractGid,
    });
  };

  try {
    if (eventType === "order_paid") {
      const sku = requiredText(payload, "sku").toUpperCase();
      const plan = PAID_PLANS.get(sku);
      if (!plan) throw new Error("Unknown membership SKU");
      const quantity = optionalInteger(payload, "quantity") ?? 1;
      if (quantity !== 1) throw new Error("Membership quantity must equal one");

      const orderGid = typedGid("Order", payload.order_gid) as string;
      const customerGid = typedGid("Customer", payload.customer_gid, false);
      const playerName = requiredText(payload, "player_name");
      const playerEmail = requiredText(payload, "player_email").toLowerCase();
      const playerTeam = requiredText(payload, "player_team");
      const desiredName = playerName.toLowerCase().replace(/\s+/g, " ");

      const { data: candidates, error: candidateError } = await supabase
        .from("players")
        .select("id,fname,lname,email")
        .ilike("email", playerEmail);
      if (candidateError) throw new Error(candidateError.message);
      const exactPlayers = (candidates || []).filter((player) =>
        normalizedName(player.fname, player.lname) === desiredName &&
        String(player.email || "").trim().toLowerCase() === playerEmail
      );
      if (exactPlayers.length > 1) throw new Error("Player identity is ambiguous");
      const verifiedPlayerId = exactPlayers.length === 1 ? exactPlayers[0].id : null;

      const { error } = await supabase.rpc("process_shopify_paid_membership", {
        event_id: eventId,
        order_gid: orderGid,
        customer_gid: customerGid,
        subscription_contract_gid: typedGid("SubscriptionContract", payload.contract_gid, false),
        product_id: plan.productId,
        variant_id: plan.variantId,
        selling_plan_id: plan.sellingPlanId,
        order_buyer_email: optionalText(payload, "buyer_email"),
        checkout_player_name: playerName,
        checkout_player_email: playerEmail,
        checkout_player_team: playerTeam,
        paid_at: timestamp(payload, "occurred_at"),
        paid_amount_cents: plan.priceCents,
        verified_player_id: verifiedPlayerId,
      });
      if (error) throw new Error(error.message);
    } else if (eventType === "contract_update") {
      const productId = optionalShopifyId(payload, "product_id", "Product");
      const variantId = optionalShopifyId(payload, "variant_id", "ProductVariant");
      const sellingPlanId = optionalShopifyId(payload, "selling_plan_id", "SellingPlan");
      const suppliedPlanIds = [productId, variantId, sellingPlanId].filter((value) => value !== null).length;
      if (suppliedPlanIds !== 0 && suppliedPlanIds !== 3) {
        throw new Error("Plan identifiers must be omitted or supplied together");
      }

      const { error } = await supabase.rpc("process_shopify_contract_update", {
        event_id: eventId,
        contract_gid: contractGid,
        origin_order_gid: typedGid("Order", payload.origin_order_gid, false),
        revision_id: optionalBigint(payload, "revision_id"),
        contract_status: requiredText(payload, "contract_status"),
        occurred_at: timestamp(payload, "occurred_at"),
        product_id: productId,
        variant_id: variantId,
        selling_plan_id: sellingPlanId,
      });
      if (error) throw new Error(error.message);
    } else {
      const successful = eventType === "billing_success";
      const { error } = await supabase.rpc("process_shopify_billing_attempt", {
        event_id: eventId,
        contract_gid: contractGid,
        renewal_order_gid: successful ? typedGid("Order", payload.renewal_order_gid, false) : null,
        attempt_outcome: successful ? "success" : "failure",
        occurred_at: timestamp(payload, "occurred_at"),
        amount_cents: optionalInteger(payload, "amount_cents"),
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
