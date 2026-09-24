import type { AgentWorkspace, ToolContext } from './types';

export const AGENT_WORKSPACES = [
  'projects',
  'studio',
  'script',
  'create-map',
  'game-design-systems',
] as const;

export function isAgentWorkspace(value: unknown): value is AgentWorkspace {
  return typeof value === 'string' && AGENT_WORKSPACES.includes(value as AgentWorkspace);
}

export function workspaceAllowsAccountScope(workspace: AgentWorkspace): boolean {
  return workspace !== 'studio';
}

export class ProjectContextRequiredError extends Error {
  readonly code = 'PROJECT_CONTEXT_REQUIRED';
}

export function requireProjectContext(ctx: ToolContext): string {
  if (!ctx.projectId) throw new ProjectContextRequiredError('Select a project before using this operation.');
  return ctx.projectId;
}
