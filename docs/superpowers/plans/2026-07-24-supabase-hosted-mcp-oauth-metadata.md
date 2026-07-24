# Supabase-Hosted MCP OAuth Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve MCP protected-resource metadata from the Supabase Edge Function so Codex OAuth discovery no longer depends on direct access to the Keco Vercel host.

**Architecture:** Add a focused Edge-compatible metadata module that validates Supabase origins, metadata paths, query parameters, and project IDs. Route exact metadata `GET` requests before MCP authorization, then build all unauthenticated `WWW-Authenticate` challenges from `SUPABASE_URL`; keep the existing Next.js metadata route unchanged for compatibility.

**Tech Stack:** Supabase Edge Functions, Deno, TypeScript, OAuth 2.0 Protected Resource Metadata, MCP Streamable HTTP, Jest.

## Global Constraints

- Preserve Supabase Auth as the authorization server.
- Preserve the existing Vercel consent UI, OAuth grants, tokens, project authorization, and MCP protocol behavior.
- Preserve both the account-scoped MCP endpoint and legacy project-scoped endpoints.
- Keep `src/app/api/mcp/oauth-protected-resource/route.ts` publicly compatible.
- Do not add custom OAuth scopes.
- Keep `KECO_PUBLIC_URL` for document codec, reindex, and other Vercel-backed behavior; remove it only from protected-resource discovery.
- Never print or commit OAuth tokens, authorization codes, cookies, PKCE values, service-role credentials, or client secrets.
- Do not deploy production changes without explicit release authorization.

## File Map

- Create `supabase/functions/mcp/oauth-metadata.ts`: pure validation and URL/JSON construction for Edge-hosted protected-resource metadata.
- Create `supabase/functions/mcp/oauth-metadata.test.ts`: focused unit tests for exact paths, queries, resource URLs, metadata URLs, and invalid configuration.
- Modify `supabase/functions/mcp/http.ts`: serve the metadata route before authorization and point 401 challenges at Supabase.
- Modify `supabase/functions/mcp/http.test.ts`: prove route isolation, challenge URLs, error responses, CORS, caching, and unchanged MCP behavior.
- Modify `docs/mcp/README.md`: document the Supabase-hosted discovery URL and clarify the remaining purpose of `KECO_PUBLIC_URL`.
- Preserve `src/app/api/mcp/oauth-protected-resource/route.ts` and `tests/unit/mcp/oauth-metadata.test.ts`: compatibility implementation and coverage remain unchanged.

---

### Task 1: Add the Edge OAuth Metadata Contract

**Files:**
- Create: `supabase/functions/mcp/oauth-metadata.ts`
- Create: `supabase/functions/mcp/oauth-metadata.test.ts`

**Interfaces:**
- Produces: `InvalidMcpMetadataConfigError` and `InvalidMcpMetadataRequestError`.
- Produces: `isProtectedResourceMetadataPath(url: URL): boolean`.
- Produces: `parseProtectedResourceMetadataProjectId(url: URL): string | null`.
- Produces: `buildProtectedResourceMetadata(supabaseUrl: string | undefined, projectId?: string | null)`.
- Produces: `buildProtectedResourceMetadataUrl(supabaseUrl: string | undefined, projectId?: string | null): string`.
- Consumes: only standard `URL` and `URLSearchParams` APIs; no environment or network access.

- [ ] **Step 1: Write failing unit tests for valid metadata contracts**

Create `supabase/functions/mcp/oauth-metadata.test.ts` with these cases:

```ts
import { assertEquals, assertThrows } from "@std/assert";
import {
  buildProtectedResourceMetadata,
  buildProtectedResourceMetadataUrl,
  InvalidMcpMetadataConfigError,
  InvalidMcpMetadataRequestError,
  isProtectedResourceMetadataPath,
  parseProtectedResourceMetadataProjectId,
} from "./oauth-metadata.ts";

const projectId = "11111111-1111-4111-8111-111111111111";

Deno.test("recognizes exact direct and gateway metadata paths", () => {
  assertEquals(isProtectedResourceMetadataPath(
    new URL("https://abc.supabase.co/mcp/oauth-protected-resource"),
  ), true);
  assertEquals(isProtectedResourceMetadataPath(
    new URL("https://abc.supabase.co/functions/v1/mcp/oauth-protected-resource"),
  ), true);
  assertEquals(isProtectedResourceMetadataPath(
    new URL("https://abc.supabase.co/mcp/oauth-protected-resource/extra"),
  ), false);
  assertEquals(isProtectedResourceMetadataPath(
    new URL("https://user:pass@abc.supabase.co/mcp/oauth-protected-resource"),
  ), false);
  assertEquals(isProtectedResourceMetadataPath(
    new URL("https://abc.supabase.co/mcp/oauth-protected-resource#fragment"),
  ), false);
});

Deno.test("parses account and legacy project metadata requests", () => {
  assertEquals(parseProtectedResourceMetadataProjectId(
    new URL("https://abc.supabase.co/mcp/oauth-protected-resource"),
  ), null);
  assertEquals(parseProtectedResourceMetadataProjectId(new URL(
    `https://abc.supabase.co/mcp/oauth-protected-resource?project_id=${projectId}`,
  )), projectId);
});

