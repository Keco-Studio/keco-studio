import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/createSupabaseServerClient';
import {
  applyCellValueReplace,
  normalizeValue,
  type CellReplacePreview,
  type CellReplaceSkip,
} from '@/lib/utils/cellValueReplace';
import { verifyLibraryUpdatePermission } from '@/lib/services/authorizationService';
import { syncReferencesForSourceChanges } from '@/lib/services/referenceSyncService';

type ReplaceBody = {
  find?: string;
  replace?: string;
  mode?: 'single' | 'all';
  assetId?: string;
  fieldId?: string;
  libraryId?: string;
  dryRun?: boolean;
};

type SearchRow = {
  asset_id: string;
  field_id: string;
  field_label: string;
  library_id?: string;
};

type ValueRow = {
  asset_id: string;
  field_id: string;
  value_json: unknown;
};

type FieldRow = {
  id: string;
  data_type: string | null;
};

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient(req);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: ReplaceBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const find = (body.find ?? '').trim();
  const replace = body.replace ?? '';
  const mode = body.mode === 'single' ? 'single' : 'all';
  const dryRun = Boolean(body.dryRun);
  const libraryIdFilter = (body.libraryId ?? '').trim() || null;

  if (!find) {
    return NextResponse.json({ error: 'find is required' }, { status: 400 });
  }

  if (mode === 'single' && (!body.assetId || !body.fieldId)) {
    return NextResponse.json(
      { error: 'assetId and fieldId are required for single replace' },
      { status: 400 }
    );
  }

  let targets: SearchRow[] = [];

  if (mode === 'single') {
    const { data: directValue, error: directError } = await supabase
      .from('library_asset_values')
      .select('asset_id, field_id')
      .eq('asset_id', body.assetId!)
      .eq('field_id', body.fieldId!)
      .maybeSingle();

    if (directError || !directValue) {
      return NextResponse.json({ error: 'Cell not found' }, { status: 404 });
    }

    const [{ data: fieldDef }, { data: assetRow }] = await Promise.all([
      supabase
        .from('library_field_definitions')
        .select('label')
        .eq('id', body.fieldId!)
        .maybeSingle(),
      supabase
        .from('library_assets')
        .select('library_id')
        .eq('id', body.assetId!)
        .maybeSingle(),
    ]);

    targets = [
      {
        asset_id: body.assetId!,
        field_id: body.fieldId!,
        field_label: (fieldDef as { label?: string } | null)?.label ?? '',
        library_id: (assetRow as { library_id?: string } | null)?.library_id,
      },
    ];
  } else {
    const { data: searchRows, error: searchError } = await supabase.rpc(
      'search_library_cell_values',
      { p_query: find, p_limit: 500 }
    );

    if (searchError) {
      return NextResponse.json(
        { error: searchError.message ?? 'search failed' },
        { status: 400 }
      );
    }

    targets = (searchRows ?? []) as SearchRow[];
    if (libraryIdFilter) {
      targets = targets.filter((t) => t.library_id === libraryIdFilter);
    }
  }

  if (targets.length === 0) {
    return NextResponse.json({
      updated: 0,
      skipped: 0,
      previews: [] as CellReplacePreview[],
      skips: [] as CellReplaceSkip[],
    });
  }

  const assetIds = [...new Set(targets.map((t) => t.asset_id))];
  const fieldIds = [...new Set(targets.map((t) => t.field_id))];

  const { data: valueRows, error: valueError } = await supabase
    .from('library_asset_values')
    .select('asset_id, field_id, value_json')
    .in('asset_id', assetIds)
    .in('field_id', fieldIds);

  if (valueError) {
    return NextResponse.json(
      { error: valueError.message ?? 'failed to load cell values' },
      { status: 400 }
    );
  }

  const valueMap = new Map<string, unknown>();
  for (const row of (valueRows ?? []) as ValueRow[]) {
    valueMap.set(`${row.asset_id}:${row.field_id}`, row.value_json);
  }

  const { data: fieldRows, error: fieldError } = await supabase
    .from('library_field_definitions')
    .select('id, data_type')
    .in('id', fieldIds);

  if (fieldError) {
    return NextResponse.json(
      { error: fieldError.message ?? 'failed to load field definitions' },
      { status: 400 }
    );
  }

  const fieldTypeMap = new Map<string, string>();
  for (const row of (fieldRows ?? []) as FieldRow[]) {
    fieldTypeMap.set(row.id, row.data_type ?? '');
  }

  const previews: CellReplacePreview[] = [];
  const skips: CellReplaceSkip[] = [];
  const upserts: Array<{ asset_id: string; field_id: string; value_json: unknown }> = [];

  for (const target of targets) {
    const key = `${target.asset_id}:${target.field_id}`;
    const dataType = fieldTypeMap.get(target.field_id) ?? '';
    const currentValue = valueMap.get(key);

    if (!dataType) {
      skips.push({
        assetId: target.asset_id,
        fieldId: target.field_id,
        fieldLabel: target.field_label,
        reason: 'Unknown field type',
      });
      continue;
    }

    const result = applyCellValueReplace({
      currentValue: normalizeValue(currentValue),
      dataType,
      find,
      replace,
    });

    if (result.ok === false) {
      skips.push({
        assetId: target.asset_id,
        fieldId: target.field_id,
        fieldLabel: target.field_label,
        reason: result.error,
      });
      continue;
    }

    previews.push({
      assetId: target.asset_id,
      fieldId: target.field_id,
      fieldLabel: target.field_label,
      dataType,
      beforeDisplay: result.beforeDisplay,
      afterDisplay: result.afterDisplay,
    });

    upserts.push({
      asset_id: target.asset_id,
      field_id: target.field_id,
      value_json: result.newValue,
    });
  }

  if (upserts.length > 0) {
    const libraryIdByAssetId = new Map(
      targets
        .filter((target): target is SearchRow & { library_id: string } => Boolean(target.library_id))
        .map((target) => [target.asset_id, target.library_id])
    );
    const previewByCell = new Map(
      previews.map((preview) => [`${preview.assetId}:${preview.fieldId}`, preview])
    );
    const libraryIds = [...new Set(
      upserts
        .map((row) => libraryIdByAssetId.get(row.asset_id))
        .filter((libraryId): libraryId is string => Boolean(libraryId))
    )];
    const permissionByLibrary = new Map<string, { allowed: boolean; reason?: string }>();

    await Promise.all(libraryIds.map(async (libraryId) => {
      try {
        await verifyLibraryUpdatePermission(
          supabase,
          libraryId,
          user.id,
          { allowEditor: true }
        );
        permissionByLibrary.set(libraryId, { allowed: true });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'No permission to edit';
        permissionByLibrary.set(libraryId, { allowed: false, reason });
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            '[cell-values/replace] permission denied for library',
            libraryId,
            'user',
            user.id,
            reason
          );
        }
      }
    }));

    const allowedUpserts: typeof upserts = [];
    for (const row of upserts) {
      const libraryId = libraryIdByAssetId.get(row.asset_id);
      const permission = libraryId ? permissionByLibrary.get(libraryId) : undefined;
      if (permission?.allowed) {
        allowedUpserts.push(row);
        continue;
      }

      const preview = previewByCell.get(`${row.asset_id}:${row.field_id}`);
      if (preview) {
        skips.push({
          assetId: row.asset_id,
          fieldId: row.field_id,
          fieldLabel: preview.fieldLabel,
          reason: permission?.reason ?? 'No permission to edit',
        });
      }
    }

    const allowedKeys = new Set(
      allowedUpserts.map((row) => `${row.asset_id}:${row.field_id}`)
    );
    const finalPreviews = previews.filter((p) =>
      allowedKeys.has(`${p.assetId}:${p.fieldId}`)
    );

    const affectedLibraryIdsFromTargets = new Set(
      targets
        .map((t) => t.library_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    );

    if (!dryRun) {
      if (allowedUpserts.length === 0) {
        return NextResponse.json(
          {
            error: 'No cells could be updated (missing edit permission)',
            updated: 0,
            skipped: skips.length,
            previews: [],
            skips,
            affectedLibraryIds: [],
          },
          { status: 403 }
        );
      }

      const { error: upsertError } = await supabase
        .from('library_asset_values')
        .upsert(allowedUpserts, { onConflict: 'asset_id,field_id' });

      if (upsertError) {
        return NextResponse.json(
          { error: upsertError.message ?? 'replace failed' },
          { status: 400 }
        );
      }

      const touchedAssetIds = [...new Set(allowedUpserts.map((r) => r.asset_id))];
      await supabase
        .from('library_assets')
        .update({ updated_at: new Date().toISOString() })
        .in('id', touchedAssetIds);

      try {
        const sourceChanges = allowedUpserts.map((row) => ({
          assetId: row.asset_id,
          fieldId: row.field_id,
          valueJson: row.value_json,
        }));
        const refUpdates = await syncReferencesForSourceChanges(supabase, sourceChanges);
        for (const u of refUpdates) {
          if (u.referencingLibraryId) {
            affectedLibraryIdsFromTargets.add(u.referencingLibraryId);
          }
        }
      } catch (syncError) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[cell-values/replace] reference sync failed', syncError);
        }
      }
    }

    const affectedLibraryIds = [...affectedLibraryIdsFromTargets];

    return NextResponse.json({
      updated: finalPreviews.length,
      skipped: skips.length,
      previews: finalPreviews,
      skips,
      affectedLibraryIds,
      ...(dryRun ? { dryRun: true } : {}),
    });
  }

  const affectedLibraryIds = [
    ...new Set(
      targets
        .map((t) => t.library_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ];

  return NextResponse.json({
    updated: previews.length,
    skipped: skips.length,
    previews,
    skips,
    dryRun,
    affectedLibraryIds,
  });
}
