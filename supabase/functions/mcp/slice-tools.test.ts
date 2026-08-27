import { assertEquals, assertMatch } from "@std/assert";
import type { McpServer } from "@mcp/server/mcp.js";
import type { ProjectMcpRequestContext } from "./context.ts";
import {
  registerAccountSliceReadTools,
  registerAccountSliceWriteTools,
  registerSliceTools,
} from "./slice-tools.ts";

type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};
type RegisteredTool = {
  name: string;
  config: {
    annotations: Record<string, boolean>;
    inputSchema: { safeParse(value: unknown): { success: boolean } };
  };
  handler(input: Record<string, unknown>): Promise<ToolResult>;
};
type RpcCall = { name: string; parameters: Record<string, unknown> };

const IDS = {
  project: "11111111-1111-4111-8111-111111111111",
  folder: "22222222-2222-4222-8222-222222222222",
  run: "33333333-3333-4333-8333-333333333333",
  state: "44444444-4444-4444-8444-444444444444",
  nextState: "55555555-5555-4555-8555-555555555555",
  event: "66666666-6666-4666-8666-666666666666",
  documents: [
    "77777777-7777-4777-8777-777777777771",
    "77777777-7777-4777-8777-777777777772",
    "77777777-7777-4777-8777-777777777773",
    "77777777-7777-4777-8777-777777777774",
  ],
};
const hash = (character: string) => `sha256:${character.repeat(64)}`;
async function sha256Utf8(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return "sha256:" + Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function exportFiles() {
  return await Promise.all(kinds.map(async (kind, index) => {
    const content = `# ${kind} ${index} \u00e9\n`;
    return {
      kind,
      repositoryPath: documentMap[kind].repositoryPath,
      documentId: IDS.documents[index],
      epoch: 0,
      revision: 1,
      byteCount: new TextEncoder().encode(content).byteLength,
      sha256: await sha256Utf8(content),
      content,
    };
  }));
}
const projection = {
  schemaVersion: 1,
  implementationStatus: "completed",
  runtimeVerificationStatus: "passed",
  acceptanceStatus: "passed",
  releaseReadiness: "ready",
};
const plan = {
  schemaVersion: 1,
  planRevision: hash("1"),
  allowedFiles: ["game/cats.gd"],
  tasks: [{
    id: "task-1",
    files: ["game/cats.gd"],
    dependsOn: [],
    servesEvaluations: ["eval-1"],
    red: { command: "godot --headless --path .", expected: "fails" },
    green: { command: "godot --headless --path .", expected: "passes" },
    review: { spec: "required", quality: "required" },
  }],
};
const evalSpec = {
  schemaVersion: 1,
  evaluations: [{
    evalId: "eval-1",
    buildHash: hash("a"),
    snapshotHash: hash("b"),
    assertions: [{
      assertionId: "guardian",
      kind: "equals",
      path: "/guardianRoundtrip",
      expected: true,
    }],
  }],
};
const policy = {
  schemaVersion: 1,
  requiredArtifacts: [
    "TaskResult",
    "TaskReview",
    "EvalReport",
    "MirrorVerification",
  ],
  runtimeEvidenceFreshness: "current_build_and_snapshot",
  maximumRepairs: 3,
  releaseOrder: [
    "implementation",
    "runtime_verification",
    "acceptance",
    "mirrors",
    "package",
  ],
  manualReviewBlocksRelease: true,
};
const kinds = ["roadmap", "spec", "plan", "status"] as const;
const documentMap = Object.fromEntries(kinds.map((kind, index) => [kind, {
  documentId: IDS.documents[index],
  repositoryPath: `docs/slices/${kind}.${kind === "status" ? "json" : "md"}`,
  epoch: 0,
  revision: 1,
}]));
const runResult = {
  runId: IDS.run,
  sliceId: "slice-1",
  stateToken: IDS.state,
  currentSequence: 1,
  repairCount: 0,
  plan,
  evalSpec,
  deliveryPolicy: policy,
  projection,
  documents: documentMap,
  facts: {
    tasks: [{ status: "completed", resultAccepted: true, reviewAccepted: true }],
    evaluations: [{ status: "passed" }],
    manualRequired: false,
    policyBlocked: false,
    mirrorsVerified: true,
    packageReady: true,
  },
};

function recordingServer() {
  const tools: RegisteredTool[] = [];
  const server = {
    registerTool(
      name: string,
      config: RegisteredTool["config"],
      handler: RegisteredTool["handler"],
    ) {
      tools.push({ name, config, handler });
    },
  } as unknown as McpServer;
  return { server, tools };
}

function projectContext(
  calls: RpcCall[],
  responses: Record<string, unknown>,
  role: "editor" | "viewer" = "editor",
): ProjectMcpRequestContext {
  return {
    mode: "project",
    requestId: crypto.randomUUID(),
    userId: "user-1",
    projectId: IDS.project,
    role,
    clientId: null,
    bearerToken: "secret-token",
    supabase: {
      async rpc(name: string, parameters: Record<string, unknown>) {
        calls.push({ name, parameters });
        const response = responses[name];
        if (response instanceof Error) {
          return {
            data: null,
            error: { code: "KS410", message: response.message },
          };
        }
        return { data: response, error: null };
      },
    },
  } as unknown as ProjectMcpRequestContext;
}

function createInput() {
  return {
    runId: IDS.run,
    folderId: IDS.folder,
    sliceId: "slice-1",
    plan,
    evalSpec,
    deliveryPolicy: policy,
    documents: kinds.map((kind) => ({
      kind,
      name: `${kind} document`,
      repositoryPath: `docs/slices/${kind}.${
        kind === "status" ? "json" : "md"
      }`,
      markdown: `# ${kind}\n`,
    })),
    idempotencyKey: "create:slice-1",
  };
}

function checkpointInput() {
  return {
    runId: IDS.run,
    stateToken: IDS.state,
    events: [{
      eventId: IDS.event,
      eventType: "runtime_observation",
      payload: {
        observation: {
          schemaVersion: 1,
          runId: IDS.run,
          sliceId: "slice-1",
          evalId: "eval-1",
          buildHash: hash("a"),
          snapshotHash: hash("b"),
          actual: { catType: "sickly" },
          errors: [],
        },
      },
    }],
    artifacts: [],
    idempotencyKey: "checkpoint:slice-1",
  };
}

function finalizeInput() {
  return {
    runId: IDS.run,
    stateToken: IDS.state,
    requestedTerminalIntent: "delivery",
    mirrorVerification: { eventId: IDS.event, manifestHash: hash("f") },
    evalReport: {
      documentId: "88888888-8888-4888-8888-888888888888",
      name: "eval report",
      repositoryPath: "docs/slices/eval-report.md",
    },
    documents: kinds.map((kind, index) => ({
      documentId: IDS.documents[index],
      expectedEpoch: 0,
      expectedRevision: 1,
      markdown: `# ${kind}\n`,
    })),
    idempotencyKey: "finalize:slice-1",
  };
}

function implementationFinalizeInput() {
  const input = finalizeInput();
  return {
    ...input,
    requestedTerminalIntent: "implementation_complete" as const,
    mirrorVerification: undefined,
  };
}

let originalFetch: typeof fetch;

Deno.test.beforeAll(() => {
  originalFetch = globalThis.fetch;
  Deno.env.set("KECO_PUBLIC_URL", "http://codec.test");
  Deno.env.set("MCP_CODEC_SECRET", "codec-secret");
  globalThis.fetch = ((request: RequestInfo | URL, init?: RequestInit) => {
    const url = String(request);
    if (url.endsWith("/api/mcp/codec")) {
      const body = JSON.parse(String(init?.body));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            markdown: body.markdown,
            yjsStateBase64: "AQ==",
          }),
          { status: 200 },
        ),
      );
    }
    if (url.endsWith("/api/mcp/reindex")) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;
});

