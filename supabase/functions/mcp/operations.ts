import type { ProjectMcpRequestContext } from "./context.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import { McpDomainError } from "./errors.ts";
import {
  MAX_DOCUMENT_MARKDOWN_BYTES,
  utf8ByteLength,
  validateLimit,
} from "./limits.ts";
import { rpc } from "./database.ts";
import { normalizeDocumentState } from "./document-codec.ts";
import { measureMcpPhase } from "./telemetry.ts";

function cursorSecret(): string {
  const value = Deno.env.get("MCP_CURSOR_SECRET");
  if (!value) throw new Error("MCP_CURSOR_SECRET is required.");
  return value;
}

function databaseFailure(message: string): McpDomainError {
  return new McpDomainError("INTERNAL_ERROR", message);
}

export async function listProjectStructure(context: ProjectMcpRequestContext) {
  const value = await rpc<Record<string, unknown> | null>(
    context,
    "mcp_read_project_structure",
    { p_project_id: context.projectId },
  );
  if (!value) {
    throw new McpDomainError(
      "PROJECT_ACCESS_REVOKED",
      "Project access has been revoked.",
    );
  }
  return value;
}

type FieldRow = {
  id: string;
  label: string;
  data_type: string;
  order_index: number;
};
type AssetRow = {
  id: string;
  name: string;
  row_index: number | null;
  updated_at: string;
};
type ValueRow = { asset_id: string; field_id: string; value_json: unknown };

