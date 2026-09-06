import manifestJson from "../../../contracts/keco-slice-v2/contract-manifest.json" with {
  type: "json",
};

export const SLICE_CONTRACT_VERSION = 2 as const;
export const SLICE_V2_MANIFEST = manifestJson;

export type SliceReasonCode = typeof manifestJson.reasonCodes[number];
export type ContractBoundary =
  | "sourceProfile"
  | "documentBindings"
  | "planEval"
  | "review"
  | "runtimeEvidence"
  | "state"
  | "repair";
export type ContractDecision =
  | { accepted: true; reasonCode: null }
  | { accepted: false; reasonCode: SliceReasonCode };

type JsonRecord = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const JSON_POINTER_RE = /^(?:\/(?:[^~\/]|~[01])*)+$/;
const CONCRETE_VAGUE_RE = /\b(?:any|tbd|todo)\b|as\s+needed|handle\s+normally/i;

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: JsonRecord, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function strings(value: unknown, allowEmpty = false): value is string[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) &&
    value.every((item) => typeof item === "string" && item.length > 0) &&
    new Set(value).size === value.length;
}

function concreteText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    !CONCRETE_VAGUE_RE.test(value.trim());
}

function boundary(value: unknown): value is string {
  if (!concreteText(value)) return false;
  const text = value.trim();
  if (text.toLowerCase() === "unbounded") return true;
  const number = "-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
  const identifier = "[A-Za-z_][A-Za-z0-9_.-]*";
  const operand = `(?:${number}|${identifier})`;
  const comparison = new RegExp(`^${operand}\\s*(?:<=|>=|==|<|>)\\s*${operand}$`);
  const increasingRange = new RegExp(`^${number}\\s*(?:<|<=)\\s*${identifier}\\s*(?:<|<=)\\s*${number}$`);
  const decreasingRange = new RegExp(`^${number}\\s*(?:>|>=)\\s*${identifier}\\s*(?:>|>=)\\s*${number}$`);
  if (comparison.test(text) || increasingRange.test(text) || decreasingRange.test(text)) return true;
  if (text.includes("|")) {
    const members = text.split("|").map((item) => item.trim());
    return members.length > 1 && members.every((item) => /^[A-Za-z0-9_.-]+$/.test(item));
  }
  if (text.length >= 3 && ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}")))) {
    const members = text.slice(1, -1).split(",").map((item) => item.trim());
    const member = /^(?:[A-Za-z0-9_.-]+|'[^'\n]+'|"[^"\n]+")$/;
    return members.length > 0 && new Set(members).size === members.length && members.every((item) => member.test(item));
  }
  return false;
}

function technicalContractValid(
  value: unknown,
  taskIds: Set<string>,
  evalIds: Set<string>,
  sourceMappingIds: Set<string>,
): boolean {
  if (!record(value)) return false;
  const sections = ["inputs", "outputs", "parameters", "interfaces", "errors", "invariants", "acceptance"] as const;
  if (!exactKeys(value, [...sections]) || sections.some((section) => !Array.isArray(value[section]) || value[section].length === 0)) return false;
  const rowSpecs: Record<typeof sections[number], string[]> = {
    inputs: ["id", "name", "source", "type", "required", "constraints", "default"],
    outputs: ["id", "name", "type", "shape", "guarantees"],
    parameters: ["id", "name", "type", "bounds", "boundaryBehavior"],
    interfaces: ["id", "provider", "consumer", "operation", "protocol"],
    errors: ["id", "condition", "detection", "response", "observable"],
    invariants: ["id", "state", "rule"],
    acceptance: ["id", "behavior", "sourceMappings", "evalIds"],
  };
  const technicalIds = new Set<string>();
  for (const section of sections) {
    for (const item of value[section] as unknown[]) {
      if (!record(item) || !exactKeys(item, rowSpecs[section]) || typeof item.id !== "string" || !ID_RE.test(item.id) || technicalIds.has(item.id)) return false;
      const textKeys = rowSpecs[section].filter((key) => !["id", "required", "constraints", "bounds", "sourceMappings", "evalIds"].includes(key));
      if (textKeys.some((key) => !concreteText(item[key]))) return false;
      if (section === "inputs" && (typeof item.required !== "boolean" || !boundary(item.constraints) || !concreteText(item.default))) return false;
      if (section === "parameters" && (!boundary(item.bounds) || !concreteText(item.boundaryBehavior))) return false;
      if (section === "acceptance" && (!strings(item.sourceMappings) || item.sourceMappings.some((id) => !sourceMappingIds.has(id)) || !strings(item.evalIds) || item.evalIds.some((id) => !evalIds.has(id)))) return false;
      technicalIds.add(item.id);
    }
  }
  return true;
}

