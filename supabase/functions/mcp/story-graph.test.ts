import { assertEquals, assertRejects } from "@std/assert";
import type { ProjectMcpRequestContext } from "./context.ts";
import { McpDomainError } from "./errors.ts";
import { MAX_STORY_GRAPH_RESULT_BYTES, utf8ByteLength } from "./limits.ts";
import { readStoryGraph } from "./story-graph.ts";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const LIBRARY_ID = "22222222-2222-4222-8222-222222222222";
const ROW_1 = "33333333-3333-4333-8333-333333333333";
const ROW_2 = "44444444-4444-4444-8444-444444444444";
Deno.env.set("MCP_CURSOR_SECRET", "story-graph-test-cursor-secret");

const fieldIds = {
  Label: "50000000-0000-4000-8000-000000000001",
  Type: "50000000-0000-4000-8000-000000000002",
  Name: "50000000-0000-4000-8000-000000000003",
  Content: "50000000-0000-4000-8000-000000000004",
  Commands: "50000000-0000-4000-8000-000000000005",
  Option0: "50000000-0000-4000-8000-000000000006",
  Option0_Next: "50000000-0000-4000-8000-000000000007",
  Option0_Commands: "50000000-0000-4000-8000-000000000008",
};

function values(input: Record<string, unknown>) {
  return Object.entries(input).map(([label, value]) => ({
    fieldId: fieldIds[label as keyof typeof fieldIds],
    value,
  }));
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    library: {
      id: LIBRARY_ID,
      name: "Branching Script",
      documentExportType: "script",
      updatedAt: "2026-08-06T00:00:00.000Z",
      plotPlan: {
        version: 2,
        entryPlotNodeId: "Opening",
        storyNodeOrder: ["Intro", "Ending"],
        nodes: [
          { id: "Opening", title: "Opening", storyNodeIds: ["Intro"] },
          { id: "Ending", title: "Ending", storyNodeIds: ["Ending"] },
        ],
        edges: [{
          fromPlotNodeId: "Opening",
          toPlotNodeId: "Ending",
          optionText: "Leave",
          optionIndex: 0,
        }],
      },
    },
    fields: Object.entries(fieldIds).map(([label, id], orderIndex) => ({
      id,
      label,
      dataType: "string",
      orderIndex,
    })),
    rows: [{
      id: ROW_1,
      name: "Intro",
      rowIndex: 0,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
      values: values({
        Label: "Intro",
        Type: "3",
        Name: "",
        Content: "Choose.",
        Commands: "",
        Option0: "Leave",
        Option0_Next: "Jump Ending",
        Option0_Commands: "Set route = 1",
      }),
    }, {
      id: ROW_2,
      name: "Ending",
      rowIndex: 1,
      createdAt: "2026-08-06T00:00:01.000Z",
      updatedAt: "2026-08-06T00:00:01.000Z",
      values: values({
        Label: "Ending",
        Type: 3,
        Name: null,
        Content: "Done.",
        Commands: "End",
      }),
    }],
    ...overrides,
  };
}

function makeContext(data: unknown) {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  const context = {
    mode: "project",
    requestId: crypto.randomUUID(),
    userId: "user-1",
    projectId: PROJECT_ID,
    role: "viewer",
    clientId: null,
    bearerToken: "test-token",
    supabase: {
      async rpc(name: string, parameters: Record<string, unknown>) {
        calls.push({ name, parameters });
        return { data, error: null };
      },
    },
  } as unknown as ProjectMcpRequestContext;
  return { context, calls };
}

function linearSnapshot(nodeCount: number, contentBytes: number) {
  const labels = Array.from({ length: nodeCount }, (_, index) => `Node${index}`);
  return snapshot({
    library: {
      ...(snapshot().library as Record<string, unknown>),
      plotPlan: {
        version: 2,
        entryPlotNodeId: "Plot0",
        storyNodeOrder: labels,
        nodes: labels.map((label, index) => ({
          id: `Plot${index}`,
          title: `Plot ${index}`,
          storyNodeIds: [label],
        })),
        edges: labels.slice(1).map((_, index) => ({
          fromPlotNodeId: `Plot${index}`,
          toPlotNodeId: `Plot${index + 1}`,
          optionText: null,
          optionIndex: null,
        })),
      },
    },
    rows: labels.map((label, index) => ({
      id: crypto.randomUUID(),
      name: label,
      rowIndex: index,
      createdAt: `2026-08-06T00:00:${String(index).padStart(2, "0")}.000Z`,
      updatedAt: `2026-08-06T00:00:${String(index).padStart(2, "0")}.000Z`,
      values: values({
        Label: label,
        Type: "3",
        Name: "",
        Content: "x".repeat(contentBytes),
        Commands: index === labels.length - 1 ? "End" : "",
      }),
    })),
  });
}

