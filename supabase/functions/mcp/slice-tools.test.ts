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
    tasks: [{
      status: "completed",
      resultAccepted: true,
      reviewAccepted: true,
    }],
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
        const response = responses[name] ??
          (name === "mcp_read_slice_run_contract_version"
            ? {
              contractVersion: 1,
              legacyLayout: true,
              planningRootId: null,
              sourceProfileHash: null,
              deliveryPrepared: false,
            }
            : undefined);
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
    "prepare_delivery",
    "finalize_slice",
    "export_slice_mirrors",
  ]);
  assertEquals(
    project.tools.find((tool) => tool.name === "create_slice_bundle")!.config
      .inputSchema.safeParse(v2CreateInput()).success,
    true,
  );
  assertEquals(
    project.tools.find((tool) => tool.name === "create_slice_bundle")!.config
      .inputSchema.safeParse({ ...createInput(), unknown: true }).success,
    false,
  );
  assertEquals(
    project.tools.find((tool) => tool.name === "create_slice_bundle")!.config
      .inputSchema.safeParse({
        ...v2CreateInput(),
        deliveryPolicy: {
          ...v2CreateInput().deliveryPolicy,
          releaseOrder: [
            "runtime_verification",
            "implementation",
            "acceptance",
            "manual_review",
            "package",
            "roadmap_completion",
            "mirrors",
            "seal",
          ],
        },
      }).success,
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
    "prepare_delivery",
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

Deno.test("create_slice_bundle encodes each mutable V2 binding and calls one atomic mutation", async () => {
  const calls: RpcCall[] = [];
  const response = {
    ok: true,
    outcome: "created",
    contractVersion: 2,
    legacyLayout: false,
    runId: IDS.run,
    stateToken: IDS.state,
    currentSequence: 1,
    documents: {
      roadmap: {
        ...documentMap.roadmap,
        folderId: IDS.folder,
        contentHash: hash("1"),
      },
      spec: {
        ...documentMap.spec,
        folderId: IDS.documents[0],
        contentHash: hash("2"),
      },
      plan: {
        ...documentMap.plan,
        folderId: IDS.documents[1],
        contentHash: hash("3"),
      },
    },
    projection,
  };
  const registered = recordingServer();
  registerSliceTools(
    registered.server,
    projectContext(calls, {
      mcp_create_slice_bundle_v2: response,
    }),
  );
  const result = await registered.tools.find((tool) =>
    tool.name === "create_slice_bundle"
  )!.handler(v2CreateInput());
  assertEquals(
    result.isError,
    undefined,
    JSON.stringify(result.structuredContent),
  );
  assertEquals(result.structuredContent, response);
  const primary = calls.filter((call) =>
    call.name === "mcp_create_slice_bundle_v2"
  );
  assertEquals(primary.length, 1);
  const documents = primary[0].parameters.p_document_bindings as Array<
    Record<string, unknown>
  >;
  assertEquals(documents.length, 3);
  assertEquals(documents.map((document) => document.yjsState), [
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
          assertions: [{
            assertionId: "guardian",
            status: "failed",
            expected: true,
            reasonCode: "ACTUAL_PATH_MISSING",
          }],
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
  assertEquals(result.structuredContent?.contractVersion, 1);
  assertEquals(result.structuredContent?.legacyLayout, true);
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
    "mcp_read_slice_run_contract_version",
    "mcp_read_slice_run",
    "mcp_checkpoint_slice",
  ]);
  const sentEvents = calls[2].parameters.p_events as Array<
    Record<string, unknown>
  >;
  assertEquals(sentEvents.map((event) => event.eventType), [
    "runtime_observation",
  ]);
  assertEquals(JSON.stringify(sentEvents).includes("assertion_result"), false);
  assertMatch(String(sentEvents[0].inputHash), /^sha256:[a-f0-9]{64}$/);
  assertEquals(calls[2].parameters.p_computed_evaluations, [{
    evalId: "eval-1",
    status: "failed",
    manualRequired: false,
    assertions: [{
      assertionId: "guardian",
      status: "failed",
      reasonCode: "ACTUAL_PATH_MISSING",
      actual: undefined,
    }],
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
  assertEquals(staleCalls.map((call) => call.name), [
    "mcp_read_slice_run_contract_version",
    "mcp_read_slice_run",
    "mcp_checkpoint_slice",
  ]);
});

Deno.test("Slice schemas reject upper-case evidence IDs and bind task evidence to the run", async () => {
  const registered = recordingServer();
  registerSliceTools(registered.server, projectContext([], {}));
  const checkpoint = registered.tools.find((tool) =>
    tool.name === "checkpoint_slice"
  )!;
  const upperCase = checkpoint.config.inputSchema.safeParse({
    ...checkpointInput(),
    events: [{
      ...checkpointInput().events[0],
      payload: {
        observation: {
          ...checkpointInput().events[0].payload.observation,
          sliceId: "Slice-1",
        },
      },
    }],
  });
  assertEquals(upperCase.success, false);

  const contradictoryTask = checkpoint.config.inputSchema.safeParse({
    ...checkpointInput(),
    events: [{
      eventId: IDS.event,
      eventType: "task_result",
      payload: {
        schemaVersion: 1,
        runId: IDS.run,
        sliceId: "slice-1",
        taskId: "task-1",
        planRevision: hash("1"),
        attemptId: crypto.randomUUID(),
        phase: "green",
        operation: { kind: "command", command: "npm test" },
        startedAt: "2026-08-27T00:00:00Z",
        endedAt: "2026-08-27T00:00:01Z",
        exitCode: 1,
        timedOut: false,
        cancelled: false,
        stdoutSummary: "",
        stdoutHash: hash("a"),
        stderrSummary: "",
        stderrHash: hash("b"),
        changedFiles: [],
        expectedOutcome: "passes",
        observedOutcome: "passed",
        status: "completed",
        concerns: [],
        artifactIds: [],
      },
    }],
  });
  assertEquals(contradictoryTask.success, false);

  const unboundMirror = checkpoint.config.inputSchema.safeParse({
    ...checkpointInput(),
    events: [{
      eventId: IDS.event,
      eventType: "mirror_verification",
      payload: {
        status: "verified",
        manifestHash: hash("c"),
      },
    }],
    artifacts: [],
  });
  assertEquals(unboundMirror.success, false);

  const calls: RpcCall[] = [];
  const bound = recordingServer();
  registerSliceTools(
    bound.server,
    projectContext(calls, { mcp_read_slice_run: runResult }),
  );
  const result = await bound.tools.find((tool) =>
    tool.name === "checkpoint_slice"
  )!.handler({
    ...checkpointInput(),
    events: [{
      eventId: IDS.event,
      eventType: "task_result",
      payload: {
        schemaVersion: 1,
        runId: IDS.run,
        sliceId: "slice-other",
        taskId: "task-1",
        planRevision: hash("1"),
        attemptId: crypto.randomUUID(),
        phase: "implementation",
        operation: { kind: "command", command: "test" },
        startedAt: "2026-08-27T00:00:00Z",
        endedAt: "2026-08-27T00:00:01Z",
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        stdoutSummary: "",
        stdoutHash: hash("a"),
        stderrSummary: "",
        stderrHash: hash("b"),
        changedFiles: [],
        expectedOutcome: "completed",
        observedOutcome: "completed",
        status: "completed",
        concerns: [],
        artifactIds: [],
      },
    }],
  });
  assertEquals(result.isError, true);
  assertEquals(calls.map((call) => call.name), [
    "mcp_read_slice_run_contract_version",
    "mcp_read_slice_run",
  ]);
});

Deno.test("V2 schemas require complete evaluation fields and equals expectations", () => {
  const registered = recordingServer();
  registerSliceTools(registered.server, projectContext([], {}));
  const create = registered.tools.find((tool) => tool.name === "create_slice_bundle")!;
  const input = v2CreateInput();
  const missingExpected = structuredClone(input);
  delete (missingExpected.evalSpec.evaluations[0].assertions[0] as Record<string, unknown>).expected;
  assertEquals(create.config.inputSchema.safeParse(missingExpected).success, false);
  const missingHash = structuredClone(input);
  delete (missingHash.evalSpec.evaluations[0] as Record<string, unknown>).buildHash;
  assertEquals(create.config.inputSchema.safeParse(missingHash).success, false);
  const invalidManual = structuredClone(input);
  (invalidManual.evalSpec.evaluations[0] as Record<string, unknown>).manualRequired = "yes";
  assertEquals(create.config.inputSchema.safeParse(invalidManual).success, false);
  const unknownEvalField = structuredClone(input);
  (unknownEvalField.evalSpec.evaluations[0] as Record<string, unknown>).extra = true;
  assertEquals(create.config.inputSchema.safeParse(unknownEvalField).success, false);
});

Deno.test("finalize encodes deterministic status, roadmap, and EvalReport projections", async () => {
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
        documents: {
          ...documentMap,
          evalReport: {
            documentId: "88888888-8888-4888-8888-888888888888",
            repositoryPath: "docs/slices/eval-report.md",
            epoch: 0,
            revision: 1,
          },
        },
      },
    }),
  );
  await registered.tools.find((tool) => tool.name === "finalize_slice")!
    .handler(implementationFinalizeInput());
  const documents = calls[2].parameters.p_documents as Array<
    Record<string, unknown>
  >;
  assertEquals(
    String(
      documents.find((document) => document.documentId === IDS.documents[0])!
        .markdown,
    ).includes("implementationStatus: completed"),
    true,
  );
  assertEquals(
    String(
      documents.find((document) => document.kind === "evalReport")!.markdown,
    ).includes("releaseReadiness: ready"),
    true,
  );
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
        documents: {
          ...documentMap,
          evalReport: {
            documentId: "88888888-8888-4888-8888-888888888888",
            repositoryPath: "docs/slices/eval-report.md",
            epoch: 0,
            revision: 1,
          },
        },
      },
    }),
  );
  const finalized = await registered.tools.find((tool) =>
    tool.name === "finalize_slice"
  )!.handler(finalizeInput());
  assertEquals(finalized.isError, undefined);
  assertEquals(calls.map((call) => call.name).slice(0, 3), [
    "mcp_read_slice_run_contract_version",
    "mcp_read_slice_run",
    "mcp_finalize_slice",
  ]);
  const sent = calls[2].parameters.p_documents as Array<
    Record<string, unknown>
  >;
  assertEquals(sent, []);
});

