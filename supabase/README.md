# EDGE Portal Supabase migrations

These migrations mirror the versioned migrations applied to the EDGE Performance Supabase project on July 31, 2026.

## Applied in order

1. `20260731064715_edge_portal_security_phase_1.sql`
2. `20260731065619_edge_portal_identity_phase_2.sql`
3. `20260731070132_edge_portal_independent_players_phase_2b.sql`
4. `20260731071500_edge_portal_client_contract_phase_3.sql`
5. `20260731071615_edge_portal_report_storage_access_phase_4a.sql`
6. `20260731071859_edge_portal_client_contract_phase_3c.sql`
7. `20260731071905_edge_portal_report_storage_write_phase_4c.sql`

The rejected `phase_3b` replacement is intentionally absent: PostgreSQL rejected it atomically because `CREATE OR REPLACE VIEW` cannot remove a column. `phase_3c` is the successful drop/recreate correction.

## Pending controlled migration

- `supabase/pending/20260731072000_edge_portal_report_storage_private_phase_4b.sql` changes the blade-report bucket from public to private. Do not apply until the signed-URL client is deployed to staging and verified with admin, player, and parent accounts.

## Current verified state

- 21 Supabase auth users and 21 legacy account profiles preserved.
- 19 independent player rows copied with unchanged UUIDs.
- 19 active primary self-access links.
- All seven player foreign keys target `public.players`.
- Jordan and Mike are the only active protected staff records.
- Portal staff routing can use `public.is_portal_staff()` instead of editable `profiles.role`.
- `public.portal_player_context` is a security-invoker view and excludes `internal_notes`.
- Blade-report signed reads and uploads are scoped to protected staff or linked player accounts.
- The blade-report bucket remains public for production compatibility until the pending migration is deliberately applied.
- Parent-managed child creation works without creating an auth user or legacy profile.
- Player/parent edits cannot overwrite staff-controlled steel-health or service-scope fields.

## Important dependencies

- Shopify 1-Set and 2-Set entitlement mappings are intentionally not included yet. Triple Whale still exposes only the old `$45` product, so immutable product and variant IDs remain pending sync.
- Supabase leaked-password protection remains a dashboard setting that must be enabled before launch.
- These migrations contain shop-specific administrator UUIDs and must be reviewed before reuse in another Supabase project.