function normalizedLabel(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export type QueryTableRowsInput = {
  tableId: string;
  limit?: number;
  cursor?: string;
  rowIndex?: number;
  fields?: string[];
};

export async function queryTableRows(
  context: ProjectMcpRequestContext,
  input: QueryTableRowsInput,
) {
  if (input.cursor && input.rowIndex !== undefined) {
    throw new McpDomainError(
      "FIELD_VALIDATION_FAILED",
      "rowIndex cannot be combined with cursor.",
    );
  }
  const limit = input.rowIndex === undefined
    ? validateLimit(input.limit, { defaultValue: 50, maximum: 200 })
    : 1;
  const tableResult = await measureMcpPhase(
    context,
    "database",
    async () =>
      await context.supabase.from("libraries").select(
        "id,name,description,library_field_definitions(id,label,data_type,order_index)",
      ).eq("id", input.tableId).eq("project_id", context.projectId)
        .maybeSingle(),
  );
  if (tableResult.error || !tableResult.data) {
    throw new McpDomainError("TABLE_NOT_FOUND", "Table not found.");
  }
  const tableData = tableResult.data as Record<string, unknown>;
  const allFields = ((tableData.library_field_definitions ?? []) as FieldRow[])
    .sort((left, right) =>
      left.order_index - right.order_index || left.id.localeCompare(right.id)
    );
  const labels = new Map<string, FieldRow>();
  for (const field of allFields) {
    const key = normalizedLabel(field.label);
    if (labels.has(key)) labels.set(key, { ...field, id: "" });
    else labels.set(key, field);
  }
  const selected = input.fields?.length
    ? input.fields.map((label) => {
      const field = labels.get(normalizedLabel(label));
      if (!field || !field.id) {
        throw new McpDomainError(
          "FIELD_VALIDATION_FAILED",
          "Selected field labels must exist and be unambiguous.",
        );
      }
      return field;
    })
    : allFields;

  let position: { rowIndex: number | null; id: string } | null = null;
  if (input.cursor) {
    position = await decodeCursor(input.cursor, {
      kind: "table_rows",
      scope: "project",
      projectId: context.projectId,
      objectId: input.tableId,
    }, cursorSecret());
  }
  let query = context.supabase.from("library_assets")
    .select("id,name,row_index,updated_at").eq("library_id", input.tableId)
    .order("row_index", { ascending: true, nullsFirst: false }).order("id")
    .limit(input.rowIndex === undefined ? limit + 1 : 1);
  if (input.rowIndex !== undefined) {
    query = query.range(input.rowIndex - 1, input.rowIndex - 1);
  }
  if (position) {
    query = position.rowIndex === null
      ? query.is("row_index", null).gt("id", position.id)
      : query.or(
        "row_index.gt." + position.rowIndex +
          ",and(row_index.eq." + position.rowIndex + ",id.gt." + position.id +
          ")" +
          ",row_index.is.null",
      );
  }
  const rowsResult = await measureMcpPhase(
    context,
    "database",
    async () => await query,
  );
  if (rowsResult.error) {
    throw databaseFailure("The table rows could not be read.");
  }
  const pageRows = (rowsResult.data ?? []) as AssetRow[];
  const hasMore = input.rowIndex === undefined && pageRows.length > limit;
  const rows = pageRows.slice(0, limit);
  let values: ValueRow[] = [];
  if (rows.length && selected.length) {
    const valuesResult = await measureMcpPhase(
      context,
      "database",
      async () =>
        await context.supabase.from("library_asset_values")
          .select("asset_id,field_id,value_json").in(
            "asset_id",
            rows.map((row) => row.id),
          )
          .in("field_id", selected.map((field) => field.id)),
    );
    if (valuesResult.error) {
      throw databaseFailure("The table values could not be read.");
    }
    values = (valuesResult.data ?? []) as ValueRow[];
  }
  const valuesByAsset = new Map<string, Map<string, unknown>>();
  for (const value of values) {
    const rowValues = valuesByAsset.get(value.asset_id) ??
      new Map<string, unknown>();
    rowValues.set(value.field_id, value.value_json);
    valuesByAsset.set(value.asset_id, rowValues);
  }
  const items = rows.map((row) => ({
    id: row.id,
    name: row.name,
    rowIndex: row.row_index,
    updatedAt: row.updated_at,
    values: selected.map((field) => ({
      fieldId: field.id,
      label: field.label,
      dataType: field.data_type,
      value: valuesByAsset.get(row.id)?.get(field.id) ?? null,
    })),
  }));
  const last = rows.at(-1);
  return {
    table: {
      id: tableData.id,
      name: tableData.name,
      description: tableData.description,
    },
    fields: selected.map((field) => ({
      id: field.id,
      label: field.label,
      dataType: field.data_type,
    })),
    items,
    returnedCount: items.length,
    hasMore,
    nextCursor: hasMore && last
      ? await encodeCursor(
        {
          kind: "table_rows",
          scope: "project",
          projectId: context.projectId,
          objectId: input.tableId,
        },
        { rowIndex: last.row_index, id: last.id },
        cursorSecret(),
      )
      : null,
  };
}

export async function getTableSchema(
  context: ProjectMcpRequestContext,
  tableId: string,
) {
  const structure = await listProjectStructure(context);
  const tables = Array.isArray(structure.tables)
    ? structure.tables as Array<Record<string, unknown>>
    : [];
  const table = tables.find((item) => item.id === tableId);
  if (!table) throw new McpDomainError("TABLE_NOT_FOUND", "Table not found.");
  return { table };
}

export async function listDocuments(context: ProjectMcpRequestContext, input: {
  limit?: number;
  cursor?: string;
}) {
  const limit = validateLimit(input.limit, { defaultValue: 50, maximum: 200 });
  let position: { updatedAt: string; id: string } | null = null;
  if (input.cursor) {
    position = await decodeCursor(input.cursor, {
      kind: "documents",
      scope: "project",
      projectId: context.projectId,
      objectId: null,
    }, cursorSecret());
  }
  let query = context.supabase.from("documents")
    .select("id,name,folder_id,updated_at,collab_epoch,collab_revision")
    .eq("project_id", context.projectId).order("updated_at", {
      ascending: false,
    })
    .order("id", { ascending: false }).limit(limit + 1);
  if (position) {
    query = query.or(
      "updated_at.lt." + position.updatedAt +
        ",and(updated_at.eq." + position.updatedAt + ",id.lt." + position.id +
        ")",
    );
  }
  const result = await measureMcpPhase(
    context,
    "database",
    async () => await query,
  );
  if (result.error) {
    throw databaseFailure("The document list could not be read.");
  }
  const page = result.data ?? [];
  const hasMore = page.length > limit;
  const items = page.slice(0, limit).map((item) => ({
    id: item.id,
    name: item.name,
    folderId: item.folder_id,
    updatedAt: item.updated_at,
    epoch: item.collab_epoch,
    revision: item.collab_revision,
  }));
  const last = items.at(-1);
  return {
    items,
    returnedCount: items.length,
    hasMore,
    nextCursor: hasMore && last
      ? await encodeCursor(
        {
          kind: "documents",
          scope: "project",
          projectId: context.projectId,
          objectId: null,
        },
        { updatedAt: last.updatedAt, id: last.id },
        cursorSecret(),
      )
      : null,
  };
}

type DocumentHead = {
  id: string;
  name: string;
  content: string;
  yjs_state: string | null;
  collab_epoch: number;
  collab_revision: number;
  updated_at: string;
};
type DocumentTail = { id: string; update_data: string; created_at: string };
type DocumentTransportRpcResult = null | { status: "access_denied" } | {
  status: "payload_too_large";
  reason: "compaction_required";
} | { status: "ok"; head: DocumentHead; tail: DocumentTail[] };

const MAX_DOCUMENT_TAIL_UPDATES = 2_000;
const MAX_DOCUMENT_TAIL_ENCODED_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_TRANSPORT_BYTES = 15 * 1024 * 1024;
const MAX_DOCUMENT_RESULT_JSON_BYTES = 900 * 1024;
const MAX_OUTLINE_ITEMS = 2_000;
const MAX_OUTLINE_JSON_BYTES = 128 * 1024;

export async function readDocumentTransportState(
  context: ProjectMcpRequestContext,
  documentId: string,
) {
  const result = await rpc<DocumentTransportRpcResult>(
    context,
    "mcp_read_document_transport_state",
    { p_project_id: context.projectId, p_document_id: documentId },
  );
  if (result?.status === "access_denied") {
    throw new McpDomainError(
      "PROJECT_ACCESS_REVOKED",
      "Project access has been revoked.",
    );
  }
  if (!result) {
    throw new McpDomainError("DOCUMENT_NOT_FOUND", "Document not found.");
  }
  if (result.status === "payload_too_large") {
    throw new McpDomainError(
      "PAYLOAD_TOO_LARGE",
      "The document collaboration tail requires compaction before it can be read.",
    );
  }
  const tailBytes = result.tail.reduce(
    (total, row) => total + utf8ByteLength(row.update_data),
    0,
  );
  const transportBytes = utf8ByteLength(JSON.stringify(result));
  if (
    result.tail.length > MAX_DOCUMENT_TAIL_UPDATES ||
    tailBytes > MAX_DOCUMENT_TAIL_ENCODED_BYTES ||
    transportBytes > MAX_DOCUMENT_TRANSPORT_BYTES
  ) {
    throw new McpDomainError(
      "PAYLOAD_TOO_LARGE",
      "The document collaboration tail requires compaction before it can be read.",
    );
  }
  return { head: result.head, tail: result.tail };
}

type OutlineItem = { level: number; text: string; line: number };

function scanDocument(markdown: string, requestedHeading?: string): {
  lines: string[];
  outline: OutlineItem[];
  outlineTruncated: boolean;
  headingRange: { start: number; end: number } | null;
} {
  const lines = markdown.split("\n");
  const items: OutlineItem[] = [];
  let outlineBytes = 2;
  let outlineTruncated = false;
  let selected: { line: number; level: number } | null = null;
  let headingEnd: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index]);
    if (!match) continue;
    const item = { level: match[1].length, text: match[2], line: index + 1 };
    const itemBytes = utf8ByteLength(JSON.stringify(item)) +
      (items.length ? 1 : 0);
    if (
      !outlineTruncated && items.length < MAX_OUTLINE_ITEMS &&
      outlineBytes + itemBytes <= MAX_OUTLINE_JSON_BYTES
    ) {
      items.push(item);
      outlineBytes += itemBytes;
    } else {
      outlineTruncated = true;
    }
    if (requestedHeading && !selected && item.text === requestedHeading) {
      selected = item;
    } else if (
      selected && headingEnd === null && item.line > selected.line &&
      item.level <= selected.level
    ) headingEnd = item.line;
  }
  return {
    lines,
    outline: items,
    outlineTruncated,
    headingRange: selected
      ? { start: selected.line, end: headingEnd ?? lines.length + 1 }
      : null,
  };
}

