export type SemanticCapability =
  | "topdown_tileset"
  | "path_tiles"
  | "map_object"
  | "inpaint"
  | "direct_map_image";

export type ProviderTransport = "mcp" | "rest";

export type DiscoveredCapability = {
  semantic: SemanticCapability;
  transport: ProviderTransport;
  operation: string;
  schemaFingerprint: string;
  inputSchema: Record<string, unknown>;
  pollOperation?: string;
  pollSchemaFingerprint?: string;
  pollInputSchema?: Record<string, unknown>;
};

export type NormalizedTileAtlas = {
  schemaVersion: 1;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  tiles: Array<{
    key: string;
    connectivityMask: number;
    sourceX: number;
    sourceY: number;
    sourceWidth: number;
    sourceHeight: number;
  }>;
};

export type PixelLabMapRequest =
  | { operation: "capabilities"; projectId: string }
  | { operation: "submit" | "poll" | "validate" | "retry" | "compose_background"; projectId: string; mapId: string; revisionId: string; generationId: string; assetId: string }
  | { operation: "resolve_unknown"; projectId: string; mapId: string; revisionId: string; generationId: string; assetId: string; acknowledgeDuplicateBilling: true }
  | {
      operation: "inpaint";
      projectId: string;
      mapId: string;
      revisionId: string;
      sourceAssetId: string;
      assetId: string;
      maskPath: string;
    };

export type PixelLabTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export class PixelLabMapError extends Error {
  constructor(
    readonly code:
      | "pixellab_not_configured"
      | "pixellab_capability_missing"
      | "pixellab_rate_limited"
      | "pixellab_quota_exceeded"
      | "pixellab_upstream"
      | "pixellab_submit_outcome_unknown"
      | "pixellab_invalid_response"
      | "pixellab_content_quality"
      | "atlas_manifest_incomplete"
      | "background_source_mismatch"
      | "background_composition_failed",
    message: string = code,
    readonly status = 502,
  ) {
    super(message);
    this.name = "PixelLabMapError";
  }
}
