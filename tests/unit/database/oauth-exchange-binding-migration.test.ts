import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260723000000_mcp_oauth_exchange_binding.sql",
);

describe("OAuth exchange project binding migration", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  it("creates the grant from the approved authorization during code exchange", () => {
    expect(sql).toMatch(
      /create or replace function public\.bind_oauth_project_grant_session/i,
    );
    expect(sql).toMatch(/old\.status\s*<>\s*'approved'/i);
    expect(sql).toMatch(/old\.resource is null/i);
    expect(sql).toMatch(/insert into public\.oauth_project_grants/i);
    expect(sql).toMatch(/old\.authorization_id/i);
    expect(sql).toMatch(/old\.user_id/i);
    expect(sql).toMatch(/old\.client_id/i);
    expect(sql).toMatch(/old\.resource/i);
  });

  it("accepts only a canonical project resource owned by a current member", () => {
    expect(sql).toMatch(/\^https\?:\/\//i);
    expect(sql).toMatch(/\(:\[0-9\]\+\)\?/i);
    expect(sql).toMatch(/\/functions\/v1\/mcp\//i);
    expect(sql).toMatch(
      /regexp_replace\(old\.resource, '\^\.\*\/', ''\)::uuid/i,
    );
    expect(sql).toMatch(/project\.owner_id\s*=\s*old\.user_id/i);
    expect(sql).toMatch(/collaborator\.user_id\s*=\s*old\.user_id/i);
    expect(sql).toMatch(/collaborator\.accepted_at is not null/i);
  });

  it("binds only the one OAuth session created in the exchange transaction", () => {
    expect(sql).toMatch(/session_row\.oauth_client_id\s*=\s*old\.client_id/i);
    expect(sql).toMatch(
      /session_row\.xmin::text::bigint\s*=\s*pg_current_xact_id\(\)::text::bigint/i,
    );
    expect(sql).toMatch(/cardinality\(v_session_ids\)\s*=\s*1/i);
    expect(sql).toMatch(/session_id\s*=\s*excluded\.session_id/i);
  });

  it("keeps the trigger function inaccessible to API roles", () => {
    for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.bind_oauth_project_grant_session\\(\\) from ${role}`,
          "i",
        ),
      );
    }
  });
});