export type ReadDocumentInput = {
  documentId: string;
  mode?: "full" | "outline" | "heading" | "lines";
  heading?: string;
  lineStart?: number;
  lineEnd?: number;
};

export async function readDocument(
  context: ProjectMcpRequestContext,
  input: string | ReadDocumentInput,
) {
  const options: ReadDocumentInput = typeof input === "string"
    ? { documentId: input }
    : input;
  const { head, tail } = await readDocumentTransportState(
    context,
    options.documentId,
  );
  const updates = tail.map((row) => row.update_data);
  const normalized = head.yjs_state === null
    ? { yjsStateBase64: "", markdown: head.content }
    : await normalizeDocumentState(head.yjs_state, updates);
  const markdown = normalized.markdown;
  const mode = options.mode ?? "full";
  const requestedHeading = mode === "heading"
    ? options.heading?.trim()
    : undefined;
  if (mode === "heading" && !requestedHeading) {
    throw new McpDomainError("FIELD_VALIDATION_FAILED", "heading is required.");
  }
  const scanned = scanDocument(markdown, requestedHeading);
  let body: string | null = markdown;
  let truncated = false;
  let fallback: string | null = null;
  if (mode === "outline") body = null;
  if (
    mode === "full" && utf8ByteLength(markdown) > MAX_DOCUMENT_MARKDOWN_BYTES
  ) {
    body = null;
    truncated = true;
    fallback = "outline";
  }
  if (mode === "heading") {
    if (!scanned.headingRange) {
      throw new McpDomainError("FIELD_VALIDATION_FAILED", "Heading not found.");
    }
    body = scanned.lines.slice(
      scanned.headingRange.start - 1,
      scanned.headingRange.end - 1,
    ).join("\n");
  }
  if (mode === "lines") {
    const start = options.lineStart;
    const end = options.lineEnd;
    if (!start || !end || end < start || end - start >= 1000) {
      throw new McpDomainError(
        "FIELD_VALIDATION_FAILED",
        "lineStart and lineEnd must define at most 1000 inclusive lines.",
      );
    }
    body = scanned.lines.slice(start - 1, end).join("\n");
  }
  if (body !== null && utf8ByteLength(body) > MAX_DOCUMENT_MARKDOWN_BYTES) {
    throw new McpDomainError(
      "PAYLOAD_TOO_LARGE",
      "The selected document content is too large.",
    );
  }
  const response = {
    document: {
      id: head.id,
      name: head.name,
      markdown: body,
      updatedAt: head.updated_at,
    },
    outline: scanned.outline,
    outlineTruncated: scanned.outlineTruncated,
    mode,
    truncated,
    fallback,
    stateToken: {
      epoch: head.collab_epoch,
      revision: head.collab_revision,
      updateIds: tail.map((row) => row.id),
    },
  };
  if (
    utf8ByteLength(JSON.stringify(response)) >= MAX_DOCUMENT_RESULT_JSON_BYTES
  ) {
    throw new McpDomainError(
      "PAYLOAD_TOO_LARGE",
      "The selected document result is too large. Request a smaller heading or line range.",
    );
  }
  return response;
}

