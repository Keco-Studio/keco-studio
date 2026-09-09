import { assertEquals, assertMatch } from "@std/assert";
import type { ProjectMcpRequestContext } from "./context.ts";
import { MCP_ERROR_CODES } from "./errors.ts";
import { handleProtocolRequest } from "./server.ts";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const UPLOAD_PATH =
  `${USER_ID}/${PROJECT_ID}/22222222-2222-4222-8222-222222222222-hero.png`;

type StorageCall = { name: string; arguments: unknown[] };

function pngBytes(): Uint8Array {
  return Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    ),
    (character) => character.charCodeAt(0),
  );
}

function imageContext(
  storageCalls: StorageCall[],
  info: Record<string, unknown> = {
    size: 68,
    contentType: "image/png",
    createdAt: "2026-07-30T08:00:00.000Z",
  },
  content: Uint8Array = pngBytes(),
  options: {
    failPreparationFor?: string;
    missingPaths?: string[];
    registrationErrorCode?: string;
    reused?: boolean | ((registrationCount: number) => boolean);
    mutateRegistrationRow?: (row: Record<string, unknown>) => void;
  } = {},
): ProjectMcpRequestContext {
  let registrationCount = 0;
  const bucket = {
    async createSignedUploadUrl(...args: unknown[]) {
      storageCalls.push({ name: "createSignedUploadUrl", arguments: args });
      if (String(args[0]).endsWith(`-${options.failPreparationFor}`)) {
        return { data: null, error: { message: "provider detail" } };
      }
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
      if (options.missingPaths?.includes(String(args[0]))) {
        return { data: null, error: { message: "provider detail" } };
      }
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
    userId: USER_ID,
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
      async rpc(name: string, ...arguments_: unknown[]) {
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
        if (name === "mcp_register_project_game_asset") {
          registrationCount += 1;
          storageCalls.push({ name, arguments: arguments_ });
          if (options.registrationErrorCode) {
            return {
              data: null,
              error: {
                code: options.registrationErrorCode,
                message: "provider detail",
              },
            };
          }
          const input = arguments_[0] as Record<string, unknown>;
          const row: Record<string, unknown> = {
            id: "33333333-3333-4333-8333-333333333333",
            project_id: PROJECT_ID,
            created_by: USER_ID,
            name: input.p_name,
            category: input.p_category,
            status: "ready",
            mime_type: input.p_mime_type,
            storage_path: input.p_storage_path,
            sha256: input.p_sha256,
            width: input.p_width,
            height: input.p_height,
            has_transparency: input.p_has_transparency,
            file_size: input.p_file_size,
            created_at: "2026-09-09T00:00:00.000Z",
            updated_at: "2026-09-09T00:00:00.000Z",
            reused: typeof options.reused === "function"
              ? options.reused(registrationCount)
              : options.reused ?? false,
          };
          options.mutateRegistrationRow?.(row);
          return {
            data: [row],
            error: null,
          };
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
    new RegExp(`^${USER_ID}/${PROJECT_ID}/[0-9a-f-]{36}-hero\\.png$`),
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
      `${USER_ID}/33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222-hero.png`,
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

Deno.test("prepare_image_uploads preserves order and scopes runtime failures to items", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(
    imageContext(calls, undefined, pngBytes(), {
      failPreparationFor: "bad.png",
    }),
    "prepare_image_uploads",
    {
      files: [
        { fileName: "first.png", fileType: "image/png", fileSize: 68 },
        { fileName: "bad.png", fileType: "image/png", fileSize: 68 },
        { fileName: "last.png", fileType: "image/png", fileSize: 68 },
      ],
    },
  );

  assertEquals(message.result?.isError, undefined);
  const structured = message.result?.structuredContent as {
    ok: boolean;
    preparedCount: number;
    failedCount: number;
    items: Array<Record<string, unknown>>;
  };
  assertEquals(structured.ok, true);
  assertEquals(structured.preparedCount, 2);
  assertEquals(structured.failedCount, 1);
  assertEquals(structured.items.map((item) => item.index), [0, 1, 2]);
  assertEquals(structured.items.map((item) => item.ok), [true, false, true]);
  assertMatch(
    JSON.stringify(structured.items[1]),
    /IMAGE_UPLOAD_PREPARATION_FAILED/,
  );
  assertEquals(JSON.stringify(structured).includes("provider detail"), false);
});

Deno.test("prepare_image_uploads rejects invalid batch metadata before storage work", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(imageContext(calls), "prepare_image_uploads", {
    files: [{ fileName: "wrong.jpg", fileType: "image/png", fileSize: 68 }],
  });

  assertEquals(message.result?.isError, true);
  assertEquals(calls.length, 0);
});

Deno.test("batch image schemas enforce the 1-20 item bounds before storage work", async () => {
  for (
    const files of [
      [],
      Array.from({ length: 21 }, (_, index) => ({
        fileName: `image-${index}.png`,
        fileType: "image/png",
        fileSize: 68,
      })),
    ]
  ) {
    const calls: StorageCall[] = [];
    const message = await callTool(
      imageContext(calls),
      "prepare_image_uploads",
      {
        files,
      },
    );
    assertEquals(message.result?.isError, true);
    assertEquals(calls.length, 0);
  }
});

Deno.test("complete_image_uploads preserves order and returns partial missing-object failures", async () => {
  const calls: StorageCall[] = [];
  const missing = UPLOAD_PATH.replace("hero.png", "missing.png");
  const second = UPLOAD_PATH.replace("hero.png", "second.png");
  const message = await callTool(
    imageContext(calls, undefined, pngBytes(), { missingPaths: [missing] }),
    "complete_image_uploads",
    { paths: [UPLOAD_PATH, missing, second] },
  );

  assertEquals(message.result?.isError, undefined);
  const structured = message.result?.structuredContent as {
    completedCount: number;
    failedCount: number;
    items: Array<Record<string, unknown>>;
  };
  assertEquals(structured.completedCount, 2);
  assertEquals(structured.failedCount, 1);
  assertEquals(structured.items.map((item) => item.index), [0, 1, 2]);
  assertEquals(structured.items.map((item) => item.ok), [true, false, true]);
  assertMatch(JSON.stringify(structured.items[1]), /IMAGE_UPLOAD_NOT_FOUND/);
});

Deno.test("complete_image_uploads rejects duplicate paths as a whole request", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(
    imageContext(calls),
    "complete_image_uploads",
    {
      paths: [UPLOAD_PATH, UPLOAD_PATH],
    },
  );

  assertEquals(message.result?.isError, true);
  assertEquals(calls.length, 0);
});

Deno.test("complete_image_uploads reports rejected stored images with the batch domain code", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(
    imageContext(calls, {
      size: 5 * 1024 * 1024 + 1,
      contentType: "image/png",
      createdAt: "2026-07-30T08:00:00.000Z",
    }),
    "complete_image_uploads",
    { paths: [UPLOAD_PATH] },
  );

  assertEquals(message.result?.isError, undefined);
  const structured = message.result?.structuredContent as {
    completedCount: number;
    failedCount: number;
    items: Array<Record<string, unknown>>;
  };
  assertEquals(structured.completedCount, 0);
  assertEquals(structured.failedCount, 1);
  assertMatch(JSON.stringify(structured.items[0]), /FIELD_VALIDATION_FAILED/);
  assertEquals(calls.some((call) => call.name === "remove"), true);
});

Deno.test("completion path errors explain image.path provenance", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(imageContext(calls), "complete_image_upload", {
    path: "/tmp/hero.png",
  });

  assertEquals(message.result?.isError, true);
  assertMatch(
    JSON.stringify(message.result),
    /image\.path returned by create_image_upload or prepare_image_uploads/,
  );
  assertEquals(calls.length, 0);
});