Deno.test.afterAll(() => {
  globalThis.fetch = originalFetch;
  Deno.env.delete("KECO_PUBLIC_URL");
  Deno.env.delete("MCP_CODEC_SECRET");
});

Deno.test("Slice tools expose strict project, viewer, and account surfaces", () => {
  const project = recordingServer();
  registerSliceTools(project.server, projectContext([], {}));
  assertEquals(project.tools.map((tool) => tool.name), [
    "create_slice_bundle",
    "checkpoint_slice",
    "finalize_slice",
    "export_slice_mirrors",
  ]);
  assertEquals(
    project.tools.find((tool) => tool.name === "create_slice_bundle")!.config
      .inputSchema.safeParse(createInput()).success,
    true,
  );
  assertEquals(
    project.tools.find((tool) => tool.name === "create_slice_bundle")!.config
      .inputSchema.safeParse({ ...createInput(), unknown: true }).success,
    false,
  );
  assertEquals(
    project.tools.find((tool) => tool.name === "checkpoint_slice")!.config
      .inputSchema.safeParse({
        ...checkpointInput(),
        events: [{
          eventId: IDS.event,
          eventType: "assertion_result",
          payload: { status: "passed" },
        }],
      }).success,
    false,
  );

  const viewer = recordingServer();
  registerSliceTools(viewer.server, projectContext([], {}, "viewer"));
  assertEquals(viewer.tools.map((tool) => tool.name), ["export_slice_mirrors"]);

  const reads = recordingServer();
  registerAccountSliceReadTools(
    reads.server,
    async () => projectContext([], {}),
  );
  assertEquals(reads.tools.map((tool) => tool.name), ["export_slice_mirrors"]);
  assertEquals(
    reads.tools[0].config.inputSchema.safeParse({
      projectId: IDS.project,
      runId: IDS.run,
    }).success,
    true,
  );
  assertEquals(
    reads.tools[0].config.inputSchema.safeParse({ runId: IDS.run }).success,
    false,
  );

  const writes = recordingServer();
  registerAccountSliceWriteTools(
    writes.server,
    async () => projectContext([], {}),
  );
  assertEquals(writes.tools.map((tool) => tool.name), [
    "create_slice_bundle",
    "checkpoint_slice",
    "finalize_slice",
  ]);
  for (const tool of [...project.tools, ...viewer.tools]) {
    assertEquals(tool.config.annotations.idempotentHint, true);
    assertEquals(
      tool.config.annotations.readOnlyHint,
      tool.name === "export_slice_mirrors",
    );
  }
});