function validJsonPointer(value: unknown): value is string {
  return typeof value === "string" && (value === "" || (value.startsWith("/") && !/~(?:[^01]|$)/.test(value)));
}

function validAssertion(value: unknown): boolean {
  if (!record(value) || typeof value.assertionId !== "string" || !ID_RE.test(value.assertionId) || typeof value.kind !== "string") return false;
  if (value.kind === "equals" || value.kind === "subset") {
    return exactKeys(value, ["assertionId", "kind", "path", "expected"]) && validJsonPointer(value.path);
  }
  if (value.kind === "range") {
    const keys = ["assertionId", "kind", "path", "minimumInclusive", "maximumInclusive"];
    if ("minimum" in value) keys.push("minimum");
    if ("maximum" in value) keys.push("maximum");
    const minimum = value.minimum;
    const maximum = value.maximum;
    const validMinimum = minimum === undefined || (typeof minimum === "number" && Number.isFinite(minimum));
    const validMaximum = maximum === undefined || (typeof maximum === "number" && Number.isFinite(maximum));
    return exactKeys(value, keys) && validJsonPointer(value.path) && typeof value.minimumInclusive === "boolean" && typeof value.maximumInclusive === "boolean" &&
      (minimum !== undefined || maximum !== undefined) && validMinimum && validMaximum &&
      (minimum === undefined || maximum === undefined || minimum <= maximum);
  }
  if (value.kind === "roundtrip") {
    return exactKeys(value, ["assertionId", "kind", "beforePath", "afterPath", "markerPaths"]) && validJsonPointer(value.beforePath) && validJsonPointer(value.afterPath) &&
      strings(value.markerPaths) && value.markerPaths.every(validJsonPointer);
  }
  return false;
}

export function isSafeRepositoryPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) return false;
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value) || value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function reject(reasonCode: SliceReasonCode): ContractDecision {
  return { accepted: false, reasonCode };
}

function validateSourceProfile(value: unknown): ContractDecision {
  if (!record(value)) return reject("SLICE_SOURCE_PROFILE_INVALID");
  const common = ["schemaVersion", "contractVersion", "kind", "kecoProjectId", "capturedAt", "sourceHash", "selectionEvidence"];
  if (value.schemaVersion !== 1 || value.contractVersion !== 2 ||
    !manifestJson.sourceProfileKinds.includes(value.kind as never) ||
    typeof value.kecoProjectId !== "string" || !UUID_RE.test(value.kecoProjectId) ||
    typeof value.capturedAt !== "string" || Number.isNaN(Date.parse(value.capturedAt)) ||
    typeof value.sourceHash !== "string" || !HASH_RE.test(value.sourceHash) ||
    !Array.isArray(value.selectionEvidence) || value.selectionEvidence.some((item) => !record(item))) {
    return reject("SLICE_SOURCE_PROFILE_INVALID");
  }
  if (["gdd", "feedback", "document"].includes(value.kind as string)) {
    const extra = ["documentId", "epoch", "revision", "contentHash"];
    if (value.kind === "gdd") extra.push("requirementInventoryHash");
    if (!exactKeys(value, [...common, ...extra]) || typeof value.documentId !== "string" || !UUID_RE.test(value.documentId) ||
      !Number.isInteger(value.epoch) || (value.epoch as number) < 0 || !Number.isInteger(value.revision) || (value.revision as number) < 0 ||
      typeof value.contentHash !== "string" || !HASH_RE.test(value.contentHash) ||
      (value.kind === "gdd" && (typeof value.requirementInventoryHash !== "string" || !HASH_RE.test(value.requirementInventoryHash)))) {
      return reject("SLICE_SOURCE_PROFILE_INVALID");
    }
    return { accepted: true, reasonCode: null };
  }
  if (value.kind === "table") {
    const rowIds = value.rowIds;
    const rowHashes = value.rowHashes;
    if (!exactKeys(value, [...common, "tableId", "schemaHash", "rowIds", "rowHashes", "contentHash"]) ||
      typeof value.tableId !== "string" || !UUID_RE.test(value.tableId) || typeof value.schemaHash !== "string" || !HASH_RE.test(value.schemaHash) ||
      !strings(rowIds, true) || rowIds.some((id) => !UUID_RE.test(id)) || !record(rowHashes) ||
      Object.keys(rowHashes).length !== rowIds.length || Object.keys(rowHashes).some((id) => !rowIds.includes(id)) ||
      Object.values(rowHashes).some((hash) => typeof hash !== "string" || !HASH_RE.test(hash)) ||
      typeof value.contentHash !== "string" || !HASH_RE.test(value.contentHash)) return reject("SLICE_SOURCE_PROFILE_INVALID");
    return { accepted: true, reasonCode: null };
  }
  if (!exactKeys(value, [...common, "requestHash", "requestExcerpt"]) || typeof value.requestHash !== "string" || !HASH_RE.test(value.requestHash) ||
    typeof value.requestExcerpt !== "string" || value.requestExcerpt.trim().length === 0 || value.requestExcerpt.length > 4000) {
    return reject("SLICE_SOURCE_PROFILE_INVALID");
  }
  return { accepted: true, reasonCode: null };
}

