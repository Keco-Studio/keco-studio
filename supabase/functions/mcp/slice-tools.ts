import type { McpServer } from "@mcp/server/mcp.js";
import { z } from "zod";
import type { ProjectMcpRequestContext } from "./context.ts";
import { rpc } from "./database.ts";
import { encodeDocumentMarkdown } from "./document-codec.ts";
import { McpDomainError } from "./errors.ts";
import { MAX_DOCUMENT_MARKDOWN_BYTES, utf8ByteLength } from "./limits.ts";
import { scheduleMcpReindex } from "./reindex.ts";
import { toolFailure, toolSuccess } from "./results.ts";
import {
  evaluateObservation,
  type EvaluationResult,
  type EvaluationSpec,
  sha256Canonical,
} from "./slice-contracts.ts";

type ProjectContextResolver = (
  projectId: string,
) => Promise<ProjectMcpRequestContext>;

const uuid = z.string().uuid();
const identifier = z.string().trim().min(1).max(100);
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const idempotencyKey = z.string().trim().min(8).max(128).regex(
  /^[A-Za-z0-9._:-]+$/,
);
const timestamp = z.string().datetime({ offset: true });
const jsonPointer = z.string().max(500).refine(
  (value) =>
    value === "" || (value.startsWith("/") && !/~(?:[^01]|$)/.test(value)),
  "Value must be an RFC 6901 JSON Pointer.",
);
const relativePath = z.string().min(1).max(500).refine(
  (value) =>
    !value.startsWith("/") && !value.includes("\\") &&
    !value.split("/").includes(".."),
  "Path must be repository-relative without parent traversal.",
);
const boundedJsonObject = z.record(z.string().max(100), z.unknown()).refine(
  (value) =>
    Object.keys(value).length <= 100 &&
    utf8ByteLength(JSON.stringify(value)) <= 64 * 1024,
  "Object exceeds the Slice contract limit.",
);
const safeSummary = z.string().max(4000).refine(
  (value) =>
    !/(?:authorization\s*:|bearer\s+[a-z0-9._-]+|api[_-]?key|password\s*[:=])/i
      .test(value),
  "Summaries must not contain credentials.",
);
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const assertionSchema = z.discriminatedUnion("kind", [
  z.object({
    assertionId: identifier,
    kind: z.literal("equals"),
    path: jsonPointer,
    expected: z.unknown(),
  }).strict(),
  z.object({
    assertionId: identifier,
    kind: z.literal("range"),
    path: jsonPointer,
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
    minimumInclusive: z.boolean(),
    maximumInclusive: z.boolean(),
  }).strict().refine(
    (value) =>
      (value.minimum !== undefined || value.maximum !== undefined) &&
      (value.minimum === undefined || value.maximum === undefined ||
        value.minimum <= value.maximum),
    "Range requires an ordered finite bound.",
  ),
  z.object({
    assertionId: identifier,
    kind: z.literal("subset"),
    path: jsonPointer,
    expected: z.union([
      z.array(z.unknown()).max(100),
      z.record(z.string().max(100), z.unknown()).refine((value) =>
        Object.keys(value).length <= 100
      ),
    ]),
  }).strict(),
  z.object({
    assertionId: identifier,
    kind: z.literal("roundtrip"),
    beforePath: jsonPointer,
    afterPath: jsonPointer,
    markerPaths: z.array(jsonPointer).min(1).max(20).refine((value) =>
      new Set(value).size === value.length
    ),
  }).strict(),
]);
const evaluationSchema = z.object({
  evalId: identifier,
  buildHash: sha256,
  snapshotHash: sha256,
  assertions: z.array(assertionSchema).min(1).max(100).refine((value) =>
    new Set(value.map((item) => item.assertionId)).size === value.length
  ),
  manualRequired: z.boolean().optional(),
}).strict();
const evalSpecSchema = z.object({
  schemaVersion: z.literal(1),
  evaluations: z.array(evaluationSchema).min(1).max(100),
}).strict().refine(
  (value) =>
    new Set(value.evaluations.map((item) => item.evalId)).size ===
      value.evaluations.length,
  "Evaluation IDs must be unique.",
);