type DegradationReason =
  | "embedding_not_configured"
  | "embedding_timeout"
  | "embedding_rate_limited"
  | "embedding_invalid_response"
  | "vector_search_unavailable";
class SearchFallback extends Error {
  constructor(readonly reason: DegradationReason) {
    super(reason);
  }
}

const embeddingCache = new Map<
  string,
  { vector: number[]; expiresAt: number }
>();
const EMBEDDING_CACHE_TTL_MS = 10 * 60 * 1000;
const EMBEDDING_CACHE_MAX = 128;

async function cacheKey(
  endpoint: string,
  model: string,
  query: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(query),
  );
  const hash = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return endpoint + "\0" + model + "\0" + "1536" + "\0" + hash;
}

async function embed(
  context: ProjectMcpRequestContext,
  query: string,
): Promise<number[]> {
  return await measureMcpPhase(context, "embedding", async () => {
    const endpoint = Deno.env.get("MCP_EMBEDDING_URL");
    const key = Deno.env.get("MCP_EMBEDDING_KEY");
    const model = Deno.env.get("MCP_EMBEDDING_MODEL");
    if (!endpoint || !key || !model) {
      throw new SearchFallback("embedding_not_configured");
    }
    const normalized = query.trim().normalize("NFC");
    const keyHash = await cacheKey(endpoint, model, normalized);
    const cached = embeddingCache.get(keyHash);
    if (cached && cached.expiresAt > Date.now()) {
      embeddingCache.delete(keyHash);
      embeddingCache.set(keyHash, cached);
      return cached.vector;
    }
    if (cached) embeddingCache.delete(keyHash);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: "Bearer " + key,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, input: normalized, texts: [normalized] }),
      });
      if (response.status === 429) {
        throw new SearchFallback("embedding_rate_limited");
      }
      if (!response.ok) throw new SearchFallback("embedding_invalid_response");
      const body = await response.json();
      const vector = body?.data?.[0]?.embedding ?? body?.vectors?.[0];
      if (
        !Array.isArray(vector) || vector.length !== 1536 ||
        !vector.every((value: unknown) =>
          typeof value === "number" && Number.isFinite(value)
        )
      ) {
        throw new SearchFallback("embedding_invalid_response");
      }
      embeddingCache.set(keyHash, {
        vector,
        expiresAt: Date.now() + EMBEDDING_CACHE_TTL_MS,
      });
      while (embeddingCache.size > EMBEDDING_CACHE_MAX) {
        const oldest = embeddingCache.keys().next().value;
        if (typeof oldest === "string") embeddingCache.delete(oldest);
        else break;
      }
      return vector;
    } catch (error) {
      if (error instanceof SearchFallback) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new SearchFallback("embedding_timeout");
      }
      throw new SearchFallback("embedding_invalid_response");
    } finally {
      clearTimeout(timeout);
    }
  });
}