Deno.test("image preparation rejects non-printable-ASCII file names", async () => {
  for (
    const [tool, arguments_] of [
      ["create_image_upload", {
        fileName: "\u82f9\u679c.png",
        fileType: "image/png",
        fileSize: 68,
      }],
      ["prepare_image_uploads", {
        files: [{
          fileName: "\u82f9\u679c.png",
          fileType: "image/png",
          fileSize: 68,
        }],
      }],
    ] as const
  ) {
    const calls: StorageCall[] = [];
    const message = await callTool(imageContext(calls), tool, arguments_);

    assertEquals(message.result?.isError, true);
    assertEquals(calls.length, 0);
  }
});

Deno.test("completion rejects a prepared path that decodes to a Unicode file name", async () => {
  const calls: StorageCall[] = [];
  const encodedName = Array.from(
    new TextEncoder().encode("\u82f9\u679c.png"),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const path = UPLOAD_PATH.replace("hero.png", `~h${encodedName}`);
  const message = await callTool(
    imageContext(calls),
    "complete_project_game_asset_uploads",
    { items: [{ path }] },
  );

  assertEquals(message.result?.isError, undefined);
  assertMatch(JSON.stringify(message.result), /FIELD_VALIDATION_FAILED/);
  assertEquals(calls.length, 0);
});

Deno.test("complete_project_game_asset_uploads verifies and registers ordered items", async () => {
  const calls: StorageCall[] = [];
  const secondPath = UPLOAD_PATH.replace(
    "22222222-2222-4222-8222-222222222222-hero.png",
    "44444444-4444-4444-8444-444444444444-second.png",
  );
  const message = await callTool(
    imageContext(calls),
    "complete_project_game_asset_uploads",
    {
      items: [
        { path: UPLOAD_PATH, category: "map" },
        { path: secondPath },
      ],
    },
  );

  assertEquals(message.result?.isError, undefined);
  const result = message.result?.structuredContent as {
    completedCount: number;
    failedCount: number;
    items: Array<{
      index: number;
      ok: boolean;
      reused: boolean;
      image: { path: string };
      asset: Record<string, unknown>;
    }>;
  };
  assertEquals(result.completedCount, 2);
  assertEquals(result.failedCount, 0);
  assertEquals(result.items.map((item) => item.index), [0, 1]);
  assertEquals(result.items.map((item) => item.asset.category), [
    "map",
    "media",
  ]);
  assertEquals(
    result.items.every((item) =>
      typeof item.asset.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(item.asset.sha256)
    ),
    true,
  );
  assertEquals(result.items[0].asset, {
    id: "33333333-3333-4333-8333-333333333333",
    projectId: PROJECT_ID,
    name: "hero.png",
    category: "map",
    status: "ready",
    storagePath: UPLOAD_PATH,
    sha256: result.items[0].asset.sha256,
    width: 1,
    height: 1,
    hasTransparency: false,
    fileSize: 68,
    mimeType: "image/png",
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  });
  assertEquals(result.items.map((item) => item.image.path), [
    UPLOAD_PATH,
    secondPath,
  ]);
  const registrations = calls.filter((call) =>
    call.name === "mcp_register_project_game_asset"
  );
  assertEquals(registrations.length, 2);
  assertEquals(
    registrations.map((call) =>
      (call.arguments[0] as Record<string, unknown>).p_category
    ),
    ["map", "media"],
  );
});

Deno.test("complete_project_game_asset_uploads sends unsafe SVG dimensions as null int4 arguments", async () => {
  for (
    const source of [
      '<svg width="1.5" height="2"></svg>',
      '<svg viewBox="0 0 2147483648 2"></svg>',
    ]
  ) {
    const calls: StorageCall[] = [];
    const content = new TextEncoder().encode(source);
    const path = UPLOAD_PATH.replace("hero.png", "icon.svg");
    const message = await callTool(
      imageContext(calls, {
        size: content.byteLength,
        contentType: "image/svg+xml",
        createdAt: "2026-07-30T08:00:00.000Z",
      }, content),
      "complete_project_game_asset_uploads",
      { items: [{ path }] },
    );

    const registration = calls.find((call) =>
      call.name === "mcp_register_project_game_asset"
    );
    if (!registration) {
      throw new Error(
        `Registration RPC was not called: ${JSON.stringify(calls)}`,
      );
    }
    assertEquals(
      message.result?.isError,
      undefined,
      JSON.stringify(message.result),
    );
    assertEquals(
      registration.arguments[0],
      {
        p_project_id: PROJECT_ID,
        p_name: "icon.svg",
        p_category: "media",
        p_mime_type: "image/svg+xml",
        p_storage_path: path,
        p_sha256: (registration.arguments[0] as Record<string, unknown>)
          .p_sha256,
        p_width: null,
        p_height: null,
        p_has_transparency: null,
        p_file_size: content.byteLength,
      },
    );
  }
});

Deno.test("complete_project_game_asset_uploads rejects an empty batch", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(
    imageContext(calls),
    "complete_project_game_asset_uploads",
    { items: [] },
  );

  assertEquals(message.result?.isError, true);
  assertMatch(JSON.stringify(message.result), /Invalid arguments for tool/);
  assertEquals(calls.length, 0);
});