Deno.test("create_slice_bundle encodes every document and calls one atomic mutation", async () => {
  const calls: RpcCall[] = [];
  const response = {
    ok: true,
    outcome: "created",
    runId: IDS.run,
    stateToken: IDS.state,
    currentSequence: 1,
    documents: documentMap,
    projection,
  };
  const registered = recordingServer();
  registerSliceTools(
    registered.server,
    projectContext(calls, {
      mcp_create_slice_bundle: response,
    }),
  );
  const result = await registered.tools.find((tool) =>
    tool.name === "create_slice_bundle"
  )!.handler(createInput());
  assertEquals(result.isError, undefined);
  assertEquals(result.structuredContent, response);
  const primary = calls.filter((call) =>
    call.name === "mcp_create_slice_bundle"
  );
  assertEquals(primary.length, 1);
  const documents = primary[0].parameters.p_documents as Array<
    Record<string, unknown>
  >;
  assertEquals(documents.length, 4);
  assertEquals(documents.map((document) => document.yjsState), [
    "AQ==",
    "AQ==",
    "AQ==",
    "AQ==",
  ]);
  assertEquals(
    documents.every((document) => typeof document.documentId === "string"),
    true,
  );
  assertMatch(
    String(primary[0].parameters.p_input_hash),
    /^sha256:[a-f0-9]{64}$/,
  );
  assertEquals(
    JSON.stringify(primary[0].parameters).includes("secret-token"),
    false,
  );
});

Deno.test("checkpoint_slice computes locked assertions and never sends assertion authority", async () => {
  const calls: RpcCall[] = [];
  const registered = recordingServer();
  registerSliceTools(
    registered.server,
    projectContext(calls, {
      mcp_read_slice_run: runResult,
      mcp_checkpoint_slice: {
        ok: true,
        outcome: "created",
        runId: IDS.run,
        stateToken: IDS.nextState,
        currentSequence: 3,
        repairCount: 0,
        computedEvaluations: [{
          evalId: "eval-1",
          status: "failed",
          manualRequired: false,
    assertions: [{ assertionId: "guardian", status: "failed", expected: true, reasonCode: "ACTUAL_PATH_MISSING" }],
          reasonCodes: ["ACTUAL_PATH_MISSING"],
        }],
        projection: {
          ...projection,
          runtimeVerificationStatus: "failed",
          acceptanceStatus: "failed",
          releaseReadiness: "failed",
        },
      },
    }),
  );
  const result = await registered.tools.find((tool) =>
    tool.name === "checkpoint_slice"
  )!.handler(checkpointInput());
  assertEquals(result.isError, undefined);
  assertEquals(result.structuredContent?.computedEvaluations, [{
    evalId: "eval-1",
    status: "failed",
    manualRequired: false,
    assertions: [{
      assertionId: "guardian",
      status: "failed",
      expected: true,
      reasonCode: "ACTUAL_PATH_MISSING",
    }],
    reasonCodes: ["ACTUAL_PATH_MISSING"],
  }]);
  assertEquals(calls.map((call) => call.name), [
    "mcp_read_slice_run",
    "mcp_checkpoint_slice",
  ]);
  const sentEvents = calls[1].parameters.p_events as Array<
    Record<string, unknown>
  >;
  assertEquals(sentEvents.map((event) => event.eventType), [
    "runtime_observation",
  ]);
  assertEquals(JSON.stringify(sentEvents).includes("assertion_result"), false);
  assertMatch(String(sentEvents[0].inputHash), /^sha256:[a-f0-9]{64}$/);
  assertEquals(calls[1].parameters.p_computed_evaluations, [{
    evalId: "eval-1", status: "failed", manualRequired: false,
    assertions: [{ assertionId: "guardian", status: "failed", reasonCode: "ACTUAL_PATH_MISSING", actual: undefined }],
    reasonCodes: ["ACTUAL_PATH_MISSING"],
  }]);
});