function filterSearchItems(
  items: unknown[],
  source: "all" | "tables" | "documents",
) {
  if (source === "all") return items;
  return items.filter((item) => {
    const type = String((item as Record<string, unknown>)?.source_type ?? "");
    return source === "documents"
      ? type.includes("document")
      : type.startsWith("library_");
  });
}

export async function semanticSearch(context: ProjectMcpRequestContext, input: {
  query: string;
  limit?: number;
  source?: "all" | "tables" | "documents";
}) {
  const limit = validateLimit(input.limit, { defaultValue: 10, maximum: 30 });
  const query = input.query.trim().normalize("NFC");
  if (!query || Array.from(query).length > 1000) {
    throw new McpDomainError(
      "FIELD_VALIDATION_FAILED",
      "query must contain between 1 and 1000 Unicode characters.",
    );
  }
  const source = input.source ?? "all";
  let degradation: DegradationReason;
  try {
    const vector = await embed(context, query);
    let items: unknown[];
    try {
      items = await rpc<unknown[]>(context, "mcp_vector_search", {
        p_project_id: context.projectId,
        p_query_embedding: vector,
        p_limit: limit,
        p_min_score: 0.2,
        p_source: source,
      });
    } catch (error) {
      if (
        error instanceof McpDomainError &&
        error.code === "PROJECT_ACCESS_REVOKED"
      ) throw error;
      throw new SearchFallback("vector_search_unavailable");
    }
    return {
      items: filterSearchItems(items, source).slice(0, limit),
      searchMode: "semantic",
      degraded: false,
      degradationReason: null,
    };
  } catch (error) {
    if (error instanceof McpDomainError) throw error;
    degradation = error instanceof SearchFallback
      ? error.reason
      : "embedding_invalid_response";
  }
  try {
    const items = await rpc<unknown[]>(context, "mcp_text_search", {
      p_project_id: context.projectId,
      p_query: query,
      p_limit: limit,
      p_source: source,
    });
    return {
      items: filterSearchItems(items, source).slice(0, limit),
      searchMode: "text_fuzzy",
      degraded: true,
      degradationReason: degradation,
    };
  } catch (error) {
    if (
      error instanceof McpDomainError && error.code === "PROJECT_ACCESS_REVOKED"
    ) throw error;
    throw new McpDomainError(
      "UPSTREAM_EMBEDDING_UNAVAILABLE",
      "Semantic and text search are unavailable.",
    );
  }
}
