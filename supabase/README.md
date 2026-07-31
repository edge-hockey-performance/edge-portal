# EDGE Portal Supabase migrations

These migrations mirror the versioned migrations applied to the EDGE Performance Supabase project on July 31, 2026.

Apply in order:

1. `20260731064715_edge_portal_security_phase_1.sql`
2. `20260731065619_edge_portal_identity_phase_2.sql`
3. `20260731070132_edge_portal_independent_players_phase_2b.sql`

## Current verified state

- 21 Supabase auth users and 21 legacy account profiles preserved.
- 19 independent player rows copied with unchanged UUIDs.
- 19 active primary self-access links.
- All seven player foreign keys target `public.players`.
- Jordan and Mike are the only active protected staff records.
- Non-admin users see only linked players and no cross-account service rows.
- Parent-managed child creation works without creating an auth user or legacy profile.
- Player/parent edits cannot overwrite staff-controlled steel-health or service-scope fields.

## Important dependencies

- Shopify 1-Set and 2-Set entitlement mappings are intentionally not included yet. Triple Whale still exposes only the old `$45` product, so immutable product and variant IDs remain pending sync.
- The blade-report bucket remains public for compatibility, but its broad object-listing policy was removed. Converting the bucket to private must ship with the portal client storage change.
- Supabase leaked-password protection remains a dashboard setting that must be enabled before launch.
- These migrations contain shop-specific administrator UUIDs and must be reviewed before reuse in another Supabase project.
