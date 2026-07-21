# Supabase MCP Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver and validate a minimal authenticated MCP endpoint in a Supabase Edge Function, including OAuth consent/discovery probes that prove whether Codex and Claude can preserve Keco's one-connection/one-project authorization boundary.

**Architecture:** A stateless Supabase Edge Function uses the MCP SDK's Web Standard Streamable HTTP transport and accepts a project ID in `/functions/v1/mcp/{projectId}`. Keco's Next.js application hosts the OAuth protected-resource metadata document and consent UI, while Supabase Auth remains the authorization server. Phase 1 exposes one read-only probe tool and stops before business tools; its release gate records whether OAuth resource binding and stable client identity are actually available.

**Tech Stack:** Supabase Edge Functions (Deno 2), `@modelcontextprotocol/sdk` 1.29.0, `@supabase/supabase-js` 2.87.1, Deno test, Jest 30, Next.js 16, Supabase CLI 2.90.0

## Global Constraints

- The MCP execution endpoint remains in Supabase Edge Functions; Next.js may host OAuth metadata and consent UI only.
- Use stateless Streamable HTTP with `WebStandardStreamableHTTPServerTransport`; do not use Express, Node HTTP, legacy HTTP+SSE, or in-memory session affinity.
- Bind the requested project through `/functions/v1/mcp/{projectId}` and recheck current project membership on every protected request.
- Do not expose business read/write tools until Phase 1 passes with both Codex and Claude.
- Do not use `service_role` for an MCP request or to validate project access.
- Access tokens, authorization codes, PKCE verifiers, full JWT payload values, and user document content must never enter logs or probe artifacts.
- Incoming request bodies are limited to 256 KiB; protocol responses are JSON and must remain below 1 MiB.
- Warm `initialize` and static capability calls target P95 below 300 ms; cold requests target P95 below 2 seconds.
- Keep all tracked source, tests, documentation, and UI copy in ASCII English to satisfy the repository's CI character gate.
- Any hosted Supabase config change or Edge deployment requires explicit user approval at execution time.

---

## File Map

### Edge Function

- `supabase/functions/mcp/deno.json`: pinned Deno import map and strict compiler settings.
- `supabase/functions/mcp/server.ts`: MCP server factory and protocol request handler.
- `supabase/functions/mcp/server.test.ts`: in-process MCP lifecycle and tool-list tests.
- `supabase/functions/mcp/auth.ts`: Bearer validation and current project-role lookup using the caller JWT.
- `supabase/functions/mcp/auth.test.ts`: authentication decision tests with injected Supabase adapters.
- `supabase/functions/mcp/http.ts`: path, method, size, CORS, challenge, and MCP transport routing.
- `supabase/functions/mcp/http.test.ts`: Web `Request`/`Response` tests for the Edge HTTP boundary.
- `supabase/functions/mcp/index.ts`: minimal `Deno.serve` entry point.

### Keco OAuth Surface

- `src/lib/mcp/oauthMetadata.ts`: protected-resource metadata and project-resource URL builders.
- `src/app/api/mcp/oauth-protected-resource/route.ts`: public OAuth resource metadata endpoint.
- `src/lib/mcp/oauthProjectBinding.ts`: strict extraction of project binding from an OAuth `resource` value.
- `src/app/oauth/consent/page.tsx`: OAuth consent page entry.
- `src/components/mcp/OAuthConsentClient.tsx`: loads Supabase authorization details and approves/denies consent.
- `src/components/mcp/OAuthConsent.module.css`: consent-page presentation.
- `tests/unit/mcp/oauth-metadata.test.ts`: metadata contract tests.
- `tests/unit/mcp/oauth-project-binding.test.ts`: resource-to-project binding tests.
- `tests/unit/mcp/oauth-consent-wiring.test.ts`: static consent API and blocked-approval wiring checks.

### Probe, CI, and Evidence

- `scripts/probe-mcp-oauth.ts`: checks the unauthenticated challenge, resource metadata, authorization metadata, and dynamic registration without printing secrets.
- `tests/unit/mcp/oauth-probe.test.ts`: parser and redaction tests for the probe.
- `docs/mcp/phase-1-compatibility.json`: machine-written, non-secret probe evidence.
- `docs/mcp/phase-1-client-matrix.md`: exact Codex and Claude manual compatibility results.
- `package.json` / `package-lock.json`: pinned Deno runner and MCP commands.
- `.github/workflows/ci.yml`: Deno check/test gates.
- `.github/workflows/README.md`: local and CI MCP verification commands.
- `tests/unit/ci-workflow.test.ts`: static assertions that CI cannot omit the MCP gates.

---

### Task 1: Pin the Edge Test Toolchain

**Files:**
- Create: `supabase/functions/mcp/deno.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/unit/ci-workflow.test.ts`

**Interfaces:**
- Produces: `npm run check:mcp` and `npm run test:mcp` commands used by every later task and CI.
- Produces: import aliases `@mcp/`, `@supabase/supabase-js`, and `@std/assert` for the Edge Function.

- [ ] **Step 1: Write the failing package-script assertions**

Add this test to `tests/unit/ci-workflow.test.ts`:

```ts
it('pins the Deno MCP verification commands', () => {
  expect(pkg.scripts['check:mcp']).toBe(
    'deno check --config supabase/functions/mcp/deno.json supabase/functions/mcp/index.ts'
  );
  expect(pkg.scripts['test:mcp']).toBe(
    'deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/mcp'
  );
});
```

- [ ] **Step 2: Run the assertion and verify it fails**

Run:

```bash
npx jest tests/unit/ci-workflow.test.ts -t 'pins the Deno MCP verification commands'
```

