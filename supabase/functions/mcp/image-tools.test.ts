import { assertEquals, assertMatch } from "@std/assert";
import type { ProjectMcpRequestContext } from "./context.ts";
import { handleProtocolRequest } from "./server.ts";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const UPLOAD_PATH =
  `user-1/${PROJECT_ID}/22222222-2222-4222-8222-222222222222-hero.png`;

type StorageCall = { name: string; arguments: unknown[] };

function pngBytes(size = 68): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

function imageContext(
  storageCalls: StorageCall[],
  info: Record<string, unknown> = {
    size: 68,
    contentType: "image/png",
    createdAt: "2026-07-30T08:00:00.000Z",
  },
  content: Uint8Array = pngBytes(),
): ProjectMcpRequestContext {
  const bucket = {
    async createSignedUploadUrl(...args: unknown[]) {
      storageCalls.push({ name: "createSignedUploadUrl", arguments: args });
      return {
        data: {
          signedUrl: "https://storage.example/upload?token=signed",
          path: args[0],
          token: "signed",
        },
        error: null,
      };
    },
    async info(...args: unknown[]) {
      storageCalls.push({ name: "info", arguments: args });
      return { data: info, error: null };
    },
    async download(...args: unknown[]) {
      storageCalls.push({ name: "download", arguments: args });
      const bytes = content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength,
      ) as ArrayBuffer;
      return { data: new Blob([bytes]), error: null };
    },
    async remove(...args: unknown[]) {
      storageCalls.push({ name: "remove", arguments: args });
      return { data: [], error: null };
    },
    getPublicUrl(path: string) {
      storageCalls.push({ name: "getPublicUrl", arguments: [path] });
      return {
        data: {
          publicUrl:
            `https://storage.example/object/public/library-media-files/${path}`,
        },
      };
    },
  };
  return {
    mode: "project",
    requestId: crypto.randomUUID(),
    userId: "user-1",
    projectId: PROJECT_ID,
    role: "editor",
    clientId: null,
    bearerToken: "test-token",
    supabase: {
      storage: {
        from(name: string) {
          storageCalls.push({ name: "from", arguments: [name] });
          return bucket;
        },
      },
      async rpc(name: string) {
        if (name === "mcp_begin_operation") {
          return {
            data: [{
              operation_id: crypto.randomUUID(),
              remaining: 239,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            }],
            error: null,
          };
        }
        if (name === "mcp_complete_operation") {
          return { data: null, error: null };
        }
        throw new Error("Unexpected RPC: " + name);
      },
    },
  } as unknown as ProjectMcpRequestContext;
}

async function callTool(
  context: ProjectMcpRequestContext,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await handleProtocolRequest(
    new Request("http://localhost/mcp/project", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
    context,
  );
  assertEquals(response.status, 200);
  return await response.json() as {
    result?: {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };
  };
}

Deno.test("create_image_upload returns a project-scoped signed PUT target", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(imageContext(calls), "create_image_upload", {
    fileName: "hero.png",
    fileType: "image/png",
    fileSize: 68,
  });

  assertEquals(message.result?.isError, undefined);
  const structured = message.result?.structuredContent as {
    ok: boolean;
    upload: Record<string, unknown>;
    image: Record<string, unknown>;
  };
  assertEquals(structured.ok, true);
  assertEquals(structured.upload, {
    url: "https://storage.example/upload?token=signed",
    method: "PUT",
    headers: {
      "cache-control": "max-age=3600",
      "content-type": "image/png",
      "x-upsert": "false",
    },
    expiresInSeconds: 7200,
  });
  assertEquals(structured.image.fileName, "hero.png");
  assertEquals(structured.image.fileSize, 68);
  assertEquals(structured.image.fileType, "image/png");
  assertMatch(
    String(structured.image.path),
    new RegExp(`^user-1/${PROJECT_ID}/[0-9a-f-]{36}-hero\\.png$`),
  );
  assertEquals(calls[0], {
    name: "from",
    arguments: ["library-media-files"],
  });
  assertEquals(calls[1].name, "createSignedUploadUrl");
  assertEquals(calls[1].arguments[1], { upsert: false });
});