Deno.test("complete_project_game_asset_uploads rejects invalid categories", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(
    imageContext(calls),
    "complete_project_game_asset_uploads",
    { items: [{ path: UPLOAD_PATH, category: "animation" }] },
  );

  assertEquals(message.result?.isError, true);
  assertMatch(JSON.stringify(message.result), /Invalid arguments for tool/);
  assertEquals(calls.length, 0);
});

Deno.test("complete_project_game_asset_uploads rejects duplicate paths", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(
    imageContext(calls),
    "complete_project_game_asset_uploads",
    { items: [{ path: UPLOAD_PATH }, { path: UPLOAD_PATH }] },
  );

  assertEquals(message.result?.isError, true);
  assertMatch(JSON.stringify(message.result), /Invalid arguments for tool/);
  assertEquals(calls.length, 0);
});

Deno.test("complete_project_game_asset_uploads rejects local paths structurally", async () => {
  for (const path of ["/tmp/hero.png", "C:\\tmp\\hero.png"]) {
    const calls: StorageCall[] = [];
    const message = await callTool(
      imageContext(calls),
      "complete_project_game_asset_uploads",
      { items: [{ path }] },
    );

    assertEquals(message.result?.isError, true);
    assertMatch(JSON.stringify(message.result), /Invalid arguments for tool/);
    assertEquals(calls.length, 0);
  }
});