const commandSchema = z.object({
  command: z.string().trim().min(1).max(1000),
  expected: z.enum(["fails", "passes"]),
}).strict();
const planTaskSchema = z.object({
  id: identifier,
  files: z.array(relativePath).min(1).max(100),
  dependsOn: z.array(identifier).max(100),
  servesEvaluations: z.array(identifier).min(1).max(100),
  red: commandSchema,
  green: commandSchema,
  review: z.object({
    spec: z.literal("required"),
    quality: z.enum(["required", "optional"]),
  }).strict(),
}).strict();
const planSchema = z.object({
  schemaVersion: z.literal(1),
  planRevision: sha256,
  allowedFiles: z.array(relativePath).min(1).max(500),
  tasks: z.array(planTaskSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  const taskIds = new Set(value.tasks.map((task) => task.id));
  if (taskIds.size !== value.tasks.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Task IDs must be unique.",
    });
  }
  const allowed = new Set(value.allowedFiles);
  for (const task of value.tasks) {
    if (task.files.some((file) => !allowed.has(file))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Every task file must be present in allowedFiles.",
      });
    }
    if (
      task.dependsOn.some((taskId) =>
        !taskIds.has(taskId) || taskId === task.id
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Task dependencies must reference another accepted task.",
      });
    }
  }
});
const policySchema = z.object({
  schemaVersion: z.literal(1),
  requiredArtifacts: z.array(
    z.enum(["TaskResult", "TaskReview", "EvalReport", "MirrorVerification"]),
  )
    .length(4).refine((value) => new Set(value).size === value.length),
  runtimeEvidenceFreshness: z.literal("current_build_and_snapshot"),
  maximumRepairs: z.literal(3),
  releaseOrder: z.tuple([
    z.literal("implementation"),
    z.literal("runtime_verification"),
    z.literal("acceptance"),
    z.literal("mirrors"),
    z.literal("package"),
  ]),
  manualReviewBlocksRelease: z.literal(true),
}).strict();

const runtimeObservationSchema = z.object({
  schemaVersion: z.literal(1),
  runId: uuid,
  sliceId: identifier,
  evalId: identifier,
  buildHash: sha256,
  snapshotHash: sha256,
  actual: z.record(z.string().max(100), z.unknown()).refine((value) =>
    Object.keys(value).length <= 1000 &&
    utf8ByteLength(JSON.stringify(value)) <= 64 * 1024
  ),
  errors: z.array(z.string().max(1000)).max(100),
}).strict();
const changedFileSchema = z.object({
  path: relativePath,
  beforeHash: sha256.nullable(),
  afterHash: sha256.nullable(),
}).strict();
const taskResultPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  runId: uuid,
  sliceId: identifier,
  taskId: identifier,
  planRevision: sha256,
  attemptId: uuid,
  phase: z.enum(["red", "green", "implementation", "verification"]),
  operation: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("command"),
      command: z.string().min(1).max(1000),
    }).strict(),
    z.object({
      kind: z.literal("mcp"),
      tools: z.array(identifier).min(1).max(50),
    }).strict(),
  ]),
  startedAt: timestamp,
  endedAt: timestamp,
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  cancelled: z.boolean(),
  stdoutSummary: safeSummary,
  stdoutHash: sha256,
  stderrSummary: safeSummary,
  stderrHash: sha256,
  changedFiles: z.array(changedFileSchema).max(500),
  expectedOutcome: z.enum(["fails", "passes", "completed"]),
  observedOutcome: z.enum(["failed", "passed", "completed", "blocked"]),
  status: z.enum(["completed", "failed", "blocked"]),
  concerns: z.array(safeSummary).max(50),
  artifactIds: z.array(uuid).max(50),
}).strict().refine(
  (value) => Date.parse(value.startedAt) <= Date.parse(value.endedAt),
  "TaskResult timestamps are inverted.",
);
const taskReviewPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  runId: uuid,
  sliceId: identifier,
  taskId: identifier,
  planRevision: sha256,
  taskResultIds: z.array(uuid).min(1).max(50),
  reviewedFiles: z.array(
    z.object({ path: relativePath, hash: sha256 }).strict(),
  ).max(500),
  reviewerType: z.enum(["agent", "human"]),
  reviewerId: identifier,
  verdict: z.enum(["accepted", "rejected"]),
  specificationFindings: z.array(safeSummary).max(50),
  qualityFindings: z.array(safeSummary).max(50),
  requiredFollowUp: z.array(safeSummary).max(50),
}).strict();