Deno.test("create_image_upload accepts SVG images", async () => {
  const calls: StorageCall[] = [];
  const content = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
  );
  const message = await callTool(
    imageContext(
      calls,
      {
        size: content.byteLength,
        contentType: "image/svg+xml",
        createdAt: "2026-07-30T08:00:00.000Z",
      },
      content,
    ),
    "create_image_upload",
    {
      fileName: "icon.svg",
      fileType: "image/svg+xml",
      fileSize: content.byteLength,
    },
  );

  assertEquals(message.result?.isError, undefined);
  const path = (message.result?.structuredContent as {
    image: { path: string };
  }).image.path;
  const completed = await callTool(
    imageContext(
      calls,
      {
        size: content.byteLength,
        contentType: "image/svg+xml",
        createdAt: "2026-07-30T08:00:00.000Z",
      },
      content,
    ),
    "complete_image_upload",
    { path },
  );
  assertEquals(completed.result?.isError, undefined);
  assertEquals(
    (completed.result?.structuredContent as { image: { fileType: string } })
      .image
      .fileType,
    "image/svg+xml",
  );
});

Deno.test("complete_image_upload rejects active SVG content and removes it", async () => {
  const calls: StorageCall[] = [];
  const content = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>',
  );
  const message = await callTool(
    imageContext(
      calls,
      {
        size: content.byteLength,
        contentType: "image/svg+xml",
        createdAt: "2026-07-30T08:00:00.000Z",
      },
      content,
    ),
    "complete_image_upload",
    { path: UPLOAD_PATH.replace(/\.png$/, ".svg") },
  );

  assertEquals(message.result?.isError, true);
  assertMatch(JSON.stringify(message.result), /FIELD_VALIDATION_FAILED/);
  assertEquals(calls.map((call) => call.name), [
    "from",
    "info",
    "download",
    "from",
    "remove",
  ]);
});

Deno.test("complete_image_upload returns table-compatible media metadata", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(imageContext(calls), "complete_image_upload", {
    path: UPLOAD_PATH,
  });

  assertEquals(message.result?.isError, undefined);
  assertEquals(message.result?.structuredContent, {
    ok: true,
    image: {
      url:
        `https://storage.example/object/public/library-media-files/${UPLOAD_PATH}`,
      path: UPLOAD_PATH,
      fileName: "hero.png",
      fileSize: 68,
      fileType: "image/png",
      uploadedAt: "2026-07-30T08:00:00.000Z",
    },
  });
  assertEquals(calls.map((call) => call.name), [
    "from",
    "info",
    "download",
    "getPublicUrl",
  ]);
});

Deno.test("complete_image_upload rejects paths outside the current project", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(imageContext(calls), "complete_image_upload", {
    path:
      "user-1/33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222-hero.png",
  });

  assertEquals(message.result?.isError, true);
  assertMatch(JSON.stringify(message.result), /FIELD_VALIDATION_FAILED/);
  assertEquals(calls.length, 0);
});

Deno.test("complete_image_upload removes an oversized uploaded object", async () => {
  const calls: StorageCall[] = [];
  const context = imageContext(calls, {
    size: 5 * 1024 * 1024 + 1,
    contentType: "image/png",
    createdAt: "2026-07-30T08:00:00.000Z",
  });
  const message = await callTool(context, "complete_image_upload", {
    path: UPLOAD_PATH,
  });

  assertEquals(message.result?.isError, true);
  assertMatch(JSON.stringify(message.result), /PAYLOAD_TOO_LARGE/);
  assertEquals(calls.map((call) => call.name), [
    "from",
    "info",
    "from",
    "remove",
  ]);
  assertEquals(calls[3].arguments, [[UPLOAD_PATH]]);
});

Deno.test("complete_image_upload removes content that is not really an image", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(
    imageContext(calls, undefined, new Uint8Array(68)),
    "complete_image_upload",
    { path: UPLOAD_PATH },
  );

  assertEquals(message.result?.isError, true);
  assertMatch(JSON.stringify(message.result), /FIELD_VALIDATION_FAILED/);
  assertEquals(calls.map((call) => call.name), [
    "from",
    "info",
    "download",
    "from",
    "remove",
  ]);
});