Deno.test("checkpoint stale replay reaches the atomic RPC", async () => {
  const staleCalls: RpcCall[] = [];
  const stale = recordingServer();
  registerSliceTools(
    stale.server,
    projectContext(staleCalls, {
      mcp_read_slice_run: { ...runResult, stateToken: IDS.nextState },
      mcp_checkpoint_slice: new Error("stale state"),
    }),
  );
  const staleResult = await stale.tools.find((tool) =>
    tool.name === "checkpoint_slice"
  )!.handler(checkpointInput());
  assertEquals(staleResult.isError, true);
  assertMatch(
    JSON.stringify(staleResult.structuredContent),
    /SLICE_STATE_CONFLICT/,
  );
  assertEquals(staleCalls.map((call) => call.name), ["mcp_read_slice_run", "mcp_checkpoint_slice"]);

});

Deno.test("Slice schemas reject upper-case evidence IDs and bind task evidence to the run", async () => {
  const registered = recordingServer();
  registerSliceTools(registered.server, projectContext([], {}));
  const checkpoint = registered.tools.find((tool) => tool.name === "checkpoint_slice")!;
  const upperCase = checkpoint.config.inputSchema.safeParse({
    ...checkpointInput(),
    events: [{
      ...checkpointInput().events[0],
      payload: { observation: { ...checkpointInput().events[0].payload.observation, sliceId: "Slice-1" } },
    }],
  });
  assertEquals(upperCase.success, false);

  const calls: RpcCall[] = [];
  const bound = recordingServer();
  registerSliceTools(bound.server, projectContext(calls, { mcp_read_slice_run: runResult }));
  const result = await bound.tools.find((tool) => tool.name === "checkpoint_slice")!.handler({
    ...checkpointInput(),
    events: [{
      eventId: IDS.event,
      eventType: "task_result",
      payload: {
        schemaVersion: 1, runId: IDS.run, sliceId: "slice-other", taskId: "task-1",
        planRevision: hash("1"), attemptId: crypto.randomUUID(), phase: "implementation",
        operation: { kind: "command", command: "test" },
        startedAt: "2026-08-27T00:00:00Z", endedAt: "2026-08-27T00:00:01Z",
        exitCode: 0, timedOut: false, cancelled: false, stdoutSummary: "", stdoutHash: hash("a"),
        stderrSummary: "", stderrHash: hash("b"), changedFiles: [], expectedOutcome: "completed",
        observedOutcome: "completed", status: "completed", concerns: [], artifactIds: [],
      },
    }],
  });
  assertEquals(result.isError, true);
  assertEquals(calls.map((call) => call.name), ["mcp_read_slice_run"]);
});

Deno.test("finalize encodes deterministic status, roadmap, and EvalReport projections", async () => {
  const calls: RpcCall[] = [];
  const registered = recordingServer();
  registerSliceTools(registered.server, projectContext(calls, {
    mcp_read_slice_run: runResult,
    mcp_finalize_slice: {
      ok: true, outcome: "created", runId: IDS.run, stateToken: IDS.nextState, currentSequence: 3,
      projection, documents: { ...documentMap, evalReport: {
        documentId: "88888888-8888-4888-8888-888888888888", repositoryPath: "docs/slices/eval-report.md", epoch: 0, revision: 1,
      } },
    },
  }));
  await registered.tools.find((tool) => tool.name === "finalize_slice")!.handler(implementationFinalizeInput());
  const documents = calls[1].parameters.p_documents as Array<Record<string, unknown>>;
  assertEquals(String(documents.find((document) => document.documentId === IDS.documents[0])!.markdown).includes("implementationStatus: completed"), true);
  assertEquals(String(documents.find((document) => document.kind === "evalReport")!.markdown).includes("releaseReadiness: ready"), true);
});

