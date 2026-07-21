import { assertEquals } from "@std/assert";
import {
  authorizeProjectWithGateway,
  isInvalidCredentialError,
} from "./auth.ts";

const projectId = "11111111-1111-4111-8111-111111111111";
const absentProjectAccess = {
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
    new Request("https://x", { headers: { authorization: "Bearer token" } }),
    projectId,
    {
      getUser: async () => ({ id: "user-1" }),
      ...absentProjectAccess,
    },
  );
  assertEquals(result, { status: "forbidden" });
});

Deno.test("authorization returns current role for a valid project member", async () => {
  const result = await authorizeProjectWithGateway(
    new Request("https://x", { headers: { authorization: "Bearer token" } }),
    projectId,
    {
      getUser: async (token) => token === "token" ? { id: "user-1" } : null,
      getProjectOwner: async () => null,
      getCollaboratorRole: async () => "viewer",
    },
  );
  assertEquals(result, {
    status: "authorized",
    context: { userId: "user-1", projectId, role: "viewer" },
  });
});

Deno.test("authorization reports identity backend failures as operational errors", async () => {
  const result = await authorizeProjectWithGateway(
    new Request("https://x", { headers: { authorization: "Bearer token" } }),
    projectId,
    {
      getUser: async () => { throw new Error("auth backend unavailable"); },
      ...absentProjectAccess,
    },
  );
  assertEquals(result, { status: "operational_error" });
});

Deno.test("authorization reports project query failures as operational errors", async () => {
  const result = await authorizeProjectWithGateway(
    new Request("https://x", { headers: { authorization: "Bearer token" } }),
    projectId,
    {
      getUser: async () => ({ id: "user-1" }),
      getProjectOwner: async () => { throw new Error("project query failed"); },
      getCollaboratorRole: async () => null,
    },
  );
  assertEquals(result, { status: "operational_error" });
});

Deno.test("authorization reports collaborator query failures as operational errors", async () => {
  const result = await authorizeProjectWithGateway(
    new Request("https://x", { headers: { authorization: "Bearer token" } }),
    projectId,
    {
      getUser: async () => ({ id: "user-1" }),
      getProjectOwner: async () => null,
      getCollaboratorRole: async () => {
        throw new Error("collaborator query failed");
      },
    },
  );
  assertEquals(result, { status: "operational_error" });
});
