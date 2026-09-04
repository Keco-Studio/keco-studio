import type { McpServer } from "@mcp/server/mcp.js";
import { z } from "zod";
import type { ProjectMcpRequestContext } from "./context.ts";
import { rpc } from "./database.ts";
import { encodeDocumentMarkdown } from "./document-codec.ts";
import { McpDomainError } from "./errors.ts";
import { MAX_DOCUMENT_MARKDOWN_BYTES, utf8ByteLength } from "./limits.ts";
import { scheduleMcpReindex } from "./reindex.ts";
import { toolFailure, toolSuccess } from "./results.ts";
import { evaluateObservation, sha256Canonical } from "./slice-contracts.ts";
import { validateSliceV2ContractCase } from "./slice-v2-contract.ts";

type ProjectContextResolver = (
  projectId: string,
) => Promise<ProjectMcpRequestContext>;

const uuid = z.string().uuid();
const identifier = z.string().trim().min(1).max(100);
const sliceId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
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
  }).strict().refine((value) => Object.hasOwn(value, "expected"), "Equals assertions require an expected value."),
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

const technicalIdentifier = z.string().regex(
  /^[a-z0-9][a-z0-9._-]{0,99}$/,
);
const concreteText = z.string().trim().min(1).max(4000).refine(
  (value) => !(/\b(?:any|tbd|todo)\b|as\s+needed|handle\s+normally/i.test(value)),
  "Technical descriptions must be concrete.",
);
const boundaryExpression = concreteText.refine((value) => {
  if (value.toLowerCase() === "unbounded") return true;
  const number = "-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
  const name = "[A-Za-z_][A-Za-z0-9_.-]*";
  const operand = `(?:${number}|${name})`;
  if (new RegExp(`^${operand}\\s*(?:<=|>=|==|<|>)\\s*${operand}$`).test(value)) return true;
  if (new RegExp(`^${number}\\s*(?:<|<=)\\s*${name}\\s*(?:<|<=)\\s*${number}$`).test(value)) return true;
  if (new RegExp(`^${number}\\s*(?:>|>=)\\s*${name}\\s*(?:>|>=)\\s*${number}$`).test(value)) return true;
  if (value.includes("|")) {
    const members = value.split("|").map((item) => item.trim());
    return members.length > 1 && members.every((item) => /^[A-Za-z0-9_.-]+$/.test(item));
  }
  if (value.length >= 3 && ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}")))) {
    const members = value.slice(1, -1).split(",").map((item) => item.trim());
    const member = /^(?:[A-Za-z0-9_.-]+|'[^'\n]+'|"[^"\n]+")$/;
    return members.length > 0 && new Set(members).size === members.length && members.every((item) => member.test(item));
  }
  return false;
}, "Technical boundaries must use a concrete comparison, range, finite set, or unbounded.");
const uniqueTechnicalIds = <T extends { id: string }>(value: T[]) =>
  new Set(value.map((item) => item.id)).size === value.length;
const uniqueStrings = (value: string[]) => new Set(value).size === value.length;
const inputContractSchema = z.object({
  id: technicalIdentifier,
  name: concreteText,
  source: concreteText,
  type: concreteText,
  required: z.boolean(),
  constraints: boundaryExpression,
  default: concreteText,
}).strict();
const outputContractSchema = z.object({
  id: technicalIdentifier,
  name: concreteText,
  type: concreteText,
  shape: concreteText,
  guarantees: concreteText,
}).strict();
const parameterContractSchema = z.object({
  id: technicalIdentifier,
  name: concreteText,
  type: concreteText,
  bounds: boundaryExpression,
  boundaryBehavior: concreteText,
}).strict();
const interfaceContractSchema = z.object({
  id: technicalIdentifier,
  provider: concreteText,
  consumer: concreteText,
  operation: concreteText,
  protocol: concreteText,
}).strict();
const errorContractSchema = z.object({
  id: technicalIdentifier,
  condition: concreteText,
  detection: concreteText,
  response: concreteText,
  observable: concreteText,
}).strict();
const invariantContractSchema = z.object({
  id: technicalIdentifier,
  state: concreteText,
  rule: concreteText,
}).strict();
const acceptanceContractSchema = z.object({
  id: technicalIdentifier,
  behavior: concreteText,
  sourceMappings: z.array(technicalIdentifier).min(1).max(1000).refine(uniqueStrings),
  evalIds: z.array(technicalIdentifier).min(1).max(1000).refine(uniqueStrings),
}).strict();
const technicalContractSchema = z.object({
  inputs: z.array(inputContractSchema).min(1).max(100),
  outputs: z.array(outputContractSchema).min(1).max(100),
  parameters: z.array(parameterContractSchema).min(1).max(100),
  interfaces: z.array(interfaceContractSchema).min(1).max(100),
  errors: z.array(errorContractSchema).min(1).max(100),
  invariants: z.array(invariantContractSchema).min(1).max(100),
  acceptance: z.array(acceptanceContractSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  const allRows = Object.values(value).flat();
  if (!uniqueTechnicalIds(allRows)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Technical IDs must be globally unique." });
  }
});
const verificationSchema = z.object({
  assertions: z.array(z.string().trim().min(1).max(4000)).min(1).max(100),
  observationPaths: z.array(jsonPointer).min(1).max(100),
}).strict();

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
  releaseOrder: z.array(z.enum([
    "implementation",
    "runtime_verification",
    "acceptance",
    "mirrors",
    "package",
  ])).length(5).refine(
    (value) =>
      value.every((item, index) =>
        item === [
          "implementation",
          "runtime_verification",
          "acceptance",
          "mirrors",
          "package",
        ][index]
      ),
    "Release order must follow implementation, runtime verification, acceptance, mirrors, package.",
  ),
  manualReviewBlocksRelease: z.literal(true),
}).strict();

