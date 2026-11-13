import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const uuidSchema = z.string().uuid();
const nullableUuidSchema = uuidSchema.nullable();
const stateSchema = z.object({
  id: uuidSchema,
  claimed: z.boolean(),
  status: z.enum(['running', 'completed', 'failed']),
  project_id: nullableUuidSchema,
  default_folder_id: nullableUuidSchema,
  design_system_id: nullableUuidSchema,
}).strict();

export type TemplateInstantiationClaim = {
  id: string;
  claimed: boolean;
  status: 'running' | 'completed' | 'failed';
  projectId: string | null;
  defaultFolderId: string | null;
  designSystemId: string | null;
};

type StateInput = {
  instantiationId: string;
  ownerId: string;
};

function parseState(value: unknown): TemplateInstantiationClaim {
  const rows = Array.isArray(value) ? value : [];
  const parsed = rows.length === 1 ? stateSchema.safeParse(rows[0]) : null;
  if (!parsed?.success) throw new Error('Invalid project template instantiation response');
  return {
    id: parsed.data.id,
    claimed: parsed.data.claimed,
    status: parsed.data.status,
    projectId: parsed.data.project_id,
    defaultFolderId: parsed.data.default_folder_id,
    designSystemId: parsed.data.design_system_id,
  };
}

async function callStateRpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<TemplateInstantiationClaim> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return parseState(data);
}

export async function claimProjectTemplateInstantiation(
  serviceClient: SupabaseClient,
  input: {
    ownerId: string;
    requestId: string;
    templateKey: string;
    templateVersion: number;
  },
): Promise<TemplateInstantiationClaim> {
  return callStateRpc(serviceClient, 'claim_project_template_instantiation', {
    p_owner_id: input.ownerId,
    p_request_id: input.requestId,
    p_template_key: input.templateKey,
    p_template_version: input.templateVersion,
  });
}

export async function checkpointProjectTemplateInstantiation(
  serviceClient: SupabaseClient,
  input: StateInput & {
    projectId?: string;
    defaultFolderId?: string;
    designSystemId?: string;
  },
): Promise<TemplateInstantiationClaim> {
  return callStateRpc(serviceClient, 'checkpoint_project_template_instantiation', {
    p_instantiation_id: input.instantiationId,
    p_owner_id: input.ownerId,
    p_project_id: input.projectId ?? null,
    p_default_folder_id: input.defaultFolderId ?? null,
    p_design_system_id: input.designSystemId ?? null,
  });
}

export async function completeProjectTemplateInstantiation(
  serviceClient: SupabaseClient,
  input: StateInput & {
    projectId: string;
    defaultFolderId: string;
    designSystemId: string;
  },
): Promise<TemplateInstantiationClaim> {
  return callStateRpc(serviceClient, 'complete_project_template_instantiation', {
    p_instantiation_id: input.instantiationId,
    p_owner_id: input.ownerId,
    p_project_id: input.projectId,
    p_default_folder_id: input.defaultFolderId,
    p_design_system_id: input.designSystemId,
  });
}

export async function failProjectTemplateInstantiation(
  serviceClient: SupabaseClient,
  input: StateInput & { errorCode: string },
): Promise<TemplateInstantiationClaim> {
  return callStateRpc(serviceClient, 'fail_project_template_instantiation', {
    p_instantiation_id: input.instantiationId,
    p_owner_id: input.ownerId,
    p_error_code: input.errorCode,
  });
}

export async function cleanupProjectTemplateInstantiation(
  serviceClient: SupabaseClient,
  input: StateInput & { errorCode: string },
): Promise<{ cleanupJobIds: string[] }> {
  const { data, error } = await serviceClient.rpc('cleanup_project_template_instantiation', {
    p_instantiation_id: input.instantiationId,
    p_owner_id: input.ownerId,
    p_error_code: input.errorCode,
  });
  if (error) throw error;
  const parsed = z.array(z.object({ cleanup_job_id: uuidSchema }).strict()).safeParse(data);
  if (!parsed.success) throw new Error('Invalid project template cleanup response');
  return { cleanupJobIds: parsed.data.map((row) => row.cleanup_job_id) };
}
