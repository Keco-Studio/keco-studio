export type SemanticCapability =
  | "topdown_tileset"
  | "path_tiles"
  | "map_object"
  | "inpaint";

export type ProviderTransport = "mcp" | "rest";

export type DiscoveredCapability = {
  semantic: SemanticCapability;
  transport: ProviderTransport;
  operation: string;
  schemaFingerprint: string;
  inputSchema: Record<string, unknown>;
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
  | { operation: "submit" | "poll" | "retry"; projectId: string; mapId: string; revisionId: string; generationId: string; assetId: string }
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
      | "pixellab_upstream"
      | "pixellab_invalid_response"
      | "atlas_manifest_incomplete",
    message: string = code,
    readonly status = 502,
  ) {
    super(message);
    this.name = "PixelLabMapError";
  }
}
