import { assertEquals } from "@std/assert";
import {
  authorizeAccountWithGateway,
  authorizeProjectWithGateway,
  canonicalAccountResource,
  isInvalidCredentialError,
} from "./auth.ts";

const projectId = "11111111-1111-4111-8111-111111111111";
const canonicalProjectResource = `https://x/functions/v1/mcp/${projectId}`;
const allowGrant = { hasOAuthProjectGrant: async () => true };
const absentProjectAccess = {
  ...allowGrant,
  getProjectOwner: async () => null,
  getCollaboratorRole: async () => null,
};

function oauthToken(claims: Record<string, unknown>): string {
  const base64Url = (value: string) => btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `${base64Url(JSON.stringify({ alg: "none" }))}.${base64Url(JSON.stringify(claims))}.signature`;
}

const accountSessionId = "22222222-2222-4222-8222-222222222222";
const accountToken = oauthToken({
  client_id: "oauth-client",
  session_id: accountSessionId,
  iss: "https://project.supabase.co/auth/v1",
});
const accountResource = "https://project.supabase.co/functions/v1/mcp";

Deno.test("credential rejection classification excludes operational auth failures", () => {
  assertEquals(isInvalidCredentialError({ status: 401 }), true);
  assertEquals(isInvalidCredentialError({ status: 403 }), true);
  assertEquals(
    isInvalidCredentialError({
      name: "AuthSessionMissingError",
      status: 400,
      code: "session_not_found",
    }),
    true,
  );
  assertEquals(isInvalidCredentialError({ status: 503 }), false);
  assertEquals(isInvalidCredentialError({ status: 429 }), false);
  assertEquals(
    isInvalidCredentialError({ name: "AuthRetryableFetchError", status: 0 }),
    false,
  );
});

Deno.test("authorization rejects missing bearer tokens", async () => {
  const result = await authorizeProjectWithGateway(
    new Request("https://x"),
    projectId,
    { getUser: async () => null, ...absentProjectAccess },
  );
  assertEquals(result, { status: "unauthenticated" });
});

Deno.test("authorization rejects invalid bearer tokens as unauthenticated", async () => {
  const result = await authorizeProjectWithGateway(
    new Request("https://x", {
      headers: { authorization: "Bearer invalid-token" },
    }),
    projectId,
    { getUser: async () => null, ...absentProjectAccess },
  );
  assertEquals(result, { status: "unauthenticated" });
});

Deno.test("authorization rejects revoked project membership as forbidden", async () => {
  const result = await authorizeProjectWithGateway(
    new Request(canonicalProjectResource, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
      ...absentProjectAccess,
    },
  );
  assertEquals(result, { status: "forbidden" });
});

Deno.test("authorization authorizes a current member with an exact project grant", async () => {
  const result = await authorizeProjectWithGateway(
    new Request(canonicalProjectResource, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
      ...allowGrant,
      getProjectOwner: async () => null,
      getCollaboratorRole: async () => "editor",
    },
  );
  assertEquals(result, {
    status: "authorized",
    context: {
      userId: "user-1",
      projectId,
      role: "editor",
      clientId: "oauth-client",
      bearerToken: "token",
    },
  });
});

Deno.test("authorization denies a non-member after client and resource checks", async () => {
  const result = await authorizeProjectWithGateway(
    new Request(canonicalProjectResource, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
      ...allowGrant,
      getProjectOwner: async () => null,
      getCollaboratorRole: async () => null,
    },
  );
  assertEquals(result, { status: "forbidden" });
});

Deno.test("authorization returns current role for a valid project member", async () => {
  const result = await authorizeProjectWithGateway(
    new Request(canonicalProjectResource, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async (token) =>
        token === "token" ? { id: "user-1", clientId: "oauth-client" } : null,
      ...allowGrant,
      getProjectOwner: async () => null,
      getCollaboratorRole: async () => "viewer",
    },
  );
  assertEquals(result, {
    status: "authorized",
    context: {
      userId: "user-1",
      projectId,
      role: "viewer",
      clientId: "oauth-client",
      bearerToken: "token",
    },
  });
});

Deno.test("authorization retains a verified OAuth client identifier", async () => {
  const result = await authorizeProjectWithGateway(
    new Request(canonicalProjectResource, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
      ...allowGrant,
      getProjectOwner: async () => "user-1",
      getCollaboratorRole: async () => null,
    },
  );
  if (result.status !== "authorized") throw new Error("expected authorization");
  assertEquals(result.context.clientId, "oauth-client");
});

