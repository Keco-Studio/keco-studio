import type { StoryPlanProgressEvent as ImportProgressEvent } from '@/lib/story-plan/conversion';
import type { AgentTool, ToolContext, ToolResult } from './types';
import { ProjectContextRequiredError } from './workspace';

export async function* executeAgentTool(
  tool: AgentTool,
  params: unknown,
  ctx: ToolContext
): AsyncGenerator<ImportProgressEvent, ToolResult> {
  try {
    if (!tool.executeStream) return await tool.execute(params, ctx);

    const iterator = tool.executeStream(params, ctx);
    while (true) {
      const step = await iterator.next();
      if (step.done === true) return step.value as ToolResult;
      yield step.value as ImportProgressEvent;
    }
  } catch (error) {
    if (error instanceof ProjectContextRequiredError) {
      return { success: false, error: `${error.code}: ${error.message}` };
    }
    throw error;
  }
}
