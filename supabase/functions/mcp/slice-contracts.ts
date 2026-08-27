import { McpDomainError } from "./errors.ts";

export type Assertion =
  | { assertionId: string; kind: "equals"; path: string; expected: unknown }
  | {
    assertionId: string;
    kind: "range";
    path: string;
    minimum?: number;
    maximum?: number;
    minimumInclusive: boolean;
    maximumInclusive: boolean;
  }
  | {
    assertionId: string;
    kind: "subset";
    path: string;
    expected: unknown[] | Record<string, unknown>;
  }
  | {
    assertionId: string;
    kind: "roundtrip";
    beforePath: string;
    afterPath: string;
    markerPaths: string[];
  };

export type EvaluationSpec = {
  evalId: string;
  buildHash: string;
  snapshotHash: string;
  assertions: Assertion[];
  manualRequired?: boolean;
};

export type RuntimeObservation = {
  schemaVersion: 1;
  runId: string;
  sliceId: string;
  evalId: string;
  buildHash: string;
  snapshotHash: string;
  actual: Record<string, unknown>;
  errors: string[];
};

export type AssertionResult = {
  assertionId: string;
  status: "passed" | "failed";
  expected: unknown;
  actual: unknown;
  reasonCode: string;
};

export type EvaluationResult = {
  evalId: string;
  status: "passed" | "failed" | "manual_required";
  manualRequired: boolean;
  assertions: AssertionResult[];
  reasonCodes: string[];
};

export type StatusInputs = {
  tasks: Array<
    { status: string; resultAccepted?: boolean; reviewAccepted?: boolean }
  >;
  evaluations: Array<{ status: string }>;
  manualRequired: boolean;
  policyBlocked?: boolean;
  mirrorsVerified: boolean;
  packageReady?: boolean;
};

export type DerivedSliceStatus = {
  implementationStatus:
    | "pending"
    | "in_progress"
    | "completed"
    | "failed"
    | "blocked";
  runtimeVerificationStatus:
    | "not_run"
    | "passed"
    | "partial"
    | "failed"
    | "blocked";
  acceptanceStatus:
    | "pending"
    | "passed"
    | "partial"
    | "failed"
    | "manual_required";
  releaseReadiness:
    | "not_ready"
    | "ready"
    | "blocked_by_verification"
    | "blocked_by_manual_review"
    | "blocked_by_policy"
    | "failed";
};

const HASH_RE = /^sha256:[a-f0-9]{64}$/;
const OBSERVATION_KEYS = [
  "schemaVersion",
  "runId",
  "sliceId",
  "evalId",
  "buildHash",
  "snapshotHash",
  "actual",
  "errors",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100;
}

function validPointer(value: unknown): value is string {
  return typeof value === "string" && value.length <= 500 &&
    (value === "" || (value.startsWith("/") && !/~(?:[^01]|$)/.test(value)));
}

function contractError(message: string): never {
  throw new McpDomainError("SLICE_CONTRACT_INVALID", message);
}

