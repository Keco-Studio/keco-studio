import { describe, expect, it } from "@jest/globals";
import { parseMapConversationSnapshot } from "@/features/create-map/model/mapConversation";
import { createMapConversationService } from "@/features/create-map/services/mapConversationService";

const id = (suffix: string) => `10000000-0000-4000-8000-0000000000${suffix}`;

describe("map conversation snapshots", () => {
  it("keeps Plans without generated Maps selectable as bases", () => {
    const snapshot = parseMapConversationSnapshot({
      id: id("01"),
      projectId: id("02"),
      title: "Island delivery",
      nodes: [
        {
          id: id("03"),
          type: "plan",
          displayVersion: 1,
          parentPlanNodeId: null,
          mapProjectId: id("04"),
          mapPlanVersionId: id("05"),
          createdAt: "2026-10-23T01:00:00.000Z",
        },
      ],
      messages: [],
    });

    expect(snapshot.planNodes).toHaveLength(1);
    expect(snapshot.planNodes[0]).toMatchObject({
      displayLabel: "Plan V1",
      maps: [],
    });
  });

  it("nests a generated Map under its owning Plan and preserves its status", () => {
    const snapshot = parseMapConversationSnapshot({
      id: id("01"),
      projectId: id("02"),
      title: "Island delivery",
      messages: [],
      nodes: [
        {
          id: id("03"),
          type: "plan",
          displayVersion: 2,
          parentPlanNodeId: null,
          mapProjectId: id("04"),
          mapPlanVersionId: id("05"),
          createdAt: "2026-10-23T01:00:00.000Z",
        },
        {
          id: id("06"),
          type: "map",
          planNodeId: id("03"),
          revisionId: id("07"),
          assetId: id("08"),
          mapVersionNumber: 1,
          status: "generating",
          createdAt: "2026-10-23T01:01:00.000Z",
        },
      ],
    });

    expect(snapshot.planNodes[0].maps[0]).toMatchObject({
      displayLabel: "Map V2.1",
      status: "generating",
    });
  });

  it("loads the durable RPC snapshot instead of relying on browser message state", async () => {
    const rpc = jest.fn(async () => ({
      data: {
        id: id("01"),
        projectId: id("02"),
        title: "Island delivery",
        messages: [],
        nodes: [
          {
            id: id("03"),
            type: "plan",
            displayVersion: 1,
            parentPlanNodeId: null,
            mapProjectId: id("04"),
            mapPlanVersionId: id("05"),
            createdAt: "2026-10-23T01:00:00.000Z",
          },
        ],
      },
      error: null,
    }));

    await expect(
      createMapConversationService({ rpc } as never).readConversation(id("01")),
    ).resolves.toMatchObject({ planNodes: [{ displayLabel: "Plan V1" }] });
    expect(rpc).toHaveBeenCalledWith("read_map_conversation_v1", {
      p_conversation_id: id("01"),
    });
  });

  it("loads the version library bound to the current Agent conversation", async () => {
    const payload = {
      id: id("01"),
      projectId: id("02"),
      title: "Island delivery",
      messages: [],
      nodes: [{
        id: id("03"),
        type: "plan" as const,
        displayVersion: 1,
        parentPlanNodeId: null,
        mapProjectId: id("04"),
        mapPlanVersionId: id("05"),
        createdAt: "2026-10-23T01:00:00.000Z",
      }],
    };
    const rpc = jest.fn(async () => ({ data: payload, error: null }));

    await expect(
      createMapConversationService({ rpc } as never).readAgentConversation(id("02"), id("09")),
    ).resolves.toMatchObject({ planNodes: [{ displayLabel: "Plan V1" }] });
    expect(rpc).toHaveBeenCalledWith("read_agent_map_conversation_v1", {
      p_project_id: id("02"),
      p_agent_conversation_id: id("09"),
    });
  });

  it("resolves a GDD map link to its owning conversation Plan", async () => {
    const rpc = jest.fn(async () => ({
      data: [{ conversation_id: id("01"), plan_node_id: id("03") }],
      error: null,
    }));

    await expect(
      createMapConversationService({ rpc } as never).findConversationForMap(id("04")),
    ).resolves.toEqual({ conversationId: id("01"), planNodeId: id("03") });
    expect(rpc).toHaveBeenCalledWith("find_map_conversation_by_map_id_v1", {
      p_map_project_id: id("04"),
    });
  });

  it("resolves a map revision to its owning Agent conversation for a follow-up", async () => {
    const rpc = jest.fn(async () => ({
      data: [{
        project_id: id("02"),
        agent_conversation_id: id("09"),
        plan_node_id: id("03"),
      }],
      error: null,
    }));

    await expect(
      createMapConversationService({ rpc } as never).handoffMapRevision(id("04"), id("03")),
    ).resolves.toEqual({
      projectId: id("02"),
      agentConversationId: id("09"),
      planNodeId: id("03"),
    });
    expect(rpc).toHaveBeenCalledWith("resolve_map_agent_handoff_v1", {
      p_map_project_id: id("04"),
      p_plan_node_id: id("03"),
    });
  });
});
