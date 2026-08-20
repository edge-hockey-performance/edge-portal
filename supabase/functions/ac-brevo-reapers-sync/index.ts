import { createClient } from "npm:@supabase/supabase-js@2";

type Json = Record<string, unknown>;
type Contact = { email: string; firstName?: string; lastName?: string; playerName?: string; teamLevel?: string; setInterest?: string; profilingInterest?: string; source: Set<string> };
const encoder = new TextEncoder();

function json(status: number, body: Json) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
function safeEqual(a: string, b: string) { const x = encoder.encode(a); const y = encoder.encode(b); if (x.length !== y.length) return false; let mismatch = 0; for (let i = 0; i < x.length; i++) mismatch |= x[i] ^ y[i]; return mismatch === 0; }
function text(value: unknown) { return String(value ?? "").trim(); }
async function fetchJson(url: string, init: RequestInit) { const response = await fetch(url, init); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(`${response.status} ${url}: ${JSON.stringify(body)}`); return body as Json; }

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const brevoApiKey = Deno.env.get("BREVO_API_KEY");
  if (!supabaseUrl || !serviceRoleKey || !brevoApiKey) return json(503, { error: "sync_not_configured" });

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: storedSyncToken } = await supabase.rpc("get_secret", { secret_name: "brevo_sync_invocation_token" });
  const authorization = (req.headers.get("authorization") || "").trim();
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const suppliedSyncToken = (req.headers.get("x-edge-sync-token") || "").trim();
  const serviceRoleAuthorized = safeEqual(bearerToken, serviceRoleKey);
  const dedicatedTokenAuthorized = typeof storedSyncToken === "string" && storedSyncToken.length >= 32 && safeEqual(suppliedSyncToken, storedSyncToken);
  if (!serviceRoleAuthorized && !dedicatedTokenAuthorized) return json(401, { error: "sync_authorization_required" });

  const [{ data: acUrl }, { data: acKey }] = await Promise.all([
    supabase.rpc("get_secret", { secret_name: "ac_api_url" }),
    supabase.rpc("get_secret", { secret_name: "ac_api_key" }),
  ]);
  if (!acUrl || !acKey) return json(503, { error: "activecampaign_not_configured" });
  const acHeaders = { "Api-Token": String(acKey), "Content-Type": "application/json" };
  const brevoHeaders = { "api-key": brevoApiKey, "accept": "application/json", "content-type": "application/json" };
  const normalizedAcUrl = String(acUrl).replace(/\/$/, "");

  const [tagsBody, fieldsBody] = await Promise.all([
    fetchJson(`${normalizedAcUrl}/api/3/tags?limit=100`, { headers: acHeaders }),
    fetchJson(`${normalizedAcUrl}/api/3/fields?limit=100`, { headers: acHeaders }),
  ]);
  const tags = Array.isArray(tagsBody.tags) ? tagsBody.tags as Json[] : [];
  const selectedTags = tags.filter((tag) => ["reapers", "reapers intro"].includes(text(tag.tag).toLowerCase()));
  if (!selectedTags.length) return json(409, { error: "reapers_tags_not_found" });
  const fieldTitles = new Map((Array.isArray(fieldsBody.fields) ? fieldsBody.fields as Json[] : []).map((field) => [text(field.id), text(field.title)]));
  const contacts = new Map<string, Contact>();

  for (const tag of selectedTags) {
    const tagName = text(tag.tag);
    const body = await fetchJson(`${normalizedAcUrl}/api/3/contacts?limit=100&tagid=${encodeURIComponent(text(tag.id))}`, { headers: acHeaders });
    for (const raw of Array.isArray(body.contacts) ? body.contacts as Json[] : []) {
      const email = text(raw.email).toLowerCase();
      if (!email) continue;
      const current = contacts.get(email) || { email, source: new Set<string>() };
      current.firstName ||= text(raw.firstName);
      current.lastName ||= text(raw.lastName);
      current.source.add(`ActiveCampaign:${tagName}`);
      const values = await fetchJson(`${normalizedAcUrl}/api/3/contacts/${encodeURIComponent(text(raw.id))}/fieldValues`, { headers: acHeaders });
      for (const value of Array.isArray(values.fieldValues) ? values.fieldValues as Json[] : []) {
        const title = (fieldTitles.get(text(value.field)) || "").toLowerCase();
        const fieldValue = text(value.value);
        if (title === "team level") current.teamLevel ||= fieldValue;
        if (title === "set interest") current.setInterest ||= fieldValue;
        if (title === "profiling interest") current.profilingInterest ||= fieldValue;
      }
      contacts.set(email, current);
    }
  }

  const { data: leads, error: leadsError } = await supabase.from("team_leads")
    .select("email,parent_name,player_name,team_level,set_interest,profiling_interest,created_at")
    .eq("team_slug", "chicago-reapers").order("created_at", { ascending: true });
  if (leadsError) throw leadsError;
  for (const lead of leads || []) {
    const email = text(lead.email).toLowerCase();
    if (!email) continue;
    const current = contacts.get(email) || { email, source: new Set<string>() };
    const parent = text(lead.parent_name).split(/\s+/).filter(Boolean);
    current.firstName = parent[0] || current.firstName;
    current.lastName = parent.slice(1).join(" ") || current.lastName;
    current.playerName = text(lead.player_name) || current.playerName;
    current.teamLevel = text(lead.team_level) || current.teamLevel;
    current.setInterest = text(lead.set_interest) || current.setInterest;
    current.profilingInterest = lead.profiling_interest === true ? "Yes" : lead.profiling_interest === false ? "No" : current.profilingInterest;
    current.source.add("Supabase:team_leads");
    contacts.set(email, current);
  }

  const foldersBody = await fetchJson("https://api.brevo.com/v3/contacts/folders?limit=50&offset=0&sort=desc", { headers: brevoHeaders });
  let folder = (Array.isArray(foldersBody.folders) ? foldersBody.folders as Json[] : []).find((item) => text(item.name) === "EDGE Performance");
  if (!folder) folder = await fetchJson("https://api.brevo.com/v3/contacts/folders", { method: "POST", headers: brevoHeaders, body: JSON.stringify({ name: "EDGE Performance" }) });
  const folderId = Number(folder.id);
  if (!Number.isInteger(folderId)) throw new Error("Brevo folder ID was not returned");

  const listsBody = await fetchJson(`https://api.brevo.com/v3/contacts/folders/${folderId}/lists?limit=50&offset=0&sort=desc`, { headers: brevoHeaders });
  let list = (Array.isArray(listsBody.lists) ? listsBody.lists as Json[] : []).find((item) => text(item.name) === "Chicago Reapers");
  if (!list) list = await fetchJson("https://api.brevo.com/v3/contacts/lists", { method: "POST", headers: brevoHeaders, body: JSON.stringify({ name: "Chicago Reapers", folderId }) });
  const listId = Number(list.id);
  if (!Number.isInteger(listId)) throw new Error("Brevo list ID was not returned");

  const attributesBody = await fetchJson("https://api.brevo.com/v3/contacts/attributes", { headers: brevoHeaders });
  const existingAttributes = new Set((Array.isArray(attributesBody.attributes) ? attributesBody.attributes as Json[] : []).map((attribute) => text(attribute.name)));
  for (const name of ["PLAYER_NAME", "TEAM_LEVEL", "SET_INTEREST", "PROFILING_INTEREST", "SOURCE_SYSTEM", "RECOMMENDED_OPTION"]) {
    if (!existingAttributes.has(name)) {
      await fetchJson(`https://api.brevo.com/v3/contacts/attributes/normal/${name}`, { method: "POST", headers: brevoHeaders, body: JSON.stringify({ type: "text" }) });
    }
  }

  let synced = 0;
  for (const contact of contacts.values()) {
    const normalizedInterest = text(contact.setInterest).toLowerCase();
    const recommended = normalizedInterest.includes("two") || normalizedInterest === "2-set" ? "2-Set" : normalizedInterest.includes("one") || normalizedInterest === "1-set" ? "1-Set" : "Compare both";
    await fetchJson("https://api.brevo.com/v3/contacts", {
      method: "POST", headers: brevoHeaders,
      body: JSON.stringify({
        email: contact.email,
        attributes: {
          FNAME: contact.firstName || "", LNAME: contact.lastName || "", PLAYER_NAME: contact.playerName || "",
          TEAM_LEVEL: contact.teamLevel || "", SET_INTEREST: contact.setInterest || "",
          PROFILING_INTEREST: contact.profilingInterest || "", SOURCE_SYSTEM: Array.from(contact.source).sort().join("; "),
          RECOMMENDED_OPTION: recommended,
        },
        listIds: [listId], updateEnabled: true,
      }),
    });
    synced++;
  }
  return json(200, { status: "synced", contacts: synced, activecampaign_tags: selectedTags.map((tag) => text(tag.tag)), brevo_list_id: listId });
});
