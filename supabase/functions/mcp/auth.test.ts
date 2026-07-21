import { assertEquals } from "@std/assert";
import { authorizeProjectWithGateway } from "./auth.ts";

const projectId = "11111111-1111-4111-8111-111111111111";

Deno.test("authorization rejects missing bearer tokens", async () => {
  const result = await authorizeProjectWithGateway(
    new Request("https://x"),
    projectId,
    { getUser: async () => null, getRole: async () => null },
  );
  assertEquals(result, { status: "unauthenticated" });
});

Deno.test("authorization rejects invalid bearer tokens as unauthenticated", async () => {
  const result = await authorizeProjectWithGateway(
    new Request("https://x", {
      headers: { authorization: "Bearer invalid-token" },
    }),
    projectId,
    { getUser: async () => null, getRole: async () => "viewer" },
  );
  assertEquals(result, { status: "unauthenticated" });
});

Deno.test("authorization rejects revoked project membership as forbidden", async () => {
  const result = await authorizeProjectWithGateway(
    new Request("https://x", { headers: { authorization: "Bearer token" } }),
    projectId,
    {
      getUser: async () => ({ id: "user-1" }),
      getRole: async () => null,
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
      getRole: async () => "viewer",
    },
  );
  assertEquals(result, {
    status: "authorized",
    context: { userId: "user-1", projectId, role: "viewer" },
  });
});