Deno.test("complete_project_game_asset_uploads rejects file URIs structurally", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(
    imageContext(calls),
    "complete_project_game_asset_uploads",
    { items: [{ path: "file:///tmp/hero.png" }] },
  );

  assertEquals(message.result?.isError, true);
  assertMatch(JSON.stringify(message.result), /Invalid arguments for tool/);
  assertEquals(calls.length, 0);
});

Deno.test("complete_project_game_asset_uploads rejects public URLs structurally", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(
    imageContext(calls),
    "complete_project_game_asset_uploads",
    {
      items: [{
        path:
          `https://storage.example/object/public/library-media-files/${UPLOAD_PATH}`,
      }],
    },
  );

  assertEquals(message.result?.isError, true);
  assertMatch(JSON.stringify(message.result), /Invalid arguments for tool/);
  assertEquals(calls.length, 0);
});

Deno.test("complete_project_game_asset_uploads rejects signed URLs structurally", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(
    imageContext(calls),
    "complete_project_game_asset_uploads",
    {
      items: [{
        path: `https://storage.example/upload/${UPLOAD_PATH}?token=signed`,
      }],
    },
  );

  assertEquals(message.result?.isError, true);
  assertMatch(JSON.stringify(message.result), /Invalid arguments for tool/);
  assertEquals(calls.length, 0);
});

Deno.test("project_game_asset registration conflict is a public MCP error code", () => {
  assertEquals(
    (MCP_ERROR_CODES as readonly string[]).includes(
      "ASSET_REGISTRATION_CONFLICT",
    ),
    true,
  );
});

