import 'server-only';

import { z } from 'zod';
import type { ToolContext, ToolResult } from './types';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { sendInvitation, CollaborationServiceError } from '@/lib/services/collaborationService';
import { normalizeEmail } from '@/lib/auth/emailIdentity';

const id = z.string().uuid();
const role = z.enum(['admin', 'editor', 'viewer']);
const scope = z.object({ projectId: id }).strict();
const inviteSchema = scope.extend({ recipientEmail: z.string().trim().email().max(320), role }).strict();
const targetSchema = scope.extend({ collaboratorId: id }).strict();
const changeSchema = targetSchema.extend({ newRole: role }).strict();
const sealedChange = changeSchema.extend({ expectedUserId: id, expectedRole: role,
  expectedUpdatedAt: z.string() }).strict();
const sealedRemove = targetSchema.extend({ expectedUserId: id, expectedRole: role,
  expectedUpdatedAt: z.string() }).strict();

function projectScope(ctx: ToolContext, projectId: string) {
  if (!ctx.userId || !ctx.projectId || ctx.projectId !== projectId) throw new Error('Project is outside this conversation.');
}

async function projectRole(ctx: ToolContext, projectId: string) {
  projectScope(ctx, projectId);
  const access = await getUserProjectRole(ctx.supabase, projectId, ctx.userId);
  return access.role;
}

async function admin(ctx: ToolContext, projectId: string) {
  if (await projectRole(ctx, projectId) !== 'admin') throw new Error('Only project admins can manage collaborators.');
}

function failed(error: unknown): ToolResult {
  const message = error instanceof CollaborationServiceError ? error.message
    : error instanceof Error && /^(Project is outside|Only project admins|Cannot change your own|Cannot remove yourself|Cannot change the last admin|Cannot remove the last admin|Collaborator not found|Collaborator changed|Invitation role is not allowed|Project not found)/.test(error.message)
      ? error.message : null;
  return { success: false, error: error instanceof z.ZodError ? 'Invalid collaborator parameters.'
    : message ?? 'Collaborator operation failed.' };
}

export async function listCollaborators(ctx: ToolContext, params: unknown): Promise<ToolResult> {
  try {
    const input = scope.extend({ limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).max(100_000).default(0) }).parse(params);
    const userRole = await projectRole(ctx, input.projectId);
    const collaboratorQuery = await ctx.supabase.from('project_collaborators')
      .select('id,user_id,role,invited_at,accepted_at,updated_at,profile:user_id(id,email,username,full_name)')
      .eq('project_id', input.projectId).not('accepted_at', 'is', null)
      .order('created_at', { ascending: true }).range(input.offset, input.offset + input.limit);
    if (collaboratorQuery.error) throw collaboratorQuery.error;
    const collaborators = (collaboratorQuery.data ?? []).slice(0, input.limit);
    let invitations: unknown[] = [];
    let invitationsHasMore = false;
    if (userRole === 'admin') {
      const result = await ctx.supabase.from('collaboration_invitations')
        .select('id,recipient_user_id,recipient_email,role,invited_by,sent_at,expires_at,updated_at')
        .eq('project_id', input.projectId).is('accepted_at', null)
        .order('sent_at', { ascending: false }).range(input.offset, input.offset + input.limit);
      if (result.error) throw result.error;
      invitationsHasMore = (result.data?.length ?? 0) > input.limit;
      invitations = (result.data ?? []).slice(0, input.limit);
    }
    return { success: true, displayHint: 'list', data: { projectId: input.projectId,
      collaborators, collaboratorsHasMore: (collaboratorQuery.data?.length ?? 0) > input.limit,
      pendingInvitations: invitations, invitationsHasMore,
      nextOffset: input.offset + input.limit } };
  } catch (error) { return failed(error); }
}

export async function inviteCollaborator(ctx: ToolContext, params: unknown): Promise<ToolResult> {
  try {
    const input = inviteSchema.parse(params);
    const actingRole = await projectRole(ctx, input.projectId);
    if (actingRole !== 'admin' && !(actingRole === 'editor' && input.role !== 'admin')) {
      throw new Error('Invitation role is not allowed for this project member.');
    }
    const project = await ctx.supabase.from('projects').select('id,name').eq('id', input.projectId).maybeSingle();
    if (project.error || !project.data) throw new Error('Project not found.');
    const profile = await ctx.supabase.from('profiles').select('username,full_name,email').eq('id', ctx.userId).maybeSingle();
    if (profile.error) throw profile.error;
    const inviter = profile.data;
    const email = normalizeEmail(input.recipientEmail);
    const invitationId = await sendInvitation(ctx.supabase, { projectId: input.projectId,
      recipientEmail: email, role: input.role }, ctx.userId,
    inviter?.username || inviter?.full_name || inviter?.email || 'A team member', project.data.name);
    return { success: true, displayHint: 'text', data: { projectId: input.projectId,
      invitationId, recipientEmail: email, role: input.role },
      invalidations: [{ type: 'project-collaborators', projectId: input.projectId }] };
  } catch (error) { return failed(error); }
}