Deno.test("authorization reports identity backend failures as operational errors", async () => {
  const result = await authorizeProjectWithGateway(
    new Request("https://x", { headers: { authorization: "Bearer token" } }),
    projectId,
    {
      getUser: async () => {
        throw new Error("auth backend unavailable");
      },
      ...absentProjectAccess,
    },
  );
  assertEquals(result, { status: "operational_error" });
});

Deno.test("authorization reports project query failures as operational errors", async () => {
  const result = await authorizeProjectWithGateway(
    new Request(canonicalProjectResource, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
      ...allowGrant,
      getProjectOwner: async () => {
        throw new Error("project query failed");
      },
      getCollaboratorRole: async () => null,
    },
  );
  assertEquals(result, { status: "operational_error" });
});

Deno.test("authorization reports collaborator query failures as operational errors", async () => {
  const result = await authorizeProjectWithGateway(
    new Request(canonicalProjectResource, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
      ...allowGrant,
      getProjectOwner: async () => null,
      getCollaboratorRole: async () => {
        throw new Error("collaborator query failed");
      },
    },
  );
  assertEquals(result, { status: "operational_error" });
});

Deno.test("authorization rejects a bearer without a verified OAuth client before membership checks", async () => {
  const calls: string[] = [];
  const result = await authorizeProjectWithGateway(
    new Request(`https://x/functions/v1/mcp/${projectId}`, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async () => ({ id: "user-1" }),
      ...allowGrant,
      getProjectOwner: async () => {
        calls.push("membership");
        return "user-1";
      },
      getCollaboratorRole: async () => {
        calls.push("membership");
        return null;
      },
    },
  );

  assertEquals(result, { status: "forbidden" });
  assertEquals(calls, []);
});

Deno.test("authorization rejects a missing exact grant before membership checks", async () => {
  const calls: string[] = [];
  const result = await authorizeProjectWithGateway(
    new Request(canonicalProjectResource, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
      hasOAuthProjectGrant: async () => false,
      getProjectOwner: async () => {
        calls.push("membership");
        return "user-1";
      },
      getCollaboratorRole: async () => {
        calls.push("membership");
        return null;
      },
    },
  );

  assertEquals(result, { status: "forbidden" });
  assertEquals(calls, []);
});

Deno.test("authorization canonicalizes the Supabase gateway MCP path", async () => {
  const result = await authorizeProjectWithGateway(
    new Request(`https://x/mcp/${projectId}`, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
      ...allowGrant,
      getProjectOwner: async () => "user-1",
      getCollaboratorRole: async () => null,
    },
  );

  assertEquals(result, {
    status: "authorized",
    context: {
      userId: "user-1",
      projectId,
      role: "admin",
      clientId: "oauth-client",
      bearerToken: "token",
    },
  });
});

Deno.test("authorization binds the resource to the verified OAuth issuer origin", async () => {
  let checkedResource: string | null = null;
  const result = await authorizeProjectWithGateway(
    new Request(`http://edge-runtime.internal/mcp/${projectId}`, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async () => ({
        id: "user-1",
        clientId: "oauth-client",
        resourceOrigin: "https://project.supabase.co",
      }),
      hasOAuthProjectGrant: async (_clientId, _projectId, resource) => {
        checkedResource = resource;
        return true;
      },
      getProjectOwner: async () => "user-1",
      getCollaboratorRole: async () => null,
    },
  );

  assertEquals(result.status, "authorized");
  assertEquals(
    checkedResource,
    `https://project.supabase.co/functions/v1/mcp/${projectId}`,
  );
});

Deno.test("authorization rejects noncanonical MCP request resources before membership", async () => {
  const otherProjectId = "22222222-2222-4222-8222-222222222222";
  const rejectedResources = [
    `https://x/mcp/${otherProjectId}`,
    `https://x/mcp/${projectId}/extra`,
    `https://x/functions/v1/mcp/${projectId}?replay=1`,
    `https://user:password@x/mcp/${projectId}`,
    `https://x/mcp/${projectId}#fragment`,
  ];

  for (const resource of rejectedResources) {
    let membershipLookups = 0;
    const result = await authorizeProjectWithGateway(
      new Request(resource, { headers: { authorization: "Bearer token" } }),
      projectId,
      {
        getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
        ...allowGrant,
        getProjectOwner: async () => {
          membershipLookups += 1;
          return "user-1";
        },
        getCollaboratorRole: async () => {
          membershipLookups += 1;
          return null;
        },
      },
    );

    assertEquals(result, { status: "forbidden" });
    assertEquals(membershipLookups, 0);
  }
});