const eventSchema = z.discriminatedUnion("eventType", [
  z.object({
    eventId: uuid,
    eventType: z.literal("plan_accepted"),
    payload: z.object({ planRevision: sha256, acceptedAt: timestamp }).strict(),
  }).strict(),
  z.object({
    eventId: uuid,
    eventType: z.literal("write_lease"),
    payload: z.object({
      leaseId: uuid,
      allowedFiles: z.array(relativePath).min(1).max(500),
      acquiredAt: timestamp,
      expiresAt: timestamp,
    }).strict(),
  }).strict(),
  z.object({
    eventId: uuid,
    eventType: z.literal("task_result"),
    payload: taskResultPayloadSchema,
  }).strict(),
  z.object({
    eventId: uuid,
    eventType: z.literal("task_review"),
    payload: taskReviewPayloadSchema,
  }).strict(),
  z.object({
    eventId: uuid,
    eventType: z.literal("runtime_observation"),
    payload: z.object({ observation: runtimeObservationSchema }).strict(),
  }).strict(),
  z.object({
    eventId: uuid,
    eventType: z.literal("mirror_verification"),
    payload: z.object({ status: z.literal("verified"), manifestHash: sha256 })
      .strict(),
  }).strict(),
  z.object({
    eventId: uuid,
    eventType: z.literal("repair_transition"),
    payload: z.object({
      reason: safeSummary,
      failedEvaluationIds: z.array(identifier).max(100),
    }).strict(),
  }).strict(),
  z.object({
    eventId: uuid,
    eventType: z.literal("manual_review"),
    payload: z.object({
      itemId: identifier,
      status: z.enum(["pending", "accepted", "rejected"]),
      notes: safeSummary,
    }).strict(),
  }).strict(),
  z.object({
    eventId: uuid,
    eventType: z.literal("delivery_check"),
    payload: z.object({
      gate: identifier,
      status: z.enum(["passed", "failed"]),
      evidenceHash: sha256,
    }).strict(),
  }).strict(),
]);
const artifactSchema = z.object({
  artifactId: uuid,
  eventId: uuid,
  artifactType: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),
  schemaVersion: z.number().int().positive(),
  contentHash: sha256,
  payload: boundedJsonObject,
}).strict();

const projectionSchema = z.object({
  schemaVersion: z.literal(1),
  implementationStatus: z.enum([
    "pending",
    "in_progress",
    "completed",
    "failed",
    "blocked",
  ]),
  runtimeVerificationStatus: z.enum([
    "not_run",
    "passed",
    "partial",
    "failed",
    "blocked",
  ]),
  acceptanceStatus: z.enum([
    "pending",
    "passed",
    "partial",
    "failed",
    "manual_required",
  ]),
  releaseReadiness: z.enum([
    "not_ready",
    "ready",
    "blocked_by_verification",
    "blocked_by_manual_review",
    "blocked_by_policy",
    "failed",
  ]),
}).strict();
const documentIdentitySchema = z.object({
  documentId: uuid,
  repositoryPath: relativePath,
  epoch: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
}).strict();
const documentMapSchema = z.record(
  z.enum(["roadmap", "spec", "plan", "status"]),
  documentIdentitySchema,
)
  .refine((value) =>
    Object.keys(value).length >= 3 && Object.keys(value).length <= 4
  );