Deno.test("finalize returns only strict bounded database results", async () => {
  const calls: RpcCall[] = [];
  const registered = recordingServer();
  registerSliceTools(
    registered.server,
    projectContext(calls, {
      mcp_read_slice_run: runResult,
      mcp_finalize_slice: {
        ok: true,
        outcome: "created",
        runId: IDS.run,
        stateToken: IDS.nextState,
        currentSequence: 3,
        projection,
        documents: { ...documentMap, evalReport: {
          documentId: "88888888-8888-4888-8888-888888888888",
          repositoryPath: "docs/slices/eval-report.md", epoch: 0, revision: 1,
        } },
      },
    }),
  );
  const finalized = await registered.tools.find((tool) =>
    tool.name === "finalize_slice"
  )!.handler(finalizeInput());
  assertEquals(finalized.isError, undefined);
  assertEquals(calls.map((call) => call.name).slice(0, 2), [
    "mcp_read_slice_run",
    "mcp_finalize_slice",
  ]);
  const sent = calls[1].parameters.p_documents as Array<
    Record<string, unknown>
  >;
  assertEquals(sent, []);
});

Deno.test("checkpoint and both finalization phases preserve exact replay inputs", async () => {
  const calls: RpcCall[] = [];
  const response = {
    ok: true, outcome: "reused", runId: IDS.run, stateToken: IDS.nextState,
    currentSequence: 3, projection, repairCount: 0, computedEvaluations: [],
  };
  const registered = recordingServer();
  registerSliceTools(registered.server, projectContext(calls, {
    mcp_read_slice_run: runResult,
    mcp_checkpoint_slice: response,
    mcp_finalize_slice: {
      ok: true, outcome: "reused", runId: IDS.run, stateToken: IDS.nextState,
      currentSequence: 3, projection, documents: documentMap,
    },
  }));
  await registered.tools.find((tool) => tool.name === "checkpoint_slice")!.handler(checkpointInput());
  await registered.tools.find((tool) => tool.name === "finalize_slice")!.handler(implementationFinalizeInput());
  await registered.tools.find((tool) => tool.name === "finalize_slice")!.handler(finalizeInput());
  assertEquals(calls.filter((call) => call.name === "mcp_checkpoint_slice").length, 1);
  assertEquals(calls.filter((call) => call.name === "mcp_finalize_slice").length, 2);
  assertEquals((calls.filter((call) => call.name === "mcp_finalize_slice")[1].parameters.p_documents), []);
});

Deno.test("export_slice_mirrors verifies raw UTF-8 content digests", async () => {
  const files = await exportFiles();
  const registered = recordingServer();
  registerSliceTools(
    registered.server,
    projectContext([], {
      mcp_export_slice_mirrors: {
        schemaVersion: 1,
        canonicalizationVersion: 1,
        runId: IDS.run,
        stateToken: IDS.nextState,
        currentSequence: 3,
        files,
        manifestHash: hash("f"),
      },
    }),
  );

  const exported = await registered.tools.find((tool) =>
    tool.name === "export_slice_mirrors"
  )!.handler({ runId: IDS.run });
  assertEquals(exported.isError, undefined);
  assertEquals(exported.structuredContent?.files, files);
});

Deno.test("export_slice_mirrors rejects a valid-shaped incorrect digest", async () => {
  const files = await exportFiles();
  files[0] = { ...files[0], sha256: hash("0") };
  const registered = recordingServer();
  registerSliceTools(
    registered.server,
    projectContext([], {
      mcp_export_slice_mirrors: {
        schemaVersion: 1,
        canonicalizationVersion: 1,
        runId: IDS.run,
        stateToken: IDS.nextState,
        currentSequence: 3,
        files,
        manifestHash: hash("f"),
      },
    }),
  );
  const result = await registered.tools.find((tool) =>
    tool.name === "export_slice_mirrors"
  )!.handler({ runId: IDS.run });
  assertEquals(result.isError, true);
  assertMatch(
    JSON.stringify(result.structuredContent),
    /SLICE_MIRROR_MISMATCH/,
  );
});

Deno.test("export_slice_mirrors rejects malformed trusted responses safely", async () => {
  const files = await exportFiles();
  const malformed = recordingServer();
  registerSliceTools(
    malformed.server,
    projectContext([], {
      mcp_export_slice_mirrors: {
        schemaVersion: 1,
        canonicalizationVersion: 1,
        runId: IDS.run,
        stateToken: IDS.nextState,
        currentSequence: 3,
        files: [{ ...files[0], content: "wrong", privateSql: "do not leak" }],
        manifestHash: hash("f"),
      },
    }),
  );
  const failed = await malformed.tools.find((tool) =>
    tool.name === "export_slice_mirrors"
  )!.handler({ runId: IDS.run });
  assertEquals(failed.isError, true);
  assertMatch(JSON.stringify(failed.structuredContent), /INTERNAL_ERROR/);
  assertEquals(
    JSON.stringify(failed.structuredContent).includes("privateSql"),
    false,
  );
});
