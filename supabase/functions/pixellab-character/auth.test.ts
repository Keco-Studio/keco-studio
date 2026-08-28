import { assertEquals } from "@std/assert";
import { resolveSourceProviderCharacterId } from "./auth.ts";

Deno.test("uses explicit provider character metadata when present", () => {
  assertEquals(
    resolveSourceProviderCharacterId({
      metadata: { providerCharacterId: "character-from-metadata" },
      provider_job_id: "character-from-job",
    }),
    "character-from-metadata",
  );
});

Deno.test("falls back to provider job id for legacy ready character attempts", () => {
  assertEquals(
    resolveSourceProviderCharacterId({
      metadata: { providerCharacterId: null },
      provider_job_id: "character-from-job",
    }),
    "character-from-job",
  );
});

Deno.test("rejects attempts without a usable provider identity", () => {
  assertEquals(resolveSourceProviderCharacterId({ metadata: {}, provider_job_id: null }), null);
});
