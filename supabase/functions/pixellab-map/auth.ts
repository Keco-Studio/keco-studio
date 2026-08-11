import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PixelLabMapError } from "./types.ts";

export type AuthorizedAsset = {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  projectId: string;
  mapId: string;
  revisionId: string;
  schemaVersion: number;
  generationId: string | null;
  revisionPlan: unknown;
  asset: Record<string, unknown>;
};

export type RegionBackgroundBinding = {
  id: string;
  map_revision_id: string;
  generation_id: string | null;
  kind: string;
  status: string;
  sha256: string | null;
  plan_fingerprint?: string | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function assertRegionObstacleBackgroundBinding(
  authorized: Pick<AuthorizedAsset, 'revisionId' | 'generationId' | 'revisionPlan' | 'asset'>,
  background: RegionBackgroundBinding | null,
): void {
  const asset = authorized.asset;
  const metadata = record(asset.metadata);
  if (asset.kind !== 'obstacle' || metadata.source !== 'region-generation') return;
  const references = Array.isArray(asset.reference_asset_ids) ? asset.reference_asset_ids : [];
  const hashes = Array.isArray(asset.reference_hashes) ? asset.reference_hashes : [];
  if (references.length !== 1 || hashes.length !== 1 || !background) {
    throw new PixelLabMapError('pixellab_invalid_response', 'Regional obstacle background binding is missing', 403);
  }
  if (
    metadata.backgroundAssetId !== references[0]
    || metadata.backgroundSha256 !== hashes[0]
    || references[0] !== background.id
    || background.map_revision_id !== authorized.revisionId
    || background.generation_id !== authorized.generationId
    || background.kind !== "background"
    || background.status !== "ready"
    || background.sha256 !== hashes[0]
    || background.plan_fingerprint !== asset.plan_fingerprint
  ) {
    throw new PixelLabMapError("pixellab_invalid_response", "Regional obstacle background binding mismatch", 403);
  }
  const params = record(asset.generation_params);
  const selection = record(params.regionSelection);
  const plan = record(authorized.revisionPlan);
  const map = record(plan.map);
  const width = Number(map.width);
  const height = Number(map.height);
  const x = Number(selection.x);
  const y = Number(selection.y);
  const selectionWidth = Number(selection.width);
  const selectionHeight = Number(selection.height);
  if (
    ![width, height, x, y, selectionWidth, selectionHeight].every(Number.isFinite)
    || selectionWidth <= 0 || selectionHeight <= 0
    || x < 0 || y < 0 || x + selectionWidth > width || y + selectionHeight > height
  ) {
    throw new PixelLabMapError("pixellab_invalid_response", "Regional obstacle selection is outside the map", 403);
  }
}

export function assertGenerationIdentity(
  authorized: Pick<AuthorizedAsset, "mapId" | "revisionId" | "schemaVersion" | "generationId">,
  request: Record<string, unknown>,
): void {
  if (authorized.schemaVersion === 1) return;
  if (
    !authorized.generationId ||
    request.mapId !== authorized.mapId ||
    request.revisionId !== authorized.revisionId ||
    request.generationId !== authorized.generationId
  ) {
    throw new PixelLabMapError("pixellab_invalid_response", "Map generation identity mismatch", 403);
  }
}

type PixelLabClientOptions = {
  global?: { headers: { authorization: string } };
  auth: { persistSession: boolean };
};

export type PixelLabClientFactory = (
  url: string,
  key: string,
  options: PixelLabClientOptions,
) => SupabaseClient;

type PixelLabSupabaseConfig = { url: string; anon: string; service: string };

const defaultClientFactory: PixelLabClientFactory = (url, key, options) =>
  createClient(url, key, options);

export function createPixelLabClients(
  token: string,
  factory: PixelLabClientFactory = defaultClientFactory,
  config: PixelLabSupabaseConfig = {
    url: Deno.env.get("SUPABASE_URL") ?? "",
    anon: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  },
) {
  const { url, anon, service } = config;
  if (!url || !anon || !service) throw new PixelLabMapError("pixellab_not_configured", undefined, 503);
  return {
    authClient: factory(url, anon, { auth: { persistSession: false } }),
    userClient: factory(url, anon, { global: { headers: { authorization: `Bearer ${token}` } }, auth: { persistSession: false } }),
    serviceClient: factory(url, service, { auth: { persistSession: false } }),
  };
}

export async function authorizeAsset(token: string, assetId: string, expectedProjectId: string): Promise<AuthorizedAsset> {
  const { authClient, userClient, serviceClient } = createPixelLabClients(token);
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) throw new PixelLabMapError("pixellab_invalid_response", "Authentication required", 401);
  const { data: asset, error: assetError } = await userClient.from("map_assets")
    .select("id, map_revision_id, generation_id, plan_fingerprint, reference_asset_ids, reference_hashes, asset_key, kind, status, requested_capability, prompt, generation_params, provider_operation, provider_job_id, attempt_count, metadata")
    .eq("id", assetId).single();
  if (assetError || !asset) throw new PixelLabMapError("pixellab_invalid_response", "Map asset not found", 404);
  const { data: revision } = await userClient.from("map_revisions").select("id, map_project_id, schema_version, plan").eq("id", asset.map_revision_id).single();
  const { data: map } = revision ? await userClient.from("map_projects").select("id, project_id").eq("id", revision.map_project_id).single() : { data: null };
  if (!revision || !map || map.project_id !== expectedProjectId) throw new PixelLabMapError("pixellab_invalid_response", "Map asset does not belong to project", 403);
  const { data: project } = await userClient.from("projects").select("owner_id").eq("id", map.project_id).single();
  const { data: collaborator } = await userClient.from("project_collaborators").select("role, accepted_at").eq("project_id", map.project_id).eq("user_id", authData.user.id).maybeSingle();
  const role = project?.owner_id === authData.user.id ? "admin" : collaborator?.accepted_at ? collaborator.role : null;
  if (role !== "admin" && role !== "editor") throw new PixelLabMapError("pixellab_invalid_response", "Map generation requires editor access", 403);
  return {
    userClient,
    serviceClient,
    userId: authData.user.id,
    projectId: map.project_id,
    mapId: map.id,
    revisionId: revision.id,
    schemaVersion: Number(revision.schema_version),
    generationId: typeof asset.generation_id === "string" ? asset.generation_id : null,
    revisionPlan: revision.plan,
    asset: asset as Record<string, unknown>,
  };
}

export async function authorizeProject(token: string, projectId: string): Promise<{ userClient: SupabaseClient; serviceClient: SupabaseClient; userId: string }> {
  const { authClient, userClient, serviceClient } = createPixelLabClients(token);
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) throw new PixelLabMapError("pixellab_invalid_response", "Authentication required", 401);
  const { data: project } = await userClient.from("projects").select("owner_id").eq("id", projectId).single();
  const { data: collaborator } = await userClient.from("project_collaborators").select("role, accepted_at").eq("project_id", projectId).eq("user_id", authData.user.id).maybeSingle();
  const role = project?.owner_id === authData.user.id ? "admin" : collaborator?.accepted_at ? collaborator.role : null;
  if (role !== "admin" && role !== "editor") throw new PixelLabMapError("pixellab_invalid_response", "Map generation requires editor access", 403);
  return { userClient, serviceClient, userId: authData.user.id };
}
