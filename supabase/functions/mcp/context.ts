import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ProjectAuthContext } from "./auth.ts";

export type McpRequestContext = Readonly<{
  requestId: string;
  userId: string;
  projectId: string;
  role: ProjectAuthContext["role"];
  clientId: string | null;
  bearerToken: string;
  supabase: SupabaseClient;
}>;

export type McpContextDependencies = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  requestId?: () => string;
  createSupabaseClient?: typeof createClient;
};

export function createMcpRequestContext(
  _request: Request,
  authContext: ProjectAuthContext,
  dependencies: McpContextDependencies = {},
): McpRequestContext {
  const supabaseUrl = dependencies.supabaseUrl ?? Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = dependencies.supabaseAnonKey ??
    Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase MCP request environment is incomplete.");
  }
  const clientFactory = dependencies.createSupabaseClient ?? createClient;
  const supabase = clientFactory(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: "Bearer " + authContext.bearerToken },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const requestId = dependencies.requestId
    ? dependencies.requestId()
    : crypto.randomUUID();
  const context = {
    requestId,
    userId: authContext.userId,
    projectId: authContext.projectId,
    role: authContext.role,
    clientId: authContext.clientId,
  } as McpRequestContext;
  Object.defineProperties(context, {
    bearerToken: {
      value: authContext.bearerToken,
      enumerable: false,
      writable: false,
      configurable: false,
    },
    supabase: {
      value: supabase,
      enumerable: false,
      writable: false,
      configurable: false,
    },
  });
  return Object.freeze(context);
}