Deno.test("builds account and project protected-resource metadata", () => {
  assertEquals(buildProtectedResourceMetadata("https://abc.supabase.co/"), {
    resource: "https://abc.supabase.co/functions/v1/mcp",
    authorization_servers: ["https://abc.supabase.co/auth/v1"],
    bearer_methods_supported: ["header"],
  });
  assertEquals(buildProtectedResourceMetadata("https://abc.supabase.co", projectId), {
    resource: `https://abc.supabase.co/functions/v1/mcp/${projectId}`,
    authorization_servers: ["https://abc.supabase.co/auth/v1"],
    bearer_methods_supported: ["header"],
  });
});

Deno.test("builds account and project metadata URLs on Supabase", () => {
  assertEquals(buildProtectedResourceMetadataUrl("https://abc.supabase.co"),
    "https://abc.supabase.co/functions/v1/mcp/oauth-protected-resource");
  assertEquals(buildProtectedResourceMetadataUrl("https://abc.supabase.co", projectId),
    `https://abc.supabase.co/functions/v1/mcp/oauth-protected-resource?project_id=${projectId}`);
});

Deno.test("rejects malformed metadata queries", () => {
  for (const url of [
    "https://abc.supabase.co/mcp/oauth-protected-resource?",
    "https://abc.supabase.co/mcp/oauth-protected-resource?unknown=1",
    `https://abc.supabase.co/mcp/oauth-protected-resource?project_id=${projectId}&project_id=${projectId}`,
    "https://abc.supabase.co/mcp/oauth-protected-resource?project_id=not-a-project",
  ]) {
    assertThrows(() => parseProtectedResourceMetadataProjectId(new URL(url)),
      InvalidMcpMetadataRequestError);
  }
});

