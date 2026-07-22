import { assertEquals } from "@std/assert";
import { McpDomainError } from "./errors.ts";
import {
  assertUtf8Below,
  utf8ByteLength,
  validateLimit,
} from "./limits.ts";
import { toolFailure, toolSuccess } from "./results.ts";

Deno.test("limits count UTF-8 bytes and reject rather than clamp", () => {
  assertEquals(utf8ByteLength("€"), 3);
  assertEquals(validateLimit(undefined, { defaultValue: 50, maximum: 200 }), 50);
  assertEquals(validateLimit(200, { defaultValue: 50, maximum: 200 }), 200);
  for (const value of [0, 201, 1.5, "10"]) {
    let code = "";
    try {
      validateLimit(value, { defaultValue: 50, maximum: 200 });
    } catch (error) {
      code = (error as McpDomainError).code;
    }
    assertEquals(code, "FIELD_VALIDATION_FAILED");
  }
  assertUtf8Below("a", 2, "value");
  let payloadCode = "";
  try {
    assertUtf8Below("aa", 2, "value");
  } catch (error) {
    payloadCode = (error as McpDomainError).code;
  }
  assertEquals(payloadCode, "PAYLOAD_TOO_LARGE");
});

Deno.test("tool results expose only stable safe failures", () => {
  assertEquals(toolSuccess("done", { ok: true }), {
    content: [{ type: "text", text: "done" }],
    structuredContent: { ok: true },
  });
  assertEquals(toolFailure(new Error("database secret")), {
    content: [{ type: "text", text: "INTERNAL_ERROR: The Keco MCP operation failed." }],
    structuredContent: {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "The Keco MCP operation failed." },
    },
    isError: true,
  });
  assertEquals(toolFailure(new McpDomainError("RATE_LIMITED", "Try later.", 12)), {
    content: [{ type: "text", text: "RATE_LIMITED: Try later." }],
    structuredContent: {
      ok: false,
      error: { code: "RATE_LIMITED", message: "Try later.", retryAfterSeconds: 12 },
    },
    isError: true,
  });
});
