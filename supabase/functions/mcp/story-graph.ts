import type { ProjectMcpRequestContext } from "./context.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import { rpc } from "./database.ts";
import { McpDomainError } from "./errors.ts";
import {
  MAX_STORY_GRAPH_RESULT_BYTES,
  utf8ByteLength,
  validateLimit,
} from "./limits.ts";
import { decodeEditableStoryGraph } from "../../../src/lib/story-graph/rowCodec.ts";
import { validateEditableStoryGraph } from "../../../src/lib/story-graph/validator.ts";
import { summarizeVisiblePlotGraph } from "../../../src/lib/story-graph/plotSummary.ts";

const REQUIRED_FIELDS = ["Label", "Type", "Name", "Content", "Commands"];

export type ReadStoryGraphInput = {
  libraryId: string;
  limit?: number;
  cursor?: string;
};

export type StoryGraphStreamItem =
  | { kind: "warning"; code: "unreachable_node"; label: string }
  | {
    kind: "plot_node";
    id: string;
    title: string;
    firstLabel: string;
    lastLabel: string;
    nodeCount: number;
  }
  | {
    kind: "plot_edge";
    fromPlotNodeId: string;
    toPlotNodeId: string;
    optionText: string | null;
    optionIndex: number | null;
  }
  | {
    kind: "story_node";
    label: string;
    plotNodeId: string;
    plotTitle: string;
    rowId: string;
    rowIndex: number;
    nodeType: string;
    speaker?: string;
    content: string;
    commands: string;
    terminal: boolean;
    nextLabel: string | null;
    choices: Array<{
      optionIndex: number;
      text: string;
      targetLabel: string;
      commands: string;
    }>;
  };

type RawField = {
  id: string;
  label: string;
  dataType: string;
  orderIndex: number;
};

type RawRow = {
  id: string;
  name: string;
  rowIndex: number;
  createdAt: string;
  updatedAt: string;
  values: Array<{ fieldId: string; value: unknown }>;
};

type RawSnapshot = {
  status: "ok";
  library: {
    id: string;
    name: string;
    documentExportType: string | null;
    updatedAt: string;
    plotPlan: unknown;
  };
  fields: RawField[];
  rows: RawRow[];
};