Deno.test("rejects malformed Supabase origins and project IDs", () => {
  for (const value of [undefined, "", "not-a-url", "ftp://abc.supabase.co",
    "https://abc.supabase.co/path", "https://abc.supabase.co?query=1",
    "https://user:pass@abc.supabase.co"]) {
    assertThrows(() => buildProtectedResourceMetadata(value),
      InvalidMcpMetadataConfigError);
  }
  assertThrows(
    () => buildProtectedResourceMetadata("https://abc.supabase.co", "not-a-project"),
    InvalidMcpMetadataRequestError,
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the module is missing**

Run:

```bash
deno test --config supabase/functions/mcp/deno.json \
  supabase/functions/mcp/oauth-metadata.test.ts
```

Expected: FAIL with an import error for `./oauth-metadata.ts`.

- [ ] **Step 3: Implement the minimal metadata module**

Create `supabase/functions/mcp/oauth-metadata.ts`:

```ts
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METADATA_PATH = /^(?:\/functions\/v1)?\/mcp\/oauth-protected-resource$/;

export class InvalidMcpMetadataConfigError extends Error {
  constructor() {
    super("Invalid MCP metadata configuration.");
    this.name = "InvalidMcpMetadataConfigError";
  }
}

export class InvalidMcpMetadataRequestError extends Error {
  constructor() {
    super("Invalid MCP metadata request.");
    this.name = "InvalidMcpMetadataRequestError";
  }
}

function normalizeSupabaseOrigin(value: string | undefined): string {
  if (!value || value.trim() !== value) throw new InvalidMcpMetadataConfigError();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidMcpMetadataConfigError();
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username || parsed.password ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search || parsed.hash
  ) throw new InvalidMcpMetadataConfigError();
  return parsed.origin;
}

function validateProjectId(projectId: string | null | undefined): string | null {
  if (projectId === null || projectId === undefined) return null;
  if (!UUID.test(projectId)) throw new InvalidMcpMetadataRequestError();
  return projectId;
}

export function isProtectedResourceMetadataPath(url: URL): boolean {
  return !url.username && !url.password && !url.hash && METADATA_PATH.test(url.pathname);
}

export function parseProtectedResourceMetadataProjectId(url: URL): string | null {
  if (!isProtectedResourceMetadataPath(url)) throw new InvalidMcpMetadataRequestError();
  const entries = [...url.searchParams.entries()];
  if (entries.length === 0) {
    if (url.href.includes("?")) throw new InvalidMcpMetadataRequestError();
    return null;
  }
  if (entries.length !== 1 || entries[0][0] !== "project_id") {
    throw new InvalidMcpMetadataRequestError();
  }
  return validateProjectId(entries[0][1]);
}

export function buildProtectedResourceMetadata(
  supabaseUrl: string | undefined,
  projectId?: string | null,
) {
  const origin = normalizeSupabaseOrigin(supabaseUrl);
  const validProjectId = validateProjectId(projectId);
  const resource = validProjectId
    ? `${origin}/functions/v1/mcp/${validProjectId}`
    : `${origin}/functions/v1/mcp`;
  return {
    resource,
    authorization_servers: [`${origin}/auth/v1`],
    bearer_methods_supported: ["header"],
  } as const;
}

export function buildProtectedResourceMetadataUrl(
  supabaseUrl: string | undefined,
  projectId?: string | null,
): string {
  const origin = normalizeSupabaseOrigin(supabaseUrl);
  const validProjectId = validateProjectId(projectId);
  const base = `${origin}/functions/v1/mcp/oauth-protected-resource`;
  return validProjectId
    ? `${base}?project_id=${encodeURIComponent(validProjectId)}`
    : base;
}
```

- [ ] **Step 4: Run focused tests and type checking**

Run:

```bash
deno test --config supabase/functions/mcp/deno.json \
  supabase/functions/mcp/oauth-metadata.test.ts
npm run check:mcp
```

Expected: all metadata tests PASS and `deno check` exits 0.

- [ ] **Step 5: Commit the metadata contract**

```bash
git add supabase/functions/mcp/oauth-metadata.ts \
  supabase/functions/mcp/oauth-metadata.test.ts
git commit -m "feat: add Supabase MCP OAuth metadata contract"
```

---

### Task 2: Serve Metadata and Change OAuth Challenges

**Files:**
- Modify: `supabase/functions/mcp/http.ts:1-294`
- Modify: `supabase/functions/mcp/http.test.ts:1-490`

**Interfaces:**
- Consumes: all exports from `supabase/functions/mcp/oauth-metadata.ts` created in Task 1.
- Changes: `McpHttpDependencies` replaces `kecoPublicUrl?: string` with `supabaseUrl?: string`.
- Preserves: `handleMcpHttpRequest(request, deps): Promise<Response>` and existing MCP endpoint classification.

- [ ] **Step 1: Write failing metadata route tests**

Add these tests to `supabase/functions/mcp/http.test.ts`:

```ts
Deno.test("serves account OAuth metadata before authorization", async () => {
  let authorizationCalls = 0;
  let protocolCalls = 0;
  const response = await handleMcpHttpRequest(
    new Request("https://x/functions/v1/mcp/oauth-protected-resource"),
    {
      supabaseUrl: "https://abc.supabase.co",
      authorizeAccount: async () => {
        authorizationCalls += 1;
        return accountUnauthenticated();
      },
      handleProtocol: async () => {
        protocolCalls += 1;
        return Response.json({});
      },
    },
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("cache-control"), "public, max-age=300");
  assertEquals(response.headers.get("access-control-allow-origin"), "*");
  assertEquals(await response.json(), {
    resource: "https://abc.supabase.co/functions/v1/mcp",
    authorization_servers: ["https://abc.supabase.co/auth/v1"],
    bearer_methods_supported: ["header"],
  });
  assertEquals(authorizationCalls, 0);
  assertEquals(protocolCalls, 0);
});

Deno.test("serves legacy project OAuth metadata from the direct Edge path", async () => {
  const response = await handleMcpHttpRequest(
    new Request(`https://x/mcp/oauth-protected-resource?project_id=${projectId}`),
    { supabaseUrl: "https://abc.supabase.co" },
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    resource: `https://abc.supabase.co/functions/v1/mcp/${projectId}`,
    authorization_servers: ["https://abc.supabase.co/auth/v1"],
    bearer_methods_supported: ["header"],
  });
});

