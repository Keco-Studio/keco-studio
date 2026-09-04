import { createHash } from 'node:crypto';
import { z } from 'zod';

const boundedText = (max: number) => z.string().trim().min(1).max(max);

function readTableString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function isNameLikeField(field: string): boolean {
  return /(?:^|[_\s-])(name|title|label)(?:$|[_\s-])/i.test(field)
    || /^(name|title|label)$/i.test(field);
}

export function coerceTableRowInput(value: unknown, fields: string[] = []): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;

  let values: Record<string, unknown>;
  if (record.values && typeof record.values === 'object' && !Array.isArray(record.values)) {
    values = { ...(record.values as Record<string, unknown>) };
  } else {
    const {
      name: _name,
      rowName: _rowName,
      row_name: _rowNameSnake,
      title: _title,
      label: _label,
      values: _values,
      ...flatValues
    } = record;
    values = flatValues;
  }

  const nameLikeField = fields.find((field) => isNameLikeField(field)) ?? fields[0];
  const name = readTableString(record, ['name', 'rowName', 'row_name', 'title', 'label'])
    ?? readTableString(values, ['name', 'title', 'label', 'productName', 'product_name'])
    ?? (nameLikeField ? readTableString(values, [nameLikeField]) : undefined);

  return { name, values };
}

export function coerceTablePlanInput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const fields = Array.isArray(record.fields)
    ? record.fields.filter((field): field is string => typeof field === 'string')
    : [];
  const rows = Array.isArray(record.rows)
    ? record.rows.map((row) => coerceTableRowInput(row, fields))
    : record.rows;
  return {
    table: readTableString(record, ['table', 'tableName', 'table_name', 'name']) ?? record.table,
    purpose: readTableString(record, ['purpose', 'description', 'summary']) ?? record.purpose,
    fields: record.fields,
    rows,
  };
}

export const generatedTableRowSchema = z.preprocess(
  (value) => coerceTableRowInput(value),
  z.object({
    name: boundedText(160),
    values: z.record(z.unknown()),
  }).strict(),
);

export const generatedTablePlanSchema = z.preprocess(
  coerceTablePlanInput,
  z.object({
    table: boundedText(120),
    purpose: boundedText(500),
    fields: z.array(boundedText(120)).min(1).max(100),
    rows: z.array(generatedTableRowSchema).min(1).max(500),
  }).strict(),
);

export type GeneratedTableRow = z.infer<typeof generatedTableRowSchema> & { id?: string };
export type GeneratedTablePlan = z.infer<typeof generatedTablePlanSchema>;

export type GeneratedTableResource = Omit<GeneratedTablePlan, 'rows'> & {
  id: string;
  fieldIds: string[];
  rows: GeneratedTableRow[];
};

/** Keep the RPC payload stable even when a caller carries model-only metadata. */
export function sanitizeTableResourcesForPersistence(resources: GeneratedTableResource[]): GeneratedTableResource[] {
  return resources.map((resource) => ({
    id: resource.id,
    table: resource.table,
    purpose: resource.purpose,
    fields: [...resource.fields],
    fieldIds: [...resource.fieldIds],
    rows: resource.rows.map((row) => {
      const record = row as Record<string, unknown>;
      const { id, name, values, ...flatValues } = record;
      const declaredFields = new Set(resource.fields.map((field) => field.toLocaleLowerCase()));
      const mergedValues = {
        ...flatValues,
        ...(values && typeof values === 'object' && !Array.isArray(values) ? values as Record<string, unknown> : {}),
      };
      const nameField = resource.fields.find((field) => field.toLocaleLowerCase() === 'name');
      if (nameField && !Object.keys(mergedValues).some((key) => key.toLocaleLowerCase() === 'name')) {
        mergedValues[nameField] = String(name ?? '');
      }
      return {
        ...(typeof id === 'string' && id ? { id } : {}),
        name: String(name ?? ''),
        values: Object.fromEntries(Object.entries(mergedValues).filter(([key]) => declaredFields.has(key.toLocaleLowerCase()))),
      };
    }),
  }));
}