const mutationResponseBase = {
  ok: z.literal(true),
  outcome: z.enum(["created", "reused"]),
  runId: uuid,
  stateToken: uuid,
  currentSequence: z.number().int().positive(),
  projection: projectionSchema,
};
const createResponseSchema = z.object({
  ...mutationResponseBase,
  documents: documentMapSchema,
}).strict();
const checkpointResponseSchema = z.object({
  ...mutationResponseBase,
  repairCount: z.number().int().min(0).max(3),
}).strict();
const finalizeResponseSchema = z.object(mutationResponseBase).strict();
const readRunSchema = z.object({
  runId: uuid,
  sliceId: identifier,
  stateToken: uuid,
  currentSequence: z.number().int().positive(),
  repairCount: z.number().int().min(0).max(3),
  plan: planSchema,
  evalSpec: evalSpecSchema,
  deliveryPolicy: policySchema,
  projection: projectionSchema,
  documents: documentMapSchema,
}).strict();
const exportResponseSchema = z.object({
  schemaVersion: z.literal(1),
  canonicalizationVersion: z.literal(1),
  runId: uuid,
  stateToken: uuid,
  currentSequence: z.number().int().positive(),
  files: z.array(
    z.object({
      kind: z.enum(["roadmap", "spec", "plan", "status"]),
      repositoryPath: relativePath,
      documentId: uuid,
      epoch: z.number().int().nonnegative(),
      revision: z.number().int().nonnegative(),
      byteCount: z.number().int().nonnegative().max(
        MAX_DOCUMENT_MARKDOWN_BYTES,
      ),
      sha256,
      content: z.string(),
    }).strict(),
  ).min(3).max(4),
  manifestHash: sha256,
}).strict().superRefine((value, context) => {
  if (
    new Set(value.files.map((file) => file.kind)).size !== value.files.length
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Export kinds must be unique.",
    });
  }
  for (const file of value.files) {
    if (utf8ByteLength(file.content) !== file.byteCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Export byte count is invalid.",
      });
    }
  }
});

function projectShape(
  account: boolean,
): { projectId: typeof uuid } | Record<never, never> {
  return account ? { projectId: uuid } : {};
}

function requestedProjectId(
  input: Record<string, unknown>,
  fixed: ProjectMcpRequestContext | null,
): string {
  return fixed?.projectId ?? input.projectId as string;
}

async function contextFor(
  input: Record<string, unknown>,
  fixed: ProjectMcpRequestContext | null,
  resolver: ProjectContextResolver | null,
): Promise<ProjectMcpRequestContext> {
  return fixed ?? await resolver!(input.projectId as string);
}

function ensureMarkdown(markdown: string): void {
  if (utf8ByteLength(markdown) > MAX_DOCUMENT_MARKDOWN_BYTES) {
    throw new McpDomainError(
      "PAYLOAD_TOO_LARGE",
      "Slice document Markdown must be at most 100 KiB.",
    );
  }
}

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

function parseTrusted<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(Array.isArray(value) ? value[0] : value);
  if (!parsed.success) {
    throw new McpDomainError(
      "INTERNAL_ERROR",
      "The Slice database returned an invalid bounded result.",
    );
  }
  return parsed.data;
}

function withoutIdempotency(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const { idempotencyKey: _ignored, ...rest } = input;
  return rest;
}