Deno.test("complete_project_game_asset_uploads keeps missing objects item scoped", async () => {
  const calls: StorageCall[] = [];
  const missingPath = UPLOAD_PATH.replace(
    "22222222-2222-4222-8222-222222222222-hero.png",
    "44444444-4444-4444-8444-444444444444-missing.png",
  );
  const message = await callTool(
    imageContext(calls, undefined, pngBytes(), {
      missingPaths: [missingPath],
    }),
    "complete_project_game_asset_uploads",
    { items: [{ path: UPLOAD_PATH }, { path: missingPath }] },
  );

  assertEquals(message.result?.isError, undefined);
  const result = message.result?.structuredContent as {
    completedCount: number;
    failedCount: number;
    items: Array<Record<string, unknown>>;
  };
  assertEquals(result.completedCount, 1);
  assertEquals(result.failedCount, 1);
  assertEquals(result.items.map((item) => item.ok), [true, false]);
  assertMatch(JSON.stringify(result.items[1]), /IMAGE_UPLOAD_NOT_FOUND/);
});

Deno.test("complete_project_game_asset_uploads normalizes oversized item errors", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(
    imageContext(calls, {
      size: 5 * 1024 * 1024 + 1,
      contentType: "image/png",
      createdAt: "2026-07-30T08:00:00.000Z",
    }),
    "complete_project_game_asset_uploads",
    { items: [{ path: UPLOAD_PATH }] },
  );

  assertEquals(message.result?.isError, undefined);
  assertMatch(JSON.stringify(message.result), /FIELD_VALIDATION_FAILED/);
  assertEquals(
    JSON.stringify(message.result).includes("PAYLOAD_TOO_LARGE"),
    false,
  );
  assertEquals(calls.some((call) => call.name === "remove"), true);
});

Deno.test("complete_project_game_asset_uploads maps KA401 to PROJECT_WRITE_FORBIDDEN", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(
    imageContext(calls, undefined, pngBytes(), {
      registrationErrorCode: "KA401",
    }),
    "complete_project_game_asset_uploads",
    { items: [{ path: UPLOAD_PATH }] },
  );

  assertEquals(message.result?.isError, undefined);
  assertMatch(JSON.stringify(message.result), /PROJECT_WRITE_FORBIDDEN/);
  assertEquals(
    JSON.stringify(message.result).includes("provider detail"),
    false,
  );
});

Deno.test("complete_project_game_asset_uploads maps KA409 to ASSET_REGISTRATION_CONFLICT", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(
    imageContext(calls, undefined, pngBytes(), {
      registrationErrorCode: "KA409",
    }),
    "complete_project_game_asset_uploads",
    { items: [{ path: UPLOAD_PATH }] },
  );

  assertEquals(message.result?.isError, undefined);
  assertMatch(JSON.stringify(message.result), /ASSET_REGISTRATION_CONFLICT/);
});

Deno.test("complete_project_game_asset_uploads propagates exact retry reuse", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(
    imageContext(calls, undefined, pngBytes(), { reused: true }),
    "complete_project_game_asset_uploads",
    { items: [{ path: UPLOAD_PATH }] },
  );

  assertEquals(message.result?.isError, undefined);
  const result = message.result?.structuredContent as {
    items: Array<{ reused: boolean; asset: { id: string } }>;
  };
  assertEquals(result.items[0].reused, true);
  assertEquals(
    result.items[0].asset.id,
    "33333333-3333-4333-8333-333333333333",
  );
});