Deno.test("checkpoint and both finalization phases preserve exact replay inputs", async () => {
  const calls: RpcCall[] = [];
  const response = {
    ok: true,
    outcome: "reused",
    runId: IDS.run,
    stateToken: IDS.nextState,
    currentSequence: 3,
    projection,
    repairCount: 0,
    computedEvaluations: [],
  };
  const registered = recordingServer();
  registerSliceTools(
    registered.server,
    projectContext(calls, {
      mcp_read_slice_run: runResult,
      mcp_checkpoint_slice: response,
      mcp_finalize_slice: {
        ok: true,
        outcome: "reused",
        runId: IDS.run,
        stateToken: IDS.nextState,
        currentSequence: 3,
        projection,
        documents: documentMap,
      },
    }),
  );
  await registered.tools.find((tool) => tool.name === "checkpoint_slice")!
    .handler(checkpointInput());
  await registered.tools.find((tool) => tool.name === "finalize_slice")!
    .handler(implementationFinalizeInput());
  await registered.tools.find((tool) => tool.name === "finalize_slice")!
    .handler(finalizeInput());
  assertEquals(
    calls.filter((call) => call.name === "mcp_checkpoint_slice").length,
    1,
  );
  assertEquals(
    calls.filter((call) => call.name === "mcp_finalize_slice").length,
    2,
  );
  assertEquals(
    calls.filter((call) => call.name === "mcp_finalize_slice")[1].parameters
      .p_documents,
    [],
  );
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

function v2CreateInput() {
  const sourceProfile = {
    schemaVersion: 1,
    contractVersion: 2,
    kind: "document",
    kecoProjectId: IDS.project,
    capturedAt: "2026-09-03T00:00:00Z",
    sourceHash: hash("a"),
    selectionEvidence: [],
    documentId: "99999999-9999-4999-8999-999999999999",
    epoch: 0,
    revision: 1,
    contentHash: hash("b"),
  };
  const sourceProfileHash =
    "sha256:ee79f64631eb435849750b89b87dedfb33de3ec28905aab8ab8707ce2df1df4c";
  return {
    contractVersion: 2,
    runId: IDS.run,
    planningRootId: IDS.folder,
    sliceId: "slice-1",
    sourceProfile,
    sourceProfileHash,
    plan: {
      schemaVersion: 2,
      coverageMode: "non_gdd",
      sourceProfileHash,
      nonGddRationale: "The selected document directly authorizes this Slice.",
      planRevision: hash("d"),
      allowedFiles: ["game/cats.gd"],
      tasks: [{
        id: "task-1",
        files: ["game/cats.gd"],
        dependsOn: [],
        servesEvaluations: ["eval-1"],
        red: { command: "test red", expected: "fails" },
        green: { command: "test green", expected: "passes" },
        review: { minimumLevel: "self" },
        sourceMappings: ["source-1"],
      }],
    },
    evalSpec: {
      schemaVersion: 2,
      coverageMode: "non_gdd",
      sourceProfileHash,
      evaluations: [{
        evalId: "eval-1",
        servedByTasks: ["task-1"],
        buildHash: hash("a"),
        snapshotHash: hash("b"),
        assertions: [{
          assertionId: "ready",
          kind: "equals",
          path: "/ready",
          expected: true,
        }],
      }],
    },
    deliveryPolicy: {
      schemaVersion: 2,
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
        "manual_review",
        "package",
        "roadmap_completion",
        "mirrors",
        "seal",
      ],
      manualReviewBlocksRelease: true,
    },
    documentBindings: [
      {
        kind: "roadmap",
        disposition: "create",
        folderId: IDS.folder,
        name: "roadmap",
        repositoryPath: "docs/superpowers/roadmap.md",
        markdown: "# Roadmap\n",
      },
      {
        kind: "spec",
        disposition: "create",
        folderId: IDS.documents[0],
        name: "slice-1",
        repositoryPath: "docs/superpowers/specs/slice-1-design.md",
        markdown: "# Spec\n",
      },
      {
        kind: "plan",
        disposition: "create",
        folderId: IDS.documents[1],
        name: "slice-1",
        repositoryPath: "docs/superpowers/plans/slice-1.md",
        markdown: "# Plan\n",
      },
    ],
    idempotencyKey: "create-v2:slice-1",
  };
}

Deno.test("stable Slice tools expose V2 creation and delivery preparation schemas", () => {
  const registered = recordingServer();
  registerSliceTools(registered.server, projectContext([], {}));
  assertEquals(registered.tools.map((tool) => tool.name), [
    "create_slice_bundle",
    "checkpoint_slice",
    "prepare_delivery",
    "finalize_slice",
    "export_slice_mirrors",
  ]);
  const create = registered.tools.find((tool) =>
    tool.name === "create_slice_bundle"
  )!;
  assertEquals(
    create.config.inputSchema.safeParse(v2CreateInput()).success,
    true,
  );
  assertEquals(
    create.config.inputSchema.safeParse(createInput()).success,
    false,
  );
});

Deno.test("V2 creation encodes mutable bindings and dispatches only to the V2 RPC", async () => {
  const calls: RpcCall[] = [];
  const response = {
    ok: true,
    outcome: "created",
    contractVersion: 2,
    legacyLayout: false,
    runId: IDS.run,
    stateToken: IDS.state,
    currentSequence: 1,
    projection,
    documents: {
      roadmap: {
        ...documentMap.roadmap,
        folderId: IDS.folder,
        contentHash: hash("1"),
      },
      spec: {
        ...documentMap.spec,
        folderId: IDS.documents[0],
        contentHash: hash("2"),
      },
      plan: {
        ...documentMap.plan,
        folderId: IDS.documents[1],
        contentHash: hash("3"),
      },
    },
  };
  const registered = recordingServer();
  registerSliceTools(
    registered.server,
    projectContext(calls, { mcp_create_slice_bundle_v2: response }),
  );
  const result = await registered.tools.find((tool) =>
    tool.name === "create_slice_bundle"
  )!.handler(v2CreateInput());
  assertEquals(result.isError, undefined);
  assertEquals(calls.map((call) => call.name), ["mcp_create_slice_bundle_v2"]);
  const bindings = calls[0].parameters.p_document_bindings as Array<
    Record<string, unknown>
  >;
  assertEquals(bindings.length, 3);
  assertEquals(
    bindings.every((item) =>
      item.disposition !== "create" || item.yjsState === "AQ=="
    ),
    true,
  );
});

Deno.test("V2 continuation dispatch is selected from stored contract identity", async () => {
  const calls: RpcCall[] = [];
  const v2Plan = v2CreateInput().plan;
  const v2EvalSpec = v2CreateInput().evalSpec;
  const v2Policy = v2CreateInput().deliveryPolicy;
  const v2Run = {
    ...runResult,
    contractVersion: 2,
    legacyLayout: false,
    plan: v2Plan,
    evalSpec: v2EvalSpec,
    deliveryPolicy: v2Policy,
    documents: {
      roadmap: {
        ...documentMap.roadmap,
        folderId: IDS.folder,
        contentHash: hash("1"),
      },
      spec: {
        ...documentMap.spec,
        folderId: IDS.documents[0],
        contentHash: hash("2"),
      },
      plan: {
        ...documentMap.plan,
        folderId: IDS.documents[1],
        contentHash: hash("3"),
      },
    },
  };
  const registered = recordingServer();
  registerSliceTools(
    registered.server,
    projectContext(calls, {
      mcp_read_slice_run_contract_version: {
        contractVersion: 2,
        legacyLayout: false,
        planningRootId: IDS.folder,
        sourceProfileHash: hash("c"),
        deliveryPrepared: false,
      },
      mcp_read_slice_run: v2Run,
      mcp_checkpoint_slice_v2: {
        ok: true,
        outcome: "created",
        contractVersion: 2,
        legacyLayout: false,
        runId: IDS.run,
        stateToken: IDS.nextState,
        currentSequence: 2,
        repairCount: 0,
        projection,
        documents: v2Run.documents,
        computedEvaluations: [],
      },
    }),
  );
  const result = await registered.tools.find((tool) =>
    tool.name === "checkpoint_slice"
  )!.handler({
    ...checkpointInput(),
    contractVersion: 2,
    documentProgress: [{
      kind: "plan",
      documentId: IDS.documents[2],
      expectedEpoch: 0,
      expectedRevision: 1,
      priorContentHash: hash("3"),
      markdown: "# Plan\r\n- [x] task-1\r\n",
    }],
  });
  assertEquals(
    result.isError,
    undefined,
    JSON.stringify(result.structuredContent),
  );
  assertEquals(calls.map((call) => call.name), [
    "mcp_read_slice_run_contract_version",
    "mcp_read_slice_run",
    "mcp_checkpoint_slice_v2",
  ]);
  const progress = (calls.at(-1)?.parameters.p_document_progress as Array<
    Record<string, unknown>
  >)[0];
  assertEquals(progress.contentHash, await sha256Utf8(String(progress.markdown)));
  assertEquals(typeof progress.yjsState, "string");
  const events = calls.at(-1)?.parameters.p_events as Array<Record<string, unknown>>;
  assertEquals((events[0].payload as Record<string, unknown>).prefix, "KECO_OBSERVATION");
});

Deno.test("stored contract identity rejects silent upgrades and downgrades", async () => {
  for (
    const [storedVersion, requestedVersion] of [[2, undefined], [1, 2]] as const
  ) {
    const calls: RpcCall[] = [];
    const registered = recordingServer();
    registerSliceTools(
      registered.server,
      projectContext(calls, {
        mcp_read_slice_run_contract_version: {
          contractVersion: storedVersion,
          legacyLayout: storedVersion === 1,
          planningRootId: storedVersion === 2 ? IDS.folder : null,
          sourceProfileHash: storedVersion === 2 ? hash("c") : null,
          deliveryPrepared: false,
        },
      }),
    );
    const result = await registered.tools.find((tool) =>
      tool.name === "checkpoint_slice"
    )!.handler({
      ...checkpointInput(),
      contractVersion: requestedVersion,
    });
    assertEquals(result.isError, true);
    assertMatch(
      JSON.stringify(result.structuredContent),
      /SLICE_STATE_CONFLICT/,
    );
    assertEquals(calls.map((call) => call.name), [
      "mcp_read_slice_run_contract_version",
    ]);
  }
});

Deno.test("prepare, export, and finalize dispatch V2 without canonical document writes", async () => {
  const documents = {
    roadmap: {
      ...documentMap.roadmap,
      folderId: IDS.folder,
      contentHash: hash("1"),
    },
    spec: {
      ...documentMap.spec,
      folderId: IDS.documents[0],
      contentHash: hash("2"),
    },
    plan: {
      ...documentMap.plan,
      folderId: IDS.documents[1],
      contentHash: hash("3"),
    },
  };
  const identity = {
    contractVersion: 2,
    legacyLayout: false,
    planningRootId: IDS.folder,
    sourceProfileHash: hash("c"),
    deliveryPrepared: false,
  };
  const mutation = {
    ok: true,
    outcome: "created",
    contractVersion: 2,
    runId: IDS.run,
    stateToken: IDS.nextState,
    currentSequence: 3,
    projection,
    documents,
  };
  const calls: RpcCall[] = [];
  const registered = recordingServer();
  registerSliceTools(
    registered.server,
    projectContext(calls, {
      mcp_read_slice_run_contract_version: identity,
      mcp_prepare_slice_delivery_v2: mutation,
      mcp_finalize_slice_v2: mutation,
    }),
  );

  const prepared = await registered.tools.find((tool) =>
    tool.name === "prepare_delivery"
  )!.handler({
    contractVersion: 2,
    runId: IDS.run,
    stateToken: IDS.state,
    roadmapProgress: {
      documentId: IDS.documents[0],
      expectedEpoch: 0,
      expectedRevision: 1,
      priorContentHash: hash("1"),
      markdown: "# Roadmap\n- [x] Slice 1\n",
    },
    idempotencyKey: "prepare:slice-1",
  });
  assertEquals(prepared.isError, undefined);

  const finalized = await registered.tools.find((tool) =>
    tool.name === "finalize_slice"
  )!.handler({
    contractVersion: 2,
    runId: IDS.run,
    stateToken: IDS.nextState,
    requestedTerminalIntent: "implementation_complete",
    documents: [],
    idempotencyKey: "finalize-v2:slice-1",
  });
  assertEquals(finalized.isError, undefined);
  const finalizeCall = calls.find((call) =>
    call.name === "mcp_finalize_slice_v2"
  )!;
  assertEquals("p_documents" in finalizeCall.parameters, false);

  const files = (await exportFiles()).slice(0, 3).map((file, index) => ({
    ...file,
    repositoryPath: [
      "docs/superpowers/roadmap.md",
      "docs/superpowers/specs/slice-1-design.md",
      "docs/superpowers/plans/slice-1.md",
    ][index],
    folderId: [IDS.folder, IDS.documents[0], IDS.documents[1]][index],
  }));
  const exportedServer = recordingServer();
  const exportCalls: RpcCall[] = [];
  registerSliceTools(
    exportedServer.server,
    projectContext(exportCalls, {
      mcp_read_slice_run_contract_version: {
        ...identity,
        deliveryPrepared: true,
      },
      mcp_export_slice_mirrors_v2: {
        schemaVersion: 2,
        canonicalizationVersion: 1,
        contractVersion: 2,
        runId: IDS.run,
        stateToken: IDS.nextState,
        currentSequence: 4,
        preparedSequence: 3,
        files,
        manifestHash: hash("f"),
      },
    }),
  );
  const exported = await exportedServer.tools.find((tool) =>
    tool.name === "export_slice_mirrors"
  )!.handler({
    contractVersion: 2,
    runId: IDS.run,
  });
  assertEquals(exported.isError, undefined);
  assertEquals(exportCalls.map((call) => call.name), [
    "mcp_read_slice_run_contract_version",
    "mcp_export_slice_mirrors_v2",
  ]);
});