function registerSliceToolSet(
  server: McpServer,
  fixed: ProjectMcpRequestContext | null,
  resolver: ProjectContextResolver | null,
  options: { writes: boolean; reads: boolean },
): void {
  const shape = projectShape(fixed === null);
  const createSchema = z.object({
    ...shape,
    runId: uuid,
    folderId: uuid,
    sliceId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
    plan: planSchema,
    evalSpec: evalSpecSchema,
    deliveryPolicy: policySchema,
    documents: z.array(
      z.object({
        kind: z.enum(["roadmap", "spec", "plan", "status"]),
        name: z.string().trim().min(1).max(200),
        repositoryPath: relativePath,
        markdown: z.string(),
      }).strict(),
    ).min(3).max(4),
    idempotencyKey,
  }).strict().superRefine((value, context) => {
    if (
      new Set(value.documents.map((item) => item.kind)).size !==
        value.documents.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Document kinds must be unique.",
      });
    }
    if (
      new Set(value.documents.map((item) => item.repositoryPath)).size !==
        value.documents.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Document paths must be unique.",
      });
    }
  });
  if (options.writes) {
    server.registerTool("create_slice_bundle", {
      description:
        "Atomically create or reuse an authoritative Keco Slice document bundle and deterministic run ledger.",
      inputSchema: createSchema,
      annotations: writeAnnotations,
    }, async (input: z.infer<typeof createSchema>) => {
      try {
        const context = await contextFor(input, fixed, resolver);
        const documents = await Promise.all(
          input.documents.map(async (document) => {
            ensureMarkdown(document.markdown);
            const encoded = await encodeDocumentMarkdown(document.markdown);
            return {
              ...document,
              documentId: crypto.randomUUID(),
              markdown: encoded.markdown,
              yjsState: encoded.yjsStateBase64,
            };
          }),
        );
        const data = parseTrusted(
          createResponseSchema,
          await rpc<unknown>(context, "mcp_create_slice_bundle", {
            p_project_id: requestedProjectId(input, fixed),
            p_run_id: input.runId,
            p_folder_id: input.folderId,
            p_slice_id: input.sliceId,
            p_plan_data: input.plan,
            p_plan_hash: await sha256Canonical(input.plan),
            p_eval_spec: input.evalSpec,
            p_eval_spec_hash: await sha256Canonical(input.evalSpec),
            p_delivery_policy: input.deliveryPolicy,
            p_delivery_policy_hash: await sha256Canonical(input.deliveryPolicy),
            p_documents: documents,
            p_idempotency_key: input.idempotencyKey,
            p_input_hash: await sha256Canonical(withoutIdempotency(input)),
          }),
        );
        if (data.outcome === "created") {
          for (const document of Object.values(data.documents)) {
            scheduleMcpReindex({
              kind: "document",
              projectId: context.projectId,
              actorUserId: context.userId,
              documentId: document.documentId,
            });
          }
        }
        return toolSuccess("Slice bundle ready.", data);
      } catch (error) {
        return toolFailure(error);
      }
    });
  }

  const checkpointSchema = z.object({
    ...shape,
    runId: uuid,
    stateToken: uuid,
    events: z.array(eventSchema).min(1).max(50),
    artifacts: z.array(artifactSchema).max(50).default([]),
    idempotencyKey,
  }).strict().refine(
    (value) =>
      new Set(value.events.map((item) => item.eventId)).size ===
        value.events.length,
    "Event IDs must be unique.",
  );
  if (options.writes) {
    server.registerTool("checkpoint_slice", {
      description:
        "Atomically append typed Slice facts, compute runtime assertions and status, and return a resumable state token.",
      inputSchema: checkpointSchema,
      annotations: writeAnnotations,
    }, async (input: z.infer<typeof checkpointSchema>) => {
      try {
        const context = await contextFor(input, fixed, resolver);
        const projectId = requestedProjectId(input, fixed);
        const run = parseTrusted(
          readRunSchema,
          await rpc<unknown>(context, "mcp_read_slice_run", {
            p_project_id: projectId,
            p_run_id: input.runId,
          }),
        );
        if (run.stateToken !== input.stateToken) {
          throw new McpDomainError(
            "SLICE_STATE_CONFLICT",
            "The Slice state changed; read the current run before continuing.",
          );
        }
        const evaluations: EvaluationResult[] = [];
        for (const event of input.events) {
          if (event.eventType !== "runtime_observation") continue;
          const spec = run.evalSpec.evaluations.find((candidate) =>
            candidate.evalId === event.payload.observation.evalId
          );
          if (!spec) {
            throw new McpDomainError(
              "SLICE_CONTRACT_INVALID",
              "Runtime evidence references an unknown evaluation.",
            );
          }
          evaluations.push(
            evaluateObservation(
              spec as EvaluationSpec,
              event.payload.observation,
            ),
          );
        }
        const events = await Promise.all(input.events.map(async (event) => ({
          ...event,
          inputHash: await sha256Canonical(event.payload),
          outputHash: await sha256Canonical({
            eventType: event.eventType,
            payload: event.payload,
          }),
        })));
        const data = parseTrusted(
          checkpointResponseSchema,
          await rpc<unknown>(context, "mcp_checkpoint_slice", {
            p_project_id: projectId,
            p_run_id: input.runId,
            p_expected_state_token: input.stateToken,
            p_events: events,
            p_artifacts: input.artifacts,
            p_idempotency_key: input.idempotencyKey,
            p_input_hash: await sha256Canonical(withoutIdempotency(input)),
          }),
        );
        return toolSuccess("Slice checkpoint accepted.", {
          ...data,
          computedEvaluations: evaluations,
        });
      } catch (error) {
        return toolFailure(error);
      }
    });
  }

  const finalizeSchema = z.object({
    ...shape,
    runId: uuid,
    stateToken: uuid,
    documents: z.array(
      z.object({
        documentId: uuid,
        expectedEpoch: z.number().int().nonnegative(),
        expectedRevision: z.number().int().nonnegative(),
        markdown: z.string(),
      }).strict(),
    ).min(3).max(4),
    idempotencyKey,
  }).strict().refine(
    (value) =>
      new Set(value.documents.map((item) => item.documentId)).size ===
        value.documents.length,
    "Final documents must be unique.",
  );
  if (options.writes) {
    server.registerTool("finalize_slice", {
      description:
        "Finalize a Slice only when computed task, runtime, acceptance, mirror, and policy gates allow it.",
      inputSchema: finalizeSchema,
      annotations: writeAnnotations,
    }, async (input: z.infer<typeof finalizeSchema>) => {
      try {
        const context = await contextFor(input, fixed, resolver);
        const projectId = requestedProjectId(input, fixed);
        const run = parseTrusted(
          readRunSchema,
          await rpc<unknown>(context, "mcp_read_slice_run", {
            p_project_id: projectId,
            p_run_id: input.runId,
          }),
        );
        if (run.stateToken !== input.stateToken) {
          throw new McpDomainError(
            "SLICE_STATE_CONFLICT",
            "The Slice state changed; read the current run before continuing.",
          );
        }
        const authoritativeIds = new Set(
          Object.values(run.documents).map((document) => document.documentId),
        );
        if (
          authoritativeIds.size !== input.documents.length ||
          input.documents.some((document) =>
            !authoritativeIds.has(document.documentId)
          )
        ) {
          throw new McpDomainError(
            "SLICE_MIRROR_MISMATCH",
            "Final documents must exactly match the authoritative Slice bundle.",
          );
        }
        const documents = await Promise.all(
          input.documents.map(async (document) => {
            ensureMarkdown(document.markdown);
            const encoded = await encodeDocumentMarkdown(document.markdown);
            return {
              ...document,
              markdown: encoded.markdown,
              yjsState: encoded.yjsStateBase64,
            };
          }),
        );
        const data = parseTrusted(
          finalizeResponseSchema,
          await rpc<unknown>(context, "mcp_finalize_slice", {
            p_project_id: projectId,
            p_run_id: input.runId,
            p_expected_state_token: input.stateToken,
            p_documents: documents,
            p_idempotency_key: input.idempotencyKey,
            p_input_hash: await sha256Canonical(withoutIdempotency(input)),
          }),
        );
        return toolSuccess("Slice finalization completed.", data);
      } catch (error) {
        return toolFailure(error);
      }
    });
  }

  const exportSchema = z.object({ ...shape, runId: uuid }).strict();
  if (options.reads) {
    server.registerTool("export_slice_mirrors", {
      description:
        "Export canonical Keco Slice document bytes, revisions, paths, and SHA-256 digests for local materialization.",
      inputSchema: exportSchema,
      annotations: readAnnotations,
    }, async (input: z.infer<typeof exportSchema>) => {
      try {
        const context = await contextFor(input, fixed, resolver);
        const data = parseTrusted(
          exportResponseSchema,
          await rpc<unknown>(context, "mcp_export_slice_mirrors", {
            p_project_id: requestedProjectId(input, fixed),
            p_run_id: input.runId,
          }),
        );
        for (const file of data.files) {
          if (await sha256Utf8(file.content) !== file.sha256) {
            throw new McpDomainError(
              "SLICE_MIRROR_MISMATCH",
              "An exported Slice mirror digest does not match its content.",
            );
          }
        }
        return toolSuccess("Slice mirror manifest exported.", {
          ok: true,
          ...data,
        });
      } catch (error) {
        return toolFailure(error);
      }
    });
  }
}

export function registerSliceTools(
  server: McpServer,
  context: ProjectMcpRequestContext,
): void {
  registerSliceToolSet(server, context, null, {
    writes: context.role !== "viewer",
    reads: true,
  });
}

export function registerAccountSliceReadTools(
  server: McpServer,
  resolveProject: ProjectContextResolver,
): void {
  registerSliceToolSet(server, null, resolveProject, {
    writes: false,
    reads: true,
  });
}

export function registerAccountSliceWriteTools(
  server: McpServer,
  resolveProject: ProjectContextResolver,
): void {
  registerSliceToolSet(server, null, resolveProject, {
    writes: true,
    reads: false,
  });
}
