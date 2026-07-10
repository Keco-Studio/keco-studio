import type { ImportProgressEvent } from '@/lib/story-ir/schema';
import type { AgentTool, ToolContext, ToolResult } from './types';

export async function* executeAgentTool(
  tool: AgentTool,
  params: unknown,
  ctx: ToolContext
): AsyncGenerator<ImportProgressEvent, ToolResult> {
  if (!tool.executeStream) return await tool.execute(params, ctx);

  const iterator = tool.executeStream(params, ctx);
  while (true) {
    const step = await iterator.next();
    if (step.done === true) return step.value as ToolResult;
    yield step.value as ImportProgressEvent;
  }
}
