import { assertEquals } from "@std/assert";
import { authorizeProjectWithGateway } from "./auth.ts";

const projectId = "11111111-1111-4111-8111-111111111111";

Deno.test("authorization rejects missing bearer tokens", async () => {
  const context = await authorizeProjectWithGateway(
    new Request("https://x"),
    projectId,
    { getUser: async () => null, getRole: async () => null },
  );
  assertEquals(context, null);
});

Deno.test("authorization returns current role for a valid project member", async () => {
  const context = await authorizeProjectWithGateway(
    new Request("https://x", { headers: { authorization: "Bearer token" } }),
    projectId,
    {
      getUser: async (token) => token === "token" ? { id: "user-1" } : null,
      getRole: async () => "viewer",
    },
  );
  assertEquals(context, { userId: "user-1", projectId, role: "viewer" });
});