function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function normalizeTableLogicalKey(table: string): string {
  return table.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * Materialize durable table/field/row IDs for GDD persistence and inline
 * ResourceReference chips.
 *
 * Prefer an existing series library ID when the Game Design System already owns
 * that logical table. Otherwise seed from the caller's project-scoped series
 * identity so later generations produce the same IDs without colliding when a
 * Game Design System is shared across projects.
 */
export function materializeTableResources(
  seriesSeed: string,
  plans: GeneratedTablePlan[],
  existingLibraryIdsByKey: ReadonlyMap<string, string> = new Map(),
): GeneratedTableResource[] {
  return plans.map((plan) => {
    const key = normalizeTableLogicalKey(plan.table);
    const id = existingLibraryIdsByKey.get(key)
      ?? deterministicUuid(`${seriesSeed}:table:${key}`);
    return {
      ...plan,
      id,
      fieldIds: plan.fields.map((field, fieldIndex) => (
        deterministicUuid(`${id}:field:${fieldIndex}:${field.toLocaleLowerCase()}`)
      )),
      rows: plan.rows.map((row, rowIndex) => ({
        ...row,
        id: deterministicUuid(`${id}:row:${rowIndex}:${row.name.toLocaleLowerCase()}`),
      })),
    };
  });
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function serializeTableRowReference(input: {
  libraryId: string;
  assetId: string;
  displayFieldId: string;
  fallbackLabel: string;
}): string {
  const attrs = {
    kind: 'table-row',
    libraryId: input.libraryId,
    assetId: input.assetId,
    displayFieldId: input.displayFieldId,
    fallbackLabel: input.fallbackLabel,
  };
  return `<ResourceReference ${Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
    .join(' ')} />`;
}

export function renderTableResourceReferences(resources: GeneratedTableResource[]): string {
  if (resources.length === 0) return '';
  return resources.map((table) => {
    const displayFieldId = table.fieldIds[0];
    if (!displayFieldId) {
      throw new Error(`Generated table ${table.table} has no fields to reference.`);
    }
    // Prefix with a zero-width space so MDX keeps the chips as inline text in one
    // paragraph. Bare adjacent JSX void tags become separate flow blocks (one
    // projection per row). Do not emit a visible table title here — the editor
    // projection already renders the linked table name.
    const chips = table.rows.map((row) => {
      if (!row.id) throw new Error(`Generated table ${table.table} row ${row.name} is missing an id.`);
      return serializeTableRowReference({
        libraryId: table.id,
        assetId: row.id,
        displayFieldId,
        fallbackLabel: row.name,
      });
    }).join(' ');
    return `\u200B${chips}`;
  }).join('\n\n');
}

const TABLE_REF_MARKER = /<!--\s*KECO_TABLE_REF\s+([^>]+?)\s*-->/gi;

function normalizeTableRefName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * Dialogue graph tables are persistence/compiler inputs, not user-facing GDD
 * content. Their rows contain node ids, full dialogue, and choice arrays, so
 * projecting them as inline table-row references produces noisy gray cards.
 */
function isInternalDialogueTable(resource: GeneratedTableResource): boolean {
  const key = normalizeTableRefName(resource.table).replace(/[\s_-]+/g, '');
  return /^(?:dialogue|conversation)(?:node|event)s?(?:table)?$/.test(key)
    || /^对话(?:节点|事件)(?:表)?$/.test(key);
}

export function listTableRefNames(markdown: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(TABLE_REF_MARKER)) {
    const name = match[1]?.trim() ?? '';
    const key = normalizeTableRefName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name.replace(/\s+/g, ' ').trim());
  }
  return names;
}

const MARKDOWN_TABLE_SEPARATOR = /^:?-{3,}:?$/;

function splitMarkdownTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  let escaped = false;
  for (const character of text) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (escaped) current += '\\';
  cells.push(current.trim());
  return cells;
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('|') && splitMarkdownTableRow(trimmed).length > 1;
}

