import { createClient } from "npm:@supabase/supabase-js@2";

type Json = Record<string, unknown>;
const PORTAL_URL = "https://portal.edgehockeyperformance.com/";
const SENDER = { name: "EDGE Hockey Performance", email: "jordan@edgehockeyperformance.com" };
const TEST_RECIPIENT_EMAIL = "jordan@edgehockeyperformance.com";
const encoder = new TextEncoder();

function json(status: number, body: Json) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
function safeEqual(a: string, b: string) {
  const left = encoder.encode(a); const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}
function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
}
async function findAuthUserByEmail(admin: ReturnType<typeof createClient>["auth"]["admin"], email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((user) => String(user.email || "").toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  throw new Error("Auth user lookup exceeded the safety page limit");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const brevoApiKey = Deno.env.get("BREVO_API_KEY");
  if (!url || !serviceRoleKey || !brevoApiKey) return json(503, { error: "invitation_service_not_configured" });
  const authorization = (req.headers.get("authorization") || "").trim();
  if (!authorization.startsWith("Bearer ") || !safeEqual(authorization.slice(7).trim(), serviceRoleKey)) {
    return json(401, { error: "service_role_required" });
  }

  let body: Json;
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }
  const membershipId = String(body.membership_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(membershipId)) return json(400, { error: "invalid_membership_id" });

  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: membership, error: membershipError } = await supabase
    .from("membership_subscriptions")
    .select("id,player_id,buyer_email,player_email,player_first_name,player_last_name,player_team,plan_code,status,match_status,shopify_order_gid")
    .eq("id", membershipId)
    .single();
  if (membershipError || !membership) return json(404, { error: "membership_not_found" });
  if (!membership.player_id || membership.status === "review_required" || membership.match_status === "ambiguous" || membership.match_status === "review_required") {
    return json(409, { error: "membership_access_not_provisionable" });
  }
  if (!["active", "grace"].includes(membership.status)) return json(409, { error: "membership_not_paid_active" });

  const recipientEmail = String(membership.buyer_email || membership.player_email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) return json(409, { error: "valid_buyer_email_required" });
  if (recipientEmail !== TEST_RECIPIENT_EMAIL) {
    return json(200, { status: "test_gate_blocked", recipient: recipientEmail });
  }

  const { data: existingInvite, error: inviteReadError } = await supabase
    .from("membership_portal_invitations")
    .select("id,status,attempt_count,brevo_message_id")
    .eq("membership_id", membershipId)
    .maybeSingle();
  if (inviteReadError) throw inviteReadError;
  if (existingInvite?.status === "sent") {
    return json(200, { status: "already_sent", message_id: existingInvite.brevo_message_id });
  }

  let authUser = await findAuthUserByEmail(supabase.auth.admin, recipientEmail);
  if (!authUser) {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: recipientEmail,
      email_confirm: false,
      user_metadata: { source: "shopify_paid_membership", membership_id: membershipId },
    });
    if (createError || !created.user) throw createError || new Error("Auth user was not created");
    authUser = created.user;
  }

  const userId = authUser.id;
  if (userId !== membership.player_id) {
    await supabase.from("player_access").update({ is_primary: false, revoked_at: new Date().toISOString() })
      .eq("player_id", userId).eq("user_id", userId).eq("relationship", "self").is("revoked_at", null);
  }
  await supabase.from("player_access").update({ is_primary: false })
    .eq("player_id", membership.player_id).eq("is_primary", true).is("revoked_at", null).neq("user_id", userId);
  const relationship = recipientEmail === String(membership.player_email || "").trim().toLowerCase() ? "self" : "parent";
  const { error: accessError } = await supabase.from("player_access").upsert({
    player_id: membership.player_id,
    user_id: userId,
    relationship,
    is_primary: true,
    created_by: userId,
    revoked_at: null,
  }, { onConflict: "player_id,user_id" });
  if (accessError) throw accessError;

  let invitationId = existingInvite?.id;
  if (!invitationId) {
    const { data: createdInvite, error: createInviteError } = await supabase.from("membership_portal_invitations").insert({
      membership_id: membershipId,
      player_id: membership.player_id,
      user_id: userId,
      recipient_email: recipientEmail,
      status: "pending",
    }).select("id").single();
    if (createInviteError || !createdInvite) throw createInviteError || new Error("Invitation log was not created");
    invitationId = createdInvite.id;
  } else {
    await supabase.from("membership_portal_invitations").update({ user_id: userId, status: "pending", last_error: null, updated_at: new Date().toISOString() }).eq("id", invitationId);
  }

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email: recipientEmail,
    options: { redirectTo: PORTAL_URL },
  });
  if (linkError || !linkData.properties?.action_link) throw linkError || new Error("Secure portal link was not generated");

  const playerName = `${membership.player_first_name || ""} ${membership.player_last_name || ""}`.trim() || "your player";
  const planName = membership.plan_code === "two_set" ? "EDGE 2-Set Membership" : "EDGE 1-Set Membership";
  const actionLink = linkData.properties.action_link;
  const htmlContent = `<!doctype html><html><body style="margin:0;background:#0A0A0A;color:#fff;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0A0A0A"><tr><td align="center" style="padding:28px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#141414;border:1px solid #2b2b2b;border-radius:12px"><tr><td style="padding:28px"><img src="https://edgehockeyperformance.com/cdn/shop/t/62/assets/edge-logo-nav.png?v=142111388735342124721786899168" width="190" alt="EDGE Performance" style="display:block;max-width:100%;height:auto;margin-bottom:28px"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#B8D4E8;font-weight:700">Payment confirmed · Portal access ready</div><h1 style="margin:10px 0 16px;font-size:32px;line-height:1.05">Set up your EDGE Portal account</h1><p style="color:#d7d7d7;line-height:1.65">Your ${escapeHtml(planName)} payment for ${escapeHtml(playerName)} has been confirmed. Your secure portal access is ready.</p><p style="color:#d7d7d7;line-height:1.65">Use the button below to create your password and connect to the player profile. This link is specific to ${escapeHtml(recipientEmail)} and should not be forwarded.</p><p style="margin:28px 0"><a href="${escapeHtml(actionLink)}" style="display:inline-block;background:#B8D4E8;color:#0A0A0A;text-decoration:none;font-weight:800;padding:14px 20px;border-radius:6px">Set Up Portal Access</a></p><p style="font-size:13px;color:#999;line-height:1.55">If you already have an EDGE Portal account, this secure link will let you set a new password and access the paid player profile.</p><p style="font-size:13px;color:#999;line-height:1.55">Questions? Reply to this email and Jordan will help.</p></td></tr></table></td></tr></table></body></html>`;

  const sendResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": brevoApiKey, "accept": "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      sender: SENDER,
      to: [{ email: recipientEmail }],
      replyTo: SENDER,
      subject: "Your EDGE Portal access is ready",
      htmlContent,
      headers: { idempotencyKey: invitationId },
    }),
  });
  const sendBody = await sendResponse.json().catch(() => ({}));
  const attemptCount = Number(existingInvite?.attempt_count || 0) + 1;
  if (!sendResponse.ok || !sendBody.messageId) {
    const message = `Brevo ${sendResponse.status}: ${JSON.stringify(sendBody)}`.slice(0, 800);
    await supabase.from("membership_portal_invitations").update({ status: "failed", attempt_count: attemptCount, last_error: message, updated_at: new Date().toISOString() }).eq("id", invitationId);
    return json(502, { error: "brevo_send_failed" });
  }

  const sentAt = new Date().toISOString();
  await supabase.from("membership_portal_invitations").update({
    status: "sent", attempt_count: attemptCount, brevo_message_id: sendBody.messageId,
    last_error: null, sent_at: sentAt, updated_at: sentAt,
  }).eq("id", invitationId);
  await supabase.from("membership_audit_log").insert({
    membership_id: membershipId,
    player_id: membership.player_id,
    action: "portal_invitation_sent",
    source: "brevo_transactional",
    external_event_id: sendBody.messageId,
    after_state: { recipient_email: recipientEmail, invitation_id: invitationId },
  });
  return json(200, { status: "sent", message_id: sendBody.messageId });
});