function validateDocumentBindings(value: unknown): ContractDecision {
  if (!record(value) || typeof value.sliceId !== "string" || !ID_RE.test(value.sliceId) ||
    ![value.planningRootId, value.specFolderId, value.planFolderId].every((id) => typeof id === "string" && UUID_RE.test(id)) ||
    value.specFolderId === value.planFolderId || !Array.isArray(value.documentBindings) || value.documentBindings.length !== 3) {
    return reject("SLICE_DOCUMENT_PLACEMENT_INVALID");
  }
  const folders: JsonRecord = { roadmap: value.planningRootId, spec: value.specFolderId, plan: value.planFolderId };
  const paths: JsonRecord = {
    roadmap: manifestJson.canonicalPaths.roadmap,
    spec: `${manifestJson.canonicalPaths.specPrefix}${value.sliceId}${manifestJson.canonicalPaths.specSuffix}`,
    plan: `${manifestJson.canonicalPaths.planPrefix}${value.sliceId}${manifestJson.canonicalPaths.planSuffix}`,
  };
  const seen = new Set<string>();
  for (const item of value.documentBindings) {
    if (!record(item) || !manifestJson.documentKinds.includes(item.kind as never) || seen.has(item.kind as string) ||
      !manifestJson.documentDispositions.includes(item.disposition as never) || item.folderId !== folders[item.kind as string] ||
      item.name !== (item.kind === "roadmap" ? "roadmap" : value.sliceId) || item.repositoryPath !== paths[item.kind as string]) {
      return reject("SLICE_DOCUMENT_PLACEMENT_INVALID");
    }
    const base = ["kind", "disposition", "folderId", "name", "repositoryPath"];
    if (item.disposition === "create") {
      if (!exactKeys(item, [...base, "markdown"]) || typeof item.markdown !== "string") return reject("SLICE_DOCUMENT_PLACEMENT_INVALID");
    } else if (item.disposition === "bind") {
      if (!exactKeys(item, [...base, "documentId", "expectedEpoch", "expectedRevision", "contentHash"]) ||
        typeof item.documentId !== "string" || !UUID_RE.test(item.documentId) || !Number.isInteger(item.expectedEpoch) ||
        !Number.isInteger(item.expectedRevision) || typeof item.contentHash !== "string" || !HASH_RE.test(item.contentHash)) {
        return reject("SLICE_DOCUMENT_PLACEMENT_INVALID");
      }
    } else if (!exactKeys(item, [...base, "documentId", "expectedEpoch", "expectedRevision", "priorContentHash", "markdown"]) ||
      typeof item.documentId !== "string" || !UUID_RE.test(item.documentId) || !Number.isInteger(item.expectedEpoch) ||
      !Number.isInteger(item.expectedRevision) || typeof item.priorContentHash !== "string" || !HASH_RE.test(item.priorContentHash) || typeof item.markdown !== "string") {
      return reject("SLICE_DOCUMENT_PLACEMENT_INVALID");
    }
    seen.add(item.kind as string);
  }
  return { accepted: true, reasonCode: null };
}

