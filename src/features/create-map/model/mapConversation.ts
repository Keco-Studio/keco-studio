import { z } from "zod";

const Uuid = z.string().uuid();
const Timestamp = z.string().datetime({ offset: true });
const MapStatus = z.enum([
  "planned",
  "queued",
  "generating",
  "ready",
  "failed",
  "blocked",
]);

const PlanNode = z.object({
  id: Uuid,
  type: z.literal("plan"),
  displayVersion: z.number().int().positive(),
  parentPlanNodeId: Uuid.nullable(),
  mapProjectId: Uuid,
  mapPlanVersionId: Uuid,
  createdAt: Timestamp,
});

const MapNode = z.object({
  id: Uuid,
  type: z.literal("map"),
  planNodeId: Uuid,
  revisionId: Uuid,
  assetId: Uuid,
  mapVersionNumber: z.number().int().positive(),
  status: MapStatus,
  createdAt: Timestamp,
});

const Message = z.object({
  id: Uuid,
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  artifactNodeId: Uuid.nullable().default(null),
  basePlanNodeId: Uuid.nullable().default(null),
  createdAt: Timestamp,
});

const RawSnapshot = z.object({
  id: Uuid,
  projectId: Uuid,
  title: z.string().min(1),
  nodes: z.array(z.discriminatedUnion("type", [PlanNode, MapNode])),
  messages: z.array(Message),
});

export type MapConversationMapNode = z.infer<typeof MapNode> & {
  displayLabel: string;
};
export type MapConversationPlanNode = z.infer<typeof PlanNode> & {
  displayLabel: string;
  maps: MapConversationMapNode[];
};
export type MapConversationMessage = z.infer<typeof Message>;
export type MapConversationSnapshot = Omit<
  z.infer<typeof RawSnapshot>,
  "nodes"
> & {
  nodes: Array<MapConversationPlanNode | MapConversationMapNode>;
  planNodes: MapConversationPlanNode[];
};

export function parseMapConversationSnapshot(
  value: unknown,
): MapConversationSnapshot {
  const parsed = RawSnapshot.parse(value);
  const plans = new Map<string, MapConversationPlanNode>();
  const maps: MapConversationMapNode[] = [];

  for (const node of parsed.nodes) {
    if (node.type === "plan") {
      plans.set(node.id, {
        ...node,
        displayLabel: `Plan V${node.displayVersion}`,
        maps: [],
      });
    } else {
      maps.push({ ...node, displayLabel: "" });
    }
  }
  for (const map of maps) {
    const plan = plans.get(map.planNodeId);
    if (!plan)
      throw new Error("Map conversation Map node is missing its owning Plan.");
    map.displayLabel = `Map V${plan.displayVersion}.${map.mapVersionNumber}`;
    plan.maps.push(map);
  }
  const planNodes = [...plans.values()].sort(
    (left, right) => left.displayVersion - right.displayVersion,
  );
  for (const plan of planNodes)
    plan.maps.sort(
      (left, right) => left.mapVersionNumber - right.mapVersionNumber,
    );
  return { ...parsed, nodes: [...planNodes, ...maps], planNodes };
}