Expected: FAIL because `check:mcp` and `test:mcp` are undefined.

- [ ] **Step 3: Install the pinned Deno runner and add scripts**

Run:

```bash
npm install --save-dev deno@2.9.3
```

Add these scripts to `package.json`:

```json
{
  "check:mcp": "deno check --config supabase/functions/mcp/deno.json supabase/functions/mcp/index.ts",
  "test:mcp": "deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/mcp"
}
```

Do not add them to `validate` until Task 7; `index.ts` does not exist yet.

- [ ] **Step 4: Create the pinned Deno import map**

Create `supabase/functions/mcp/deno.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "lib": ["deno.window"]
  },
  "imports": {
    "@mcp/": "npm:@modelcontextprotocol/sdk@1.29.0/",
    "@std/assert": "jsr:@std/assert@1.0.14",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2.87.1"
  }
}
```

- [ ] **Step 5: Run the focused Jest test**

Run:

```bash
npx jest tests/unit/ci-workflow.test.ts -t 'pins the Deno MCP verification commands'
```

Expected: PASS.

- [ ] **Step 6: Commit the toolchain**

```bash
git add package.json package-lock.json supabase/functions/mcp/deno.json tests/unit/ci-workflow.test.ts
git commit -m "build: add mcp edge test toolchain"
```

### Task 2: Build the Stateless MCP Protocol Probe

**Files:**
- Create: `supabase/functions/mcp/server.test.ts`
- Create: `supabase/functions/mcp/server.ts`

**Interfaces:**
- Produces: `createProbeServer(): McpServer`.
- Produces: `handleProtocolRequest(request: Request): Promise<Response>`.
- The only Phase 1 tool is `keco_connection_probe`; it performs no database access.

- [ ] **Step 1: Write failing lifecycle and tool discovery tests**

Create `supabase/functions/mcp/server.test.ts`:

```ts
import { assertEquals } from '@std/assert';
import { LATEST_PROTOCOL_VERSION } from '@mcp/types.js';
import { handleProtocolRequest } from './server.ts';

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const response = await handleProtocolRequest(new Request('http://localhost/mcp/project', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }));
  assertEquals(response.status, 200);
  return await response.json() as {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
}

Deno.test('initialize declares only the tools capability', async () => {
  const message = await rpc('initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'phase-1-test', version: '1.0.0' },
  });
  assertEquals(message.error, undefined);
  assertEquals(message.result?.protocolVersion, LATEST_PROTOCOL_VERSION);
  assertEquals(message.result?.serverInfo, { name: 'keco-mcp', version: '0.3.1' });
  assertEquals(message.result?.capabilities, { tools: { listChanged: true } });
});

Deno.test('tools/list exposes one read-only connection probe', async () => {
  const message = await rpc('tools/list');
  assertEquals(message.error, undefined);
  assertEquals(message.result?.tools, [{
    name: 'keco_connection_probe',
    description: 'Verify that the authenticated Keco MCP connection is operational.',
    inputSchema: { type: 'object', properties: {} },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }]);
});

Deno.test('ping returns an empty result', async () => {
  const message = await rpc('ping');
  assertEquals(message.error, undefined);
  assertEquals(message.result, {});
});

Deno.test('tools/call returns a bounded static result', async () => {
  const message = await rpc('tools/call', {
    name: 'keco_connection_probe',
    arguments: {},
  });
  assertEquals(message.error, undefined);
  assertEquals(message.result, {
    content: [{ type: 'text', text: 'Keco MCP connection is operational.' }],
    structuredContent: { ok: true, phase: 1 },
  });
});
```

- [ ] **Step 2: Run the Deno test and verify it fails**

Run:

```bash
npm run test:mcp -- --filter 'initialize|ping|tools/list|tools/call'
```

Expected: FAIL because `server.ts` does not exist.

- [ ] **Step 3: Implement the MCP server factory and Web Standard transport**

Create `supabase/functions/mcp/server.ts`:

```ts
import { McpServer } from '@mcp/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@mcp/server/webStandardStreamableHttp.js';

export function createProbeServer(): McpServer {
  const server = new McpServer(
    { name: 'keco-mcp', version: '0.3.1' },
    { capabilities: { tools: { listChanged: false } } },
  );

  server.registerTool('keco_connection_probe', {
    description: 'Verify that the authenticated Keco MCP connection is operational.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async () => ({
    content: [{ type: 'text' as const, text: 'Keco MCP connection is operational.' }],
    structuredContent: { ok: true, phase: 1 },
  }));

  return server;
}

export async function handleProtocolRequest(request: Request): Promise<Response> {
  const server = createProbeServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return await transport.handleRequest(request);
}
```

- [ ] **Step 4: Run protocol tests and type checking**

Run:

```bash
npm run test:mcp -- --filter 'initialize|ping|tools/list|tools/call'
npx deno check --config supabase/functions/mcp/deno.json supabase/functions/mcp/server.ts
```

Expected: all three tests PASS and `deno check` exits 0.

- [ ] **Step 5: Commit the protocol probe**

```bash
git add supabase/functions/mcp/server.ts supabase/functions/mcp/server.test.ts
git commit -m "feat: add stateless mcp protocol probe"
```

### Task 3: Add the Authenticated Edge HTTP Boundary

