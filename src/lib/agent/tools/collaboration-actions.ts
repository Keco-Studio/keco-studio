import type { AgentTool } from '../types';

const projectId = { type: 'string', format: 'uuid' };
const collaboratorId = { type: 'string', format: 'uuid' };
const role = { type: 'string', enum: ['admin', 'editor', 'viewer'] };

export const listProjectCollaboratorsTool: AgentTool = {
  name: 'list_project_collaborators',
  description: 'List up to 50 accepted collaborators and, for admins, pending invitations for the current project. Returns exact IDs.',
  category: 'read', confirmationMode: 'pre_execute',
  parameters: { type: 'object', additionalProperties: false,
    properties: { projectId, limit: { type: 'integer', minimum: 1, maximum: 50 },
      offset: { type: 'integer', minimum: 0 } }, required: ['projectId'] },
  async execute(params, ctx) {
    const { listCollaborators } = await import('../collaboration-tool-service');
    return listCollaborators(ctx, params);
  },
};

export const inviteProjectCollaboratorTool: AgentTool = {
  name: 'invite_project_collaborator',
  description: 'Invite an exact registered email to the current project. Admins may grant any role; editors may grant editor/viewer. Sends an invitation email.',
  category: 'write', requiredPermission: 'editor', confirmationMode: 'pre_execute',
  parameters: { type: 'object', additionalProperties: false,
    properties: { projectId, recipientEmail: { type: 'string', format: 'email' }, role },
    required: ['projectId', 'recipientEmail', 'role'] },
  async execute(params, ctx) {
    const { inviteCollaborator } = await import('../collaboration-tool-service');
    return inviteCollaborator(ctx, params);
  },
};

export const changeProjectCollaboratorRoleTool: AgentTool = {
  name: 'change_project_collaborator_role',
  description: 'Change the role of an exact project collaborator after mandatory confirmation. Admins only; rejects stale role changes.',
  category: 'write', requiredPermission: 'admin', confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false,
    properties: { projectId, collaboratorId, newRole: role },
    required: ['projectId', 'collaboratorId', 'newRole'] },
  async prepareConfirmation(params, ctx) {
    const { prepareRoleChange, preparationFailure } = await import('../collaboration-tool-service');
    try { return { success: true, ...await prepareRoleChange(ctx, params) }; }
    catch (error) { return preparationFailure(error); }
  },
  async execute(params, ctx) {
    const { changeCollaboratorRole } = await import('../collaboration-tool-service');
    return changeCollaboratorRole(ctx, params);
  },
};

export const removeProjectCollaboratorTool: AgentTool = {
  name: 'remove_project_collaborator',
  description: 'Remove an exact project collaborator after mandatory confirmation. Admins only; rejects stale target changes.',
  category: 'write', requiredPermission: 'admin', confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false,
    properties: { projectId, collaboratorId }, required: ['projectId', 'collaboratorId'] },
  async prepareConfirmation(params, ctx) {
    const { prepareRemoval, preparationFailure } = await import('../collaboration-tool-service');
    try { return { success: true, ...await prepareRemoval(ctx, params) }; }
    catch (error) { return preparationFailure(error); }
  },
  async execute(params, ctx) {
    const { removeCollaborator } = await import('../collaboration-tool-service');
    return removeCollaborator(ctx, params);
  },
};
