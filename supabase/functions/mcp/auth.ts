import { createClient } from "@supabase/supabase-js";

export type ProjectRole = "admin" | "editor" | "viewer";
export type ProjectAuthContext = {
  userId: string;
  projectId: string;
  role: ProjectRole;
};
export type ProjectAuthorization =
  | { status: "authorized"; context: ProjectAuthContext }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export interface AuthGateway {
  getUser(token: string): Promise<{ id: string } | null>;
  getRole(
    userId: string,
    projectId: string,
    token: string,
  ): Promise<ProjectRole | null>;
}

export async function authorizeProjectWithGateway(
  request: Request,
  projectId: string,
  gateway: AuthGateway,
): Promise<ProjectAuthorization> {
  const match = /^Bearer\s+(.+)$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match) return { status: "unauthenticated" };
  const token = match[1];
  const user = await gateway.getUser(token);
  if (!user) return { status: "unauthenticated" };
  const role = await gateway.getRole(user.id, projectId, token);
  return role
    ? {
      status: "authorized",
      context: { userId: user.id, projectId, role },
    }
    : { status: "forbidden" };
}

function supabaseGateway(): AuthGateway {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new Error("Supabase MCP auth environment is incomplete.");
  }
  return {
    async getUser(token) {
      const client = createClient(url, anonKey, {
        auth: { persistSession: false },
      });
      const { data, error } = await client.auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },
    async getRole(userId, projectId, token) {
      const client = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      });
      const { data: project, error: projectError } = await client
        .from("projects").select("owner_id").eq("id", projectId).maybeSingle();
      if (projectError) return null;
      if (project?.owner_id === userId) return "admin";
      const { data: collaborator, error: collaboratorError } = await client
        .from("project_collaborators").select("role").eq(
          "project_id",
          projectId,
        )
        .eq("user_id", userId).not("accepted_at", "is", null).maybeSingle();
      if (collaboratorError) return null;
      return collaborator?.role === "admin" ||
          collaborator?.role === "editor" || collaborator?.role === "viewer"
        ? collaborator.role
        : null;
    },
  };
}

export function authorizeProject(
  request: Request,
  projectId: string,
): Promise<ProjectAuthorization> {
  return authorizeProjectWithGateway(request, projectId, supabaseGateway());
}
