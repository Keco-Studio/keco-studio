import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260821120000_map_mcp_idempotency.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");

describe("Create Map MCP idempotency migration", () => {
  it("stores immutable requests by authenticated actor and UUID key", () => {
    expect(sql).toMatch(/create table public\.map_creation_requests/i);
    expect(sql).toMatch(
      /actor_id uuid not null references auth\.users\(id\) on delete cascade/i,
    );
    expect(sql).toMatch(/idempotency_key uuid not null/i);
    expect(sql).toMatch(
      /input_hash text not null check \(input_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/i,
    );
    expect(sql).toMatch(
      /map_id uuid not null references public\.map_projects\(id\) on delete cascade/i,
    );
    expect(sql).toMatch(
      /revision_id uuid not null references public\.map_revisions\(id\) on delete cascade/i,
    );
    expect(sql).toMatch(/primary key \(actor_id, idempotency_key\)/i);
  });

  it("serializes absent-key races and returns an identical replay", () => {
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/v_actor_id uuid := auth\.uid\(\)/i);
    expect(sql).toMatch(
      /where actor_id = v_actor_id[\s\S]+idempotency_key = p_idempotency_key[\s\S]+for update/i,
    );
    expect(sql).toMatch(
      /if v_request\.input_hash <> p_input_hash[\s\S]+IDEMPOTENCY_CONFLICT/i,
    );
    expect(sql).toMatch(
      /return query[\s\S]+v_request\.map_id[\s\S]+v_request\.revision_id/i,
    );
  });

  it("reuses the validated V3 create RPC and records the result atomically", () => {
    expect(sql).toMatch(
      /from public\.create_map_project_v3\([\s\S]+p_plan,[\s\S]+p_scene[\s\S]+\)/i,
    );
    expect(sql).toMatch(
      /insert into public\.map_creation_requests[\s\S]+v_actor_id[\s\S]+p_idempotency_key[\s\S]+p_input_hash[\s\S]+v_created\.map_id[\s\S]+v_created\.draft_revision_id/i,
    );
    expect(sql).not.toMatch(/p_(?:actor|user)_id/i);
  });

  it("keeps storage private and grants only the RPC to authenticated users", () => {
    expect(sql).toMatch(
      /create function public\.create_map_project_v3_idempotent/i,
    );
    expect(sql).toMatch(/security definer\s+set search_path = ''/i);
    expect(sql).toMatch(
      /revoke all on table public\.map_creation_requests from public, anon, authenticated/i,
    );
    expect(sql).not.toMatch(
      /grant (?:select|insert|update|delete|all)[^;]+map_creation_requests/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.create_map_project_v3_idempotent\([\s\S]+from public, anon/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.create_map_project_v3_idempotent\([\s\S]+to authenticated/i,
    );
  });
});