async function collaborator(ctx: ToolContext, input: z.infer<typeof targetSchema>) {
  await admin(ctx, input.projectId);
  const { data, error } = await ctx.supabase.from('project_collaborators')
    .select('id,project_id,user_id,role,updated_at,accepted_at').eq('id', input.collaboratorId)
    .eq('project_id', input.projectId).maybeSingle();
  if (error || !data || !data.accepted_at) throw new Error('Collaborator not found in this project.');
  return data;
}

async function protectLastAdmin(ctx: ToolContext, projectId: string, currentRole: string, action: 'change' | 'remove') {
  if (currentRole !== 'admin') return;
  const { data, error } = await ctx.supabase.from('project_collaborators').select('id')
    .eq('project_id', projectId).eq('role', 'admin').not('accepted_at', 'is', null).limit(2);
  if (error || (data?.length ?? 0) <= 1) throw new Error(action === 'change'
    ? 'Cannot change the last admin. Promote another user first.'
    : 'Cannot remove the last admin. Promote another user first.');
}

export async function prepareRoleChange(ctx: ToolContext, params: unknown) {
  const input = changeSchema.parse(params);
  const current = await collaborator(ctx, input);
  if (current.user_id === ctx.userId) throw new Error('Cannot change your own role.');
  if (current.role === 'admin' && input.newRole !== 'admin') await protectLastAdmin(ctx, input.projectId, current.role, 'change');
  return { args: { ...input, expectedUserId: current.user_id, expectedRole: current.role,
    expectedUpdatedAt: current.updated_at },
    preview: { action: 'change_collaborator_role', projectId: input.projectId,
      collaboratorId: current.id, userId: current.user_id, previousRole: current.role,
      newRole: input.newRole } };
}

export async function changeCollaboratorRole(ctx: ToolContext, params: unknown): Promise<ToolResult> {
  try {
    const input = sealedChange.parse(params);
    const current = await collaborator(ctx, input);
    if (current.user_id !== input.expectedUserId || current.role !== input.expectedRole ||
        current.updated_at !== input.expectedUpdatedAt) throw new Error('Collaborator changed after approval. Request confirmation again.');
    if (current.user_id === ctx.userId) throw new Error('Cannot change your own role.');
    if (current.role === 'admin' && input.newRole !== 'admin') await protectLastAdmin(ctx, input.projectId, current.role, 'change');
    const { data, error } = await ctx.supabase.from('project_collaborators')
      .update({ role: input.newRole, updated_at: new Date().toISOString() })
      .eq('id', input.collaboratorId).eq('project_id', input.projectId)
      .eq('user_id', input.expectedUserId).eq('role', input.expectedRole)
      .eq('updated_at', input.expectedUpdatedAt).select('id,role,updated_at').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Collaborator changed after approval. Request confirmation again.');
    return { success: true, displayHint: 'text', data: { projectId: input.projectId,
      collaboratorId: input.collaboratorId, userId: input.expectedUserId,
      beforeRole: input.expectedRole, role: data.role, updatedAt: data.updated_at },
      invalidations: [{ type: 'project-collaborators', projectId: input.projectId }] };
  } catch (error) { return failed(error); }
}

export async function prepareRemoval(ctx: ToolContext, params: unknown) {
  const input = targetSchema.parse(params);
  const current = await collaborator(ctx, input);
  if (current.user_id === ctx.userId) throw new Error('Cannot remove yourself from the project.');
  await protectLastAdmin(ctx, input.projectId, current.role, 'remove');
  return { args: { ...input, expectedUserId: current.user_id, expectedRole: current.role,
    expectedUpdatedAt: current.updated_at },
    preview: { action: 'remove_collaborator', projectId: input.projectId,
      collaboratorId: current.id, userId: current.user_id, role: current.role,
      consequence: 'Remove this collaborator from the project.' } };
}

export async function removeCollaborator(ctx: ToolContext, params: unknown): Promise<ToolResult> {
  try {
    const input = sealedRemove.parse(params);
    const current = await collaborator(ctx, input);
    if (current.user_id !== input.expectedUserId || current.role !== input.expectedRole ||
        current.updated_at !== input.expectedUpdatedAt) throw new Error('Collaborator changed after approval. Request confirmation again.');
    if (current.user_id === ctx.userId) throw new Error('Cannot remove yourself from the project.');
    await protectLastAdmin(ctx, input.projectId, current.role, 'remove');
    const { data, error } = await ctx.supabase.from('project_collaborators').delete()
      .eq('id', input.collaboratorId).eq('project_id', input.projectId)
      .eq('user_id', input.expectedUserId).eq('role', input.expectedRole)
      .eq('updated_at', input.expectedUpdatedAt).select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Collaborator changed after approval. Request confirmation again.');
    return { success: true, displayHint: 'text', data: { projectId: input.projectId,
      collaboratorId: input.collaboratorId, userId: input.expectedUserId, removed: true },
      invalidations: [{ type: 'project-collaborators', projectId: input.projectId }] };
  } catch (error) { return failed(error); }
}

export function preparationFailure(error: unknown) {
  return { success: false as const, error: failed(error).error! };
}
