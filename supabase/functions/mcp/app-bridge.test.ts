import {
  assertEquals,
  assertRejects,
} from "@std/assert";
import { callKecoApp } from "./app-bridge.ts";
import { McpDomainError } from "./errors.ts";
import type { McpRequestContext } from "./context.ts";

const TOKEN = "bridge-secret-bearer-token";
const context = {
  mode: "account",
  requestId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  clientId: "client-1",
  sessionId: "00000000-0000-4000-8000-000000000003",
  bearerToken: TOKEN,
  supabase: {},
} as unknown as McpRequestContext;

Deno.test("app bridge forwards the verified actor and idempotency key", async () => {
  let received: { url: string; init?: RequestInit } | null = null;
  const value = await callKecoApp<{ job: { id: string } }>(context, {
    method: "POST",
    path: "/api/game-design-systems/generation-jobs",
    idempotencyKey: "request-1234",
    body: { title: "Tactics" },
  }, {
    origin: "https://keco.test",
    fetch: ((input, init) => {
      received = { url: String(input), init };
      return Promise.resolve(Response.json({ job: { id: "job-1" } }));
    }) as typeof fetch,
  });

  assertEquals(value, { job: { id: "job-1" } });
  const captured = received as { url: string; init?: RequestInit } | null;
  if (!captured) throw new Error("expected the bridge fetch to run");
  assertEquals(captured.url, "https://keco.test/api/game-design-systems/generation-jobs");
  const headers = new Headers(captured.init?.headers);
  assertEquals(headers.get("authorization"), "Bearer " + TOKEN);
  assertEquals(headers.get("idempotency-key"), "request-1234");
  assertEquals(headers.get("content-type"), "application/json");
  assertEquals(captured.init?.body, JSON.stringify({ title: "Tactics" }));
});

Deno.test("app bridge rejects unsafe origins", async () => {
  await assertRejects(
    () => callKecoApp(context, { method: "GET", path: "/api/test" }, {
      origin: "http://keco.example.test",
      fetch,
    }),
    McpDomainError,
    "unavailable",
  );
});

Deno.test("app bridge accepts local HTTP development origins", async () => {
  const result = await callKecoApp<{ ok: boolean }>(context, {
    method: "GET",
    path: "/api/test",
  }, {
    origin: "http://127.0.0.1:3000",
    fetch: (() => Promise.resolve(Response.json({ ok: true }))) as typeof fetch,
  });
  assertEquals(result, { ok: true });
});

Deno.test("app bridge rejects responses at the private size boundary", async () => {
  const oversized = JSON.stringify({ value: "x".repeat(256 * 1024) });
  const error = await assertRejects(
    () => callKecoApp(context, { method: "GET", path: "/api/test" }, {
      origin: "https://keco.test",
      fetch: (() => Promise.resolve(new Response(oversized))) as typeof fetch,
    }),
    McpDomainError,
  );
  assertEquals(error.code, "PAYLOAD_TOO_LARGE");
});

Deno.test("app bridge maps stable app errors without leaking response details", async () => {
  const error = await assertRejects(
    () => callKecoApp(context, { method: "POST", path: "/api/test" }, {
      origin: "https://keco.test",
      fetch: (() => Promise.resolve(Response.json({
        code: "MAP_CONFIRMATION_EXPIRED",
        error: "The map generation confirmation expired.",
        internal: TOKEN,
      }, { status: 409 }))) as typeof fetch,
    }),
    McpDomainError,
  );
  assertEquals(error.code, "MAP_CONFIRMATION_EXPIRED");
  assertEquals(error.message, "The map generation confirmation expired.");
  assertEquals(error.message.includes(TOKEN), false);
});

Deno.test("app bridge maps malformed upstream failures to a retryable safe error", async () => {
  const error = await assertRejects(
    () => callKecoApp(context, { method: "GET", path: "/api/test" }, {
      origin: "https://keco.test",
      fetch: (() => Promise.resolve(new Response("provider token=" + TOKEN, {
        status: 502,
      }))) as typeof fetch,
    }),
    McpDomainError,
  );
  assertEquals(error.code, "UPSTREAM_UNAVAILABLE");
  assertEquals(error.retryable, true);
  assertEquals(error.message.includes(TOKEN), false);
});

Deno.test("app bridge aborts requests after the configured timeout", async () => {
  const error = await assertRejects(
    () => callKecoApp(context, { method: "GET", path: "/api/test" }, {
      origin: "https://keco.test",
      timeoutMs: 1,
      fetch: ((_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })) as typeof fetch,
    }),
    McpDomainError,
  );
  assertEquals(error.code, "UPSTREAM_UNAVAILABLE");
  assertEquals(error.retryable, true);
});