function validateAssertion(value: unknown): asserts value is Assertion {
  if (!isRecord(value) || !validIdentifier(value.assertionId)) {
    contractError("Evaluation assertions require a bounded assertionId.");
  }
  if (value.kind === "equals") {
    if (
      !hasExactKeys(value, ["assertionId", "kind", "path", "expected"]) ||
      !validPointer(value.path)
    ) {
      contractError("Equals assertion does not satisfy the evidence contract.");
    }
    return;
  }
  if (value.kind === "range") {
    if (
      !hasExactKeys(value, [
        "assertionId",
        "kind",
        "path",
        ...(Object.hasOwn(value, "minimum") ? ["minimum"] : []),
        ...(Object.hasOwn(value, "maximum") ? ["maximum"] : []),
        "minimumInclusive",
        "maximumInclusive",
      ]) || !validPointer(value.path) ||
      (value.minimum === undefined && value.maximum === undefined) ||
      (value.minimum !== undefined &&
        (typeof value.minimum !== "number" ||
          !Number.isFinite(value.minimum))) ||
      (value.maximum !== undefined &&
        (typeof value.maximum !== "number" ||
          !Number.isFinite(value.maximum))) ||
      (typeof value.minimum === "number" && typeof value.maximum === "number" &&
        value.minimum > value.maximum) ||
      typeof value.minimumInclusive !== "boolean" ||
      typeof value.maximumInclusive !== "boolean"
    ) {
      contractError("Range assertion does not satisfy the evidence contract.");
    }
    return;
  }
  if (value.kind === "subset") {
    if (
      !hasExactKeys(value, ["assertionId", "kind", "path", "expected"]) ||
      !validPointer(value.path) ||
      (!Array.isArray(value.expected) && !isRecord(value.expected)) ||
      (Array.isArray(value.expected) && value.expected.length > 100) ||
      (isRecord(value.expected) && Object.keys(value.expected).length > 100)
    ) {
      contractError("Subset assertion does not satisfy the evidence contract.");
    }
    return;
  }
  if (value.kind === "roundtrip") {
    if (
      !hasExactKeys(value, [
        "assertionId",
        "kind",
        "beforePath",
        "afterPath",
        "markerPaths",
      ]) || !validPointer(value.beforePath) || !validPointer(value.afterPath) ||
      !Array.isArray(value.markerPaths) || value.markerPaths.length === 0 ||
      value.markerPaths.length > 20 ||
      value.markerPaths.some((path) => !validPointer(path)) ||
      new Set(value.markerPaths).size !== value.markerPaths.length
    ) {
      contractError(
        "Roundtrip assertion does not satisfy the evidence contract.",
      );
    }
    return;
  }
  contractError("Unsupported assertion kind.");
}

function validateEvaluationSpec(
  value: unknown,
): asserts value is EvaluationSpec {
  if (!isRecord(value)) contractError("Evaluation spec must be an object.");
  const allowed = [
    "evalId",
    "buildHash",
    "snapshotHash",
    "assertions",
    ...(Object.hasOwn(value, "manualRequired") ? ["manualRequired"] : []),
  ];
  if (
    !hasExactKeys(value, allowed) || !validIdentifier(value.evalId) ||
    typeof value.buildHash !== "string" || !HASH_RE.test(value.buildHash) ||
    typeof value.snapshotHash !== "string" ||
    !HASH_RE.test(value.snapshotHash) ||
    !Array.isArray(value.assertions) || value.assertions.length === 0 ||
    value.assertions.length > 100 ||
    (value.manualRequired !== undefined &&
      typeof value.manualRequired !== "boolean")
  ) {
    contractError("Evaluation spec does not satisfy the evidence contract.");
  }
  value.assertions.forEach(validateAssertion);
  const ids = value.assertions.map((assertion) => assertion.assertionId);
  if (new Set(ids).size !== ids.length) {
    contractError("Evaluation assertion IDs must be unique.");
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export async function sha256Canonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "sha256:" +
    Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
}

function pointer(
  value: unknown,
  path: string,
): { found: boolean; value?: unknown } {
  if (path === "") return { found: true, value };
  if (!path.startsWith("/")) return { found: false };
  let current: unknown = value;
  for (const raw of path.slice(1).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current) && /^\d+$/.test(key)) {
      const index = Number(key);
      if (index >= current.length) return { found: false };
      current = current[index];
    } else if (
      isRecord(current) && Object.prototype.hasOwnProperty.call(current, key)
    ) {
      current = current[key];
    } else return { found: false };
  }
  return { found: true, value: current };
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function subset(
  actual: unknown,
  expected: unknown[] | Record<string, unknown>,
): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((candidate) =>
      actual.some((item) => equal(item, candidate))
    );
  }
  if (!isRecord(actual) || !isRecord(expected)) return false;
  return Object.entries(expected).every(([key, candidate]) =>
    Object.prototype.hasOwnProperty.call(actual, key) &&
    equal(actual[key], candidate)
  );
}

