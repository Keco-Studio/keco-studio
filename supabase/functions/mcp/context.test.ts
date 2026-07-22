import { assertEquals, assertStrictEquals } from "@std/assert";
import { createMcpRequestContext } from "./context.ts";

const authContext = {
  userId: "user-1",
  projectId: "11111111-1111-4111-8111-111111111111",
  role: "viewer" as const,
  clientId: "client-1",
  bearerToken: "secret-bearer-token",
};

Deno.test("request context is immutable and does not serialize credentials or client", () => {
  let receivedOptions: unknown;
  const client = { marker: true };
  const context = createMcpRequestContext(
    new Request("https://example.test"),
    authContext,
    {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      requestId: () => "request-1",
      createSupabaseClient: ((_url: string, _key: string, options: unknown) => {
        receivedOptions = options;
        return client;
      }) as never,
    },
  );

  assertEquals(context.requestId, "request-1");
  assertEquals(context.role, "viewer");
  assertEquals(context.clientId, "client-1");
  assertEquals(context.bearerToken, "secret-bearer-token");
  assertStrictEquals(context.supabase, client);
  assertEquals(Object.isFrozen(context), true);
  assertEquals(JSON.stringify(context).includes("secret-bearer-token"), false);
  assertEquals(JSON.stringify(context).includes("marker"), false);
  assertEquals(
    JSON.stringify(receivedOptions).includes("Bearer secret-bearer-token"),
    true,
  );
});

Deno.test("request context fails closed when Supabase environment is missing", () => {
  let thrown = false;
  try {
    createMcpRequestContext(new Request("https://example.test"), authContext, {
      supabaseUrl: "",
      supabaseAnonKey: "",
    });
  } catch {
    thrown = true;
  }
  assertEquals(thrown, true);
});
