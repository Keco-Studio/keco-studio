import {
  type Assertion,
  deriveSliceStatus,
  evaluateObservation,
  parseRuntimeObservation,
  type RuntimeObservation,
} from "./slice-contracts.ts";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import fixtureJson from "../../../tests/fixtures/plugins/keco-slice-contract-cases.json" with {
  type: "json",
};

type ContractFixture = {
  buildHash: string;
  snapshotHash: string;
  cases: Array<{
    id: string;
    assertion: Assertion;
    actual: Record<string, unknown>;
    observationBuildHash?: string;
    expectedStatus: "passed" | "failed";
    reasonCode?: string;
  }>;
};

const fixture = fixtureJson as ContractFixture;

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const observation = (actual: Record<string, unknown>): RuntimeObservation => ({
  schemaVersion: 1,
  runId: "run-1",
  sliceId: "slice-1",
  evalId: "eval-1",
  buildHash: hash("a"),
  snapshotHash: hash("b"),
  actual,
  errors: [],
});

Deno.test("computes equals, range, subset, and roundtrip assertions", () => {
  const assertions: Assertion[] = [
    {
      assertionId: "equals",
      kind: "equals",
      path: "/guardianRoundtrip",
      expected: true,
    },
    {
      assertionId: "range",
      kind: "range",
      path: "/score",
      minimum: 2,
      maximum: 4,
      minimumInclusive: true,
      maximumInclusive: false,
    },
    {
      assertionId: "subset",
      kind: "subset",
      path: "/cats",
      expected: ["sickly", "guardian"],
    },
    {
      assertionId: "roundtrip",
      kind: "roundtrip",
      beforePath: "/before",
      afterPath: "/after",
      markerPaths: ["/transitions/entered", "/transitions/exited"],
    },
  ];
  const result = evaluateObservation(
    {
      evalId: "eval-1",
      buildHash: hash("a"),
      snapshotHash: hash("b"),
      assertions,
    },
    observation({
      guardianRoundtrip: true,
      score: 3,
      cats: ["guardian", "sickly", "other"],
      before: { hp: 3 },
      after: { hp: 3 },
      transitions: { entered: true, exited: true },
    }),
  );
  assertEquals(result.status, "passed");
  assertEquals(result.assertions.map((item) => item.status), [
    "passed",
    "passed",
    "passed",
    "passed",
  ]);
});

Deno.test("fails closed for missing values, stale hashes, and runtime errors", () => {
  const assertions: Assertion[] = [{
    assertionId: "probe",
    kind: "equals",
    path: "/probe",
    expected: true,
  }];
  const missing = evaluateObservation({
    evalId: "eval-1",
    buildHash: hash("a"),
    snapshotHash: hash("b"),
    assertions: [{
      assertionId: "missing",
      kind: "equals",
      path: "/required",
      expected: true,
    }],
  }, observation({}));
  assertEquals(missing.status, "failed");
  assertEquals(missing.reasonCodes, ["ACTUAL_PATH_MISSING"]);
  assertEquals(
    evaluateObservation({
      evalId: "eval-1",
      buildHash: hash("c"),
      snapshotHash: hash("b"),
      assertions,
    }, observation({})).reasonCodes,
    ["BUILD_HASH_MISMATCH"],
  );
  assertEquals(
    evaluateObservation({
      evalId: "eval-1",
      buildHash: hash("a"),
      snapshotHash: hash("c"),
      assertions,
    }, observation({})).reasonCodes,
    ["SNAPSHOT_HASH_MISMATCH"],
  );
  assertEquals(
    evaluateObservation({
      evalId: "eval-1",
      buildHash: hash("a"),
      snapshotHash: hash("b"),
      assertions,
    }, { ...observation({}), errors: ["parse error"] }).reasonCodes,
    ["RUNTIME_ERRORS"],
  );
});

Deno.test("runtime observations cannot self-report expected values or pass status", () => {
  assertThrows(
    () =>
      parseRuntimeObservation({
        ...observation({ guardianRoundtrip: false }),
        status: "passed",
        expected: { guardianRoundtrip: true },
      }),
    Error,
    "does not satisfy",
  );
});

Deno.test("shared fixtures produce deterministic statuses and reason codes", () => {
  for (const item of fixture.cases) {
    const parsed = parseRuntimeObservation({
      ...observation(item.actual),
      buildHash: item.observationBuildHash ?? fixture.buildHash,
      snapshotHash: fixture.snapshotHash,
    });
    const evaluated = evaluateObservation({
      evalId: "eval-1",
      buildHash: fixture.buildHash,
      snapshotHash: fixture.snapshotHash,
      assertions: [item.assertion],
    }, parsed);
    assertEquals(evaluated.status, item.expectedStatus, item.id);
    assertEquals(evaluated.reasonCodes[0], item.reasonCode, item.id);
  }
});

Deno.test("rejects unknown fields, malformed assertions, and duplicate assertion IDs", () => {
  assertThrows(
    () => parseRuntimeObservation({ ...observation({}), debug: true }),
    Error,
    "does not satisfy",
  );
  const invalid = (assertions: unknown[]) =>
    evaluateObservation({
      evalId: "eval-1",
      buildHash: hash("a"),
      snapshotHash: hash("b"),
      assertions: assertions as Assertion[],
    }, observation({ value: 1 }));
  assertThrows(
    () =>
      invalid([{
        assertionId: "range",
        kind: "range",
        path: "/value",
        minimumInclusive: true,
        maximumInclusive: true,
      }]),
    Error,
    "Range assertion",
  );
  assertThrows(
    () =>
      invalid([
        { assertionId: "same", kind: "equals", path: "/value", expected: 1 },
        { assertionId: "same", kind: "equals", path: "/value", expected: 1 },
      ]),
    Error,
    "must be unique",
  );
});

Deno.test("derives independent implementation, acceptance, and release states", () => {
  assertEquals(
    deriveSliceStatus({
      tasks: [{
        status: "completed",
        resultAccepted: true,
        reviewAccepted: true,
      }],
      evaluations: [{ status: "passed" }],
      manualRequired: true,
      mirrorsVerified: true,
    }),
    {
      implementationStatus: "completed",
      runtimeVerificationStatus: "passed",
      acceptanceStatus: "manual_required",
      releaseReadiness: "blocked_by_manual_review",
    },
  );
  assertEquals(
    deriveSliceStatus({
      tasks: [{ status: "completed" }],
      evaluations: [{ status: "passed" }],
      manualRequired: false,
      mirrorsVerified: true,
    }),
    {
      implementationStatus: "pending",
      runtimeVerificationStatus: "passed",
      acceptanceStatus: "passed",
      releaseReadiness: "blocked_by_verification",
    },
  );
  assertEquals(
    deriveSliceStatus({
      tasks: [{
        status: "completed",
        resultAccepted: true,
        reviewAccepted: true,
      }],
      evaluations: [{ status: "manual_required" }],
      manualRequired: true,
      mirrorsVerified: true,
    }),
    {
      implementationStatus: "completed",
      runtimeVerificationStatus: "passed",
      acceptanceStatus: "manual_required",
      releaseReadiness: "blocked_by_manual_review",
    },
  );
});
