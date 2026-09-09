import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import { aggregateProjectGameAssets } from '@/lib/services/gameAssetsService';
import { getUserProjectRole, AuthorizationError } from '@/lib/services/authorizationService';

const UUID = z.string().uuid();
const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml']);
const NO_STORE = { 'Cache-Control': 'private, no-store' };
export const runtime = 'nodejs';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

function mimeFromName(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return null;
  }
}

type RouteContext = { params: Promise<{ projectId: string }> };

export const GET = withAuth<RouteContext>(async (request, context, { supabase }) => {
  const { projectId } = await context.params;
  if (!UUID.safeParse(projectId).success) return json({ error: 'Invalid project id' }, 400);
  try {
    await getUserProjectRole(supabase, projectId);
    const result = await aggregateProjectGameAssets(supabase, projectId);
    return json(result);
  } catch (error) {
    if (error instanceof AuthorizationError) return json({ error: 'Forbidden' }, 403);
    console.error('[game-assets] list failed', error);
    return json({ error: 'Unable to load game assets' }, 500);
  }
});

export const POST = withAuth<RouteContext>(async (request, context, { supabase, user }) => {
  const { projectId } = await context.params;
  if (!UUID.safeParse(projectId).success) return json({ error: 'Invalid project id' }, 400);
  try {
    const role = (await getUserProjectRole(supabase, projectId, user.id)).role;
    if (role === 'viewer') return json({ error: 'Editor or admin access is required' }, 403);
    const form = await request.formData();
    const entries = form.getAll('files');
    if (entries.length === 0) return json({ error: 'No files provided' }, 400);
    const items: Array<Record<string, unknown>> = [];
    for (const entry of entries.slice(0, 20)) {
      if (!(entry instanceof File)) {
        items.push({ ok: false, error: 'Invalid file item' });
        continue;
      }
      const mimeType = entry.type && IMAGE_TYPES.has(entry.type) ? entry.type : mimeFromName(entry.name);
      if (!mimeType || !IMAGE_TYPES.has(mimeType) || entry.size < 1 || entry.size > MAX_BYTES) {
        items.push({ ok: false, name: entry.name, error: 'Only images up to 5 MiB are supported' });
        continue;
      }
      try {
        const bytes = Buffer.from(await entry.arrayBuffer());
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const id = randomUUID();
        const safeName = entry.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${user.id}/${projectId}/${id}-${safeName}`;
        const upload = await supabase.storage.from('library-media-files').upload(path, bytes, {
          contentType: mimeType,
          upsert: false,
        });
        if (upload.error) throw upload.error;
        let width: number | null = null;
        let height: number | null = null;
        let hasTransparency: boolean | null = null;
        if (mimeType !== 'image/svg+xml') {
          const metadata = await sharp(bytes).metadata();
          width = metadata.width ?? null;
          height = metadata.height ?? null;
          hasTransparency = metadata.hasAlpha ?? null;
        }
        const { data, error } = await supabase.from('project_game_assets').insert({
          id,
          project_id: projectId,
          created_by: user.id,
          name: entry.name,
          mime_type: mimeType,
          storage_path: path,
          sha256,
          width,
          height,
          has_transparency: hasTransparency,
          file_size: entry.size,
        }).select('id').single();
        if (error) {
          await supabase.storage.from('library-media-files').remove([path]);
          throw error;
        }
        items.push({ ok: true, name: entry.name, id: data?.id ?? id, sha256 });
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : typeof error === 'object' && error && 'message' in error && typeof (error as { message: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'Upload failed';
        console.error('[game-assets] per-file upload failed', { name: entry instanceof File ? entry.name : null, error });
        items.push({ ok: false, name: entry instanceof File ? entry.name : undefined, error: message });
      }
    }
    return json({ items, completedCount: items.filter((item) => item.ok).length, failedCount: items.filter((item) => !item.ok).length }, 201);
  } catch (error) {
    if (error instanceof AuthorizationError) return json({ error: 'Forbidden' }, 403);
    console.error('[game-assets] upload failed', error);
    return json({ error: 'Unable to upload game assets' }, 500);
  }
});
