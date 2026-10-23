import type { SupabaseClient } from "@supabase/supabase-js";
import type { MapPlanV3, MapSceneV3 } from "../model/directMapSchema";
import {
  parseMapConversationSnapshot,
  type MapConversationMapNode,
  type MapConversationSnapshot,
} from "../model/mapConversation";
import type { MapDraftIdentity, MapSourceToken } from "./createMapService";

export class MapConversationServiceError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "MapConversationServiceError";
  }
}

export type CreateConversationPlanInput = {
  projectId: string;
  conversationId: string | null;
  basePlanNodeId: string | null;
  title: string;
  message: string;
  idempotencyKey: string;
  intentHash: string;
  name: string;
  source: MapSourceToken | null;
  plan: MapPlanV3;
  scene: MapSceneV3;
};

export type CreatedConversationPlan = {
  conversationId: string;
  planNodeId: string;
  planVersionId: string;
  displayVersion: number;
  identity: MapDraftIdentity;
};

export type ResolvedConversationNode = {
  planNodeId: string;
  mapProjectId: string;
  mapPlanVersionId: string;
  selectedMapAssetId: string | null;
};

export type MapAgentHandoffTarget = {
  projectId: string;
  agentConversationId: string;
  planNodeId: string;
};

function row<T>(value: unknown): T {
  const result = Array.isArray(value) ? value[0] : value;
  if (!result || typeof result !== "object")
    throw new MapConversationServiceError("invalid_response");
  return result as T;
}

function optionalRow<T>(value: unknown): T | null {
  const result = Array.isArray(value) ? value[0] : value;
  if (!result || typeof result !== "object") return null;
  return result as T;
}

export function createMapConversationService(supabase: SupabaseClient) {
  return {
    async readAgentConversation(
      projectId: string,
      agentConversationId: string,
    ): Promise<MapConversationSnapshot | null> {
      const { data, error } = await supabase.rpc("read_agent_map_conversation_v1", {
        p_project_id: projectId,
        p_agent_conversation_id: agentConversationId,
      });
      if (error) {
        throw new MapConversationServiceError(
          error.code ?? "agent_conversation_load_failed",
          error.message,
        );
      }
      return data == null ? null : parseMapConversationSnapshot(data);
    },

    async readConversation(
      conversationId: string,
    ): Promise<MapConversationSnapshot> {
      const { data, error } = await supabase.rpc("read_map_conversation_v1", {
        p_conversation_id: conversationId,
      });
      if (error)
        throw new MapConversationServiceError(
          error.code ?? "conversation_load_failed",
          error.message,
        );
      return parseMapConversationSnapshot(data);
    },

    async findConversationForMap(
      mapProjectId: string,
    ): Promise<{ conversationId: string; planNodeId: string } | null> {
      const { data, error } = await supabase.rpc(
        "find_map_conversation_by_map_id_v1",
        { p_map_project_id: mapProjectId },
      );
      if (error)
        throw new MapConversationServiceError(
          error.code ?? "conversation_lookup_failed",
          error.message,
        );
      const resolved = optionalRow<{
        conversation_id: string;
        plan_node_id: string;
      }>(data);
      if (!resolved) return null;
      if (
        typeof resolved.conversation_id !== "string" ||
        typeof resolved.plan_node_id !== "string"
      )
        throw new MapConversationServiceError("invalid_response");
      return {
        conversationId: resolved.conversation_id,
        planNodeId: resolved.plan_node_id,
      };
    },

    async handoffMapRevision(
      mapProjectId: string,
      planNodeId: string,
    ): Promise<MapAgentHandoffTarget> {
      const { data, error } = await supabase.rpc(
        "resolve_map_agent_handoff_v1",
        {
          p_map_project_id: mapProjectId,
          p_plan_node_id: planNodeId,
        },
      );
      if (error)
        throw new MapConversationServiceError(
          error.code ?? "agent_handoff_failed",
          error.message,
        );
      const resolved = row<{
        project_id: string;
        agent_conversation_id: string;
        plan_node_id: string;
      }>(data);
      if (
        typeof resolved.project_id !== "string" ||
        typeof resolved.agent_conversation_id !== "string" ||
        typeof resolved.plan_node_id !== "string"
      )
        throw new MapConversationServiceError("invalid_response");
      return {
        projectId: resolved.project_id,
        agentConversationId: resolved.agent_conversation_id,
        planNodeId: resolved.plan_node_id,
      };
    },

    async createPlan(
      input: CreateConversationPlanInput,
    ): Promise<CreatedConversationPlan> {
      const { data, error } = await supabase.rpc(
        "create_map_conversation_plan_v1",
        {
          p_project_id: input.projectId,
          p_conversation_id: input.conversationId,
          p_parent_plan_node_id: input.basePlanNodeId,
          p_title: input.title,
          p_message: input.message,
          p_idempotency_key: input.idempotencyKey,
          p_intent_hash: input.intentHash,
          p_name: input.name,
          p_source_document_id: input.source?.documentId ?? null,
          p_source_document_updated_at: input.source?.documentUpdatedAt ?? null,
          p_source_epoch: input.source?.epoch ?? null,
          p_source_revision: input.source?.revision ?? null,
          p_plan: input.plan,
          p_scene: input.scene,
        },
      );
      if (error)
        throw new MapConversationServiceError(
          error.code ?? "conversation_plan_failed",
          error.message,
        );
      const created = row<{
        conversation_id: string;
        plan_node_id: string;
        map_id: string;
        draft_revision_id: string;
        plan_version_id: string;
        plan_display_version: number;
      }>(data);
      return {
        conversationId: created.conversation_id,
        planNodeId: created.plan_node_id,
        planVersionId: created.plan_version_id,
        displayVersion: created.plan_display_version,
        identity: {
          mapId: created.map_id,
          revisionId: created.draft_revision_id,
          revisionNumber: 1,
          saveVersion: 0,
        },
      };
    },

    async attachGeneratedMap(
      planNodeId: string,
      revisionId: string,
      assetId: string,
    ): Promise<MapConversationMapNode> {
      const { data, error } = await supabase.rpc(
        "attach_map_conversation_output_v1",
        {
          p_plan_node_id: planNodeId,
          p_map_revision_id: revisionId,
          p_map_asset_id: assetId,
        },
      );
      if (error)
        throw new MapConversationServiceError(
          error.code ?? "conversation_output_failed",
          error.message,
        );
      const attached = row<{
        map_node_id: string;
        plan_display_version: number;
        map_version_number: number;
      }>(data);
      return {
        id: attached.map_node_id,
        type: "map",
        planNodeId,
        revisionId,
        assetId,
        mapVersionNumber: attached.map_version_number,
        status: "generating",
        createdAt: new Date(0).toISOString(),
        displayLabel: `Map V${attached.plan_display_version}.${attached.map_version_number}`,
      };
    },

    async resolveNode(nodeId: string): Promise<ResolvedConversationNode> {
      const { data, error } = await supabase.rpc(
        "resolve_map_conversation_node_v1",
        { p_node_id: nodeId },
      );
      if (error)
        throw new MapConversationServiceError(
          error.code ?? "conversation_node_failed",
          error.message,
        );
      const resolved = row<{
        plan_node_id: string;
        map_project_id: string;
        map_plan_version_id: string;
        selected_map_asset_id: string | null;
      }>(data);
      return {
        planNodeId: resolved.plan_node_id,
        mapProjectId: resolved.map_project_id,
        mapPlanVersionId: resolved.map_plan_version_id,
        selectedMapAssetId: resolved.selected_map_asset_id,
      };
    },
  };
}