**Files:**
- Create: `supabase/functions/mcp/auth.test.ts`
- Create: `supabase/functions/mcp/auth.ts`
- Create: `supabase/functions/mcp/http.test.ts`
- Create: `supabase/functions/mcp/http.ts`
- Create: `supabase/functions/mcp/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Produces: `extractBoundProjectId(url: URL): string | null`.
- Produces: `authorizeProject(request, projectId): Promise<ProjectAuthContext | null>`.
- Produces: `handleMcpHttpRequest(request, dependencies): Promise<Response>`.
- Consumes: `handleProtocolRequest(request)` from Task 2.

- [ ] **Step 1: Write failing path, auth, size, and CORS tests**

Create `supabase/functions/mcp/http.test.ts` with these cases:

```ts
import { assertEquals, assertStringIncludes } from '@std/assert';
import { extractBoundProjectId, handleMcpHttpRequest } from './http.ts';

const projectId = '11111111-1111-4111-8111-111111111111';
const allow = async () => ({ userId: 'user-1', projectId, role: 'editor' as const });
const deny = async () => null;

Deno.test('extractBoundProjectId accepts only a UUID after the mcp segment', () => {
  assertEquals(extractBoundProjectId(new URL(`https://x/functions/v1/mcp/${projectId}`)), projectId);
  assertEquals(extractBoundProjectId(new URL('https://x/functions/v1/mcp/not-a-uuid')), null);
  assertEquals(extractBoundProjectId(new URL(`https://x/functions/v1/mcp/${projectId}/extra`)), null);
});

Deno.test('missing auth returns an OAuth resource metadata challenge', async () => {
  const response = await handleMcpHttpRequest(
    new Request(`https://x/functions/v1/mcp/${projectId}`, { method: 'POST' }),
    { authorize: deny, kecoPublicUrl: 'https://keco.example.com' },
  );
  assertEquals(response.status, 401);
  assertStringIncludes(
    response.headers.get('www-authenticate') ?? '',
    `resource_metadata="https://keco.example.com/api/mcp/oauth-protected-resource?project_id=${projectId}"`,
  );
});

Deno.test('oversized request is rejected before MCP parsing', async () => {
  const response = await handleMcpHttpRequest(new Request(
    `https://x/functions/v1/mcp/${projectId}`,
    {
      method: 'POST',
      headers: { authorization: 'Bearer valid', 'content-length': '262145' },
      body: 'x',
    },
  ), { authorize: allow, kecoPublicUrl: 'https://keco.example.com' });
  assertEquals(response.status, 413);
});

Deno.test('OPTIONS returns bounded CORS headers without authentication', async () => {
  const response = await handleMcpHttpRequest(
    new Request(`https://x/functions/v1/mcp/${projectId}`, { method: 'OPTIONS' }),
    { authorize: deny, kecoPublicUrl: 'https://keco.example.com' },
  );
  assertEquals(response.status, 204);
  assertEquals(response.headers.get('access-control-allow-methods'), 'GET, POST, DELETE, OPTIONS');
  assertStringIncludes(response.headers.get('access-control-allow-headers') ?? '', 'MCP-Protocol-Version');
});
```

Create `supabase/functions/mcp/auth.test.ts` with an injected gateway rather than live Supabase:

```ts
import { assertEquals } from '@std/assert';
import { authorizeProjectWithGateway } from './auth.ts';

const projectId = '11111111-1111-4111-8111-111111111111';

Deno.test('authorization rejects missing bearer tokens', async () => {
  const context = await authorizeProjectWithGateway(
    new Request('https://x'),
    projectId,
    { getUser: async () => null, getRole: async () => null },
  );
  assertEquals(context, null);
});

Deno.test('authorization returns current role for a valid project member', async () => {
  const context = await authorizeProjectWithGateway(
    new Request('https://x', { headers: { authorization: 'Bearer token' } }),
    projectId,
    {
      getUser: async (token) => token === 'token' ? { id: 'user-1' } : null,
      getRole: async () => 'viewer',
    },
  );
  assertEquals(context, { userId: 'user-1', projectId, role: 'viewer' });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm run test:mcp -- --filter 'extractBoundProjectId|missing auth|oversized|OPTIONS|authorization'
```

Expected: FAIL because `auth.ts` and `http.ts` do not exist.

- [ ] **Step 3: Implement authentication without `service_role`**

Create `supabase/functions/mcp/auth.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

export type ProjectRole = 'admin' | 'editor' | 'viewer';
export type ProjectAuthContext = { userId: string; projectId: string; role: ProjectRole };

export interface AuthGateway {
  getUser(token: string): Promise<{ id: string } | null>;
  getRole(userId: string, projectId: string, token: string): Promise<ProjectRole | null>;
}

export async function authorizeProjectWithGateway(
  request: Request,
  projectId: string,
  gateway: AuthGateway,
): Promise<ProjectAuthContext | null> {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) return null;
  const token = match[1];
  const user = await gateway.getUser(token);
  if (!user) return null;
  const role = await gateway.getRole(user.id, projectId, token);
  return role ? { userId: user.id, projectId, role } : null;
}

function supabaseGateway(): AuthGateway {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) throw new Error('Supabase MCP auth environment is incomplete.');
  return {
    async getUser(token) {
      const client = createClient(url, anonKey, { auth: { persistSession: false } });
      const { data, error } = await client.auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },
    async getRole(userId, projectId, token) {
      const client = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      });
      const { data: project } = await client.from('projects').select('owner_id').eq('id', projectId).maybeSingle();
      if (project?.owner_id === userId) return 'admin';
      const { data } = await client.from('project_collaborators')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .not('accepted_at', 'is', null)
        .maybeSingle();
      return data?.role === 'admin' || data?.role === 'editor' || data?.role === 'viewer'
        ? data.role
        : null;
    },
  };
}

