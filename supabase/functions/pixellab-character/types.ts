import type { SupabaseClient } from "@supabase/supabase-js";

export type CharacterSemantic = "character" | "animation";
export type ProviderTransport = "mcp";
export type ProviderStatus = "processing" | "completed" | "failed";

export type CharacterCapability = {
  semantic: CharacterSemantic;
  operation: "create_character" | "animate_character";
  pollOperation: "get_character" | "get_background_job";
  schemaFingerprint: string;
  pollSchemaFingerprint: string;
  inputSchema: Record<string, unknown>;
  pollInputSchema: Record<string, unknown>;
};

export type CharacterAssetPlan = {
  schemaVersion: 1; kind: "character"; name: string; description: string;
  perspective: "topdown" | "platformer" | "isometric"; facing: "front" | "back" | "left" | "right";
  width: number; height: number; transparent: true;
} | {
  schemaVersion: 1; kind: "animation"; name: string; sourceCharacterAssetId: string;
  sourceCharacterSha256: string; motionDescription: string; frameWidth: number; frameHeight: number;
  frameCount: number; fps: number; loop: boolean;
};

export type AuthorizedCharacterAttempt = {
  serviceClient?: SupabaseClient;
  projectId: string; assetId: string; attemptId: string; generationId: string;
  planFingerprint: string; attemptCount: number;
  status: "planned" | "queued" | "generating" | "ready" | "failed" | "blocked";
  lastErrorCode: string | null; providerJobId: string | null;
  metadata: Record<string, unknown>; plan: CharacterAssetPlan;
  sourceProviderCharacterId: string | null;
  sourceFacing?: "front" | "back" | "left" | "right";
  updatedAt?: string;
};

export type LifecycleOperation = "submit" | "retry" | "poll" | "validate" | "resolve_unknown";

export class PixelLabCharacterError extends Error {
  constructor(readonly code:
    | "pixellab_not_configured" | "pixellab_capability_missing" | "pixellab_rate_limited"
    | "pixellab_quota_exceeded" | "pixellab_upstream" | "pixellab_submit_outcome_unknown"
    | "pixellab_invalid_response" | "validation_failed" | "authorization_failed",
    message: string = code, readonly status = code === "authorization_failed" ? 403 : 502) {
    super(message);
    this.name = "PixelLabCharacterError";
  }
}