function validatePlanEval(value: unknown): ContractDecision {
  if (!record(value) || !record(value.plan) || !record(value.evalSpec)) return reject("SLICE_PLAN_SCOPE_INVALID");
  const plan = value.plan;
  const evalSpec = value.evalSpec;
  const planKeys = ["schemaVersion", "coverageMode", "sourceProfileHash", "nonGddRationale", "inventoryHash", "requirementIds", "planRevision", "allowedFiles", "tasks", "technicalContract"];
  const evalKeys = ["schemaVersion", "coverageMode", "sourceProfileHash", "inventoryHash", "requirementIds", "evaluations"];
  if (Object.keys(plan).some((key) => !planKeys.includes(key)) || Object.keys(evalSpec).some((key) => !evalKeys.includes(key))) {
    return reject("SLICE_PLAN_SCOPE_INVALID");
  }
  if (plan.schemaVersion !== 2 || typeof plan.planRevision !== "string" || !HASH_RE.test(plan.planRevision) || !strings(plan.allowedFiles) || plan.allowedFiles.some((path) => !isSafeRepositoryPath(path)) ||
    !Array.isArray(plan.tasks) || plan.tasks.length === 0 || new Set(plan.allowedFiles).size !== plan.allowedFiles.length) {
    return reject("SLICE_PLAN_SCOPE_INVALID");
  }
  const allowedFiles = plan.allowedFiles as string[];
  const tasks = plan.tasks as unknown[];
  if (plan.coverageMode === "gdd") {
    if (!strings(plan.requirementIds) || typeof plan.inventoryHash !== "string" || !HASH_RE.test(plan.inventoryHash) || "nonGddRationale" in plan) {
      return reject("SLICE_PLAN_SCOPE_INVALID");
    }
  } else if (plan.coverageMode !== "non_gdd" || typeof plan.nonGddRationale !== "string" || plan.nonGddRationale.trim().length === 0 ||
    typeof plan.sourceProfileHash !== "string" || !HASH_RE.test(plan.sourceProfileHash) || "requirementIds" in plan || "inventoryHash" in plan) {
    return reject("SLICE_PLAN_SCOPE_INVALID");
  }
  const taskIds = new Set<string>();
  const ownedFiles = new Set<string>();
  for (const task of tasks) {
    if (!record(task) || typeof task.id !== "string" || !ID_RE.test(task.id) || taskIds.has(task.id) || !strings(task.files) ||
      task.files.some((path) => !allowedFiles.includes(path)) || !strings(task.dependsOn, true) || task.dependsOn.some((id) => id === task.id || !taskIds.has(id)) ||
      !strings(task.servesEvaluations) || !record(task.red) || task.red.expected !== "fails" || typeof task.red.command !== "string" || task.red.command.trim() === "" ||
      !record(task.green) || task.green.expected !== "passes" || typeof task.green.command !== "string" || task.green.command.trim() === "" ||
      !record(task.review) || !manifestJson.reviewLevels.includes(task.review.minimumLevel as never) || !strings(task.sourceMappings)) {
      return reject("SLICE_PLAN_SCOPE_INVALID");
    }
    taskIds.add(task.id);
    task.files.forEach((path) => ownedFiles.add(path));
  }
  if (allowedFiles.some((path) => !ownedFiles.has(path))) return reject("SLICE_PLAN_SCOPE_INVALID");

  // Validate the technical contract before EvalSpec reciprocity so malformed
  // technical rows receive the canonical technical reason code.
  const rawEvaluations = evalSpec.evaluations;
  const knownEvalIds = new Set<string>();
  if (Array.isArray(rawEvaluations)) {
    for (const evaluation of rawEvaluations) {
      if (record(evaluation) && typeof evaluation.evalId === "string") knownEvalIds.add(evaluation.evalId);
    }
  }
  const sourceMappingIds = plan.coverageMode === "gdd"
    ? new Set(Array.isArray(plan.requirementIds) ? plan.requirementIds.filter((id): id is string => typeof id === "string") : [])
    : new Set(tasks.flatMap((task) => record(task) && Array.isArray(task.sourceMappings) ? task.sourceMappings.filter((id): id is string => typeof id === "string") : []));
  if (!technicalContractValid(plan.technicalContract, taskIds, knownEvalIds, sourceMappingIds)) return reject("SLICE_TECHNICAL_CONTRACT_INVALID");
  const technical = plan.technicalContract as JsonRecord;
  const technicalByKind = Object.fromEntries(["inputs", "outputs", "parameters", "interfaces", "errors", "invariants", "acceptance"].map((section) => [section, new Set((technical[section] as JsonRecord[]).map((row) => row.id as string))])) as Record<string, Set<string>>;
  const validConsumes = new Set([...technicalByKind.inputs, ...technicalByKind.parameters, ...technicalByKind.interfaces, ...technicalByKind.invariants]);
  const validProduces = new Set([...technicalByKind.outputs, ...technicalByKind.interfaces, ...technicalByKind.errors, ...technicalByKind.invariants, ...technicalByKind.acceptance]);
  const requiredProduces = new Set([...validProduces].filter((id) => !technicalByKind.acceptance.has(id)));
  const consumed = new Set<string>();
  const produced = new Set<string>();
  for (const task of tasks as JsonRecord[]) {
    if (!exactKeys(task, ["id", "files", "dependsOn", "servesEvaluations", "red", "green", "review", "sourceMappings", "consumes", "produces", "verification"]) ||
      !strings(task.consumes, true) || task.consumes.some((id) => !validConsumes.has(id)) ||
      !strings(task.produces, true) || task.produces.some((id) => !validProduces.has(id)) ||
      !record(task.verification) || !exactKeys(task.verification, ["assertions", "observationPaths"]) ||
      !strings(task.verification.assertions) || !strings(task.verification.observationPaths) ||
      (task.verification.observationPaths as string[]).some((path) => !JSON_POINTER_RE.test(path))) {
      return reject("SLICE_TECHNICAL_CONTRACT_INVALID");
    }
    for (const id of task.consumes) consumed.add(id);
    for (const id of task.produces) produced.add(id);
  }
  if (![...validConsumes].every((id) => consumed.has(id)) || ![...requiredProduces].every((id) => produced.has(id))) return reject("SLICE_TECHNICAL_CONTRACT_INVALID");

  if (evalSpec.schemaVersion !== 2 || evalSpec.coverageMode !== plan.coverageMode ||
    (plan.coverageMode === "non_gdd" && evalSpec.sourceProfileHash !== plan.sourceProfileHash) ||
    !Array.isArray(evalSpec.evaluations) || evalSpec.evaluations.length === 0) return reject("SLICE_EVAL_BINDING_INVALID");
  if (
    plan.coverageMode === "gdd" &&
    (evalSpec.inventoryHash !== plan.inventoryHash ||
      JSON.stringify(evalSpec.requirementIds) !== JSON.stringify(plan.requirementIds))
  ) return reject("SLICE_EVAL_BINDING_INVALID");
  const evalIds = new Set<string>();
  const reverse = new Map<string, Set<string>>();
  for (const evaluation of evalSpec.evaluations) {
    if (!record(evaluation) || Object.keys(evaluation).some((key) => !["evalId", "servedByTasks", "buildHash", "snapshotHash", "assertions", "manualRequired"].includes(key)) ||
      typeof evaluation.evalId !== "string" || !ID_RE.test(evaluation.evalId) || evalIds.has(evaluation.evalId) ||
      !strings(evaluation.servedByTasks) || evaluation.servedByTasks.some((id) => !taskIds.has(id)) || !Array.isArray(evaluation.assertions) || evaluation.assertions.length === 0 ||
      typeof evaluation.buildHash !== "string" || !HASH_RE.test(evaluation.buildHash) || typeof evaluation.snapshotHash !== "string" || !HASH_RE.test(evaluation.snapshotHash) ||
      ("manualRequired" in evaluation && typeof evaluation.manualRequired !== "boolean") ||
      !evaluation.assertions.every(validAssertion) || new Set(evaluation.assertions.map((assertion) => record(assertion) ? assertion.assertionId : "")).size !== evaluation.assertions.length) {
      return reject("SLICE_EVAL_BINDING_INVALID");
    }
    evalIds.add(evaluation.evalId);
    reverse.set(evaluation.evalId, new Set(evaluation.servedByTasks));
  }
  for (const task of tasks as JsonRecord[]) {
    for (const evalId of task.servesEvaluations as string[]) {
      if (!evalIds.has(evalId) || !reverse.get(evalId)?.has(task.id as string)) return reject("SLICE_EVAL_BINDING_INVALID");
    }
  }
  for (const [evalId, servingTasks] of reverse) {
    for (const taskId of servingTasks) {
      const task = (tasks as JsonRecord[]).find((candidate) => candidate.id === taskId)!;
      if (!(task.servesEvaluations as string[]).includes(evalId)) return reject("SLICE_EVAL_BINDING_INVALID");
    }
  }
  const acceptanceEvalIds = new Set<string>();
  for (const row of technical.acceptance as JsonRecord[]) {
    for (const evalId of row.evalIds as string[]) acceptanceEvalIds.add(evalId);
  }
  if (acceptanceEvalIds.size !== evalIds.size || [...acceptanceEvalIds].some((id) => !evalIds.has(id))) return reject("SLICE_TECHNICAL_CONTRACT_INVALID");
  return { accepted: true, reasonCode: null };
}

