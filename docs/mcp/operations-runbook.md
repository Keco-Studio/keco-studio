# Keco MCP Operations Runbook

## Service Boundaries

The public path is Supabase Auth, the project-bound `mcp` Edge Function,
PostgreSQL/RLS, and the trusted Vercel document codec. Table and row operations
use the caller JWT. Only `update_document` creates a short-lived service-role
client, and only for `mcp_replace_document_content`.

Never copy authorization headers, tokens, raw search queries, full document
bodies, full row values, SQL error text, or provider response bodies into logs,
issues, dashboards, or evidence. Logs use request IDs plus opaque actor/project
hashes.

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

For an Edge regression, redeploy the last known-good `mcp` Function bundle. For a
codec regression, roll Vercel production back to the last known-good deployment;
document writes should fail closed while reads remain available. Do not bypass the
codec or accept unverified Yjs state.

Database migrations are additive and security-sensitive. Prefer a forward repair
migration. Before any exceptional rollback, take a managed backup, inspect new
audit/write rows, and prove that removing functions, columns, indexes, or grants
will not discard state or reopen access. Never edit an already applied migration.

After rollback or repair, run OAuth discovery, capabilities, bounded reads, search,
disposable writes, stale conflict, role downgrade/removal, cross-project denial,
rate/audit, and all latency gates in both Codex and Claude before declaring service
recovery.
