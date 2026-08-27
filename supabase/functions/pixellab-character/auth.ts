import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PixelLabCharacterError } from "./types.ts";

function serviceRole(): string { return Deno.env.get("KECO_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""; }
function clients() {
  const url = Deno.env.get("SUPABASE_URL") ?? ""; const key = serviceRole();
  if (!url || !key) throw new PixelLabCharacterError("pixellab_not_configured", "Supabase is not configured", 503);
  return createClient(url, key, { auth: { persistSession: false } });
}
export type AuthorizedContext = { serviceClient: SupabaseClient; state: Record<string, unknown> };

export async function authorizeProject(serviceToken: string, projectId: string, actorUserId: string): Promise<SupabaseClient> {
  if (!serviceToken || serviceToken !== serviceRole()) throw new PixelLabCharacterError("authorization_failed", "Service authorization required", 403);
  const serviceClient = clients();
  const { data: project } = await serviceClient.from("projects").select("owner_id").eq("id", projectId).maybeSingle();
  const { data: collaborator } = await serviceClient.from("project_collaborators").select("role, accepted_at").eq("project_id", projectId).eq("user_id", actorUserId).maybeSingle();
  const role = project?.owner_id === actorUserId ? "admin" : collaborator?.accepted_at ? collaborator.role : null;
  if (role !== "admin" && role !== "editor") throw new PixelLabCharacterError("authorization_failed", "Character generation requires editor access", 403);
  return serviceClient;
}

export async function authorizeServiceRequest(request: Request, body: Record<string, unknown>): Promise<AuthorizedContext> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || token !== serviceRole()) throw new PixelLabCharacterError("authorization_failed", "Service authorization required", 403);
  const projectId = String(body.projectId ?? ""); const assetId = String(body.assetId ?? ""); const attemptId = String(body.attemptId ?? "");
  const actorUserId = String(body.actorUserId ?? "");
  if (!projectId || !assetId || !attemptId || !actorUserId) throw new PixelLabCharacterError("authorization_failed", "Character generation identity is incomplete", 403);
  const serviceClient = await authorizeProject(token, projectId, actorUserId);
  const { data: asset, error: assetError } = await serviceClient.from("character_assets").select("id, project_id, kind, plan, status, plan_fingerprint, source_character_asset_id, latest_generation_attempt_id").eq("id", assetId).maybeSingle();
  const { data: attempt, error: attemptError } = await serviceClient.from("character_generation_attempts").select("*").eq("id", attemptId).eq("character_asset_id", assetId).maybeSingle();
  if (assetError || attemptError || !asset || !attempt || asset.project_id !== projectId) throw new PixelLabCharacterError("authorization_failed", "Character generation binding is invalid", 403);
  let sourceProviderCharacterId: string | null = null;
  let sourceFacing: string | undefined;
  if (asset.kind === "animation") {
    const { data: source } = await serviceClient.from("character_assets").select("plan, latest_generation_attempt_id").eq("id", asset.source_character_asset_id).eq("project_id", projectId).eq("status", "ready").maybeSingle();
    const { data: sourceAttempt } = source?.latest_generation_attempt_id ? await serviceClient.from("character_generation_attempts").select("metadata, sha256").eq("id", source.latest_generation_attempt_id).eq("status", "ready").maybeSingle() : { data: null };
    if (!sourceAttempt || sourceAttempt.sha256 !== asset.plan?.sourceCharacterSha256 || typeof sourceAttempt.metadata?.providerCharacterId !== "string") throw new PixelLabCharacterError("authorization_failed", "Source character binding is invalid", 403);
    sourceProviderCharacterId = sourceAttempt.metadata.providerCharacterId;
    sourceFacing = source?.plan?.facing;
  }
  return { serviceClient, state: {
    serviceClient, projectId, assetId, attemptId, generationId: String(attempt.generation_id),
    planFingerprint: String(attempt.plan_fingerprint), attemptCount: Number(attempt.attempt_count), status: attempt.status,
    lastErrorCode: attempt.last_error_code, providerJobId: attempt.provider_job_id, metadata: attempt.metadata ?? {}, plan: asset.plan,
    sourceProviderCharacterId: asset.kind === "character" && typeof attempt.metadata?.providerCharacterId === "string" ? attempt.metadata.providerCharacterId : sourceProviderCharacterId,
    sourceFacing,
    updatedAt: attempt.updated_at,
  } };
}