Deno.test("story graph read maps one atomic snapshot into complete canonical semantics", async () => {
  const { context, calls } = makeContext(snapshot());

  const result = await readStoryGraph(context, { libraryId: LIBRARY_ID, limit: 200 });

  assertEquals(result.library.name, "Branching Script");
  assertEquals(result.graph.entryLabel, "Intro");
  assertEquals(result.graph.entryPlotNodeId, "Opening");
  assertEquals(result.items.filter((item) => item.kind === "story_node"), [{
    kind: "story_node",
    label: "Intro",
    plotNodeId: "Opening",
    plotTitle: "Opening",
    rowId: ROW_1,
    rowIndex: 1,
    nodeType: "narration",
    content: "Choose.",
    commands: "",
    terminal: false,
    nextLabel: null,
    choices: [{
      optionIndex: 0,
      text: "Leave",
      targetLabel: "Ending",
      commands: "Set route = 1",
    }],
  }, {
    kind: "story_node",
    label: "Ending",
    plotNodeId: "Ending",
    plotTitle: "Ending",
    rowId: ROW_2,
    rowIndex: 2,
    nodeType: "narration",
    content: "Done.",
    commands: "",
    terminal: true,
    nextLabel: null,
    choices: [],
  }]);
  assertEquals(calls, [{
    name: "mcp_read_story_graph_snapshot",
    parameters: { p_project_id: PROJECT_ID, p_library_id: LIBRARY_ID },
  }]);
});

Deno.test("story graph read maps missing and revoked snapshots safely", async () => {
  for (const [data, code] of [
    [null, "TABLE_NOT_FOUND"],
    [{ status: "access_denied" }, "PROJECT_ACCESS_REVOKED"],
  ] as const) {
    const { context } = makeContext(data);
    const error = await assertRejects(
      () => readStoryGraph(context, { libraryId: LIBRARY_ID }),
      McpDomainError,
    );
    assertEquals(error.code, code);
  }
});

Deno.test("story graph read rejects unsupported and invalid snapshots", async () => {
  const base = snapshot();
  const unsupported = snapshot({
    library: { ...(base.library as Record<string, unknown>), documentExportType: null },
  });
  const missingFields = snapshot({
    fields: (base.fields as Array<{ label: string }>).filter((field) => field.label !== "Content"),
  });
  const invalidPlot = snapshot({
    library: {
      ...(base.library as Record<string, unknown>),
      plotPlan: {
        ...((base.library as { plotPlan: Record<string, unknown> }).plotPlan),
        storyNodeOrder: ["Intro"],
      },
    },
  });

  for (const [data, code] of [
    [unsupported, "STORY_GRAPH_UNSUPPORTED_LIBRARY"],
    [missingFields, "STORY_GRAPH_INVALID_SNAPSHOT"],
    [invalidPlot, "STORY_GRAPH_INVALID_SNAPSHOT"],
  ] as const) {
    const { context } = makeContext(data);
    const error = await assertRejects(
      () => readStoryGraph(context, { libraryId: LIBRARY_ID }),
      McpDomainError,
    );
    assertEquals(error.code, code);
  }
});

Deno.test("story graph cursor pages one stable typed stream without gaps", async () => {
  const { context } = makeContext(snapshot());
  const items: Array<{ kind: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await readStoryGraph(context, {
      libraryId: LIBRARY_ID,
      limit: 2,
      ...(cursor ? { cursor } : {}),
    });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    assertEquals(page.returnedCount, page.items.length);
    assertEquals(page.hasMore, cursor !== undefined);
  } while (cursor);

  assertEquals(items.map((item) => item.kind), [
    "plot_node",
    "plot_node",
    "plot_edge",
    "story_node",
    "story_node",
  ]);
});

Deno.test("story graph cursor rejects changed snapshots and changed limits", async () => {
  const first = await readStoryGraph(makeContext(snapshot()).context, {
    libraryId: LIBRARY_ID,
    limit: 2,
  });
  const changed = snapshot();
  const changedRows = structuredClone(changed.rows) as Array<Record<string, unknown>>;
  const firstValues = changedRows[0].values as Array<Record<string, unknown>>;
  firstValues.find((value) => value.fieldId === fieldIds.Content)!.value = "Changed.";

  const conflict = await assertRejects(
    () => readStoryGraph(makeContext({ ...changed, rows: changedRows }).context, {
      libraryId: LIBRARY_ID,
      limit: 2,
      cursor: first.nextCursor!,
    }),
    McpDomainError,
  );
  assertEquals(conflict.code, "STORY_GRAPH_CONFLICT");

  const invalid = await assertRejects(
    () => readStoryGraph(makeContext(snapshot()).context, {
      libraryId: LIBRARY_ID,
      limit: 3,
      cursor: first.nextCursor!,
    }),
    McpDomainError,
  );
  assertEquals(invalid.code, "INVALID_CURSOR");
});

Deno.test("story graph pages adapt to the response budget without truncating items", async () => {
  const result = await readStoryGraph(makeContext(linearSnapshot(4, 300 * 1024)).context, {
    libraryId: LIBRARY_ID,
    limit: 200,
  });

  assertEquals(result.hasMore, true);
  assertEquals(result.returnedCount < 11, true);
  assertEquals(
    utf8ByteLength(JSON.stringify(result)) < MAX_STORY_GRAPH_RESULT_BYTES,
    true,
  );
});

Deno.test("story graph rejects a single item that cannot fit losslessly", async () => {
  const context = makeContext(linearSnapshot(1, 1024 * 1024)).context;
  const first = await readStoryGraph(context, { libraryId: LIBRARY_ID, limit: 200 });
  assertEquals(first.items.map((item) => item.kind), ["plot_node"]);

  const error = await assertRejects(
    () => readStoryGraph(context, {
      libraryId: LIBRARY_ID,
      limit: 200,
      cursor: first.nextCursor!,
    }),
    McpDomainError,
  );
  assertEquals(error.code, "PAYLOAD_TOO_LARGE");
});
