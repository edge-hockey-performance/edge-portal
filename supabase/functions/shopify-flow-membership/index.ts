import { createClient } from "npm:@supabase/supabase-js@2";

type Json = Record<string, unknown>;

const EXPECTED_SOURCE = "edge-performance-3.myshopify.com";
const encoder = new TextEncoder();

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

async function sha256Hex(rawBody: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", rawBody));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
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
  if (!["billing_success", "billing_failure", "contract_update"].includes(eventType)) {
    return json(400, { error: "unsupported_event_type" });
  }

  const externalEventId = requiredText(payload, "event_id");
  const eventId = `flow:${eventType}:${externalEventId}`;
  const contractGid = typedGid("SubscriptionContract", payload.contract_gid) as string;
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
    if (eventType === "contract_update") {
      const productId = optionalInteger(payload, "product_id");
      const variantId = optionalInteger(payload, "variant_id");
      const sellingPlanId = optionalInteger(payload, "selling_plan_id");
      const suppliedPlanIds = [productId, variantId, sellingPlanId].filter((value) => value !== null).length;
      if (suppliedPlanIds !== 0 && suppliedPlanIds !== 3) {
        throw new Error("Plan identifiers must be omitted or supplied together");
      }

      const { error } = await supabase.rpc("process_shopify_contract_update", {
        event_id: eventId,
        contract_gid: contractGid,
        origin_order_gid: typedGid("Order", payload.origin_order_gid, false),
        revision_id: optionalInteger(payload, "revision_id"),
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