const sourceProfileCommon = {
  schemaVersion: z.literal(1),
  contractVersion: z.literal(2),
  kecoProjectId: uuid,
  capturedAt: timestamp,
  sourceHash: sha256,
  selectionEvidence: z.array(boundedJsonObject).max(100),
};
const sourceProfileSchema = z.discriminatedUnion("kind", [
  z.object({
    ...sourceProfileCommon,
    kind: z.literal("gdd"),
    documentId: uuid,
    epoch: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    contentHash: sha256,
    requirementInventoryHash: sha256,
  }).strict(),
  z.object({
    ...sourceProfileCommon,
    kind: z.literal("feedback"),
    documentId: uuid,
    epoch: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    contentHash: sha256,
  }).strict(),
  z.object({
    ...sourceProfileCommon,
    kind: z.literal("document"),
    documentId: uuid,
    epoch: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    contentHash: sha256,
  }).strict(),
  z.object({
    ...sourceProfileCommon,
    kind: z.literal("table"),
    tableId: uuid,
    schemaHash: sha256,
    rowIds: z.array(uuid).max(1000).refine((value) =>
      new Set(value).size === value.length
    ),
    rowHashes: z.record(uuid, sha256),
    contentHash: sha256,
  }).strict(),
  z.object({
    ...sourceProfileCommon,
    kind: z.literal("user_idea"),
    requestHash: sha256,
    requestExcerpt: z.string().trim().min(1).max(4000),
  }).strict(),
]).superRefine((value, context) => {
  if (
    value.kind === "table" &&
    (Object.keys(value.rowHashes).length !== value.rowIds.length ||
      Object.keys(value.rowHashes).some((rowId) => !value.rowIds.includes(rowId)))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Table row hashes must cover exactly the selected row IDs.",
    });
  }
});
const v2EvaluationSchema = evaluationSchema.extend({
  servedByTasks: z.array(identifier).min(1).max(100).refine((value) =>
    new Set(value).size === value.length
  ),
}).strict();
const v2EvalSpecSchema = z.object({
  schemaVersion: z.literal(2),
  coverageMode: z.enum(["gdd", "non_gdd"]),
  sourceProfileHash: sha256.optional(),
  inventoryHash: sha256.optional(),
  requirementIds: z.array(identifier).min(1).max(1000).optional(),
  evaluations: z.array(v2EvaluationSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (
    new Set(value.evaluations.map((item) => item.evalId)).size !==
      value.evaluations.length
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Evaluation IDs must be unique.",
    });
  }
  if (value.coverageMode === "gdd") {
    if (
      !value.inventoryHash || !value.requirementIds || value.sourceProfileHash
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GDD evaluation coverage is incomplete.",
      });
    }
  } else if (
    !value.sourceProfileHash || value.inventoryHash || value.requirementIds
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Non-GDD evaluation coverage is invalid.",
    });
  }
});
const v2PlanTaskSchema = planTaskSchema.omit({ review: true }).extend({
  review: z.object({
    minimumLevel: z.enum(["self", "separate_context", "independent_actor"]),
  }).strict(),
  sourceMappings: z.array(identifier).min(1).max(1000).refine((value) =>
    new Set(value).size === value.length
  ),
  consumes: z.array(technicalIdentifier).max(1000).refine(uniqueStrings),
  produces: z.array(technicalIdentifier).max(1000).refine(uniqueStrings),
  verification: verificationSchema,
}).strict();
const v2PlanSchema = z.object({
  schemaVersion: z.literal(2),
  coverageMode: z.enum(["gdd", "non_gdd"]),
  sourceProfileHash: sha256.optional(),
  nonGddRationale: z.string().trim().min(1).max(4000).optional(),
  inventoryHash: sha256.optional(),
  requirementIds: z.array(identifier).min(1).max(1000).optional(),
  planRevision: sha256,
  allowedFiles: z.array(relativePath).min(1).max(500),
  technicalContract: technicalContractSchema,
  tasks: z.array(v2PlanTaskSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  const taskIds = new Set(value.tasks.map((task) => task.id));
  if (taskIds.size !== value.tasks.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Task IDs must be unique." });
  }
  const technical = value.technicalContract;
  const byKind = Object.fromEntries(Object.entries(technical).map(([kind, rows]) => [kind, new Set(rows.map((row) => row.id))])) as Record<string, Set<string>>;
  const validConsumes = new Set([...byKind.inputs, ...byKind.parameters, ...byKind.interfaces, ...byKind.invariants]);
  const validProduces = new Set([...byKind.outputs, ...byKind.interfaces, ...byKind.errors, ...byKind.invariants, ...byKind.acceptance]);
  const requiredProduces = new Set([...validProduces].filter((id) => !byKind.acceptance.has(id)));
  const consumed = new Set<string>();
  const produced = new Set<string>();
  for (const task of value.tasks) {
    if (task.files.some((file) => !value.allowedFiles.includes(file))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Every task file must be present in allowedFiles." });
    }
    if (task.dependsOn.some((id) => id === task.id || !taskIds.has(id))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Task dependencies must reference another accepted task." });
    }
    for (const id of task.consumes) consumed.add(id);
    for (const id of task.produces) produced.add(id);
    if (task.consumes.some((id) => !validConsumes.has(id)) || task.produces.some((id) => !validProduces.has(id))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Task technical references must point to declared rows." });
    }
  }
  if ([...validConsumes].some((id) => !consumed.has(id)) || [...requiredProduces].some((id) => !produced.has(id))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Every technical row must be consumed or produced by a task." });
  }
  const sourceMappingIds = value.coverageMode === "gdd"
    ? new Set(value.requirementIds ?? [])
    : new Set(value.tasks.flatMap((task) => task.sourceMappings));
  if (technical.acceptance.some((row) => row.sourceMappings.some((id) => !sourceMappingIds.has(id)))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Acceptance source mappings must reference declared source mappings." });
  }
});
const v2PolicySchema = z.object({
  schemaVersion: z.literal(2),
  requiredArtifacts: z.array(
    z.enum(["TaskResult", "TaskReview", "EvalReport", "MirrorVerification"]),
  )
    .length(4).refine(
      (value) => value.every((item, index) =>
        item === ["TaskResult", "TaskReview", "EvalReport", "MirrorVerification"][index]
      ),
      "requiredArtifacts must preserve the canonical order.",
    ),
  runtimeEvidenceFreshness: z.literal("current_build_and_snapshot"),
  maximumRepairs: z.literal(3),
  releaseOrder: z.array(z.enum([
    "implementation",
    "runtime_verification",
    "acceptance",
    "manual_review",
    "package",
    "roadmap_completion",
    "mirrors",
    "seal",
  ])).length(8).refine(
    (value) =>
      value.every((item, index) =>
        item === [
          "implementation",
          "runtime_verification",
          "acceptance",
          "manual_review",
          "package",
          "roadmap_completion",
          "mirrors",
          "seal",
        ][index]
      ),
    "Release order must follow the Slice V2 delivery lifecycle.",
  ),
  manualReviewBlocksRelease: z.literal(true),
}).strict();
const documentBindingBase = {
  kind: z.enum(["roadmap", "spec", "plan"]),
  folderId: uuid,
  name: z.string().trim().min(1).max(200),
  repositoryPath: relativePath,
};
const documentBindingSchema = z.discriminatedUnion("disposition", [
  z.object({
    ...documentBindingBase,
    disposition: z.literal("create"),
    markdown: z.string(),
  }).strict(),
  z.object({
    ...documentBindingBase,
    disposition: z.literal("bind"),
    documentId: uuid,
    expectedEpoch: z.number().int().nonnegative(),
    expectedRevision: z.number().int().nonnegative(),
    contentHash: sha256,
  }).strict(),
  z.object({
    ...documentBindingBase,
    disposition: z.literal("update"),
    documentId: uuid,
    expectedEpoch: z.number().int().nonnegative(),
    expectedRevision: z.number().int().nonnegative(),
    priorContentHash: sha256,
    markdown: z.string(),
  }).strict(),
]);
const documentProgressSchema = z.object({
  kind: z.literal("plan"),
  documentId: uuid,
  expectedEpoch: z.number().int().nonnegative(),
  expectedRevision: z.number().int().nonnegative(),
  priorContentHash: sha256,
  markdown: z.string(),
}).strict();
const roadmapProgressSchema = z.object({
  documentId: uuid,
  expectedEpoch: z.number().int().nonnegative(),
  expectedRevision: z.number().int().nonnegative(),
  priorContentHash: sha256,
  markdown: z.string(),
}).strict();

const runtimeObservationSchema = z.object({
  schemaVersion: z.literal(1),
  runId: uuid,
  sliceId,
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
  sliceId,
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
).superRefine((value, context) => {
  const expectedByPhase = {
    red: "fails",
    green: "passes",
    implementation: "completed",
    verification: "completed",
  } as const;
  if (value.expectedOutcome !== expectedByPhase[value.phase]) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "TaskResult expected outcome does not match its phase.",
    });
  }
  const validOutcome = value.timedOut || value.cancelled
    ? value.observedOutcome === "blocked" && value.status === "blocked"
    : value.phase === "red"
    ? value.observedOutcome === "failed" && value.status === "completed" &&
      value.exitCode !== null && value.exitCode !== 0
    : value.phase === "green"
    ? value.observedOutcome === "passed" && value.status === "completed" &&
      value.exitCode === 0
    : value.observedOutcome === "completed"
    ? value.status === "completed" &&
      (value.operation.kind !== "command" || value.exitCode === 0)
    : value.observedOutcome === "failed"
    ? value.status === "failed" &&
      (value.operation.kind !== "command" ||
        value.exitCode !== null && value.exitCode !== 0)
    : value.observedOutcome === "blocked" && value.status === "blocked";
  if (!validOutcome) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "TaskResult status contradicts its observed command outcome.",
    });
  }
  const paths = value.changedFiles.map((item) => item.path);
  if (
    new Set(paths).size !== paths.length ||
    value.changedFiles.some((item) =>
      item.beforeHash === null && item.afterHash === null
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "TaskResult changed files require unique paths and a digest.",
    });
  }
});
const taskReviewPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  runId: uuid,
  sliceId,
  taskId: identifier,
  planRevision: sha256,
  taskResultIds: z.array(uuid).min(1).max(50),
  reviewedFiles: z.array(
    z.object({ path: relativePath, hash: sha256 }).strict(),
  ).max(500),
  reviewerType: z.enum(["agent", "human"]),
  reviewerId: identifier,
  requestedLevel: z.enum(["self", "separate_context", "independent_actor"])
    .optional(),
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
    payload: z.object({
      prefix: z.literal("KECO_OBSERVATION").default("KECO_OBSERVATION"),
      observation: runtimeObservationSchema,
    }).strict(),
  }).strict(),
  z.object({
    eventId: uuid,
    eventType: z.literal("mirror_verification"),
    payload: z.object({
      status: z.literal("verified"),
      manifestHash: sha256,
    }).strict(),
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
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
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
const v2DocumentIdentitySchema = documentIdentitySchema.extend({
  folderId: uuid,
  contentHash: sha256,
}).strict();
const documentMapSchema = z.record(z.string(), documentIdentitySchema)
  .superRefine((value, context) => {
    const allowed = new Set([
      "roadmap",
      "spec",
      "plan",
      "status",
      "evalReport",
    ]);
    if (
      Object.keys(value).length < 3 || Object.keys(value).length > 5 ||
      Object.keys(value).some((key) => !allowed.has(key))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Slice documents have an invalid generated document kind.",
      });
    }
  });
