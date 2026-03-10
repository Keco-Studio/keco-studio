import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyLibraryAccess } from '@/lib/services/authorizationService';
import { getLibrary } from '@/lib/services/libraryService';
import { getLibrarySchema, getLibraryAssetsWithProperties } from '@/lib/services/libraryAssetsService';
import type { SectionConfig, PropertyConfig, AssetRow } from '@/lib/types/libraryAssets';
import * as XLSX from 'xlsx';

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Format value for export (arrays, objects, special types as readable string) */
function formatCellValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && Array.isArray(value)) {
    return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return value as string | number | boolean;
}

/** YYYYMMDDHHmmss */
function timestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}${h}${min}${s}`;
}

/** Sanitize filename: replace invalid chars */
function safeFileName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'export';
}

export async function GET(request: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const libraryId = searchParams.get('libraryId');
  const format = (searchParams.get('format') || 'xlsx').toLowerCase();

  if (!libraryId || !isUuid(libraryId)) {
    return NextResponse.json({ error: 'Invalid libraryId' }, { status: 400 });
  }
  if (format !== 'xlsx' && format !== 'json') {
    return NextResponse.json({ error: 'Format must be xlsx or json' }, { status: 400 });
  }

  try {
    await verifyLibraryAccess(supabase, libraryId);
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    if (err.name === 'AuthorizationError') {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error)?.message || 'Library not found' }, { status: 404 });
  }

  const [library, schema, assets] = await Promise.all([
    getLibrary(supabase, libraryId),
    getLibrarySchema(supabase, libraryId),
    getLibraryAssetsWithProperties(supabase, libraryId),
  ]);

  if (!library) {
    return NextResponse.json({ error: 'Library not found' }, { status: 404 });
  }

  const libraryName = library.name || 'table';
  const exportedAt = timestamp();
  const baseName = `${safeFileName(libraryName)}_${exportedAt}`;
  const sections = schema.sections;
  const properties = schema.properties;

  if (format === 'json') {
    const payload = {
      libraryName,
      exportedAt,
      sections: sections.map((s: SectionConfig) => ({ id: s.id, name: s.name, orderIndex: s.orderIndex })),
      properties: properties.map((p: PropertyConfig) => ({
        id: p.id,
        sectionId: p.sectionId,
        key: p.key,
        name: p.name,
        dataType: p.dataType,
        orderIndex: p.orderIndex,
      })),
      rows: assets.map((row: AssetRow) => ({
        id: row.id,
        name: row.name,
        propertyValues: row.propertyValues,
        created_at: row.created_at,
        rowIndex: row.rowIndex,
      })),
    };
    const json = JSON.stringify(payload, null, 2);
    return new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${baseName}.json"`,
      },
    });
  }

  // xlsx: one sheet, row0 = section names, row1 = label (datatype), row2+ = data
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const headersSection: string[] = [];
  const headersLabel: string[] = [];
  for (const p of properties) {
    const section = sectionById.get(p.sectionId);
    headersSection.push(section?.name ?? '');
    headersLabel.push(`${p.name} (${p.dataType ?? p.valueType ?? 'other'})`);
  }

  const dataRows: (string | number | boolean | null)[][] = assets.map((row) => {
    return properties.map((p) => formatCellValue(row.propertyValues[p.key]));
  });

  const wsData = [headersSection, headersLabel, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, safeFileName(libraryName).slice(0, 31));

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${baseName}.xlsx"`,
    },
  });
}
