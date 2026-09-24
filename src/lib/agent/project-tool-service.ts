import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const uuid = z.string().uuid();
const cursorSchema = z.object({ createdAt: z.string().datetime(), id: uuid });
const summaryColumns = 'id,name,description,created_at,membership:project_collaborators!inner(role)';

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  membership: { role: string }[];
};

export type ProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  role: 'admin' | 'editor' | 'viewer';
  canRead: true;
  canWrite: boolean;
};

function summary(row: ProjectRow): ProjectSummary {
  const role = row.membership?.[0]?.role;
  if (role !== 'admin' && role !== 'editor' && role !== 'viewer') {
    throw new Error('Invalid project membership role.');
  }
  return {
    id: row.id,
    name: row.name.slice(0, 120),
    description: row.description?.slice(0, 240) ?? null,
    role,
    canRead: true,
    canWrite: role !== 'viewer',
  };
}

function accessibleProjects(supabase: SupabaseClient, userId: string) {
  return supabase.from('projects').select(summaryColumns)
    .eq('membership.user_id', userId)
    .not('membership.accepted_at', 'is', null);
}

export async function listAccountProjects(
  supabase: SupabaseClient,
  userId: string,
  input: { cursor?: string; limit?: number }
): Promise<{ projects: ProjectSummary[]; nextCursor: string | null }> {
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));
  let query = accessibleProjects(supabase, userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (input.cursor) {
    let cursor: z.infer<typeof cursorSchema>;
    try {
      cursor = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')));
    } catch {
      throw new Error('INVALID_CURSOR');
    }
    query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as ProjectRow[];
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    projects: page.map(summary),
    nextCursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString('base64url')
      : null,
  };
}

export async function findAccessibleProject(
  supabase: SupabaseClient,
  userId: string,
  input: { projectId?: string; projectName?: string }
): Promise<{ project?: ProjectSummary; candidates?: ProjectSummary[] }> {
  if (input.projectId) {
    const { data, error } = await accessibleProjects(supabase, userId)
      .eq('id', input.projectId).limit(1);
    if (error) throw error;
    return { project: data?.[0] ? summary(data[0] as unknown as ProjectRow) : undefined };
  }
  const name = input.projectName!.trim();
  const escaped = name.replace(/[\\%_]/g, '\\$&');
  const { data, error } = await accessibleProjects(supabase, userId)
    .ilike('name', escaped)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(51);
  if (error) throw error;
  const matches = ((data ?? []) as unknown as ProjectRow[])
    .filter((row) => row.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
  if (matches.length > 1) return { candidates: matches.slice(0, 50).map(summary) };
  return { project: matches[0] ? summary(matches[0]) : undefined };
}

export async function createAccountProject(
  supabase: SupabaseClient,
  input: { name: string; description?: string; idempotencyKey: string }
): Promise<{ projectId: string; defaultFolderId: string }> {
  const { data, error } = await supabase.rpc('create_project_with_default_resource_idempotent', {
    p_name: input.name.trim(),
    p_description: input.description?.trim() || null,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    if (error.code === 'KM409' || error.message?.includes('IDEMPOTENCY_CONFLICT')) {
      throw new Error('IDEMPOTENCY_CONFLICT');
    }
    throw error;
  }
  const result = Array.isArray(data) ? data[0] : data;
  const parsed = z.object({ project_id: uuid, folder_id: uuid }).safeParse(result);
  if (!parsed.success) throw new Error('Invalid project creation response.');
  return { projectId: parsed.data.project_id, defaultFolderId: parsed.data.folder_id };
}
