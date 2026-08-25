import { assertEquals, assertMatch } from "@std/assert";
import type { McpServer } from "@mcp/server/mcp.js";
import type {
  AccountMcpRequestContext,
  ProjectMcpRequestContext,
} from "./context.ts";
import { callKecoApp } from "./app-bridge.ts";
import { registerMapTools } from "./map-tools.ts";

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}>;
type RegisteredTool = {
  name: string;
  config: {
    description: string;
    annotations: Record<string, boolean>;
    inputSchema: { safeParse(value: unknown): { success: boolean } };
  };
  handler: ToolHandler;
};

const IDS = {
  projectId: "11111111-1111-4111-8111-111111111111",
  mapId: "22222222-2222-4222-8222-222222222222",
  revisionId: "33333333-3333-4333-8333-333333333333",
  assetId: "44444444-4444-4444-8444-444444444444",
  generationId: "55555555-5555-4555-8555-555555555555",
  requestId: "66666666-6666-4666-8666-666666666666",
};
const fingerprint = "a".repeat(64);
const accountContext = {
  mode: "account",
  requestId: "request-1",
  userId: "user-1",
  clientId: "client-1",
  sessionId: "session-1",
  bearerToken: "account-token",
  supabase: {},
} as unknown as AccountMcpRequestContext;
const projectContext = {
  mode: "project",
  requestId: "request-2",
  userId: "user-1",
  projectId: IDS.projectId,
  role: "editor",
  clientId: null,
  bearerToken: "project-token",
  supabase: {},
} as unknown as ProjectMcpRequestContext;

const expectedNames = [
  "list_maps",
  "read_map",
  "create_map_draft",
  "update_map_draft",
  "prepare_map_generation",
  "start_map_generation",
  "get_map_generation",
  "advance_map_generation",
];

function recordingServer() {
  const tools: RegisteredTool[] = [];
  const server = {
    registerTool(
      name: string,
      config: RegisteredTool["config"],
      handler: ToolHandler,
    ) {
      tools.push({ name, config, handler });
    },
  } as unknown as McpServer;
  return { server, tools };
}

function identity(projectId = IDS.projectId) {
  return {
    projectId,
    mapId: IDS.mapId,
    revisionId: IDS.revisionId,
    assetId: IDS.assetId,
    generationId: IDS.generationId,
    planFingerprint: fingerprint,
  };
}

Deno.test("Map tools register strict account and legacy project schemas", () => {
  for (const context of [accountContext, projectContext]) {
    const { server, tools } = recordingServer();
    registerMapTools(server, context, { callApp: async () => ({}) });
    assertEquals(tools.map((tool) => tool.name), expectedNames);
    for (const tool of tools) {
      const base = tool.name === "list_maps"
        ? {}
        : tool.name === "read_map"
        ? { mapId: IDS.mapId }
        : null;
      if (base) {
        const valid = context.mode === "account"
          ? { projectId: IDS.projectId, ...base }
          : base;
        assertEquals(tool.config.inputSchema.safeParse(valid).success, true);
        const forged = context.mode === "account"
          ? base
          : { projectId: IDS.projectId, ...base };
        assertEquals(tool.config.inputSchema.safeParse(forged).success, false);
      }
    }
  }

  const { server, tools } = recordingServer();
  registerMapTools(server, accountContext, { callApp: async () => ({}) });
  const create = tools.find((tool) => tool.name === "create_map_draft")!;
  assertEquals(
    create.config.inputSchema.safeParse({
      projectId: IDS.projectId,
      description: "Mountain village",
      documentId: null,
      referenceIds: [],
      styleReferenceId: null,
      referenceRoles: {},
      referenceUsage: {},
      styleCopy: [],
      idempotencyKey: "not-a-uuid",
    }).success,
    false,
  );
  const start = tools.find((tool) => tool.name === "start_map_generation")!;
  assertEquals(
    start.config.inputSchema.safeParse({
      ...identity(),
      confirmationToken: "signed-confirmation",
      confirmPaidGeneration: false,
    }).success,
    false,
  );
  assertEquals(
    start.config.inputSchema.safeParse({
      ...identity(),
      confirmationToken: "signed-confirmation",
      confirmPaidGeneration: true,
    }).success,
    true,
  );
  assertMatch(
    start.config.description,
    /fee notice[\s\S]*explicit confirmation/i,
  );
  const get = tools.find((tool) => tool.name === "get_map_generation")!;
  const advance = tools.find((tool) => tool.name === "advance_map_generation")!;
  assertEquals(get.config.annotations.readOnlyHint, true);
  assertEquals(advance.config.annotations.readOnlyHint, false);
});

