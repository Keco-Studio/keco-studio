# Keco MCP Operations Runbook

## Service Boundaries

The public paths are the account-scoped `mcp` root route and the legacy
project-bound `mcp/{projectId}` route, Supabase Auth, PostgreSQL/RLS, and the
trusted Vercel document codec. Account OAuth grants authenticate the service;
each project operation then checks current membership and role under the caller
JWT. Table and row operations use the caller JWT. Only `update_document` creates
a short-lived service-role client, and only for `mcp_replace_document_content`.

Never copy authorization headers, tokens, raw search queries, full document
bodies, full row values, SQL error text, or provider response bodies into logs,
issues, dashboards, or evidence. Logs use request IDs plus opaque actor/project
hashes.

## Account Entry Deployment

Deploy the additive account entry in this order:

1. Apply the database migration that creates the service-grant contract,
   project-discovery RPCs, and exchange binding.
2. Deploy Vercel OAuth metadata and account consent handling.
3. Confirm the production codec health check using the managed codec secret.
4. Deploy the `mcp` Edge Function with `--no-verify-jwt`; its service-grant and
   project-role checks remain the authorization boundary.
5. Run real OAuth and MCP acceptance against the root endpoint, then verify a
   legacy project URL with an existing legacy credential.

Keep `supabase/setup-cli@v1` and Supabase CLI `2.90.0` in CI and deployment
workflows. In that CLI version, `[auth.oauth_server]` configures the local
stack, but remote OAuth Server configuration serialization is unimplemented.
`supabase link` and `supabase db push` therefore do not prove production OAuth
Server configuration. Treat production discovery and dynamic registration as
direct post-deploy checks. For authorization and code exchange, run the OAuth
probe with `--exercise-code-exchange`, an exact
`http://127.0.0.1:{port}/` redirect URI, and complete the login and consent
opened in the system browser.

The production root endpoint is:

```text
https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp
```

Before release, capture sanitized evidence for all of the following:

- anonymous root request returns `401` with account resource metadata;
- root OAuth discovery, DCR, authorization response, and code exchange succeed;
- `list_projects` returns a bounded page, including duplicate names without an
  unsolicited clarification, and records its timing;
- a viewer-targeted write returns `PROJECT_WRITE_FORBIDDEN` without choosing a
  different project;
- account and legacy OAuth credentials each receive `403` when replayed to the
  other route;
- a zero-project account receives a successful empty page;
- a legacy project URL continues to initialize and expose its unchanged surface.

Record only request IDs, durations, counts, roles, generated project labels,
workflow URLs, and commit identifiers. Do not record credentials, authorization
codes, refresh tokens, PKCE values, cookies, client secrets, or project IDs.

## Health Gates

The release budgets are strict: warm static P95 below 300 ms, ordinary read P95
below 800 ms, project structure P95 below 1 second, ordinary write P95 below 1
second, search P95 below 3 seconds, and independently verified cold P95 below 2
seconds. Responses must remain below 1 MiB and full Markdown below 100 KiB.

Alert when any condition is sustained:

- Edge 5xx exceeds 2 percent for 5 minutes.
- P95 exceeds twice its operation-class budget for 10 minutes.
- embedding fallback exceeds 25 percent for 15 minutes.
- rate-limited outcomes exceed 20 percent for 10 minutes.
- any credential-shaped value appears in audit, logs, or evidence.
- admitted operations older than 5 minutes have no completion event.

Useful privileged SQL queries:

```sql
select operation_class, outcome, count(*)
from public.mcp_audit_events
where created_at >= now() - interval '15 minutes'
group by operation_class, outcome
order by operation_class, outcome;

select operation,
  percentile_cont(array[0.5, 0.95, 0.99]) within group (order by total_ms) as latency_ms
from public.mcp_audit_events
where created_at >= now() - interval '1 hour'
  and outcome in ('succeeded', 'failed') and total_ms is not null
group by operation order by operation;

select operation_id, project_id, actor_id, created_at
from public.mcp_audit_events admitted
where outcome = 'admitted' and created_at < now() - interval '5 minutes'
  and not exists (
    select 1 from public.mcp_audit_events completed
    where completed.operation_id = admitted.operation_id
      and completed.outcome in ('succeeded', 'failed')
  );
```

Run audit cleanup through the privileged scheduler daily:

```sql
select public.mcp_cleanup_telemetry();
```

Authenticated clients cannot select audit rows or invoke cleanup. Retention is
90 days.

## Provider Degradation

If embedding fallback rises, verify provider reachability, status, model, and
1536-dimensional response shape without logging the API key or body. Text/fuzzy
search remains the supported degraded mode. Do not disable search or relabel the
fallback as semantic. After provider recovery, run a bounded semantic probe and
repair stale `agent_embedding_chunks` through the existing embedding reindex job.
Reindex failure does not roll back a successful write.

## Authorization Incidents

For unexpected access, first remove or downgrade the project membership. The next
MCP request must reflect the new role independently of token expiry. Revoke the
OAuth client/session in Supabase Auth when credentials may be compromised. Rotate
the codec/cursor secrets and provider keys through their managed environments;
never place replacement values in shell history or tickets.

Validate a suspected cross-project issue using two disposable projects and stable
foreign identifiers. The expected public result is not-found or forbidden without
revealing whether the foreign object exists. Preserve only request IDs and bounded
audit metadata for investigation.

## Rate Limits

Initial per-user/project 60-second limits are 240 static, 120 read, 30 write, and
20 search operations. Investigate caller patterns and error ratios before tuning.
Change limits in a reviewed migration, retain distributed PostgreSQL admission,
and rerun burst/concurrency probes. Do not add worker-local enforcement as the
authority.

## Rollback

If root account acceptance fails, disable or reject only the exact `/mcp` route.
Keep `/mcp/{projectId}` traffic, its existing OAuth grants, and its tool contract
available throughout the rollback. The account service-grant table and exchange
trigger are additive and may remain deployed; do not use a destructive database
rollback to remove them. Once the root route is disabled, verify the legacy probe
and a legacy client before announcing the fallback.

For an unrelated Edge regression, redeploy the last known-good `mcp` Function
bundle. For a codec regression, roll Vercel production back to the last
known-good deployment; document writes should fail closed while reads remain
available. Do not bypass the codec or accept unverified Yjs state.

Database migrations are additive and security-sensitive. Prefer a forward repair
migration. Before any exceptional rollback, take a managed backup, inspect new
audit/write rows, and prove that removing functions, columns, indexes, or grants
will not discard state or reopen access. Never edit an already applied migration.

After rollback or repair, run root OAuth discovery, account project listing,
capabilities, bounded reads, search, disposable writes, stale conflict, role
downgrade/removal, viewer denial, cross-resource replay denial, legacy
compatibility, rate/audit, and all latency gates in both Codex and Claude before
declaring service recovery.