function parseMarkdownTableCell(value: string): unknown {
  const trimmed = value.trim();
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^(?:true|false)$/i.test(trimmed)) return trimmed.toLocaleLowerCase() === 'true';
  return trimmed;
}

function markdownTableHeading(lines: string[], tableStart: number): string | undefined {
  for (let index = tableStart - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? '';
    if (!line) continue;
    const heading = /^(?:#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) return undefined;
    return heading[1]!
      .replace(/^\d+(?:\.\d+)*\s*/, '')
      .trim();
  }
  return undefined;
}

function uniqueMarkdownTableName(
  candidate: string,
  usedNames: Set<string>,
  fallbackIndex: number,
): string {
  const base = candidate.trim() || `Table ${fallbackIndex}`;
  let name = base;
  let suffix = 2;
  while (usedNames.has(normalizeTableRefName(name))) {
    name = `${base} ${suffix}`;
    suffix += 1;
  }
  usedNames.add(normalizeTableRefName(name));
  return name;
}

function normalizeMarkdownTableField(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function matchingTableGuidance(
  fields: string[],
  guidance: ReadonlyArray<{ table?: string; purpose?: string; fields?: string[] }>,
): { table: string; purpose?: string; fields?: string[] } | undefined {
  return guidance.find((candidate): candidate is { table: string; purpose?: string; fields: string[] } => (
    typeof candidate.table === 'string'
    && Array.isArray(candidate.fields)
    && candidate.fields.length === fields.length
    && candidate.fields.every((field, index) => (
      normalizeMarkdownTableField(field) === normalizeMarkdownTableField(fields[index] ?? '')
    ))
  ));
}

/** Convert accidental Markdown data tables into first-class Keco table plans. */
export function convertMarkdownTablesToPlans(
  markdown: string,
  existingPlans: GeneratedTablePlan[] = [],
  guidance: ReadonlyArray<{ table?: string; purpose?: string; fields?: string[] }> = [],
): { markdown: string; tablePlans: GeneratedTablePlan[] } {
  const lines = markdown.split(/\r?\n/);
  const usedNames = new Set(existingPlans.map((plan) => normalizeTableRefName(plan.table)));
  const tablePlans: GeneratedTablePlan[] = [];
  const output: string[] = [];
  let tableIndex = 0;

  for (let index = 0; index < lines.length;) {
    const header = lines[index];
    const separator = lines[index + 1];
    if (
      typeof header === 'string'
      && typeof separator === 'string'
      && isMarkdownTableRow(header)
      && isMarkdownTableRow(separator)
    ) {
      const fields = splitMarkdownTableRow(header);
      const separatorCells = splitMarkdownTableRow(separator);
      if (
        fields.length > 0
        && fields.length === separatorCells.length
        && separatorCells.every((cell) => MARKDOWN_TABLE_SEPARATOR.test(cell.replace(/\s+/g, '')))
        && fields.every(Boolean)
      ) {
        const rows: GeneratedTableRow[] = [];
        let end = index + 2;
        while (end < lines.length && isMarkdownTableRow(lines[end]!)) {
          const cells = splitMarkdownTableRow(lines[end]!);
          if (cells.length !== fields.length) break;
          const rowValues = Object.fromEntries(fields.map((field, fieldIndex) => [
            field,
            parseMarkdownTableCell(cells[fieldIndex] ?? ''),
          ]));
          const nameFieldIndex = fields.findIndex((field) => /(?:^|[_\s-])(name|title|label)(?:$|[_\s-])/i.test(field));
          const rowName = cells[nameFieldIndex >= 0 ? nameFieldIndex : 0] || `Row ${rows.length + 1}`;
          rows.push({ name: rowName, values: rowValues });
          end += 1;
        }
        if (rows.length > 0) {
          tableIndex += 1;
          const guided = matchingTableGuidance(fields, guidance);
          const table = uniqueMarkdownTableName(
            guided?.table ?? markdownTableHeading(lines, index) ?? '',
            usedNames,
            tableIndex,
          );
          tablePlans.push({
            table,
            purpose: guided?.purpose ?? 'Imported from a Markdown table in the generated GDD.',
            fields: guided?.fields ? [...guided.fields] : fields,
            rows,
          });
          output.push(`<!-- KECO_TABLE_REF ${table} -->`);
          index = end;
          continue;
        }
      }
    }
    output.push(lines[index]!);
    index += 1;
  }

  return { markdown: output.join('\n'), tablePlans };
}

/** Replace body KECO_TABLE_REF markers with toolbar-style ResourceReference chips. */
export function applyInlineTableResourceReferences(
  markdown: string,
  resources: GeneratedTableResource[],
): string {
  try {
    return replaceInlineTableResourceReferences(markdown, resources);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid KECO_TABLE_REF markers.';
    throw new GddTableReferenceError(message);
  }
}

export class GddTableReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GddTableReferenceError';
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Drop a lone "TableName:" line immediately before its KECO_TABLE_REF marker. */
function stripRedundantTableTitlesBeforeMarkers(
  markdown: string,
  resources: GeneratedTableResource[],
): string {
  let result = markdown;
  for (const resource of resources) {
    const name = escapeRegExp(resource.table.trim());
    const pattern = new RegExp(
      `(^|\\n)[ \\t]*${name}[ \\t]*[:：]?[ \\t]*\\n(?=[ \\t]*<!--\\s*KECO_TABLE_REF\\s+${name}\\s*-->)`,
      'gi',
    );
    result = result.replace(pattern, '$1');
  }
  return result;
}

export function stripOrphanTableRefMarkers(markdown: string): string {
  const withoutTitledMarkers = markdown.replace(
    /(^|\n)[ \t]*([^\n<#]{1,120}?)[ \t]*[:：]?[ \t]*\n[ \t]*<!--\s*KECO_TABLE_REF\s+\2\s*-->/gi,
    '$1',
  );
  return withoutTitledMarkers
    .replace(TABLE_REF_MARKER, '')
    .replace(/\n{3,}/g, '\n\n');
}

function replaceInlineTableResourceReferences(
  markdown: string,
  resources: GeneratedTableResource[],
): string {
  if (resources.length === 0) {
    // Last resort: keep the GDD instead of failing the whole job when the model
    // emitted REF placeholders but no usable TABLE_PLAN.
    return stripOrphanTableRefMarkers(markdown);
  }

  const prepared = stripRedundantTableTitlesBeforeMarkers(markdown, resources);
  const visibleResources = resources.filter((resource) => !isInternalDialogueTable(resource));
  const byName = new Map(
    visibleResources.map((resource) => [normalizeTableRefName(resource.table), resource] as const),
  );
  const seen = new Set<string>();
  let replaced = prepared.replace(TABLE_REF_MARKER, (_match, rawName: string) => {
    const key = normalizeTableRefName(rawName);
    if (!key) return '';
    const resource = byName.get(key);
    if (!resource) return '';
    if (seen.has(key)) return '';
    seen.add(key);
    return renderTableResourceReferences([resource]);
  });

  const missing = visibleResources.filter((resource) => !seen.has(normalizeTableRefName(resource.table)));
  if (missing.length > 0) {
    const appendix = [
      '',
      '## Keco Tables',
      '',
      ...missing.flatMap((resource) => [renderTableResourceReferences([resource]), '']),
    ].join('\n');
    replaced = `${replaced.trimEnd()}\n${appendix}`;
  }
  return replaced.replace(/\n{3,}/g, '\n\n');
}

const TABLE_MARKERS = /<!--\s*KECO_TABLE_PLAN\s*([\s\S]*?)\s*-->/gi;

export const tablePlanShapeExample = JSON.stringify([{
  table: 'Skills',
  purpose: 'What this table controls.',
  fields: ['name'],
  rows: [{ name: 'Basic', values: { name: 'Basic' } }],
}]);

export function repairTablePlanMarkerJson(raw: string): string {
  let text = raw.trim();
  if (/^```/.test(text)) {
    text = text.replace(/^```(?:json)?[ \t]*(?:\r?\n|$)/i, '').replace(/(?:\r?\n)?```[ \t]*$/i, '').trim();
  }
  return text
    .replace(/[\u201C\u201D\uFF02]/g, '"')
    .replace(/[\u2018\u2019]/g, '\'')
    .replace(/,\s*([}\]])/g, '$1');
}

export function parseTablePlanMarkerJson(raw: string): unknown {
  const candidates = [raw.trim(), repairTablePlanMarkerJson(raw)];
  let lastError: unknown;
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new SyntaxError('Invalid JSON');
}

export function extractTablePlanMarker(raw: string): {
  markdown: string;
  tablePlans: GeneratedTablePlan[];
  warning: string | null;
} {
  const matches = [...raw.matchAll(TABLE_MARKERS)];
  if (matches.length === 0) return { markdown: raw.trim(), tablePlans: [], warning: null };
  const markdown = raw.replace(TABLE_MARKERS, '').trim();
  try {
    const values = matches.map((match) => parseTablePlanMarkerJson(match[1]));
    if (values.some((value) => !Array.isArray(value))) {
      throw new Error('Each KECO table plan marker must contain an array.');
    }
    return {
      markdown,
      tablePlans: normalizeTablePlans(values.flat()),
      warning: null,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        markdown,
        tablePlans: [],
        warning: 'KECO table plan marker is not valid JSON.',
      };
    }
    const message = error instanceof Error ? error.message : 'Invalid KECO table plan marker.';
    return {
      markdown,
      tablePlans: [],
      warning: message.slice(0, 300),
    };
  }
}

export function normalizeTablePlans(value: unknown): GeneratedTablePlan[] {
  if (!Array.isArray(value)) throw new Error('Generated table plan must be an array.');
  const plans = value.map((item) => generatedTablePlanSchema.parse(item));
  const names = new Set<string>();
  for (const plan of plans) {
    const key = plan.table.toLocaleLowerCase();
    if (names.has(key)) throw new Error(`Duplicate generated table name: ${plan.table}`);
    names.add(key);
    // Models occasionally put a valid row value in `rows` but omit it from
    // `fields`. Promote those keys into the schema so persistence can retain
    // the generated data instead of failing the whole GDD.
    const fieldLabels = new Map(plan.fields.map((field) => [field.toLocaleLowerCase(), field]));
    for (const row of plan.rows) {
      for (const field of Object.keys(row.values)) {
        const fieldKey = field.toLocaleLowerCase();
        if (fieldKey === 'id' && !fieldLabels.has('id')) {
          delete row.values[field];
          continue;
        }
        if (!fieldLabels.has(fieldKey)) {
          const normalizedField = boundedText(120).parse(field);
          fieldLabels.set(fieldKey, normalizedField);
          plan.fields.push(normalizedField);
        }
      }
    }
    const fieldNames = new Set<string>();
    for (const field of plan.fields) {
      const fieldKey = field.toLocaleLowerCase();
      if (fieldNames.has(fieldKey)) throw new Error(`Duplicate field name in generated table ${plan.table}: ${field}`);
      fieldNames.add(fieldKey);
    }
    const rowNames = new Set<string>();
    plan.rows = plan.rows.map((row) => {
      const values = { ...row.values };
      if (!fieldNames.has('id')) delete values.id;
      return { ...row, values };
    });
    for (const row of plan.rows) {
      const rowKey = row.name.toLocaleLowerCase();
      if (rowNames.has(rowKey)) throw new Error(`Duplicate generated row name in table ${plan.table}: ${row.name}`);
      rowNames.add(rowKey);
      for (const field of Object.keys(row.values)) {
        if (!fieldNames.has(field.toLocaleLowerCase())) {
          throw new Error(`Generated table ${plan.table} contains unknown field in row ${row.name}: ${field}`);
        }
      }
    }
  }
  return plans;
}
