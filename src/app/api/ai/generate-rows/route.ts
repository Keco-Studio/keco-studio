import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/createSupabaseServerClient';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

type PropertyDataType =
  | 'string'
  | 'string_array'
  | 'int'
  | 'int_array'
  | 'float'
  | 'float_array'
  | 'boolean'
  | 'enum'
  | 'date'
  | 'image'
  | 'file'
  | 'reference'
  | 'multimedia'
  | 'audio'
  | 'formula';

type PropertyInput = {
  key: string;
  name: string;
  dataType?: PropertyDataType;
  enumOptions?: string[];
};

type GenerateRowsRequest = {
  instruction: string;
  count?: number;
  properties: PropertyInput[];
  sampleRows?: Array<Record<string, unknown>>;
};

const MAX_ROWS = 20;
const DEFAULT_ROWS = 3;

function isNameLikeField(property: PropertyInput): boolean {
  const text = `${property.key} ${property.name}`.toLowerCase();
  return /(name|title|名称|名字|品名|作物名)/i.test(text);
}

function getSampleValuesByKey(
  sampleRows: Array<Record<string, unknown>> | undefined,
  key: string,
): unknown[] {
  if (!Array.isArray(sampleRows) || sampleRows.length === 0) return [];
  return sampleRows
    .map((row) => row?.[key])
    .filter((v) => v !== null && v !== undefined && v !== '');
}

function clampCount(count: number): number {
  if (!Number.isFinite(count)) return DEFAULT_ROWS;
  return Math.min(Math.max(Math.floor(count), 1), MAX_ROWS);
}

function inferCount(instruction: string, fallback: number): number {
  const fromChinese = instruction.match(/(\d+)\s*行/);
  if (fromChinese) return clampCount(Number(fromChinese[1]));
  const fromEnglish = instruction.match(/(\d+)\s*rows?/i);
  if (fromEnglish) return clampCount(Number(fromEnglish[1]));
  return clampCount(fallback);
}