Deno.test("authorization denies noncanonical and real dual-project grant replay", async () => {
  const grantedResource = `https://x/functions/v1/mcp/${projectId}`;
  const otherProjectId = "22222222-2222-4222-8222-222222222222";
  const otherResource = `https://x/functions/v1/mcp/${otherProjectId}`;
  const gateway = {
    getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
    hasOAuthProjectGrant: async (
      _clientId: string,
      checkedProjectId: string,
      checkedResource: string,
    ) => checkedProjectId === projectId && checkedResource === grantedResource,
    getProjectOwner: async () => "user-1",
    getCollaboratorRole: async () => null,
  };

  const wrongResource = await authorizeProjectWithGateway(
    new Request(`${grantedResource}?replay=1`, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    gateway,
  );
  const otherProject = await authorizeProjectWithGateway(
    new Request(otherResource, { headers: { authorization: "Bearer token" } }),
    otherProjectId,
    gateway,
  );

  assertEquals(wrongResource, { status: "forbidden" });
  assertEquals(otherProject, { status: "forbidden" });
});

Deno.test("canonical account resource accepts only exact public and gateway roots", () => {
  assertEquals(
    canonicalAccountResource("https://x/functions/v1/mcp"),
    "https://x/functions/v1/mcp",
  );
  assertEquals(
    canonicalAccountResource("https://x/mcp", "https://project.supabase.co"),
    accountResource,
  );
  for (const url of [
    "https://x/functions/v1/mcp/extra",
    "https://x/functions/v1/mcp?replay=1",
    "https://user:password@x/mcp",
    "https://x/mcp#fragment",
  ]) {
    assertEquals(canonicalAccountResource(url), null);
  }
});

Deno.test("account authorization requires a verified OAuth client, session, and exact grant", async () => {
  const checked: Array<[string, string, string]> = [];
  const result = await authorizeAccountWithGateway(
    new Request("https://edge.internal/mcp", {
      headers: { authorization: `Bearer ${accountToken}` },
    }),
    {
      getUser: async (token) => token === accountToken ? { id: "user-1" } : null,
      hasOAuthServiceGrant: async (clientId, resource, token) => {
        checked.push([clientId, resource, token]);
        return true;
      },
      ...absentProjectAccess,
    },
  );

  assertEquals(result, {
    status: "authorized",
    context: {
      userId: "user-1",
      clientId: "oauth-client",
      sessionId: accountSessionId,
      bearerToken: accountToken,
    },
  });
  assertEquals(checked, [["oauth-client", accountResource, accountToken]]);
});

Deno.test("account authorization fails closed before the grant lookup for missing claims or malformed resources", async () => {
  const missingSession = oauthToken({
    client_id: "oauth-client",
    iss: "https://project.supabase.co/auth/v1",
  });
  for (const [url, token] of [
    ["https://x/mcp", missingSession],
    [`${accountResource}?replay=1`, accountToken],
    ["https://project.supabase.co/functions/v1/mcp/extra", accountToken],
  ]) {
    let grantLookups = 0;
    const result = await authorizeAccountWithGateway(
      new Request(url, { headers: { authorization: `Bearer ${token}` } }),
      {
        getUser: async () => ({ id: "user-1" }),
        hasOAuthServiceGrant: async () => {
          grantLookups += 1;
          return true;
        },
        ...absentProjectAccess,
      },
    );
    assertEquals(result, { status: "forbidden" });
    assertEquals(grantLookups, 0);
  }
});

Deno.test("account authorization distinguishes invalid credentials, denied grants, and backend failures", async () => {
  const request = new Request(accountResource, {
    headers: { authorization: `Bearer ${accountToken}` },
  });
  const invalid = await authorizeAccountWithGateway(request, {
    getUser: async () => null,
    ...absentProjectAccess,
  });
  const denied = await authorizeAccountWithGateway(request, {
    getUser: async () => ({ id: "user-1" }),
    hasOAuthServiceGrant: async () => false,
    ...absentProjectAccess,
  });
  const unavailable = await authorizeAccountWithGateway(request, {
    getUser: async () => ({ id: "user-1" }),
    hasOAuthServiceGrant: async () => {
      throw new Error("grant backend unavailable");
    },
    ...absentProjectAccess,
  });

  assertEquals(invalid, { status: "unauthenticated" });
  assertEquals(denied, { status: "forbidden" });
  assertEquals(unavailable, { status: "operational_error" });
});
