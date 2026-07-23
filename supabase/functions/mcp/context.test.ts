import { assertEquals, assertStrictEquals } from "@std/assert";
import { createMcpRequestContext } from "./context.ts";

const authContext = {
  userId: "user-1",
  projectId: "11111111-1111-4111-8111-111111111111",
  role: "viewer" as const,
  clientId: "client-1",
  bearerToken: "secret-bearer-token",
};
const accountAuthContext = {
  userId: "user-1",
  clientId: "client-1",
  sessionId: "11111111-1111-4111-8111-111111111111",
  bearerToken: "secret-account-bearer-token",
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
  assertEquals(context.mode, "project");
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

Deno.test("account request context is mode-discriminated and protects credentials", () => {
  const client = { marker: true };
  const context = createMcpRequestContext(
    new Request("https://example.test"),
    accountAuthContext,
    {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      requestId: () => "request-account",
      createSupabaseClient: (() => client) as never,
    },
  );

  assertEquals(context.mode, "account");
  if (context.mode !== "account") throw new Error("expected account context");
  assertEquals(context.sessionId, accountAuthContext.sessionId);
  assertEquals(context.bearerToken, accountAuthContext.bearerToken);
  assertStrictEquals(context.supabase, client);
  assertEquals(Object.isFrozen(context), true);
  assertEquals(JSON.stringify(context).includes(accountAuthContext.bearerToken), false);
  assertEquals(JSON.stringify(context).includes("marker"), false);
  assertEquals("projectId" in context, false);
  assertEquals("role" in context, false);
});

Deno.test("request context uses the runtime UUID generator without detaching it", () => {
  const context = createMcpRequestContext(
    new Request("https://example.test"),
    authContext,
    {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      createSupabaseClient: (() => ({ marker: true })) as never,
    },
  );

  assertEquals(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(context.requestId),
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
