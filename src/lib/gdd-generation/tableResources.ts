import { createHash } from 'node:crypto';
import { z } from 'zod';

const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const generatedTableRowSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, 'values')) return value;
  const { name, ...values } = record;
  return { name, values };
}, z.object({
  name: boundedText(160),
  values: z.record(z.unknown()),
}).strict());

export const generatedTablePlanSchema = z.object({
  table: boundedText(120),
  purpose: boundedText(500),
  fields: z.array(boundedText(120)).min(1).max(100),
  rows: z.array(generatedTableRowSchema).min(1).max(500),
}).strict();

export type GeneratedTableRow = z.infer<typeof generatedTableRowSchema> & { id?: string };
export type GeneratedTablePlan = z.infer<typeof generatedTablePlanSchema>;

export type GeneratedTableResource = Omit<GeneratedTablePlan, 'rows'> & { id: string; rows: GeneratedTableRow[] };

/** Keep the RPC payload stable even when a caller carries model-only metadata. */
export function sanitizeTableResourcesForPersistence(resources: GeneratedTableResource[]): GeneratedTableResource[] {
  return resources.map((resource) => ({
    id: resource.id,
    table: resource.table,
    purpose: resource.purpose,
    fields: [...resource.fields],
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

export function materializeTableResources(jobId: string, plans: GeneratedTablePlan[]): GeneratedTableResource[] {
  return plans.map((plan, index) => {
    const id = deterministicUuid(`${jobId}:${index}:${plan.table.toLocaleLowerCase()}`);
    return {
      ...plan,
      id,
      rows: plan.rows.map((row, rowIndex) => ({
        ...row,
        id: deterministicUuid(`${id}:row:${rowIndex}:${row.name.toLocaleLowerCase()}`),
      })),
    };
  });
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

export function renderTableReferences(projectId: string, resources: GeneratedTableResource[]): string {
  if (resources.length === 0) return '- No independent Keco tables were generated.';
  return resources.map((table) => [
    `- [${table.table}](/${encodeURIComponent(projectId)}/${encodeURIComponent(table.id)}) - ${table.purpose}`,
    `  - Fields: ${table.fields.join(', ')}`,
  ].join('\n')).join('\n');
}