const RAW_REGISTRATION_SENTINEL = "RAW_REGISTRATION_SENTINEL";
const malformedRegistrationRows: Array<{
  name: string;
  mutate: (row: Record<string, unknown>) => void;
}> = [
  { name: "string width", mutate: (row) => row.width = "1" },
  { name: "fractional height", mutate: (row) => row.height = 1.5 },
  { name: "zero width", mutate: (row) => row.width = 0 },
  {
    name: "out-of-range width",
    mutate: (row) => row.width = 2_147_483_648,
  },
  { name: "string file size", mutate: (row) => row.file_size = "68" },
  { name: "fractional file size", mutate: (row) => row.file_size = 67.5 },
  { name: "zero file size", mutate: (row) => row.file_size = 0 },
  {
    name: "oversized file size",
    mutate: (row) => row.file_size = 5 * 1024 * 1024 + 1,
  },
  {
    name: "invalid asset UUID",
    mutate: (row) => row.id = RAW_REGISTRATION_SENTINEL,
  },
  {
    name: "invalid project UUID",
    mutate: (row) => row.project_id = RAW_REGISTRATION_SENTINEL,
  },
  {
    name: "invalid creator UUID",
    mutate: (row) => row.created_by = RAW_REGISTRATION_SENTINEL,
  },
  {
    name: "mismatched project UUID",
    mutate: (row) => row.project_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  },
  {
    name: "mismatched creator UUID",
    mutate: (row) => row.created_by = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  },
  {
    name: "invalid created timestamp",
    mutate: (row) => row.created_at = RAW_REGISTRATION_SENTINEL,
  },
  {
    name: "invalid updated timestamp",
    mutate: (row) => row.updated_at = RAW_REGISTRATION_SENTINEL,
  },
  {
    name: "missing reused flag",
    mutate: (row) => delete row.reused,
  },
  { name: "string reused flag", mutate: (row) => row.reused = "false" },
  {
    name: "mismatched name",
    mutate: (row) => row.name = RAW_REGISTRATION_SENTINEL,
  },
  { name: "mismatched category", mutate: (row) => row.category = "icon" },
  {
    name: "mismatched MIME type",
    mutate: (row) => row.mime_type = "image/jpeg",
  },
  {
    name: "mismatched storage path",
    mutate: (row) =>
      row.storage_path = UPLOAD_PATH.replace("hero.png", "other.png"),
  },
  {
    name: "mismatched SHA-256",
    mutate: (row) => row.sha256 = "0".repeat(64),
  },
  { name: "mismatched status", mutate: (row) => row.status = "processing" },
  { name: "mismatched width", mutate: (row) => row.width = 2 },
  { name: "mismatched height", mutate: (row) => row.height = 2 },
  {
    name: "mismatched transparency",
    mutate: (row) => row.has_transparency = true,
  },
  { name: "mismatched file size", mutate: (row) => row.file_size = 67 },
];

for (const testCase of malformedRegistrationRows) {
  Deno.test(
    `complete_project_game_asset_uploads rejects malformed registration row: ${testCase.name}`,
    async () => {
      const calls: StorageCall[] = [];
      const message = await callTool(
        imageContext(calls, undefined, pngBytes(), {
          mutateRegistrationRow(row) {
            row.provider_detail = RAW_REGISTRATION_SENTINEL;
            testCase.mutate(row);
          },
        }),
        "complete_project_game_asset_uploads",
        { items: [{ path: UPLOAD_PATH, category: "map" }] },
      );

      assertEquals(message.result?.isError, undefined);
      const result = message.result?.structuredContent as {
        completedCount: number;
        failedCount: number;
        items: Array<Record<string, unknown>>;
      };
      assertEquals(result.completedCount, 0);
      assertEquals(result.failedCount, 1);
      assertEquals(result.items[0], {
        index: 0,
        ok: false,
        path: UPLOAD_PATH,
        error: {
          code: "INTERNAL_ERROR",
          message: "The project asset could not be registered.",
        },
      });
      assertEquals(
        JSON.stringify(message.result).includes(RAW_REGISTRATION_SENTINEL),
        false,
      );
    },
  );
}