Deno.test("rejects malformed OAuth metadata requests without authorization", async () => {
  for (const url of [
    "https://x/mcp/oauth-protected-resource?unknown=1",
    "https://x/mcp/oauth-protected-resource?project_id=not-a-project",
    `https://x/mcp/oauth-protected-resource?project_id=${projectId}&project_id=${projectId}`,
  ]) {
    const response = await handleMcpHttpRequest(new Request(url), {
      supabaseUrl: "https://abc.supabase.co",
    });
    assertEquals(response.status, 400);
    assertEquals(await response.json(), { error: "Invalid MCP metadata request." });
  }
});

Deno.test("fails closed when metadata configuration is invalid", async () => {
  const response = await handleMcpHttpRequest(
    new Request("https://x/mcp/oauth-protected-resource"),
    { supabaseUrl: "https://abc.supabase.co/path" },
  );
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "MCP metadata is not configured." });
});

Deno.test("rejects metadata-like paths and methods as MCP endpoints", async () => {
  for (const request of [
    new Request("https://x/mcp/oauth-protected-resource/extra"),
    new Request("https://x/mcp/oauth-protected-resource", { method: "POST" }),
  ]) {
    const response = await handleMcpHttpRequest(request, {
      supabaseUrl: "https://abc.supabase.co",
    });
    assertEquals(response.status, 404);
    assertEquals(await response.json(), { error: "Invalid MCP project endpoint." });
  }
});
```

- [ ] **Step 2: Change existing challenge expectations to Supabase URLs**

In account and project unauthenticated tests, inject:

```ts
supabaseUrl: "https://abc.supabase.co"
```

Assert these exact challenge values:

```text
Bearer resource_metadata="https://abc.supabase.co/functions/v1/mcp/oauth-protected-resource"
Bearer resource_metadata="https://abc.supabase.co/functions/v1/mcp/oauth-protected-resource?project_id=11111111-1111-4111-8111-111111111111"
```

Rename the invalid-configuration loop variable to `supabaseUrl` and cover `""`, `"/relative"`, and `"https://abc.supabase.co/path"`. Remove `kecoPublicUrl` from authorized, forbidden, OPTIONS, bounded-response, and other tests that do not need metadata configuration.

- [ ] **Step 3: Run the HTTP tests and verify the new cases fail**

Run:

```bash
deno test --config supabase/functions/mcp/deno.json \
  --allow-env --allow-net supabase/functions/mcp/http.test.ts
```

Expected: FAIL because the metadata path currently returns 404 and challenges still use `KECO_PUBLIC_URL`.

- [ ] **Step 4: Import metadata helpers and update dependencies**

At the top of `supabase/functions/mcp/http.ts`, add:

```ts
import {
  buildProtectedResourceMetadata,
  buildProtectedResourceMetadataUrl,
  InvalidMcpMetadataConfigError,
  InvalidMcpMetadataRequestError,
  isProtectedResourceMetadataPath,
  parseProtectedResourceMetadataProjectId,
} from "./oauth-metadata.ts";
```

Change the dependency field to `supabaseUrl?: string;` and delete the local `normalizePublicOrigin` function.

- [ ] **Step 5: Serve exact metadata GET requests before authorization**

Immediately after the `OPTIONS` branch, parse the URL and add:

```ts
const url = new URL(request.url);
if (request.method === "GET" && isProtectedResourceMetadataPath(url)) {
  try {
    const projectId = parseProtectedResourceMetadataProjectId(url);
    const metadata = buildProtectedResourceMetadata(
      deps.supabaseUrl ?? Deno.env.get("SUPABASE_URL"),
      projectId,
    );
    return withCors(Response.json(metadata, {
      headers: { "cache-control": "public, max-age=300" },
    }));
  } catch (error) {
    if (error instanceof InvalidMcpMetadataRequestError) {
      return withCors(Response.json({ error: "Invalid MCP metadata request." }, {
        status: 400,
      }));
    }
    if (error instanceof InvalidMcpMetadataConfigError) {
      return withCors(Response.json({ error: "MCP metadata is not configured." }, {
        status: 500,
      }));
    }
    return withCors(Response.json({ error: "MCP metadata is unavailable." }, {
      status: 500,
    }));
  }
}
const endpoint = extractMcpEndpoint(url);
```

Remove the old second `new URL(request.url)` call. Requests using another method or a trailing metadata path segment continue through strict endpoint classification and return 404.

- [ ] **Step 6: Build 401 challenges from `SUPABASE_URL`**

Replace the `KECO_PUBLIC_URL` block with:

```ts
if (authorization.status === "unauthenticated") {
  let metadata: string;
  try {
    metadata = buildProtectedResourceMetadataUrl(
      deps.supabaseUrl ?? Deno.env.get("SUPABASE_URL"),
      endpoint.mode === "project" ? endpoint.projectId : null,
    );
  } catch {
    return withCors(Response.json({ error: "MCP authentication is unavailable." }, {
      status: 500,
    }));
  }
  return withCors(Response.json({ error: "Authentication required." }, {
    status: 401,
    headers: { "www-authenticate": `Bearer resource_metadata="${metadata}"` },
  }));
}
```

Do not change operational-error, forbidden, authorized-context, protocol, response-limit, or CORS behavior.

- [ ] **Step 7: Run focused tests and MCP checks**

Run:

```bash
deno test --config supabase/functions/mcp/deno.json \
  --allow-env --allow-net \
  supabase/functions/mcp/oauth-metadata.test.ts \
  supabase/functions/mcp/http.test.ts
