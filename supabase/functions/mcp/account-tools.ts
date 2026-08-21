import type { McpServer } from "@mcp/server/mcp.js";
import { z } from "zod";
import {
  accountHasWritableProject,
  authorizeAccountProject,
  listAccessibleProjects,
} from "./account-projects.ts";
import type { AccountMcpRequestContext } from "./context.ts";
import { registerAccountReadTools } from "./read-tools.ts";
import { toolFailure, toolSuccess } from "./results.ts";
import { registerAccountWriteTools } from "./write-tools.ts";

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export async function registerAccountTools(
  server: McpServer,
  context: AccountMcpRequestContext,
): Promise<boolean> {
  const listProjectsSchema = z.object({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(4096).optional(),
  }).strict();
  server.registerTool("list_projects", {
    description:
      "List a deterministic bounded page of projects accessible to this account.",
    inputSchema: listProjectsSchema,
    annotations: readAnnotations,
  }, async (input: z.infer<typeof listProjectsSchema>) => {
    try {
      const page = await listAccessibleProjects(context, input);
      return toolSuccess("Projects loaded.", { ok: true, ...page });
    } catch (error) {
      return toolFailure(error);
    }
  });

  registerAccountReadTools(
    server,
    (projectId) => authorizeAccountProject(context, projectId, "read"),
  );
  let hasWritableProject = false;
  try {
    hasWritableProject = await accountHasWritableProject(context);
  } catch {
    // A discovery failure must not remove the account's safe tool surface.
  }
  if (hasWritableProject) {
    registerAccountWriteTools(
      server,
      (projectId) => authorizeAccountProject(context, projectId, "write"),
    );
  }
  return hasWritableProject;
}