export function authorizeProject(request: Request, projectId: string) {
  return authorizeProjectWithGateway(request, projectId, supabaseGateway());
}
```

- [ ] **Step 4: Implement the HTTP adapter and Edge entry point**

Create `supabase/functions/mcp/http.ts`:

```ts
import { authorizeProject, type ProjectAuthContext } from './auth.ts';
import { handleProtocolRequest } from './server.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BYTES = 256 * 1024;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID',
  'access-control-expose-headers': 'MCP-Protocol-Version, MCP-Session-Id, WWW-Authenticate',
};

export function extractBoundProjectId(url: URL): string | null {
  const parts = url.pathname.split('/').filter(Boolean);
  const index = parts.lastIndexOf('mcp');
  if (index < 0 || index !== parts.length - 2) return null;
  return UUID.test(parts[index + 1]) ? parts[index + 1] : null;
}

type Dependencies = {
  authorize?: (request: Request, projectId: string) => Promise<ProjectAuthContext | null>;
  kecoPublicUrl?: string;
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  Object.entries(CORS).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function handleMcpHttpRequest(request: Request, deps: Dependencies = {}): Promise<Response> {
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
  const projectId = extractBoundProjectId(new URL(request.url));
  if (!projectId) return withCors(Response.json({ error: 'Invalid MCP project endpoint.' }, { status: 404 }));
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_REQUEST_BYTES) {
    return withCors(Response.json({ error: 'MCP request exceeds 256 KiB.' }, { status: 413 }));
  }
  const authorize = deps.authorize ?? authorizeProject;
  const context = await authorize(request, projectId);
  if (!context) {
    const kecoPublicUrl = (deps.kecoPublicUrl ?? Deno.env.get('KECO_PUBLIC_URL') ?? '').replace(/\/$/, '');
    const metadata = `${kecoPublicUrl}/api/mcp/oauth-protected-resource?project_id=${projectId}`;
    return withCors(Response.json({ error: 'Authentication required.' }, {
      status: 401,
      headers: { 'www-authenticate': `Bearer resource_metadata="${metadata}"` },
    }));
  }
  return withCors(await handleProtocolRequest(request));
}
```

Create `supabase/functions/mcp/index.ts`:

```ts
import { handleMcpHttpRequest } from './http.ts';

Deno.serve((request) => handleMcpHttpRequest(request));
```

In `supabase/config.toml`, add:

```toml
[functions.mcp]
verify_jwt = false
```

Gateway JWT verification is disabled only because the function must emit the MCP OAuth challenge itself. `authorizeProject` still authenticates every non-OPTIONS request.

- [ ] **Step 5: Run all Edge tests and checks**

Run:

```bash
npm run test:mcp
npm run check:mcp
```

Expected: all Deno tests PASS and `deno check` exits 0.

- [ ] **Step 6: Commit the authenticated Edge boundary**

```bash
git add supabase/config.toml supabase/functions/mcp/auth.ts supabase/functions/mcp/auth.test.ts supabase/functions/mcp/http.ts supabase/functions/mcp/http.test.ts supabase/functions/mcp/index.ts
git commit -m "feat: add authenticated mcp edge endpoint"
```

### Task 4: Publish OAuth Protected-Resource Metadata

**Files:**
- Create: `tests/unit/mcp/oauth-metadata.test.ts`
- Create: `src/lib/mcp/oauthMetadata.ts`
- Create: `src/app/api/mcp/oauth-protected-resource/route.ts`

**Interfaces:**
- Produces: `buildProjectResourceUrl(supabaseUrl, projectId): string`.
- Produces: `buildProtectedResourceMetadata(input): ProtectedResourceMetadata`.
- The public route accepts only `project_id` and returns `Cache-Control: public, max-age=300`.

- [ ] **Step 1: Write failing metadata tests**

Create `tests/unit/mcp/oauth-metadata.test.ts`:

```ts
import { buildProjectResourceUrl, buildProtectedResourceMetadata } from '@/lib/mcp/oauthMetadata';

const projectId = '11111111-1111-4111-8111-111111111111';

it('builds project-bound resource metadata for Supabase Auth', () => {
  const resource = buildProjectResourceUrl('https://abc.supabase.co/', projectId);
  expect(resource).toBe(`https://abc.supabase.co/functions/v1/mcp/${projectId}`);
  expect(buildProtectedResourceMetadata({
    resource,
    authorizationServer: 'https://abc.supabase.co/auth/v1',
  })).toEqual({
    resource,
    authorization_servers: ['https://abc.supabase.co/auth/v1'],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write'],
  });
});