export type StoryGraphReadResult = {
  library: { id: string; name: string; snapshotId: string };
  graph: {
    entryLabel: string;
    entryPlotNodeId: string;
    summary: ReturnType<typeof validateEditableStoryGraph>["summary"];
  };
  items: StoryGraphStreamItem[];
  returnedCount: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export async function readStoryGraph(
  context: ProjectMcpRequestContext,
  input: ReadStoryGraphInput,
): Promise<StoryGraphReadResult> {
  const limit = validateLimit(input.limit, { defaultValue: 100, maximum: 200 });
  const binding = {
    kind: "story_graph",
    scope: "project" as const,
    projectId: context.projectId,
    objectId: input.libraryId,
  };
  const position = input.cursor
    ? await decodeStoryGraphCursor(input.cursor, binding, limit)
    : null;
  const raw = await rpc<unknown>(context, "mcp_read_story_graph_snapshot", {
    p_project_id: context.projectId,
    p_library_id: input.libraryId,
  });
  if (raw === null) {
    throw new McpDomainError("TABLE_NOT_FOUND", "Script library not found.");
  }
  if (isRecord(raw) && raw.status === "access_denied") {
    throw new McpDomainError(
      "PROJECT_ACCESS_REVOKED",
      "Project access has been revoked.",
    );
  }

  try {
    const currentSnapshotId = await snapshotDigest(raw);
    if (position && position.snapshotId !== currentSnapshotId) {
      throw new McpDomainError(
        "STORY_GRAPH_CONFLICT",
        "The story graph changed; discard prior pages and restart.",
      );
    }
    const snapshot = parseRawSnapshot(raw);
    if (
      snapshot.library.documentExportType !== "script" ||
      !isRecord(snapshot.library.plotPlan) ||
      snapshot.library.plotPlan.version !== 2
    ) {
      throw new McpDomainError(
        "STORY_GRAPH_UNSUPPORTED_LIBRARY",
        "Story graph reads require a document-derived Script with plot plan version 2.",
      );
    }
    const fieldById = new Map<string, RawField>();
    const fieldIdByLabel = new Map<string, string>();
    for (const field of snapshot.fields) {
      if (fieldById.has(field.id) || fieldIdByLabel.has(field.label)) {
        invalid("Script fields must have unique IDs and labels.");
      }
      fieldById.set(field.id, field);
      fieldIdByLabel.set(field.label, field.id);
    }
    const missing = REQUIRED_FIELDS.filter((label) => !fieldIdByLabel.has(label));
    if (missing.length > 0) invalid(`Script library is missing fields: ${missing.join(", ")}`);

    const graph = decodeEditableStoryGraph({
      plotPlan: snapshot.library.plotPlan,
      rows: snapshot.rows.map((row) => {
        if (!Number.isInteger(row.rowIndex)) invalid("Every Script row requires rowIndex.");
        const named: Record<string, string> = {};
        const seenValues = new Set<string>();
        for (const value of row.values) {
          const field = fieldById.get(value.fieldId);
          if (!field || seenValues.has(value.fieldId)) {
            invalid("Script values must reference one known field per row.");
          }
          seenValues.add(value.fieldId);
          named[field.label] = cellString(value.value);
        }
        return { assetId: row.id, rowIndex: row.rowIndex, values: named };
      }),
    });
    const validation = validateEditableStoryGraph(graph);
    const plots = summarizeVisiblePlotGraph({
      storyNodeOrder: graph.nodes.map((node) => node.label),
      nodes: graph.plotPlan.nodes,
      edges: graph.plotPlan.edges,
    });
    const plotByStoryLabel = new Map<string, { id: string; title: string }>();
    for (const plot of plots.nodes) {
      for (const label of plot.storyLabels) {
        plotByStoryLabel.set(label, { id: plot.id, title: plot.title });
      }
    }

    const items: StoryGraphStreamItem[] = [
      ...validation.warnings.map((warning) => ({ kind: "warning" as const, ...warning })),
      ...plots.nodes.map((plot) => ({
        kind: "plot_node" as const,
        id: plot.id,
        title: plot.title,
        firstLabel: plot.firstLabel,
        lastLabel: plot.lastLabel,
        nodeCount: plot.nodeCount,
      })),
      ...plots.edges.map((edge) => ({ kind: "plot_edge" as const, ...edge })),
      ...graph.nodes.map((node) => {
        const plot = plotByStoryLabel.get(node.label);
        if (!plot || !node.assetId) invalid(`Story node ${node.label} lacks persisted identity.`);
        return {
          kind: "story_node" as const,
          label: node.label,
          plotNodeId: plot.id,
          plotTitle: plot.title,
          rowId: node.assetId,
          rowIndex: node.rowIndex + 1,
          nodeType: node.nodeType,
          ...(node.speaker ? { speaker: node.speaker } : {}),
          content: node.content,
          commands: node.commands,
          terminal: node.terminal,
          nextLabel: node.nextLabel,
          choices: node.choices.map((choice) => ({
            optionIndex: choice.optionIndex,
            text: choice.text,
            targetLabel: choice.targetLabel,
            commands: choice.commands,
          })),
        };
      }),
    ];
    const overview = {
      library: {
        id: snapshot.library.id,
        name: snapshot.library.name,
        snapshotId: currentSnapshotId,
      },
      graph: {
        entryLabel: graph.entryLabel,
        entryPlotNodeId: graph.plotPlan.entryPlotNodeId,
        summary: validation.summary,
      },
    };
    const offset = position?.offset ?? 0;
    if (offset > items.length) invalidCursor();
    let result: StoryGraphReadResult | null = null;
    const pageItems: StoryGraphStreamItem[] = [];
    for (let index = offset; index < items.length && pageItems.length < limit; index += 1) {
      const candidateItems = [...pageItems, items[index]];
      const nextOffset = offset + candidateItems.length;
      const hasMore = nextOffset < items.length;
      const nextCursor = hasMore
        ? await encodeCursor(
          binding,
          { offset: nextOffset, snapshotId: currentSnapshotId, limit },
          cursorSecret(),
        )
        : null;
      const candidate: StoryGraphReadResult = {
        ...overview,
        items: candidateItems,
        returnedCount: candidateItems.length,
        hasMore,
        nextCursor,
      };
      if (utf8ByteLength(JSON.stringify(candidate)) >= MAX_STORY_GRAPH_RESULT_BYTES) {
        if (!result) {
          throw new McpDomainError(
            "PAYLOAD_TOO_LARGE",
            "One story graph item is too large to return losslessly.",
          );
        }
        break;
      }
      pageItems.push(items[index]);
      result = candidate;
    }
    if (result) return result;
    const emptyResult: StoryGraphReadResult = {
      ...overview,
      items: [],
      returnedCount: 0,
      hasMore: false,
      nextCursor: null,
    };
    if (utf8ByteLength(JSON.stringify(emptyResult)) >= MAX_STORY_GRAPH_RESULT_BYTES) {
      throw new McpDomainError(
        "PAYLOAD_TOO_LARGE",
        "Story graph metadata is too large to return losslessly.",
      );
    }
    return emptyResult;
  } catch (error) {
    if (error instanceof McpDomainError) throw error;
    throw new McpDomainError(
      "STORY_GRAPH_INVALID_SNAPSHOT",
      error instanceof Error ? error.message : "Story graph snapshot is invalid.",
    );
  }
}

type StoryGraphCursorPosition = {
  offset: number;
  snapshotId: string;
  limit: number;
};

async function decodeStoryGraphCursor(
  cursor: string,
  binding: {
    kind: string;
    scope: "project";
    projectId: string;
    objectId: string;
  },
  limit: number,
): Promise<StoryGraphCursorPosition> {
  const value = await decodeCursor<unknown>(cursor, binding, cursorSecret());
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !== "limit,offset,snapshotId" ||
    !Number.isSafeInteger(value.offset) || Number(value.offset) < 0 ||
    typeof value.snapshotId !== "string" || !/^[a-f0-9]{64}$/.test(value.snapshotId) ||
    !Number.isSafeInteger(value.limit) || value.limit !== limit
  ) invalidCursor();
  return value as StoryGraphCursorPosition;
}

