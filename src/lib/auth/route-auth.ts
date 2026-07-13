import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/createSupabaseServerClient';
import {
  AuthorizationError,
  getUserProjectRole,
} from '@/lib/services/authorizationService';
import type { CollaboratorRole } from '@/lib/types/collaboration';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export interface AuthedRequest {
  supabase: SupabaseClient;
  user: User;
}

export async function authenticate(
  request: Request
): Promise<AuthedRequest | NextResponse> {
  const authHeader = request.headers.get('authorization');
  const supabase = authHeader
    ? createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : createSupabaseServerClient(request);

  const {
    data: { user },
    error: authError,
  } = authHeader
    ? await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
    : await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: 'Please sign in to continue' },
      { status: 401 }
    );
  }

  return { supabase, user };
}

type ProjectRoleRequirement<Context> = {
  projectId:
    | string
    | ((request: Request, context: Context) => string | Promise<string>);
  allowedRoles: readonly CollaboratorRole[];
};

type WithAuthOptions<Context> = {
  requireProjectRole?: ProjectRoleRequirement<Context>;
  unauthorizedResponse?: () => NextResponse;
  forbiddenResponse?: () => NextResponse;
};

type AuthedRouteHandler<Context, RequestType extends Request> = (
  request: RequestType,
  context: Context,
  auth: AuthedRequest
) => Response | Promise<Response>;

export function withAuth<Context = undefined, RequestType extends Request = Request>(
  handler: AuthedRouteHandler<Context, RequestType>,
  options: WithAuthOptions<Context> = {}
) {
  return async (request: RequestType, context: Context): Promise<Response> => {
    const auth = await authenticate(request);
    if (auth instanceof NextResponse) {
      return options.unauthorizedResponse?.() ?? auth;
    }

    const requirement = options.requireProjectRole;
    if (requirement) {
      const projectId = typeof requirement.projectId === 'function'
        ? await requirement.projectId(request, context)
        : requirement.projectId;

      try {
        const { role } = await getUserProjectRole(
          auth.supabase,
          projectId,
          auth.user.id
        );
        if (!requirement.allowedRoles.includes(role)) {
          return options.forbiddenResponse?.() ?? NextResponse.json(
            { error: 'Forbidden' },
            { status: 403 }
          );
        }
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return options.forbiddenResponse?.() ?? NextResponse.json(
            { error: 'Forbidden' },
            { status: 403 }
          );
        }
        throw error;
      }
    }

    return handler(request, context, auth);
  };
}