it('rejects malformed project IDs', () => {
  expect(() => buildProjectResourceUrl('https://abc.supabase.co', '../other')).toThrow(
    'Invalid MCP project ID.'
  );
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npx jest tests/unit/mcp/oauth-metadata.test.ts
```

Expected: FAIL because `oauthMetadata.ts` does not exist.

- [ ] **Step 3: Implement metadata builders and the public route**

Create `src/lib/mcp/oauthMetadata.ts`:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildProjectResourceUrl(supabaseUrl: string, projectId: string): string {
  if (!UUID.test(projectId)) throw new Error('Invalid MCP project ID.');
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/mcp/${projectId}`;
}

export function buildProtectedResourceMetadata(input: {
  resource: string;
  authorizationServer: string;
}) {
  return {
    resource: input.resource,
    authorization_servers: [input.authorizationServer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write'],
  } as const;
}
```

Create `src/app/api/mcp/oauth-protected-resource/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { buildProjectResourceUrl, buildProtectedResourceMetadata } from '@/lib/mcp/oauthMetadata';

export function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get('project_id') ?? '';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  try {
    const resource = buildProjectResourceUrl(supabaseUrl, projectId);
    return NextResponse.json(buildProtectedResourceMetadata({
      resource,
      authorizationServer: `${supabaseUrl.replace(/\/$/, '')}/auth/v1`,
    }), { headers: { 'cache-control': 'public, max-age=300' } });
  } catch {
    return NextResponse.json({ error: 'Invalid MCP project metadata request.' }, { status: 400 });
  }
}
```

- [ ] **Step 4: Run unit and API type checks**

```bash
npx jest tests/unit/mcp/oauth-metadata.test.ts
npm run typecheck:api
```

Expected: PASS and typecheck exits 0.

- [ ] **Step 5: Commit metadata support**

```bash
git add src/lib/mcp/oauthMetadata.ts src/app/api/mcp/oauth-protected-resource/route.ts tests/unit/mcp/oauth-metadata.test.ts
git commit -m "feat: publish mcp oauth resource metadata"
```

### Task 5: Add a Project-Binding-Aware OAuth Consent Page

**Files:**
- Create: `tests/unit/mcp/oauth-project-binding.test.ts`
- Create: `tests/unit/mcp/oauth-consent-wiring.test.ts`
- Create: `src/lib/mcp/oauthProjectBinding.ts`
- Create: `src/app/oauth/consent/page.tsx`
- Create: `src/components/mcp/OAuthConsentClient.tsx`
- Create: `src/components/mcp/OAuthConsent.module.css`
- Modify: `supabase/config.toml`

**Interfaces:**
- Produces: `projectIdFromOAuthResource(resource: unknown): string | null`.
- Consent approval is disabled unless Supabase authorization details preserve a `resource` equal to a project-bound Keco MCP URL.
- Uses the installed methods `supabase.auth.oauth.getAuthorizationDetails`, `approveAuthorization`, and `denyAuthorization`.

- [ ] **Step 1: Write failing binding and consent wiring tests**

Create `tests/unit/mcp/oauth-project-binding.test.ts`:

```ts
import { projectIdFromOAuthResource } from '@/lib/mcp/oauthProjectBinding';

const projectId = '11111111-1111-4111-8111-111111111111';

it('extracts a UUID from a project-bound Supabase MCP resource', () => {
  expect(projectIdFromOAuthResource(
    `https://abc.supabase.co/functions/v1/mcp/${projectId}`
  )).toBe(projectId);
});

it.each([undefined, null, '', 'https://abc.supabase.co/functions/v1/mcp/all', `https://x/mcp/${projectId}/extra`])(
  'rejects an unavailable or unbound OAuth resource: %p',
  (resource) => expect(projectIdFromOAuthResource(resource)).toBeNull()
);
```

Create `tests/unit/mcp/oauth-consent-wiring.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(process.cwd(), 'src/components/mcp/OAuthConsentClient.tsx'),
  'utf8'
);

it('uses the supported Supabase OAuth consent APIs', () => {
  expect(source).toContain('getAuthorizationDetails');
  expect(source).toContain('approveAuthorization');
  expect(source).toContain('denyAuthorization');
});