function cursorSecret(): string {
  const value = Deno.env.get("MCP_CURSOR_SECRET");
  if (!value) {
    throw new McpDomainError(
      "INTERNAL_ERROR",
      "MCP cursor configuration is unavailable.",
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function snapshotDigest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function parseRawSnapshot(value: unknown): RawSnapshot {
  if (!isRecord(value) || value.status !== "ok") invalid("Story graph snapshot is invalid.");
  if (!isRecord(value.library) || !Array.isArray(value.fields) || !Array.isArray(value.rows)) {
    invalid("Story graph snapshot is incomplete.");
  }
  const library = value.library;
  if (
    typeof library.id !== "string" || typeof library.name !== "string" ||
    !(typeof library.documentExportType === "string" || library.documentExportType === null) ||
    typeof library.updatedAt !== "string"
  ) invalid("Story graph library metadata is invalid.");

  const fields = value.fields.map((field) => {
    if (
      !isRecord(field) || typeof field.id !== "string" ||
      typeof field.label !== "string" || typeof field.dataType !== "string" ||
      !Number.isInteger(field.orderIndex)
    ) invalid("Story graph field metadata is invalid.");
    return field as RawField;
  });
  const rows = value.rows.map((row) => {
    if (
      !isRecord(row) || typeof row.id !== "string" || typeof row.name !== "string" ||
      !Number.isInteger(row.rowIndex) || typeof row.createdAt !== "string" ||
      typeof row.updatedAt !== "string" || !Array.isArray(row.values)
    ) invalid("Story graph row metadata is invalid.");
    for (const cell of row.values) {
      if (!isRecord(cell) || typeof cell.fieldId !== "string" || !("value" in cell)) {
        invalid("Story graph cell metadata is invalid.");
      }
    }
    return row as RawRow;
  });
  return {
    status: "ok",
    library: {
      id: library.id,
      name: library.name,
      documentExportType: library.documentExportType,
      updatedAt: library.updatedAt,
      plotPlan: library.plotPlan,
    },
    fields,
    rows,
  };
}

function cellString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new Error(message);
}

function invalidCursor(): never {
  throw new McpDomainError(
    "INVALID_CURSOR",
    "The pagination cursor is invalid or expired.",
  );
}