Deno.test("viewer Map tools expose provider-free generation reads only", () => {
  const { server, tools } = recordingServer();
  registerMapTools(server, { ...projectContext, role: "viewer" }, {
    callApp: async () => ({}),
  });
  assertEquals(tools.map((tool) => tool.name), [
    "list_maps",
    "read_map",
    "get_map_generation",
  ]);
});

Deno.test("Map tools map account and project inputs to the strict app action route", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const { server, tools } = recordingServer();
  registerMapTools(server, projectContext, {
    callApp: async (_context, request) => {
      calls.push(request);
      if (
        (request.body as { action?: string }).action ===
          "prepare_map_generation"
      ) {
        return {
          assetId: IDS.assetId,
          status: "planned",
          confirmationToken: "signed-confirmation",
          feeNotice: "Paid generation consumes credits.",
          providerSecret: "remove-me",
        };
      }
      if ((request.body as { action?: string }).action === "get_map_generation") {
        return {
          assetId: IDS.assetId,
          status: "failed",
          attemptCount: 3,
          providerSecret: "remove-me",
        };
      }
      return { items: [], returnedCount: 0, bearerToken: "remove-me" };
    },
  });

  await tools.find((tool) => tool.name === "list_maps")!.handler({});
  const prepared = await tools.find((tool) =>
    tool.name === "prepare_map_generation"
  )!.handler({
    mapId: IDS.mapId,
    revisionId: IDS.revisionId,
    saveVersion: 0,
  });

  assertEquals(calls, [
    {
      method: "POST",
      path: "/api/mcp/create-map",
      body: { action: "list_maps", projectId: IDS.projectId },
    },
    {
      method: "POST",
      path: "/api/mcp/create-map",
      body: {
        action: "prepare_map_generation",
        projectId: IDS.projectId,
        mapId: IDS.mapId,
        revisionId: IDS.revisionId,
        saveVersion: 0,
      },
    },
  ]);
  assertEquals(prepared.structuredContent, {
    ok: true,
    assetId: IDS.assetId,
    status: "planned",
    confirmationToken: "signed-confirmation",
    feeNotice: "Paid generation consumes credits.",
  });

  const generation = await tools.find((tool) => tool.name === "get_map_generation")!.handler(identity());
  assertEquals(generation.structuredContent, {
    ok: true,
    assetId: IDS.assetId,
    status: "failed",
    attemptCount: 3,
  });
});

Deno.test("Map generation start forwards only literal confirmation inputs", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const { server, tools } = recordingServer();
  registerMapTools(server, accountContext, {
    callApp: async (_context, request) => {
      calls.push(request);
      return {
        assetId: IDS.assetId,
        status: "generating",
        rawProvider: "remove",
      };
    },
  });
  const result = await tools.find((tool) =>
    tool.name === "start_map_generation"
  )!.handler({
    ...identity(),
    confirmationToken: "signed-confirmation",
    confirmPaidGeneration: true,
  });
  assertEquals(calls[0], {
    method: "POST",
    path: "/api/mcp/create-map",
    body: {
      action: "start_map_generation",
      ...identity(),
      confirmationToken: "signed-confirmation",
      confirmPaidGeneration: true,
    },
  });
  assertEquals(result.structuredContent, {
    ok: true,
    assetId: IDS.assetId,
    status: "generating",
  });
});

Deno.test("Map app failures become safe tool failures", async () => {
  const { server, tools } = recordingServer();
  registerMapTools(server, projectContext, {
    callApp: () => Promise.reject(new Error("Bearer private-token")),
  });
  const result = await tools[0].handler({});
  assertEquals(result.isError, true);
  assertEquals(result.structuredContent, {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "The Keco MCP operation failed.",
    },
  });
});

Deno.test("unsafe map descriptions return actionable non-retryable tool failures", async () => {
  const safeMessage = "The map description contains unsupported instructions. Remove provider or API controls, credentials, URLs, and dynamic Keco UI instructions, then create a new draft request.";
  const { server, tools } = recordingServer();
  registerMapTools(server, projectContext, {
    callApp: (context, request) => callKecoApp(context, request, {
      origin: "https://keco.test",
      fetch: (() => Promise.resolve(Response.json({
        code: "FIELD_VALIDATION_FAILED",
        error: safeMessage,
      }, { status: 400 }))) as typeof fetch,
    }),
  });

  const result = await tools.find((tool) =>
    tool.name === "create_map_draft"
  )!.handler({
    description: "Unsupported map instructions",
    documentId: null,
    referenceIds: [],
    styleReferenceId: null,
    referenceRoles: {},
    referenceUsage: {},
    styleCopy: [],
    idempotencyKey: IDS.requestId,
  });

  assertEquals(result.isError, true);
  assertEquals(result.structuredContent, {
    ok: false,
    error: {
      code: "FIELD_VALIDATION_FAILED",
      message: safeMessage,
      retryable: false,
    },
  });
});
