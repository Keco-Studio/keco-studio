import { assertEquals } from "@std/assert";
import type { McpServer } from "@mcp/server/mcp.js";
import type {
  AccountMcpRequestContext,
  ProjectMcpRequestContext,
} from "./context.ts";
import { registerGdsTools } from "./gds-tools.ts";

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}>;

type RegisteredTool = {
  name: string;
  config: {
    inputSchema: {
      safeParse: (value: unknown) => { success: boolean };
    };
  };
  handler: ToolHandler;
};

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
  projectId: "11111111-1111-4111-8111-111111111111",
  role: "admin",
  clientId: null,
  bearerToken: "project-token",
  supabase: {},
} as unknown as ProjectMcpRequestContext;

function recordingServer(): {
  server: McpServer;
  tools: RegisteredTool[];
} {
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

const expectedNames = [
  "list_game_design_systems",
  "read_game_design_system",
  "read_project_game_design_system",
  "get_game_design_system_generation",
  "create_game_design_system",
  "generate_game_design_system",
  "create_game_design_system_version",
  "set_project_game_design_system",
  "clear_project_game_design_system",
];

Deno.test("GDS tools register the approved account and project schemas", () => {
  for (const context of [accountContext, projectContext]) {
    const { server, tools } = recordingServer();
    registerGdsTools(server, context, { callApp: async () => ({}) });
    assertEquals(tools.map((tool) => tool.name), expectedNames);

    const projectRead = tools.find((tool) =>
      tool.name === "read_project_game_design_system"
    )!;
    const valid = context.mode === "account"
      ? { projectId: "11111111-1111-4111-8111-111111111111" }
      : {};
    assertEquals(projectRead.config.inputSchema.safeParse(valid).success, true);
    assertEquals(
      projectRead.config.inputSchema.safeParse(
        context.mode === "account" ? {} : { projectId: valid.projectId },
      ).success,
      false,
    );

    const ownedRead = tools.find((tool) =>
      tool.name === "read_game_design_system"
    )!;
    assertEquals(
      ownedRead.config.inputSchema.safeParse({
        systemId: "22222222-2222-4222-8222-222222222222",
        projectId: "11111111-1111-4111-8111-111111111111",
      }).success,
      false,
    );
  }
});

Deno.test("GDS read and project handlers map to encoded app routes", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const { server, tools } = recordingServer();
  registerGdsTools(server, accountContext, {
    callApp: async (_context, request) => {
      calls.push(request);
      return request.path === "/api/game-design-systems"
        ? {
          systems: [{ id: "system-1", title: "Tactics", owner_id: "secret" }],
        }
        : { system: null };
    },
  });

  const list = await tools[0].handler({});
  await tools[2].handler({
    projectId: "11111111-1111-4111-8111-111111111111",
  });

  assertEquals(calls, [
    { method: "GET", path: "/api/game-design-systems" },
    {
      method: "GET",
      path:
        "/api/projects/11111111-1111-4111-8111-111111111111/game-design-system",
    },
  ]);
  assertEquals(list.structuredContent?.systems, [{
    id: "system-1",
    title: "Tactics",
  }]);
});

Deno.test("GDS mutations forward bodies and idempotency keys", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const { server, tools } = recordingServer();
  registerGdsTools(server, projectContext, {
    callApp: async (_context, request) => {
      calls.push(request);
      return request.path.includes("generation-jobs")
        ? { job: { id: "job-1", status: "queued", input_hash: "secret" } }
        : { version: { id: "version-2", system_id: "system-1" } };
    },
  });

  const generate = tools.find((tool) =>
    tool.name === "generate_game_design_system"
  )!;
  const version = tools.find((tool) =>
    tool.name === "create_game_design_system_version"
  )!;
  const generationInput = {
    title: "Tactics",
    genres: ["Strategy"],
    philosophies: [],
    description: "Turn-based encounters",
    references: [],
    referenceGames: [],
    artStyle: {
      presetId: "pixel-classic",
      presetVersion: 1,
      customization: { referenceGames: [] },
    },
    idempotencyKey: "request-1234",
  };
  await generate.handler(generationInput);
  await version.handler({
    systemId: "22222222-2222-4222-8222-222222222222",
    parentVersionId: "33333333-3333-4333-8333-333333333333",
    expectedCurrentVersionId: "33333333-3333-4333-8333-333333333333",
    rules: {
      schemaVersion: 1,
      genres: ["Strategy"],
      philosophies: [],
      suitableFor: "Tactical games",
      rules: [{
        id: "readable-state",
        kind: "principle",
        title: "Readable state",
        statement: "Keep state readable.",
        appliesWhen: "During play",
        severity: "required",
      }],
      tableGuidance: [],
    },
    idempotencyKey: "44444444-4444-4444-8444-444444444444",
  });

  const { idempotencyKey: generationKey, ...generationBody } = generationInput;
  assertEquals(calls[0], {
    method: "POST",
    path: "/api/game-design-systems/generation-jobs",
    idempotencyKey: generationKey,
    body: generationBody,
  });
  assertEquals(calls[1].method, "POST");
  assertEquals(
    calls[1].path,
    "/api/game-design-systems/22222222-2222-4222-8222-222222222222/versions",
  );
  assertEquals(
    calls[1].idempotencyKey,
    "44444444-4444-4444-8444-444444444444",
  );
});

Deno.test("GDS app failures become safe tool failures", async () => {
  const { server, tools } = recordingServer();
  registerGdsTools(server, projectContext, {
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
