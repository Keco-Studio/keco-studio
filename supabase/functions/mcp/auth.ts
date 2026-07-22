import { createClient } from "@supabase/supabase-js";

export type ProjectRole = "admin" | "editor" | "viewer";
export type ProjectAuthContext = {
  userId: string;
  projectId: string;
  role: ProjectRole;
  clientId: string | null;
  bearerToken: string;
};
export type ProjectAuthorization =
  | { status: "authorized"; context: ProjectAuthContext }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "operational_error" };

export interface AuthGateway {
  getUser(
    token: string,
  ): Promise<{ id: string; clientId?: string | null } | null>;
  hasOAuthProjectGrant(
    clientId: string,
    projectId: string,
    resource: string,
    token: string,
  ): Promise<boolean>;
  getProjectOwner(projectId: string, token: string): Promise<string | null>;
  getCollaboratorRole(
    userId: string,
    projectId: string,
    token: string,
  ): Promise<ProjectRole | null>;
}

const INVALID_CREDENTIAL_CODES = new Set([
  "bad_jwt",
  "invalid_jwt",
  "no_authorization",
  "session_expired",
  "session_not_found",
  "user_not_found",
]);

const MCP_PATH = /^(?:\/functions\/v1)?\/mcp\/([^/]+)$/;

/**
 * Supabase's Edge gateway invokes this function at `/mcp/{projectId}`, while
 * OAuth grants are bound to the public `/functions/v1/mcp/{projectId}` URL.
 */
export function canonicalProjectResource(
  requestUrl: string,
  projectId: string,
): string | null {
  try {
    const url = new URL(requestUrl);
    const match = MCP_PATH.exec(url.pathname);
    if (
      !match ||
      match[1] !== projectId ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return `${url.origin}/functions/v1/mcp/${projectId}`;
  } catch {
    return null;
  }
}

function verifiedClientId(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const padding = "=".repeat((4 - payload.length % 4) % 4);
    const decoded = JSON.parse(atob(
      payload.replaceAll("-", "+").replaceAll("_", "/") + padding,
    ));
    const candidate = decoded?.client_id;
    return typeof candidate === "string" && candidate.length >= 1 &&
        candidate.length <= 256
      ? candidate
      : null;
  } catch {
    return null;
  }
}

export function isInvalidCredentialError(error: {
  status?: number;
  code?: string;
  name?: string;
}): boolean {
  return error.status === 401 || error.status === 403 ||
    INVALID_CREDENTIAL_CODES.has(error.code ?? "") ||
    error.name === "AuthInvalidJwtError" ||
    error.name === "AuthSessionMissingError";
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
  try {
    const user = await gateway.getUser(token);
    if (!user) return { status: "unauthenticated" };
    const clientId = user.clientId ?? null;
    if (!clientId) return { status: "forbidden" };
    const resource = canonicalProjectResource(request.url, projectId);
    if (!resource) return { status: "forbidden" };
    const hasGrant = await gateway.hasOAuthProjectGrant(
      clientId,
      projectId,
      resource,
      token,
    );
    if (!hasGrant) return { status: "forbidden" };
    const ownerId = await gateway.getProjectOwner(projectId, token);
    const role = ownerId === user.id
      ? "admin"
      : await gateway.getCollaboratorRole(user.id, projectId, token);
    return role
      ? {
        status: "authorized",
        context: {
          userId: user.id,
          projectId,
          role,
          clientId,
          bearerToken: token,
        },
      }
      : { status: "forbidden" };
  } catch {
    return { status: "operational_error" };
  }
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
      if (error) {
        if (isInvalidCredentialError(error)) return null;
        throw new Error("Supabase user lookup failed.");
      }
      return data.user
        ? { id: data.user.id, clientId: verifiedClientId(token) }
        : null;
    },
    async hasOAuthProjectGrant(clientId, projectId, resource, token) {
      const client = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      });
      const { data, error } = await client.rpc("has_oauth_project_grant", {
        p_client_id: clientId,
        p_project_id: projectId,
        p_resource: resource,
      });
      if (error) throw new Error("Supabase OAuth grant lookup failed.");
      return data === true;
    },
    async getProjectOwner(projectId, token) {
      const client = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      });
      const { data: project, error: projectError } = await client
        .from("projects").select("owner_id").eq("id", projectId).maybeSingle();
      if (projectError) throw new Error("Supabase project lookup failed.");
      return typeof project?.owner_id === "string" ? project.owner_id : null;
    },
    async getCollaboratorRole(userId, projectId, token) {
      const client = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      });
      const { data: collaborator, error: collaboratorError } = await client
        .from("project_collaborators").select("role").eq(
          "project_id",
          projectId,
        )
        .eq("user_id", userId).not("accepted_at", "is", null).maybeSingle();
      if (collaboratorError) {
        throw new Error("Supabase collaborator lookup failed.");
      }
      return collaborator?.role === "admin" ||
          collaborator?.role === "editor" || collaborator?.role === "viewer"
        ? collaborator.role
        : null;
    },
  };
}

export async function authorizeProject(
  request: Request,
  projectId: string,
): Promise<ProjectAuthorization> {
  try {
    return await authorizeProjectWithGateway(
      request,
      projectId,
      supabaseGateway(),
    );
  } catch {
    return { status: "operational_error" };
  }
}