function validateReview(value: unknown): ContractDecision {
  if (!record(value) || !manifestJson.reviewLevels.includes(value.requestedLevel as never)) return reject("SLICE_REVIEW_LEVEL_INVALID");
  if (value.requestedLevel === "independent_actor") {
    return typeof value.taskResultActor === "string" && typeof value.reviewActor === "string" && value.taskResultActor !== value.reviewActor
      ? { accepted: true, reasonCode: null }
      : reject("SLICE_REVIEW_LEVEL_INVALID");
  }
  if (value.requestedLevel === "separate_context") {
    return value.trustedContext === true && typeof value.taskExecutionContext === "string" && typeof value.reviewExecutionContext === "string" &&
        value.taskExecutionContext !== value.reviewExecutionContext
      ? { accepted: true, reasonCode: null }
      : reject("SLICE_REVIEW_LEVEL_INVALID");
  }
  return { accepted: true, reasonCode: null };
}

export function validateSliceV2ContractCase(boundary: ContractBoundary, value: unknown): ContractDecision {
  if (boundary === "sourceProfile") return validateSourceProfile(value);
  if (boundary === "documentBindings") return validateDocumentBindings(value);
  if (boundary === "planEval") return validatePlanEval(value);
  if (boundary === "review") return validateReview(value);
  if (boundary === "runtimeEvidence") {
    if (!record(value)) return reject("SLICE_RUNTIME_EVIDENCE_INVALID");
    const valid = value.contractVersion === 2 && value.prefix === manifestJson.runtimePrefixes.current && value.legacyAdapter !== true;
    return valid ? { accepted: true, reasonCode: null } : reject("SLICE_RUNTIME_EVIDENCE_INVALID");
  }
  if (boundary === "state") {
    return record(value) && typeof value.expectedStateToken === "string" && value.expectedStateToken === value.currentStateToken
      ? { accepted: true, reasonCode: null }
      : reject("SLICE_STATE_CONFLICT");
  }
  if (boundary === "repair") {
    return record(value) && Number.isInteger(value.repairCount) && Number.isInteger(value.requestedTransitions) &&
        (value.repairCount as number) >= 0 && (value.requestedTransitions as number) > 0 &&
        (value.repairCount as number) + (value.requestedTransitions as number) <= manifestJson.maximumRepairs
      ? { accepted: true, reasonCode: null }
      : reject("SLICE_REPAIR_LIMIT");
  }
  return reject("SLICE_SOURCE_PROFILE_INVALID");
}
