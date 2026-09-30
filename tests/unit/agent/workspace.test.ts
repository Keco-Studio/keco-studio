import {
  AGENT_WORKSPACES,
  isAgentWorkspace,
  ProjectContextRequiredError,
  requireProjectContext,
  workspaceAllowsAccountScope,
} from '../../../src/lib/agent/workspace';
import type { ToolContext } from '../../../src/lib/agent/types';

describe('agent workspaces', () => {
  it.each([
    ['projects', true],
    ['studio', false],
    ['script', true],
    ['create-map', true],
    ['game-design-systems', true],
  ] as const)('%s account capability is %s', (workspace, expected) => {
    expect(workspaceAllowsAccountScope(workspace)).toBe(expected);
  });

  it('validates exactly the supported workspace values', () => {
    for (const workspace of AGENT_WORKSPACES) expect(isAgentWorkspace(workspace)).toBe(true);
    expect(isAgentWorkspace('other')).toBe(false);
    expect(isAgentWorkspace(null)).toBe(false);
  });

  it('requires a project only when a project tool asks for one', () => {
    const ctx = { workspace: 'script' } as ToolContext;
    expect(() => requireProjectContext(ctx)).toThrow(ProjectContextRequiredError);
    expect(() => requireProjectContext(ctx)).toThrow('Select a project before using this operation.');
    try {
      requireProjectContext(ctx);
    } catch (error) {
      expect(error).toHaveProperty('code', 'PROJECT_CONTEXT_REQUIRED');
    }
    ctx.projectId = 'project-1';
    expect(requireProjectContext(ctx)).toBe('project-1');
  });
});