function result(
  assertion: Assertion,
  status: "passed" | "failed",
  expected: unknown,
  actual: unknown,
  reasonCode: string,
): AssertionResult {
  return {
    assertionId: assertion.assertionId,
    status,
    expected,
    actual,
    reasonCode,
  };
}

function evaluateAssertion(
  assertion: Assertion,
  actualRoot: Record<string, unknown>,
): AssertionResult {
  if (assertion.kind === "roundtrip") {
    const before = pointer(actualRoot, assertion.beforePath);
    const after = pointer(actualRoot, assertion.afterPath);
    if (!before.found || !after.found) {
      return result(
        assertion,
        "failed",
        before.value,
        after.value,
        "ACTUAL_PATH_MISSING",
      );
    }
    const missingMarker = assertion.markerPaths.find((path) =>
      !pointer(actualRoot, path).found
    );
    if (missingMarker) {
      return result(
        assertion,
        "failed",
        assertion.markerPaths,
        missingMarker,
        "ROUNDTRIP_MARKER_MISSING",
      );
    }
    return result(
      assertion,
      equal(before.value, after.value) ? "passed" : "failed",
      before.value,
      after.value,
      equal(before.value, after.value) ? "OK" : "ROUNDTRIP_MISMATCH",
    );
  }
  const actual = pointer(actualRoot, assertion.path);
  if (!actual.found) {
    return result(
      assertion,
      "failed",
      assertion.kind === "range"
        ? { minimum: assertion.minimum, maximum: assertion.maximum }
        : assertion.expected,
      undefined,
      "ACTUAL_PATH_MISSING",
    );
  }
  if (assertion.kind === "equals") {
    return result(
      assertion,
      equal(actual.value, assertion.expected) ? "passed" : "failed",
      assertion.expected,
      actual.value,
      equal(actual.value, assertion.expected) ? "OK" : "VALUE_MISMATCH",
    );
  }
  if (assertion.kind === "subset") {
    return result(
      assertion,
      subset(actual.value, assertion.expected) ? "passed" : "failed",
      assertion.expected,
      actual.value,
      subset(actual.value, assertion.expected) ? "OK" : "SUBSET_MISMATCH",
    );
  }
  if (typeof actual.value !== "number" || !Number.isFinite(actual.value)) {
    return result(
      assertion,
      "failed",
      { minimum: assertion.minimum, maximum: assertion.maximum },
      actual.value,
      "RANGE_VALUE_INVALID",
    );
  }
  const aboveMinimum = assertion.minimum === undefined ||
    (assertion.minimumInclusive
      ? actual.value >= assertion.minimum
      : actual.value > assertion.minimum);
  const belowMaximum = assertion.maximum === undefined ||
    (assertion.maximumInclusive
      ? actual.value <= assertion.maximum
      : actual.value < assertion.maximum);
  return result(
    assertion,
    aboveMinimum && belowMaximum ? "passed" : "failed",
    { minimum: assertion.minimum, maximum: assertion.maximum },
    actual.value,
    aboveMinimum && belowMaximum ? "OK" : "RANGE_OUT_OF_BOUNDS",
  );
}

export function parseRuntimeObservation(value: unknown): RuntimeObservation {
  if (
    !isRecord(value) || !hasExactKeys(value, OBSERVATION_KEYS) ||
    value.schemaVersion !== 1 || !validIdentifier(value.runId) ||
    !validIdentifier(value.sliceId) || !validIdentifier(value.evalId) ||
    typeof value.buildHash !== "string" ||
    typeof value.snapshotHash !== "string" || !HASH_RE.test(value.buildHash) ||
    !HASH_RE.test(value.snapshotHash) || !isRecord(value.actual) ||
    Object.keys(value.actual).length > 1000 || !Array.isArray(value.errors) ||
    value.errors.length > 100 ||
    value.errors.some((error) =>
      typeof error !== "string" || error.length > 1000
    )
  ) {
    throw new McpDomainError(
      "SLICE_CONTRACT_INVALID",
      "Runtime observation does not satisfy the evidence contract.",
    );
  }
  return value as unknown as RuntimeObservation;
}