Deno.test("printable ASCII names survive preparation and exact completion retry", async () => {
  for (
    const fileName of [
      "hero final.png",
      "hero+v1!.png",
      "~hero.png",
      "-hero.png",
    ]
  ) {
    const calls: StorageCall[] = [];
    const context = imageContext(calls, undefined, pngBytes(), {
      reused: (registrationCount) => registrationCount === 2,
    });
    const prepared = await callTool(context, "create_image_upload", {
      fileName,
      fileType: "image/png",
      fileSize: 68,
    });
    const preparedImage = (prepared.result?.structuredContent as {
      image: { path: string; fileName: string };
    }).image;
    assertEquals(preparedImage.fileName, fileName);
    if (fileName === "-hero.png") {
      assertMatch(preparedImage.path, /--hero\.png$/);
    } else {
      assertMatch(preparedImage.path, /-~h[0-9a-f]+$/i);
    }

    const results = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const completed = await callTool(
        context,
        "complete_project_game_asset_uploads",
        { items: [{ path: preparedImage.path }] },
      );
      assertEquals(completed.result?.isError, undefined);
      results.push(
        (completed.result?.structuredContent as {
          items: Array<{
            reused: boolean;
            image: { fileName: string };
            asset: { id: string; name: string };
          }>;
        }).items[0],
      );
    }

    assertEquals(results.map((item) => item.reused), [false, true]);
    assertEquals(results[0].asset.id, results[1].asset.id);
    assertEquals(
      results.map((item) => [item.image.fileName, item.asset.name]),
      [[fileName, fileName], [fileName, fileName]],
    );
    assertEquals(
      calls.filter((call) => call.name === "mcp_register_project_game_asset")
        .map((call) => (call.arguments[0] as Record<string, unknown>).p_name),
      [fileName, fileName],
    );
  }
});

Deno.test("completion remains compatible with existing sanitized image paths", async () => {
  const calls: StorageCall[] = [];
  const legacyPath = UPLOAD_PATH.replace("hero.png", "hero_final.png");
  const completed = await callTool(
    imageContext(calls),
    "complete_project_game_asset_uploads",
    { items: [{ path: legacyPath }] },
  );

  assertEquals(completed.result?.isError, undefined);
  const item = (completed.result?.structuredContent as {
    items: Array<{ image: { fileName: string }; asset: { name: string } }>;
  }).items[0];
  assertEquals(item.image.fileName, "hero_final.png");
  assertEquals(item.asset.name, "hero_final.png");
});

Deno.test("complete_project_game_asset_uploads accepts prepared leading-hyphen names", async () => {
  const calls: StorageCall[] = [];
  const fileName = "-hero.png";
  const prepared = await callTool(
    imageContext(calls),
    "create_image_upload",
    { fileName, fileType: "image/png", fileSize: 68 },
  );
  const path = (prepared.result?.structuredContent as {
    image: { path: string };
  }).image.path;
  assertMatch(path, /--hero\.png$/);

  const completed = await callTool(
    imageContext(calls),
    "complete_project_game_asset_uploads",
    { items: [{ path }] },
  );

  assertEquals(completed.result?.isError, undefined);
  const result = completed.result?.structuredContent as {
    completedCount: number;
    failedCount: number;
    items: Array<{ asset: { name: string } }>;
  };
  assertEquals(result.completedCount, 1);
  assertEquals(result.failedCount, 0);
  assertEquals(result.items[0].asset.name, fileName);
});

Deno.test("complete_project_game_asset_uploads omits upload credentials and bytes", async () => {
  const calls: StorageCall[] = [];
  const message = await callTool(
    imageContext(calls),
    "complete_project_game_asset_uploads",
    { items: [{ path: UPLOAD_PATH }] },
  );

  assertEquals(message.result?.isError, undefined);
  const result = JSON.stringify(message.result?.structuredContent);
  assertEquals(
    result.includes("https://storage.example/upload?token=signed"),
    false,
  );
  assertEquals(result.includes("headers"), false);
  assertEquals(result.includes("bytes"), false);
  assertEquals(result.includes("iVBOR"), false);
});

Deno.test("complete_project_game_asset_uploads leaves actor and project matching to verification", async () => {
  const calls: StorageCall[] = [];
  const otherActorPath = UPLOAD_PATH.replace(
    USER_ID,
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  );
  const message = await callTool(
    imageContext(calls),
    "complete_project_game_asset_uploads",
    { items: [{ path: otherActorPath }] },
  );

  assertEquals(message.result?.isError, undefined);
  assertMatch(JSON.stringify(message.result), /FIELD_VALIDATION_FAILED/);
  assertEquals(calls.length, 0);
});