const mutationResponseBase = {
  ok: z.literal(true),
  outcome: z.enum(["created", "reused"]),
  runId: uuid,
  stateToken: uuid,
  currentSequence: z.number().int().positive(),
  projection: projectionSchema,
};
const v2DocumentMapSchema = z.object({
  roadmap: v2DocumentIdentitySchema,
  spec: v2DocumentIdentitySchema,
  plan: v2DocumentIdentitySchema,
}).strict();
const v2MutationResponseBase = {
  ...mutationResponseBase,
  contractVersion: z.literal(2),
};
const v2CreateResponseSchema = z.object({
  ...v2MutationResponseBase,
  documents: v2DocumentMapSchema,
}).strict();
const checkpointResponseSchema = z.object({
  ...mutationResponseBase,
  repairCount: z.number().int().min(0).max(3),
  computedEvaluations: z.array(
    z.object({
      evalId: identifier,
      status: z.enum(["passed", "failed", "manual_required"]),
      manualRequired: z.boolean(),
      assertions: z.array(
        z.object({
          assertionId: identifier,
          status: z.enum(["passed", "failed"]),
          actual: z.unknown().optional(),
          reasonCode: identifier,
        }).passthrough(),
      ).max(100),
      reasonCodes: z.array(identifier).max(100),
    }).strict(),
  ).max(50).default([]),
}).strict();
const v2CheckpointResponseSchema = checkpointResponseSchema.extend({
  contractVersion: z.literal(2),
  documents: v2DocumentMapSchema,
}).strict();
const finalizeResponseSchema = z.object({
  ...mutationResponseBase,
  documents: documentMapSchema,
}).strict();
const v2FinalizeResponseSchema = finalizeResponseSchema.extend({
  contractVersion: z.literal(2),
  documents: v2DocumentMapSchema,
}).strict();
const v2ReadRunSchema = z.object({
  runId: uuid,
  sliceId,
  stateToken: uuid,
  currentSequence: z.number().int().positive(),
  repairCount: z.number().int().min(0).max(3),
  contractVersion: z.literal(2),
  plan: v2PlanSchema,
  evalSpec: v2EvalSpecSchema,
  deliveryPolicy: v2PolicySchema,
  projection: projectionSchema,
  documents: v2DocumentMapSchema,
  facts: z.object({
    tasks: z.array(
      z.object({
        status: z.string(),
        resultAccepted: z.boolean().optional(),
        reviewAccepted: z.boolean().optional(),
      }).strict(),
    ).max(100),
    evaluations: z.array(z.object({ status: z.string() }).strict()).max(100),
    manualRequired: z.boolean(),
    policyBlocked: z.boolean(),
    mirrorsVerified: z.boolean(),
    packageReady: z.boolean(),
  }).strict(),
}).strict();
const runVersionSchema = z.object({
  contractVersion: z.number().int(),
  planningRootId: uuid.nullable(),
  sourceProfileHash: sha256.nullable(),
  deliveryPrepared: z.boolean(),
}).strict();
const v2ExportResponseSchema = z.object({
  schemaVersion: z.literal(2),
  canonicalizationVersion: z.literal(1),
  contractVersion: z.literal(2),
  runId: uuid,
  stateToken: uuid,
  currentSequence: z.number().int().positive(),
  preparedSequence: z.number().int().positive(),
  files: z.array(
    z.object({
      kind: z.enum(["roadmap", "spec", "plan"]),
      repositoryPath: relativePath,
      documentId: uuid,
      folderId: uuid,
      epoch: z.number().int().nonnegative(),
      revision: z.number().int().nonnegative(),
      byteCount: z.number().int().nonnegative().max(
        MAX_DOCUMENT_MARKDOWN_BYTES,
      ),
      sha256,
      content: z.string(),
    }).strict(),
  ).length(3),
  manifestHash: sha256,
}).strict().superRefine((value, context) => {
  if (new Set(value.files.map((file) => file.kind)).size !== 3) {
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

function requireAcceptedContract(
  decision: ReturnType<typeof validateSliceV2ContractCase>,
): void {
  if (!decision.accepted) {
    throw new McpDomainError(
      "SLICE_CONTRACT_INVALID",
      `The Slice request failed ${decision.reasonCode}.`,
    );
  }
}

async function readRunContractVersion(
  context: ProjectMcpRequestContext,
  projectId: string,
  runId: string,
  requestedVersion: 2,
): Promise<z.infer<typeof runVersionSchema>> {
  const identity = parseTrusted(
    runVersionSchema,
    await rpc<unknown>(context, "mcp_read_slice_run_contract_version", {
      p_project_id: projectId,
      p_run_id: runId,
    }),
  );
  if (identity.contractVersion !== 2) {
    throw new McpDomainError(
      "SLICE_CONTRACT_INVALID",
      "Godot Slice V1 is retired and unsupported by the current MCP runtime.",
    );
  }
  if (identity.contractVersion !== requestedVersion) {
    throw new McpDomainError(
      "SLICE_STATE_CONFLICT",
      "The requested Slice contract version does not match the stored run.",
    );
  }
  return identity;
}

async function encodeProgress<T extends { markdown: string }>(
  progress: T,
): Promise<
  T & {
    yjsState: string;
    contentHash: string;
  }
> {
  ensureMarkdown(progress.markdown);
  const encoded = await encodeDocumentMarkdown(progress.markdown);
  return {
    ...progress,
    markdown: encoded.markdown,
    yjsState: encoded.yjsStateBase64,
    contentHash: await sha256Utf8(encoded.markdown),
  };
}

function validateEventBindings(
  run: z.infer<typeof v2ReadRunSchema>,
  events: z.infer<typeof eventSchema>[],
): void {
  const taskIds = new Set(run.plan.tasks.map((task) => task.id));
  const allowedFiles = new Set(run.plan.allowedFiles);
  for (const event of events) {
    if (event.eventType === "runtime_observation") {
      if (
        event.payload.observation.runId !== run.runId ||
        event.payload.observation.sliceId !== run.sliceId
      ) {
        throw new McpDomainError(
          "SLICE_CONTRACT_INVALID",
          "Runtime evidence must be bound to the current Slice run.",
        );
      }
      continue;
    }
    if (
      event.eventType !== "task_result" && event.eventType !== "task_review"
    ) {
      continue;
    }
    const payload = event.payload;
    if (
      payload.runId !== run.runId || payload.sliceId !== run.sliceId ||
      payload.planRevision !== run.plan.planRevision ||
      !taskIds.has(payload.taskId)
    ) {
      throw new McpDomainError(
        "SLICE_CONTRACT_INVALID",
        "Task evidence must be bound to the accepted Slice plan and run.",
      );
    }
    if (event.eventType === "task_result") {
      const taskPayload = event.payload;
      const task = run.plan.tasks.find((candidate) =>
        candidate.id === taskPayload.taskId
      )!;
      if (
        taskPayload.changedFiles.some((file) => !allowedFiles.has(file.path)) ||
        (taskPayload.phase === "red" || taskPayload.phase === "green") &&
          (taskPayload.operation.kind !== "command" ||
            taskPayload.operation.command !== task[taskPayload.phase].command)
      ) {
        throw new McpDomainError(
          "SLICE_CONTRACT_INVALID",
          "Task evidence must use the approved command and allowed files.",
        );
      }
    }
  }
}

function serverComparableEvaluation(
  evaluation: ReturnType<typeof evaluateObservation>,
): Record<string, unknown> {
  return {
    evalId: evaluation.evalId,
    status: evaluation.status,
    manualRequired: evaluation.manualRequired,
    assertions: evaluation.assertions.map((
      { expected: _expected, ...assertion },
    ) => assertion),
    reasonCodes: evaluation.reasonCodes,
  };
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
    contractVersion: z.literal(2),
    runId: uuid,
    planningRootId: uuid,
    sliceId,
    sourceProfile: sourceProfileSchema,
    sourceProfileHash: sha256,
    plan: v2PlanSchema,
    evalSpec: v2EvalSpecSchema,
    deliveryPolicy: v2PolicySchema,
    documentBindings: z.array(documentBindingSchema).length(3),
    supersedesRunId: uuid.optional(),
    idempotencyKey,
  }).strict().superRefine((value, context) => {
    const sourceDecision = validateSliceV2ContractCase(
      "sourceProfile",
      value.sourceProfile,
    );
    const planDecision = validateSliceV2ContractCase("planEval", {
      plan: value.plan,
      evalSpec: value.evalSpec,
    });
    const specFolderId = value.documentBindings.find((item) =>
      item.kind === "spec"
    )?.folderId;
    const planFolderId = value.documentBindings.find((item) =>
      item.kind === "plan"
    )?.folderId;
    const bindingDecision = validateSliceV2ContractCase("documentBindings", {
      sliceId: value.sliceId,
      planningRootId: value.planningRootId,
      specFolderId,
      planFolderId,
      documentBindings: value.documentBindings,
    });
    for (const decision of [sourceDecision, planDecision, bindingDecision]) {
      if (!decision.accepted) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `Slice V2 contract rejected the request with ${decision.reasonCode}.`,
        });
      }
    }
    if (value.plan.coverageMode !== value.evalSpec.coverageMode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Plan and EvalSpec coverage modes must match.",
      });
    }
    if (
      new Set(value.documentBindings.map((item) => item.repositoryPath))
        .size !== 3
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
        const projectId = requestedProjectId(input, fixed);
        requireAcceptedContract(
          validateSliceV2ContractCase("sourceProfile", input.sourceProfile),
        );
        requireAcceptedContract(validateSliceV2ContractCase("planEval", {
          plan: input.plan,
          evalSpec: input.evalSpec,
        }));
        if (
          input.sourceProfile.kecoProjectId !== projectId ||
          await sha256Canonical(input.sourceProfile) !== input.sourceProfileHash
        ) {
          throw new McpDomainError(
            "SLICE_CONTRACT_INVALID",
            "The SourceProfile identity or hash does not match the requested project.",
          );
        }
        const documentBindings = await Promise.all(
          input.documentBindings.map(async (binding) => {
            if (binding.disposition === "bind") return binding;
            ensureMarkdown(binding.markdown);
            const encoded = await encodeDocumentMarkdown(binding.markdown);
            return binding.disposition === "create"
              ? {
                ...binding,
                documentId: crypto.randomUUID(),
                markdown: encoded.markdown,
                yjsState: encoded.yjsStateBase64,
              }
              : {
                ...binding,
                markdown: encoded.markdown,
                yjsState: encoded.yjsStateBase64,
              };
          }),
        );
        const data = parseTrusted(
          v2CreateResponseSchema,
          await rpc<unknown>(context, "mcp_create_slice_bundle_v2", {
            p_project_id: projectId,
            p_run_id: input.runId,
            p_planning_root_id: input.planningRootId,
            p_slice_id: input.sliceId,
            p_source_profile: input.sourceProfile,
            p_source_profile_hash: input.sourceProfileHash,
            p_plan_data: input.plan,
            p_plan_hash: await sha256Canonical(input.plan),
            p_eval_spec: input.evalSpec,
            p_eval_spec_hash: await sha256Canonical(input.evalSpec),
            p_delivery_policy: input.deliveryPolicy,
            p_delivery_policy_hash: await sha256Canonical(input.deliveryPolicy),
            p_document_bindings: documentBindings,
            p_supersedes_run_id: input.supersedesRunId ?? null,
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
    contractVersion: z.literal(2),
    runId: uuid,
    stateToken: uuid,
    events: z.array(eventSchema).min(1).max(50),
    artifacts: z.array(artifactSchema).max(50).default([]),
    documentProgress: z.array(documentProgressSchema).max(1).default([]),
    idempotencyKey,
  }).strict().superRefine((value, context) => {
    if (
      new Set(value.events.map((item) => item.eventId)).size !==
        value.events.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Event IDs must be unique.",
      });
    }
    for (const event of value.events) {
      if (event.eventType !== "mirror_verification") continue;
      const artifact = value.artifacts.find((candidate) =>
        candidate.eventId === event.eventId &&
        candidate.artifactType === "mirror_verification"
      );
      const payload = artifact?.payload;
      if (
        !artifact || !payload ||
        payload.artifactType !== "MirrorVerification" ||
        payload.runId !== value.runId ||
        payload.manifestHash !== event.payload.manifestHash ||
        !Array.isArray(payload.files) || payload.files.length === 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Mirror verification must bind the materialized read-back artifact.",
        });
      }
    }
  });
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
        const identity = await readRunContractVersion(
          context,
          projectId,
          input.runId,
          input.contractVersion,
        );
        const rawRun = await rpc<unknown>(context, "mcp_read_slice_run", {
          p_project_id: projectId,
          p_run_id: input.runId,
        });
        const run = parseTrusted(v2ReadRunSchema, rawRun);
        validateEventBindings(run, input.events);
        const requestedDocumentProgress = input.documentProgress ?? [];
        const computedEvaluations = input.events
          .filter((event) => event.eventType === "runtime_observation")
          .map((event) => {
            const spec = run.evalSpec.evaluations.find((candidate) =>
              candidate.evalId === event.payload.observation.evalId
            );
            if (!spec) {
              throw new McpDomainError(
                "SLICE_CONTRACT_INVALID",
                "Runtime evidence references an unknown evaluation.",
              );
            }
            const { servedByTasks: _ignored, ...runtimeSpec } = spec;
            return evaluateObservation(runtimeSpec, event.payload.observation);
          });
        const events = await Promise.all(input.events.map(async (event) => {
          const payload = event.eventType === "runtime_observation"
            ? { ...event.payload, prefix: "KECO_OBSERVATION" as const }
            : event.payload;
          return {
            ...event,
            payload,
            inputHash: await sha256Canonical(payload),
            outputHash: await sha256Canonical({
              eventType: event.eventType,
              payload,
            }),
          };
        }));
        const documentProgress = await Promise.all(
          requestedDocumentProgress.map(encodeProgress),
        );
        const data = parseTrusted(
          v2CheckpointResponseSchema,
          await rpc<unknown>(context, "mcp_checkpoint_slice_v2", {
            p_project_id: projectId,
            p_run_id: input.runId,
            p_expected_state_token: input.stateToken,
            p_events: events,
            p_computed_evaluations: computedEvaluations.map(
              serverComparableEvaluation,
            ),
            p_artifacts: input.artifacts,
            p_document_progress: documentProgress,
            p_idempotency_key: input.idempotencyKey,
            p_input_hash: await sha256Canonical(withoutIdempotency(input)),
          }),
        );
        return toolSuccess("Slice checkpoint accepted.", data);
      } catch (error) {
        return toolFailure(error);
      }
    });
  }

  const prepareSchema = z.object({
    ...shape,
    contractVersion: z.literal(2),
    runId: uuid,
    stateToken: uuid,
    roadmapProgress: roadmapProgressSchema,
    idempotencyKey,
  }).strict();
  if (options.writes) {
    server.registerTool("prepare_delivery", {
      description:
        "Validate release gates and apply the final authoritative roadmap checkbox update before mirror export.",
      inputSchema: prepareSchema,
      annotations: writeAnnotations,
    }, async (input: z.infer<typeof prepareSchema>) => {
      try {
        const context = await contextFor(input, fixed, resolver);
        const projectId = requestedProjectId(input, fixed);
        await readRunContractVersion(context, projectId, input.runId, 2);
        const roadmapProgress = await encodeProgress(input.roadmapProgress);
        const data = parseTrusted(
          v2FinalizeResponseSchema,
          await rpc<unknown>(context, "mcp_prepare_slice_delivery_v2", {
            p_project_id: projectId,
            p_run_id: input.runId,
            p_expected_state_token: input.stateToken,
            p_roadmap_progress: roadmapProgress,
            p_idempotency_key: input.idempotencyKey,
            p_input_hash: await sha256Canonical(withoutIdempotency(input)),
          }),
        );
        return toolSuccess("Slice delivery prepared.", data);
      } catch (error) {
        return toolFailure(error);
      }
    });
  }

  const finalizeSchema = z.object({
    ...shape,
    contractVersion: z.literal(2),
    runId: uuid,
    stateToken: uuid,
    requestedTerminalIntent: z.enum(["implementation_complete", "delivery"]),
    mirrorVerification: z.object({
      eventId: uuid,
      manifestHash: sha256,
    }).strict().optional(),
    evalReport: z.object({
      documentId: uuid,
      name: z.string().trim().min(1).max(200),
      repositoryPath: relativePath,
    }).strict().optional(),
    documents: z.array(
      z.object({
        documentId: uuid,
        expectedEpoch: z.number().int().nonnegative(),
        expectedRevision: z.number().int().nonnegative(),
        markdown: z.string(),
      }).strict(),
    ).max(4).default([]),
    idempotencyKey,
  }).strict().superRefine((value, context) => {
    if (
      new Set(value.documents.map((item) => item.documentId)).size !==
        value.documents.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Final documents must be unique.",
      });
    }
    if (
      value.documents.length > 0 || value.evalReport
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Version-2 finalization cannot mutate canonical documents.",
      });
    }
    if (
      value.requestedTerminalIntent === "implementation_complete" &&
      value.mirrorVerification
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Implementation completion precedes mirror verification.",
      });
    }
  });
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
        await readRunContractVersion(
          context,
          projectId,
          input.runId,
          input.contractVersion,
        );
        const data = parseTrusted(
          v2FinalizeResponseSchema,
          await rpc<unknown>(context, "mcp_finalize_slice_v2", {
            p_project_id: projectId,
            p_run_id: input.runId,
            p_expected_state_token: input.stateToken,
            p_requested_terminal_intent: input.requestedTerminalIntent,
            p_mirror_verification_event_id:
              input.mirrorVerification?.eventId ?? null,
            p_mirror_manifest_hash: input.mirrorVerification?.manifestHash ??
              null,
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

  const exportSchema = z.object({
    ...shape,
    contractVersion: z.literal(2),
    runId: uuid,
  }).strict();
  if (options.reads) {
    server.registerTool("export_slice_mirrors", {
      description:
        "Export canonical Keco Slice document bytes, revisions, paths, and SHA-256 digests for local materialization.",
      inputSchema: exportSchema,
      annotations: readAnnotations,
    }, async (input: z.infer<typeof exportSchema>) => {
      try {
        const context = await contextFor(input, fixed, resolver);
        const projectId = requestedProjectId(input, fixed);
        await readRunContractVersion(
          context,
          projectId,
          input.runId,
          input.contractVersion,
        );
        const rawExport = await rpc<unknown>(
          context,
          "mcp_export_slice_mirrors_v2",
          {
          p_project_id: projectId,
          p_run_id: input.runId,
          },
        );
        const data = parseTrusted(v2ExportResponseSchema, rawExport);
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
  options: { writes?: boolean; reads?: boolean } = {},
): void {
  registerSliceToolSet(server, context, null, {
    writes: context.role !== "viewer" && options.writes !== false,
    reads: options.reads !== false,
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