export function evaluateObservation(
  spec: EvaluationSpec,
  observation: RuntimeObservation,
): EvaluationResult {
  validateEvaluationSpec(spec);
  observation = parseRuntimeObservation(observation);
  if (spec.evalId !== observation.evalId) {
    throw new McpDomainError(
      "SLICE_CONTRACT_INVALID",
      "Evaluation identity does not match the runtime observation.",
    );
  }
  const manualRequired = spec.manualRequired === true;
  if (spec.buildHash !== observation.buildHash) {
    return {
      evalId: spec.evalId,
      status: "failed",
      manualRequired,
      assertions: [],
      reasonCodes: ["BUILD_HASH_MISMATCH"],
    };
  }
  if (spec.snapshotHash !== observation.snapshotHash) {
    return {
      evalId: spec.evalId,
      status: "failed",
      manualRequired,
      assertions: [],
      reasonCodes: ["SNAPSHOT_HASH_MISMATCH"],
    };
  }
  if (observation.errors.length > 0) {
    return {
      evalId: spec.evalId,
      status: "failed",
      manualRequired,
      assertions: [],
      reasonCodes: ["RUNTIME_ERRORS"],
    };
  }
  const assertions = spec.assertions.map((assertion) =>
    evaluateAssertion(assertion, observation.actual)
  );
  const reasonCodes = assertions.filter((item) => item.status === "failed").map(
    (item) => item.reasonCode,
  );
  const status = reasonCodes.length > 0 ? "failed" : "passed";
  return {
    evalId: spec.evalId,
    status,
    manualRequired,
    assertions,
    reasonCodes,
  };
}

export function deriveSliceStatus(input: StatusInputs): DerivedSliceStatus {
  const tasksComplete = input.tasks.length > 0 &&
    input.tasks.every((task) =>
      task.status === "completed" && task.resultAccepted === true &&
      task.reviewAccepted === true
    );
  const tasksFailed = input.tasks.some((task) => task.status === "failed");
  const tasksBlocked = input.tasks.some((task) => task.status === "blocked");
  const implementationStatus = tasksFailed
    ? "failed"
    : tasksBlocked
    ? "blocked"
    : tasksComplete
    ? "completed"
    : input.tasks.some((task) => task.status === "in_progress")
    ? "in_progress"
    : "pending";
  const runtimeVerificationStatus = input.evaluations.length === 0
    ? "not_run"
    : input.evaluations.some((evaluation) => evaluation.status === "failed")
    ? "failed"
    : input.evaluations.some((evaluation) => evaluation.status === "blocked")
    ? "blocked"
    : input.evaluations.every((evaluation) =>
        evaluation.status === "passed" ||
        evaluation.status === "manual_required"
      )
    ? "passed"
    : "partial";
  const acceptanceStatus = runtimeVerificationStatus === "failed"
    ? "failed"
    : runtimeVerificationStatus === "not_run"
    ? "pending"
    : input.manualRequired
    ? "manual_required"
    : runtimeVerificationStatus === "passed"
    ? "passed"
    : "partial";
  const releaseReadiness = input.policyBlocked
    ? "blocked_by_policy"
    : implementationStatus === "failed" || acceptanceStatus === "failed"
    ? "failed"
    : implementationStatus !== "completed" ||
        runtimeVerificationStatus !== "passed"
    ? "blocked_by_verification"
    : input.manualRequired || acceptanceStatus === "manual_required"
    ? "blocked_by_manual_review"
    : input.mirrorsVerified && input.packageReady !== false
    ? "ready"
    : "not_ready";
  return {
    implementationStatus,
    runtimeVerificationStatus,
    acceptanceStatus,
    releaseReadiness,
  };
}