npm run check:mcp
```

Expected: all focused tests PASS and `deno check` exits 0.

- [ ] **Step 8: Commit the HTTP integration**

```bash
git add supabase/functions/mcp/http.ts supabase/functions/mcp/http.test.ts
git commit -m "fix: host MCP OAuth metadata on Supabase"
```

---

### Task 3: Document and Verify the Complete Change

**Files:**
- Modify: `docs/mcp/README.md:26-39`
- Modify: `docs/mcp/README.md:65-72`
- Verify unchanged: `src/app/api/mcp/oauth-protected-resource/route.ts`
- Verify unchanged: `tests/unit/mcp/oauth-metadata.test.ts`

**Interfaces:**
- Consumes: the public metadata and challenge URLs implemented in Task 2.
- Produces: operator-facing setup and configuration documentation.

- [ ] **Step 1: Document the new discovery path**

After the first Client Setup paragraph, add:

```markdown
The MCP challenge advertises protected-resource metadata on the same Supabase
origin at `/functions/v1/mcp/oauth-protected-resource`. OAuth discovery therefore
does not require the MCP client process to reach the Keco Vercel application.
The browser authorization and consent flow may still use the deployed Keco web
origin.
```

In Server Configuration, retain `KECO_PUBLIC_URL` and clarify:

```markdown
`KECO_PUBLIC_URL` is the deployed Keco web origin used by the consent UI, document
codec, reindex integration, and other web-backed operations; protected-resource
metadata is served by the Supabase MCP Function itself.
```

- [ ] **Step 2: Run focused compatibility checks**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/mcp/oauth-metadata.test.ts \
  tests/unit/mcp/oauth-probe.test.ts
npm run check:mcp
npm run test:mcp -- supabase/functions/mcp/oauth-metadata.test.ts \
  supabase/functions/mcp/http.test.ts
```

Expected: existing Vercel metadata and OAuth probe tests remain green, and all Edge metadata tests PASS.

- [ ] **Step 3: Run full local regression checks**

Run:

```bash
npm run typecheck
npm run typecheck:api
npm run test:mcp
npm run test:unit -- --runInBand tests/unit/mcp
```

Expected: all commands exit 0. If an unrelated pre-existing test fails, record the exact command and failure without modifying unrelated user work.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git diff --check HEAD~2..HEAD
git diff --stat HEAD~2..HEAD
git status --short
```

Confirm that no credentials appear, the Vercel route is unchanged, `KECO_PUBLIC_URL` remains used by codec/reindex code, ordinary MCP behavior is unchanged, and unrelated dirty-worktree changes remain untouched.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/mcp/README.md
git commit -m "docs: describe Supabase-hosted MCP OAuth discovery"
```

- [ ] **Step 6: Perform production acceptance only after release authorization**

After an authorized deployment of the `mcp` Edge Function with `--no-verify-jwt`, run read-only discovery checks:

```bash
MCP_URL='https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp'
METADATA_URL='https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp/oauth-protected-resource'
curl -sS -D /tmp/keco-mcp-headers -o /tmp/keco-mcp-body "$MCP_URL"
curl -sS -D /tmp/keco-metadata-headers -o /tmp/keco-metadata-body "$METADATA_URL"
```

Verify the MCP response is `401`, its `WWW-Authenticate` header contains the exact `METADATA_URL`, and the metadata response is `200` with the account MCP resource and `https://lulrcirmwwvvnupmwqcq.supabase.co/auth/v1` authorization server. Do not print credential-bearing headers.

Then run:

```bash
codex mcp login keco-account
```

Expected: the affected VM advances past OAuth discovery instead of returning `No authorization support detected`. Complete browser authorization, start a fresh Codex session, and verify `list_projects` succeeds. Repeat the login check on Windows to confirm compatibility.