function inferRange(instruction: string): { min: number; max: number } | null {
  const rangeMatch = instruction.match(/(-?\d+(?:\.\d+)?)\s*[-~到至]\s*(-?\d+(?:\.\d+)?)/);
  if (!rangeMatch) return null;
  const a = Number(rangeMatch[1]);
  const b = Number(rangeMatch[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function randomInt(min: number, max: number): number {
  const span = max - min + 1;
  return min + Math.floor(Math.random() * span);
}

function randomFloat(min: number, max: number): number {
  const val = min + Math.random() * (max - min);
  return Number(val.toFixed(2));
}

function pickEnumOption(options: string[], instruction: string, rowIndex: number): string {
  if (options.length === 0) return '';
  const loweredInstruction = instruction.toLowerCase();
  const byMention = options.find((option) => loweredInstruction.includes(option.toLowerCase()));
  if (byMention) return byMention;
  return options[rowIndex % options.length];
}

function buildStringValue(property: PropertyInput, rowIndex: number): string {
  const base = property.name || property.key || 'value';
  return `${base}-${rowIndex + 1}`;
}

function buildValueForProperty(
  property: PropertyInput,
  instruction: string,
  rowIndex: number,
  sampleRows?: Array<Record<string, unknown>>,
): unknown {
  const dataType = property.dataType ?? 'string';
  const inferredRange = inferRange(instruction);
  const sampleValues = getSampleValuesByKey(sampleRows, property.key);

  switch (dataType) {
    case 'int': {
      const numericSamples = sampleValues
        .map((v) => (typeof v === 'number' ? v : Number(v)))
        .filter((v) => Number.isFinite(v)) as number[];
      if (numericSamples.length > 0) {
        const min = Math.min(...numericSamples);
        const max = Math.max(...numericSamples);
        return randomInt(Math.floor(min), Math.ceil(max));
      }
      if (inferredRange) return randomInt(Math.floor(inferredRange.min), Math.ceil(inferredRange.max));
      return randomInt(1, 100);
    }
    case 'float': {
      const numericSamples = sampleValues
        .map((v) => (typeof v === 'number' ? v : Number(v)))
        .filter((v) => Number.isFinite(v)) as number[];
      if (numericSamples.length > 0) {
        const min = Math.min(...numericSamples);
        const max = Math.max(...numericSamples);
        return randomFloat(min, max);
      }
      if (inferredRange) return randomFloat(inferredRange.min, inferredRange.max);
      return randomFloat(1, 100);
    }
    case 'boolean':
      return rowIndex % 2 === 0;
    case 'enum':
      if (sampleValues.length > 0) {
        return String(sampleValues[rowIndex % sampleValues.length]);
      }
      return pickEnumOption(property.enumOptions ?? [], instruction, rowIndex);
    case 'date': {
      if (sampleValues.length > 0) {
        const raw = String(sampleValues[rowIndex % sampleValues.length]);
        if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
      }
      const date = new Date();
      date.setDate(date.getDate() + rowIndex);
      return date.toISOString().slice(0, 10);
    }
    case 'string': {
      if (sampleValues.length > 0) {
        const base = String(sampleValues[rowIndex % sampleValues.length]);
        if (isNameLikeField(property)) {
          return `${base}-${rowIndex + 1}`;
        }
        return base;
      }
      return buildStringValue(property, rowIndex);
    }
    case 'string_array':
      if (sampleValues.length > 0) {
        const picked = sampleValues[rowIndex % sampleValues.length];
        return Array.isArray(picked) ? picked : [String(picked)];
      }
      return [buildStringValue(property, rowIndex)];
    case 'int_array':
      return [randomInt(1, 100), randomInt(1, 100)];
    case 'float_array':
      return [randomFloat(1, 100), randomFloat(1, 100)];
    case 'formula':
    case 'reference':
    case 'image':
    case 'file':
    case 'multimedia':
    case 'audio':
      return null;
    default:
      return buildStringValue(property, rowIndex);
  }
}

function generateRows(payload: GenerateRowsRequest): Array<Record<string, unknown>> {
  const requestedCount = clampCount(payload.count ?? DEFAULT_ROWS);
  const count = inferCount(payload.instruction, requestedCount);
  const writableProperties = payload.properties.filter(
    (property) =>
      property.key &&
      !['formula', 'reference', 'image', 'file', 'multimedia', 'audio'].includes(property.dataType ?? ''),
  );

  return Array.from({ length: count }, (_, rowIndex) => {
    const row: Record<string, unknown> = {};
    for (const property of writableProperties) {
      row[property.key] = buildValueForProperty(
        property,
        payload.instruction,
        rowIndex,
        payload.sampleRows,
      );
    }
    return row;
  });
}

export async function POST(req: Request) {
  const headerSupabase = createSupabaseServerClient(req);
  let {
    data: { user },
  } = await headerSupabase.auth.getUser();

  // Fallback for calls that rely on cookie-based auth.
  if (!user) {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const cookieSupabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Ignore writes from route handlers when not permitted.
          }
        },
      },
    });
    const userResult = await cookieSupabase.auth.getUser();
    user = userResult.data.user;
  }

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: GenerateRowsRequest;
  try {
    payload = (await req.json()) as GenerateRowsRequest;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!payload || typeof payload.instruction !== 'string' || payload.instruction.trim().length === 0) {
    return NextResponse.json({ error: 'instruction_required' }, { status: 400 });
  }

  if (!Array.isArray(payload.properties) || payload.properties.length === 0) {
    return NextResponse.json({ error: 'properties_required' }, { status: 400 });
  }

  const rows = generateRows(payload);
  return NextResponse.json({
    rows,
    meta: {
      mode: 'local-generator',
      note: 'No external model/API token required. Generated by local heuristic parser.',
    },
  });
}