it('blocks approval when the authorization details omit project resource binding', () => {
  expect(source).toContain('projectIdFromOAuthResource');
  expect(source).toContain('Project binding was not preserved by the authorization server.');
  expect(source).toMatch(/disabled=\{[^}]*!projectId/);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
npx jest tests/unit/mcp/oauth-project-binding.test.ts tests/unit/mcp/oauth-consent-wiring.test.ts
```

Expected: FAIL because the binding helper and consent component do not exist.

- [ ] **Step 3: Implement strict project binding extraction**

Create `src/lib/mcp/oauthProjectBinding.ts`:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function projectIdFromOAuthResource(resource: unknown): string | null {
  if (typeof resource !== 'string') return null;
  try {
    const parts = new URL(resource).pathname.split('/').filter(Boolean);
    const index = parts.lastIndexOf('mcp');
    if (index < 0 || index !== parts.length - 2) return null;
    return UUID.test(parts[index + 1]) ? parts[index + 1] : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Implement the consent client and page**

Create `src/app/oauth/consent/page.tsx`:

```tsx
import { Suspense } from 'react';
import { OAuthConsentClient } from '@/components/mcp/OAuthConsentClient';

export default function OAuthConsentPage() {
  return <Suspense fallback={<main>Loading authorization request...</main>}><OAuthConsentClient /></Suspense>;
}
```

Create `src/components/mcp/OAuthConsentClient.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { useSupabase } from '@/lib/SupabaseContext';
import { getProject } from '@/lib/services/projectService';
import { projectIdFromOAuthResource } from '@/lib/mcp/oauthProjectBinding';
import styles from './OAuthConsent.module.css';

type BoundDetails = OAuthAuthorizationDetails & { resource?: string };

export function OAuthConsentClient() {
  const supabase = useSupabase();
  const router = useRouter();
  const search = useSearchParams();
  const authorizationId = search.get('authorization_id') ?? '';
  const [details, setDetails] = useState<BoundDetails | null>(null);
  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const projectId = projectIdFromOAuthResource(details?.resource);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!authorizationId) {
        if (active) setError('Missing OAuth authorization ID.');
        return;
      }
      const result = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (result.error?.name === 'AuthSessionMissingError') {
        const target = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
        router.replace(`/projects?redirect=${encodeURIComponent(target)}`);
        return;
      }
      if (result.error || !result.data) {
        setError('Authorization request is unavailable or expired.');
        return;
      }
      const next = result.data as BoundDetails;
      setDetails(next);
      const boundProjectId = projectIdFromOAuthResource(next.resource);
      if (!boundProjectId) {
        setError('Project binding was not preserved by the authorization server.');
        return;
      }
      if (next.redirect_url) {
        setError('Existing OAuth consent bypassed the project-bound approval step.');
        return;
      }
      try {
        const project = await getProject(supabase, boundProjectId);
        if (!active) return;
        if (!project) setError('You do not have access to the bound project.');
        else setProjectName(project.name);
      } catch {
        if (active) setError('You do not have access to the bound project.');
      }
    })();
    return () => { active = false; };
  }, [authorizationId, router, supabase]);

  async function decide(action: 'approve' | 'deny') {
    if (!authorizationId || (action === 'approve' && !projectId)) return;
    setBusy(true);
    const result = action === 'approve'
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (result.error || !result.data?.redirect_url) {
      setError('Authorization decision could not be completed.');
      setBusy(false);
      return;
    }
    window.location.assign(result.data.redirect_url);
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <h1>Authorize Keco MCP</h1>
        {details && <p><strong>{details.client.name}</strong> requests access to <strong>{projectName || 'the bound project'}</strong>.</p>}
        {details && <p>Requested scopes: {details.scope || 'default identity scopes'}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" onClick={() => void decide('deny')} disabled={busy || !details}>Deny</button>
          <button type="button" onClick={() => void decide('approve')} disabled={busy || !details || !projectId || Boolean(error)}>Approve</button>
        </div>
      </section>
    </main>
  );
}
```

Create `src/components/mcp/OAuthConsent.module.css`:

```css
.page { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f5f6f8; color: #17191c; }
.panel { width: min(100%, 520px); border: 1px solid #d8dce2; border-radius: 8px; background: #fff; padding: 24px; }
.panel h1 { margin: 0 0 16px; font-size: 24px; letter-spacing: 0; }
.error { color: #b42318; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
.actions button { min-height: 40px; padding: 0 16px; border: 1px solid #aeb4bd; border-radius: 6px; background: #fff; }
.actions button:last-child { border-color: #1769aa; background: #1769aa; color: #fff; }
.actions button:disabled { cursor: not-allowed; opacity: 0.55; }
```

Change the OAuth server section in `supabase/config.toml` to:

```toml
[auth.oauth_server]
enabled = true
authorization_url_path = "/oauth/consent"
allow_dynamic_registration = true
```

- [ ] **Step 5: Run focused tests, typecheck, and build**

```bash
npx jest tests/unit/mcp/oauth-project-binding.test.ts tests/unit/mcp/oauth-consent-wiring.test.ts
npm run typecheck
npm run build
```

Expected: tests PASS, typecheck exits 0, and the Next.js build includes `/oauth/consent` and `/api/mcp/oauth-protected-resource`.

- [ ] **Step 6: Commit the consent surface**

```bash
git add supabase/config.toml src/app/oauth/consent/page.tsx src/components/mcp/OAuthConsentClient.tsx src/components/mcp/OAuthConsent.module.css src/lib/mcp/oauthProjectBinding.ts tests/unit/mcp/oauth-project-binding.test.ts tests/unit/mcp/oauth-consent-wiring.test.ts
git commit -m "feat: add project-bound mcp oauth consent"
```

### Task 6: Add a Redacted OAuth Discovery Probe

**Files:**
- Create: `tests/unit/mcp/oauth-probe.test.ts`
- Create: `scripts/probe-mcp-oauth.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `parseBearerMetadata(header): string`.
- Produces: `authorizationMetadataUrl(issuer): string`.
- Produces: `redactProbeEvidence(value): unknown`.
- CLI: `npm run probe:mcp-oauth -- --mcp-url <url> --output docs/mcp/phase-1-compatibility.json`.
- Exit 0 means challenge, resource metadata, authorization metadata, and dynamic registration all passed; any missing capability exits 1.

- [ ] **Step 1: Write failing parser and redaction tests**

Create `tests/unit/mcp/oauth-probe.test.ts`:

```ts
import {
  authorizationMetadataUrl,
  parseBearerMetadata,
  redactProbeEvidence,
} from '../../scripts/probe-mcp-oauth';

it('extracts the protected resource metadata URI', () => {
  expect(parseBearerMetadata('Bearer resource_metadata="https://keco.example.com/meta?id=1"'))
    .toBe('https://keco.example.com/meta?id=1');
});

it('builds RFC 8414 metadata URLs for an issuer with a path', () => {
  expect(authorizationMetadataUrl('https://abc.supabase.co/auth/v1'))
    .toBe('https://abc.supabase.co/.well-known/oauth-authorization-server/auth/v1');
});

it('redacts credential-shaped values recursively', () => {
  expect(redactProbeEvidence({
    access_token: 'secret',
    refresh_token: 'secret',
    client_secret: 'secret',
    code_verifier: 'secret',
    nested: { registration_endpoint: 'https://auth/register' },
  })).toEqual({
    access_token: '[REDACTED]',
    refresh_token: '[REDACTED]',
    client_secret: '[REDACTED]',
    code_verifier: '[REDACTED]',
    nested: { registration_endpoint: 'https://auth/register' },
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npx jest tests/unit/mcp/oauth-probe.test.ts
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement the probe**

Create `scripts/probe-mcp-oauth.ts` as a Node/tsx module with these exact exported behaviors:

```ts
import { writeFile } from 'node:fs/promises';

const SECRET_KEYS = new Set(['access_token', 'refresh_token', 'client_secret', 'code_verifier', 'authorization_code']);

export function parseBearerMetadata(header: string | null): string {
  const match = /resource_metadata="([^"]+)"/i.exec(header ?? '');
  if (!match) throw new Error('MCP 401 response omitted resource_metadata.');
  return match[1];
}

export function authorizationMetadataUrl(issuer: string): string {
  const url = new URL(issuer);
  const issuerPath = url.pathname.replace(/^\/+|\/+$/g, '');
  url.pathname = `/.well-known/oauth-authorization-server${issuerPath ? `/${issuerPath}` : ''}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function redactProbeEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactProbeEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    SECRET_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redactProbeEvidence(item),
  ]));
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`);
  return process.argv[index + 1];
}

export async function runProbe(mcpUrl: string, redirectUri: string) {
  const challengeResponse = await fetch(mcpUrl, {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  if (challengeResponse.status !== 401) throw new Error(`Expected MCP 401, received ${challengeResponse.status}.`);
  const resourceMetadataUrl = parseBearerMetadata(challengeResponse.headers.get('www-authenticate'));
  const resourceResponse = await fetch(resourceMetadataUrl);
  if (!resourceResponse.ok) throw new Error(`Resource metadata failed with ${resourceResponse.status}.`);
  const resource = await resourceResponse.json() as { resource?: string; authorization_servers?: string[] };
  if (resource.resource !== mcpUrl) throw new Error('Resource metadata does not match the MCP URL.');
  const authorizationServer = resource.authorization_servers?.[0];
  if (!authorizationServer) throw new Error('Resource metadata omitted authorization_servers.');
  const authMetadataUrl = authorizationMetadataUrl(authorizationServer);
  const authResponse = await fetch(authMetadataUrl);
  if (!authResponse.ok) throw new Error(`Authorization metadata failed with ${authResponse.status}.`);
  const auth = await authResponse.json() as Record<string, unknown>;
  if (typeof auth.authorization_endpoint !== 'string') throw new Error('Authorization metadata omitted authorization_endpoint.');
  if (typeof auth.token_endpoint !== 'string') throw new Error('Authorization metadata omitted token_endpoint.');
  if (typeof auth.registration_endpoint !== 'string') throw new Error('Authorization metadata omitted registration_endpoint.');
  const registrationResponse = await fetch(auth.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Keco MCP Phase 1 Probe',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!registrationResponse.ok) throw new Error(`Dynamic registration failed with ${registrationResponse.status}.`);
  const registration = await registrationResponse.json() as Record<string, unknown>;
  if (typeof registration.client_id !== 'string') throw new Error('Dynamic registration omitted client_id.');
  return redactProbeEvidence({
    checkedAt: new Date().toISOString(),
    passed: true,
    mcpUrl,
    resourceMetadataUrl,
    resource,
    authorizationMetadata: auth,
    registration,
  });
}

async function main() {
  const output = argument('--output');
  const evidence = await runProbe(argument('--mcp-url'), argument('--redirect-uri'));
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

if (process.argv[1]?.endsWith('probe-mcp-oauth.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'OAuth probe failed.');
    process.exitCode = 1;
  });
}
```

Add to `package.json`:

```json
{
  "probe:mcp-oauth": "tsx scripts/probe-mcp-oauth.ts"
}
```

- [ ] **Step 4: Run focused tests**

```bash
npx jest tests/unit/mcp/oauth-probe.test.ts
```

Expected: PASS with no secret values printed.

- [ ] **Step 5: Commit the probe**

```bash
git add package.json package-lock.json scripts/probe-mcp-oauth.ts tests/unit/mcp/oauth-probe.test.ts
git commit -m "test: add mcp oauth discovery probe"
```

### Task 7: Enforce MCP Checks in CI

**Files:**
- Modify: `tests/unit/ci-workflow.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: `check:mcp` and `test:mcp` from Task 1.
- Produces: required CI gates before the Next.js build.

- [ ] **Step 1: Write the failing CI assertions**

Add to `tests/unit/ci-workflow.test.ts`:

```ts
it('runs Edge MCP checks in CI and local validate', () => {
  expect(workflow).toContain('npm run check:mcp');
  expect(workflow).toContain('npm run test:mcp');
  expect(pkg.scripts.validate).toBe(
    'npm run lint && npm run typecheck && npm run typecheck:api && npm run check:mcp && npm run test:mcp && npm run test:unit && npm run build'
  );
});
```

- [ ] **Step 2: Run the assertion and verify it fails**

```bash
npx jest tests/unit/ci-workflow.test.ts -t 'runs Edge MCP checks in CI and local validate'
```

Expected: FAIL because CI and `validate` do not include the MCP checks.

- [ ] **Step 3: Add the CI and local gates**

Change `package.json` `validate` to:

```json
"validate": "npm run lint && npm run typecheck && npm run typecheck:api && npm run check:mcp && npm run test:mcp && npm run test:unit && npm run build"
```

In `.github/workflows/ci.yml`, add these steps after `Typecheck API routes` and before `Run unit tests`:

```yaml
      - name: Check MCP Edge Function types
        run: npm run check:mcp

      - name: Test MCP Edge Function
        run: npm run test:mcp
```

In `.github/workflows/README.md`, add `npm run check:mcp` and `npm run test:mcp` to the local equivalents block and state that the MCP tests use the pinned Deno npm runner.

- [ ] **Step 4: Run the focused and complete local gates**

```bash
npx jest tests/unit/ci-workflow.test.ts
npm run check:mcp
npm run test:mcp
npm run lint
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit CI enforcement**

```bash
git add package.json .github/workflows/ci.yml .github/workflows/README.md tests/unit/ci-workflow.test.ts
git commit -m "ci: verify supabase mcp edge function"
```

### Task 8: Run the Hosted OAuth and Client Compatibility Gate

**Files:**
- Create: `docs/mcp/phase-1-compatibility.json`
- Create: `docs/mcp/phase-1-client-matrix.md`
- Modify only if the gate finds a standards issue: `docs/superpowers/specs/2026-07-21-supabase-mcp-server-design.md`

**Interfaces:**
- Consumes: deployed Keco preview URL, deployed Supabase preview function, and one existing preview project UUID.
- Produces: evidence that determines whether Phase 2 may begin.
- No token, code, verifier, client secret, or decoded JWT values may be committed.

- [ ] **Step 1: Run full pre-deployment verification**

```bash
npm run validate
git diff --check
git status --short
```

Expected: validation exits 0; only intended Phase 1 changes are present.

- [ ] **Step 2: Apply preview OAuth settings with explicit approval**

After obtaining approval for hosted changes, set these values in the preview Supabase project using the supported dashboard/config API for that project:

```text
OAuth server enabled: true
Authorization URL path: /oauth/consent
Dynamic client registration: true
Site URL: the deployed Keco preview origin
Allowed redirect URLs: existing Keco auth callback URLs plus the exact Codex and Claude callback URLs shown by those clients
Refresh token rotation: enabled
```

Do not run `supabase config push` against production from the local `config.toml`; it contains local URLs.

- [ ] **Step 3: Deploy the preview Edge Function with explicit approval**

```bash
supabase functions deploy mcp --no-verify-jwt --project-ref "$SUPABASE_PROJECT_REF_PREVIEW"
```

Expected: deployment exits 0 and reports function `mcp`. The environment must define `KECO_PUBLIC_URL` as the Keco preview origin; `SUPABASE_URL` and `SUPABASE_ANON_KEY` are supplied by Supabase.

- [ ] **Step 4: Record machine-readable discovery evidence**

```bash
mkdir -p docs/mcp
npm run probe:mcp-oauth -- \
  --mcp-url "https://$SUPABASE_PROJECT_REF_PREVIEW.supabase.co/functions/v1/mcp/$MCP_TEST_PROJECT_ID" \
  --redirect-uri "$MCP_PROBE_REDIRECT_URI" \
  --output docs/mcp/phase-1-compatibility.json
```

Expected: exit 0 and JSON containing `"passed": true`, matching `resource`, and authorization metadata with authorization, token, and registration endpoints. Review the file with:

```bash
rg -n 'access_token|refresh_token|client_secret|code_verifier|authorization_code' docs/mcp/phase-1-compatibility.json
```

Expected: no matches, or only values exactly equal to `[REDACTED]`.

- [ ] **Step 5: Test OAuth project binding and client identity**

For each real client, connect to the exact project-bound URL and complete browser authorization. Inspect only claim keys and authorization-detail keys using a temporary local diagnostic; do not save values. The gate requires:

```text
authorization details contain the exact MCP resource URL, including project UUID
access token provides a stable OAuth client identity key (`client_id` or `azp`)
the token refresh completes without a second manual configuration
the consent page displays the bound Keco project name
```

If either required key is absent, mark Phase 1 failed. Do not infer project binding from client-controlled `state`, referrer headers, or the path alone.

- [ ] **Step 6: Run Codex and Claude interoperability checks**

For both Codex and Claude, execute this sequence against the same non-production test project:

```text
OAuth discovery and dynamic registration complete
initialize returns serverInfo.name = keco-mcp
tools/list returns only keco_connection_probe
tools/call keco_connection_probe returns ok = true and phase = 1
refresh the access token and call the tool again
remove the test user from the project and verify the next call is rejected
restore test membership only if the fixture is still needed
```

- [ ] **Step 7: Write the client matrix with an unambiguous verdict**

Create `docs/mcp/phase-1-client-matrix.md` only after both client runs are complete. It must contain a four-column table named `Gate`, `Codex`, `Claude`, and `Required result`. Add rows for protected-resource discovery, dynamic client registration, PKCE authorization, project resource preservation, stable client identity, `initialize`, `tools/list`, probe tool call, refresh and retry, and membership revocation. Populate each client cell with the observed enum `PASS` or `FAIL`; the required-result cell is `PASS in both` for every row. End with `**Phase 1 verdict:** PASS` only when every client cell passes; otherwise end with `**Phase 1 verdict:** FAIL` and the approved design remediation. Do not create or commit an incomplete matrix.

- [ ] **Step 8: Reconcile the design if the gate fails**

If the verdict is FAIL, update the design spec in the same commit with the observed missing standard capability and one explicitly chosen remediation. Allowed remediations are:

```text
a standards-compliant metadata/authorization proxy that preserves RFC 8707 resource
a separate authorization server that emits project-bound audience and client identity
a revised user-approved grant flow with a cryptographically bound project identifier
```

Do not select a remediation that trusts an unverified query parameter, OAuth `state`, or a client-supplied `projectId`.

- [ ] **Step 9: Run evidence checks and commit Phase 1 results**

```bash
npm run validate
git diff --check
rg -n 'UNTESTED|INCOMPLETE|REPLACE_ME' docs/mcp/phase-1-client-matrix.md docs/mcp/phase-1-compatibility.json
```

Expected: validation exits 0 and the incomplete-result scan returns no matches.

```bash
git add docs/mcp/phase-1-compatibility.json docs/mcp/phase-1-client-matrix.md docs/superpowers/specs/2026-07-21-supabase-mcp-server-design.md
git commit -m "test: record mcp phase one compatibility"
```

The design file is added only when Step 8 changed it.

---

## Phase Boundary

Do not write the Phase 2 read-surface plan until Task 8 has a PASS verdict or an approved design revision. Phase 2 will cover project authorization context, fixed-query project structure, read Tools, Resources, Prompts, pagination, payload budgets, and read audit/rate limits. Phase 3 will cover atomic write RPCs and document integrity. Phase 4 will cover deployment automation, load testing, monitoring, and production hardening.
