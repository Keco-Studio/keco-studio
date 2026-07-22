import { assertEquals } from "@std/assert";
import {
  authorizeProjectWithGateway,
  isInvalidCredentialError,
} from "./auth.ts";

const projectId = "11111111-1111-4111-8111-111111111111";
const canonicalProjectResource = `https://x/functions/v1/mcp/${projectId}`;
const absentProjectAccess = {
  hasOAuthProjectGrant: async () => false,
  getProjectOwner: async () => null,
  getCollaboratorRole: async () => null,
};

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
      hasOAuthProjectGrant: async () => true,
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
      hasOAuthProjectGrant: async () => true,
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
      hasOAuthProjectGrant: async () => true,
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
      hasOAuthProjectGrant: async () => true,
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
      hasOAuthProjectGrant: async () => true,
      getProjectOwner: async () => null,
      getCollaboratorRole: async () => {
        throw new Error("collaborator query failed");
      },
    },
  );
  assertEquals(result, { status: "operational_error" });
});

Deno.test("authorization rejects a bearer without a verified OAuth client before grant or membership checks", async () => {
  const calls: string[] = [];
  const result = await authorizeProjectWithGateway(
    new Request(`https://x/functions/v1/mcp/${projectId}`, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async () => ({ id: "user-1" }),
      hasOAuthProjectGrant: async () => {
        calls.push("grant");
        return true;
      },
      getProjectOwner: async () => {
        calls.push("membership");
        return "user-1";
      },
      getCollaboratorRole: async () => null,
    },
  );

  assertEquals(result, { status: "forbidden" });
  assertEquals(calls, []);
});

Deno.test("authorization checks the exact client, project, and request resource before membership", async () => {
  const calls: string[] = [];
  const resource = canonicalProjectResource;
  const result = await authorizeProjectWithGateway(
    new Request(resource, { headers: { authorization: "Bearer token" } }),
    projectId,
    {
      getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
      hasOAuthProjectGrant: async (
        clientId,
        checkedProjectId,
        checkedResource,
        token,
      ) => {
        calls.push(
          `grant:${clientId}:${checkedProjectId}:${checkedResource}:${token}`,
        );
        return false;
      },
      getProjectOwner: async () => {
        calls.push("membership");
        return "user-1";
      },
      getCollaboratorRole: async () => null,
    },
  );

  assertEquals(result, { status: "forbidden" });
  assertEquals(calls, [
    `grant:oauth-client:${projectId}:${resource}:token`,
  ]);
});

Deno.test("authorization canonicalizes the Supabase gateway MCP path before grant lookup", async () => {
  const result = await authorizeProjectWithGateway(
    new Request(`https://x/mcp/${projectId}`, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
      hasOAuthProjectGrant: async (
        clientId,
        checkedProjectId,
        checkedResource,
      ) =>
        clientId === "oauth-client" && checkedProjectId === projectId &&
        checkedResource === canonicalProjectResource,
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

Deno.test("authorization rejects noncanonical MCP request resources before grant lookup", async () => {
  const otherProjectId = "22222222-2222-4222-8222-222222222222";
  const rejectedResources = [
    `https://x/mcp/${otherProjectId}`,
    `https://x/mcp/${projectId}/extra`,
    `https://x/functions/v1/mcp/${projectId}?replay=1`,
    `https://user:password@x/mcp/${projectId}`,
    `https://x/mcp/${projectId}#fragment`,
  ];

  for (const resource of rejectedResources) {
    let grantLookups = 0;
    const result = await authorizeProjectWithGateway(
      new Request(resource, { headers: { authorization: "Bearer token" } }),
      projectId,
      {
        getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
        hasOAuthProjectGrant: async () => {
          grantLookups += 1;
          return true;
        },
        getProjectOwner: async () => "user-1",
        getCollaboratorRole: async () => null,
      },
    );

    assertEquals(result, { status: "forbidden" });
    assertEquals(grantLookups, 0);
  }
});

Deno.test("authorization denies wrong-resource and dual-project grant replay", async () => {
  const grantedResource = `https://x/functions/v1/mcp/${projectId}`;
  const otherProjectId = "22222222-2222-4222-8222-222222222222";
  const otherResource = `https://x/functions/v1/mcp/${otherProjectId}`;
  const gateway = {
    getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
    hasOAuthProjectGrant: async (
      clientId: string,
      checkedProjectId: string,
      checkedResource: string,
    ) =>
      clientId === "oauth-client" && checkedProjectId === projectId &&
      checkedResource === grantedResource,
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

Deno.test("authorization denies a bearer whose OAuth client differs from the grant", async () => {
  const resource = `https://x/functions/v1/mcp/${projectId}`;
  const result = await authorizeProjectWithGateway(
    new Request(resource, { headers: { authorization: "Bearer token" } }),
    projectId,
    {
      getUser: async () => ({ id: "user-1", clientId: "wrong-client" }),
      hasOAuthProjectGrant: async (clientId) => clientId === "granted-client",
      getProjectOwner: async () => "user-1",
      getCollaboratorRole: async () => null,
    },
  );

  assertEquals(result, { status: "forbidden" });
});

Deno.test("authorization reports OAuth grant lookup failures as operational errors", async () => {
  const result = await authorizeProjectWithGateway(
    new Request(`https://x/functions/v1/mcp/${projectId}`, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
      hasOAuthProjectGrant: async () => {
        throw new Error("grant query failed");
      },
      getProjectOwner: async () => "user-1",
      getCollaboratorRole: async () => null,
    },
  );

  assertEquals(result, { status: "operational_error" });
});
