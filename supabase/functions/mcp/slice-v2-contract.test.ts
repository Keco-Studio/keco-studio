import { assertEquals } from "jsr:@std/assert";
import corpusJson from "../../../contracts/keco-slice-v2/conformance-cases.json" with {
  type: "json",
};
import manifestJson from "../../../contracts/keco-slice-v2/contract-manifest.json" with {
  type: "json",
};
import {
  type ContractBoundary,
  validateSliceV2ContractCase,
} from "./slice-v2-contract.ts";

type Corpus = {
  contractVersion: 2;
  cases: Array<{
    id: string;
    boundary: ContractBoundary;
    input: unknown;
    expected: { accepted: boolean; reasonCode: string | null };
  }>;
};

const corpus = corpusJson as Corpus;

Deno.test("canonical Slice V2 manifest owns bounded contract values", () => {
  assertEquals(manifestJson.contractVersion, 2);
  assertEquals(manifestJson.sourceProfileKinds, [
    "gdd",
    "feedback",
    "table",
    "document",
    "user_idea",
  ]);
  assertEquals(manifestJson.reviewLevels, [
    "self",
    "separate_context",
    "independent_actor",
  ]);
  assertEquals(manifestJson.runtimePrefixes, {
    current: "KECO_OBSERVATION",
  });
  assertEquals(manifestJson.maximumRepairs, 3);
});

Deno.test("canonical Slice V2 corpus has stable cross-layer decisions", () => {
  assertEquals(corpus.contractVersion, 2);
  const requiredCases = new Set([
    "unsafe-parent-path",
    "unsafe-absolute-path",
    "missing-allowed-files",
    "ghost-evaluation",
    "missing-reverse-evaluation-mapping",
    "wrong-document-folder",
    "forged-independent-review",
    "retired-runtime-prefix",
    "stale-state-token",
    "fourth-repair",
  ]);
  for (const testCase of corpus.cases) {
    requiredCases.delete(testCase.id);
    assertEquals(
      validateSliceV2ContractCase(testCase.boundary, testCase.input),
      testCase.expected,
      testCase.id,
    );
  }
  assertEquals([...requiredCases], []);
});
