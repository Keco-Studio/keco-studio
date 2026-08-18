import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { compileGameArtStyle } from '@/lib/game-art-style/compiler';
import {
  createGameDesignSystemVersionRequestSchema,
  type CreateGameDesignSystemVersionRequest,
} from '@/lib/game-design-system/versionRequest';
import {
  buildCompatibilityGameDesignDocument,
  parseGameDesignDocument,
  parseRuleSet,
} from '@/lib/game-design-system/ruleSchema';
import { findReintroducedRuleIds } from '@/lib/game-design-system/ruleDiff';
import {
  createVersionDiff,
} from '@/lib/game-design-system/versionDiff';
import {
  GAME_DESIGN_SYSTEM_VERSION_PLACEHOLDER,
  renderRuleSetMarkdown,
} from '@/lib/game-design-system/ruleMarkdown';
import {
  hydrateGameDesignSystemVersionRow,
  type GameDesignSystemVersion,
} from './gameDesignSystemService';

const SYSTEM_WRITE_COLUMNS = 'id,owner_id,source,title,summary,current_version_id';
const VERSION_WRITE_COLUMNS = 'id,system_id,version_number,parent_version_id,document,rules,rendered_markdown,source_snapshots,diff,conflicts,content_hash,created_by,created_at';

export type PublicGameDesignSystemVersionErrorCode =
  | 'VERSION_REQUEST_INVALID'
  | 'VERSION_SYSTEM_NOT_FOUND'
  | 'VERSION_FORBIDDEN'
  | 'VERSION_PARENT_INVALID'
  | 'VERSION_LINEAGE_INVALID'
  | 'VERSION_RULE_REINTRODUCED'
  | 'VERSION_NO_CHANGES'
  | 'VERSION_STALE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'VERSION_CREATE_FAILED';

const PUBLIC_ERROR_MESSAGES: Record<PublicGameDesignSystemVersionErrorCode, string> = {
  VERSION_REQUEST_INVALID: 'Invalid version request.',
  VERSION_SYSTEM_NOT_FOUND: 'Game Design System not found.',
  VERSION_FORBIDDEN: 'Only the owner can create a version.',
  VERSION_PARENT_INVALID: 'Parent version does not belong to this system.',
  VERSION_LINEAGE_INVALID: 'Version lineage is invalid.',
  VERSION_RULE_REINTRODUCED: 'Rule IDs cannot be reintroduced after deletion.',
  VERSION_NO_CHANGES: 'The version does not contain any changes.',
  VERSION_STALE: 'The Game Design System changed after this draft was opened.',
  IDEMPOTENCY_CONFLICT: 'Idempotency key was already used with a different payload.',
  VERSION_CREATE_FAILED: 'Version could not be created.',
};

export class PublicGameDesignSystemVersionError extends Error {
  readonly code: PublicGameDesignSystemVersionErrorCode;
  readonly publicMessage: string;
  readonly ruleIds?: string[];

  constructor(code: PublicGameDesignSystemVersionErrorCode, options?: { ruleIds?: string[] }) {
    const publicMessage = PUBLIC_ERROR_MESSAGES[code];
    super(publicMessage);
    this.name = 'PublicGameDesignSystemVersionError';
    this.code = code;
    this.publicMessage = publicMessage;
    this.ruleIds = options?.ruleIds;
  }
}

type PublicVersionWriteInput = {
  systemId: string;
  actorId: string;
  idempotencyKey: string;
  request: CreateGameDesignSystemVersionRequest;
};

type WriteSystemRow = {
  id: string;
  owner_id: string | null;
  source: string;
  title: string;
  summary: string | null;
  current_version_id: string | null;
};

type RawVersionWriteRow = Record<string, unknown> & {
  id: string;
  system_id: string;
  parent_version_id: string | null;
  document: unknown;
  rules: unknown;
  source_snapshots: unknown;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function hashCompleteVersion(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

async function loadWriteSystem(
  serviceClient: SupabaseClient,
  systemId: string,
): Promise<WriteSystemRow | null> {
  const { data, error } = await serviceClient
    .from('game_design_systems')
    .select(SYSTEM_WRITE_COLUMNS)
    .eq('id', systemId)
    .maybeSingle();
  if (error) throw new PublicGameDesignSystemVersionError('VERSION_CREATE_FAILED');
  return data as WriteSystemRow | null;
}

async function loadRawWriteVersion(
  serviceClient: SupabaseClient,
  versionId: string,
): Promise<RawVersionWriteRow | null> {
  const { data, error } = await serviceClient
    .from('game_design_system_versions')
    .select(VERSION_WRITE_COLUMNS)
    .eq('id', versionId)
    .maybeSingle();
  if (error) throw new PublicGameDesignSystemVersionError('VERSION_CREATE_FAILED');
  return data as RawVersionWriteRow | null;
}

async function loadRawArtStyle(
  serviceClient: SupabaseClient,
  versionId: string,
): Promise<unknown | null> {
  const { data, error } = await serviceClient
    .from('game_design_system_versions')
    .select('art_style')
    .eq('id', versionId)
    .maybeSingle();
  if (error) throw new PublicGameDesignSystemVersionError('VERSION_CREATE_FAILED');
  return data && typeof data === 'object' && 'art_style' in data
    ? (data as { art_style: unknown | null }).art_style
    : null;
}

async function loadAncestorRules(
  serviceClient: SupabaseClient,
  parent: RawVersionWriteRow,
) {
  const ancestors = [];
  const visited = new Set([parent.id]);
  let ancestorId = parent.parent_version_id;
  while (ancestorId) {
    if (visited.has(ancestorId)) {
      throw new PublicGameDesignSystemVersionError('VERSION_LINEAGE_INVALID');
    }
    visited.add(ancestorId);
    const ancestor = await loadRawWriteVersion(serviceClient, ancestorId);
    if (!ancestor) throw new PublicGameDesignSystemVersionError('VERSION_LINEAGE_INVALID');
    try {
      ancestors.push(parseRuleSet(ancestor.rules));
    } catch {
      throw new PublicGameDesignSystemVersionError('VERSION_LINEAGE_INVALID');
    }
    ancestorId = ancestor.parent_version_id;
  }
  return ancestors;
}

function mapRpcError(error: { code?: string; message?: string } | null) {
  const message = error?.message ?? '';
  if (message.includes('IDEMPOTENCY_CONFLICT')) {
    return new PublicGameDesignSystemVersionError('IDEMPOTENCY_CONFLICT');
  }
  if (message.includes('VERSION_NO_CHANGES')) {
    return new PublicGameDesignSystemVersionError('VERSION_NO_CHANGES');
  }
  if (message.includes('VERSION_STALE')) {
    return new PublicGameDesignSystemVersionError('VERSION_STALE');
  }
  return new PublicGameDesignSystemVersionError('VERSION_CREATE_FAILED');
}

export async function createPublicGameDesignSystemVersion(
  serviceClient: SupabaseClient,
  input: PublicVersionWriteInput,
): Promise<GameDesignSystemVersion> {
  const parsedRequest = createGameDesignSystemVersionRequestSchema.safeParse(input.request);
  if (!parsedRequest.success) {
    throw new PublicGameDesignSystemVersionError('VERSION_REQUEST_INVALID');
  }
  const request = parsedRequest.data;
  const system = await loadWriteSystem(serviceClient, input.systemId);
  if (!system) throw new PublicGameDesignSystemVersionError('VERSION_SYSTEM_NOT_FOUND');
  if (system.source !== 'user' || system.owner_id !== input.actorId) {
    throw new PublicGameDesignSystemVersionError('VERSION_FORBIDDEN');
  }

  const parent = await loadRawWriteVersion(serviceClient, request.parentVersionId);
  if (!parent || parent.system_id !== input.systemId) {
    throw new PublicGameDesignSystemVersionError('VERSION_PARENT_INVALID');
  }

  let parentRules;
  let parentDocument;
  try {
    parentRules = parseRuleSet(parent.rules);
    parentDocument = parent.document == null
      ? buildCompatibilityGameDesignDocument(parentRules, system)
      : parseGameDesignDocument(parent.document);
  } catch {
    throw new PublicGameDesignSystemVersionError('VERSION_PARENT_INVALID');
  }

  const document = request.document === undefined
    ? parentDocument
    : parseGameDesignDocument(request.document);
  const rules = request.rules === undefined
    ? parentRules
    : parseRuleSet(request.rules);
  const inheritArtStyle = request.artStyle === undefined;
  const artStyleJson = inheritArtStyle
    ? null
    : request.artStyle === null
      ? null
      : compileGameArtStyle(request.artStyle);
  const parentArtStyle = inheritArtStyle ? null : await loadRawArtStyle(serviceClient, parent.id);

  if (request.rules !== undefined) {
    const ancestors = await loadAncestorRules(serviceClient, parent);
    const reintroduced = findReintroducedRuleIds(parentRules, rules, ancestors);
    if (reintroduced.length > 0) {
      throw new PublicGameDesignSystemVersionError('VERSION_RULE_REINTRODUCED', {
        ruleIds: reintroduced,
      });
    }
  }

  const diff = createVersionDiff(
    { document: parentDocument, rules: parentRules, artStyle: parentArtStyle },
    { document, rules, artStyle: artStyleJson },
  );
  const renderedMarkdown = renderRuleSetMarkdown(rules, {
    title: system.title,
    version: GAME_DESIGN_SYSTEM_VERSION_PLACEHOLDER,
    document,
  });
  const { data, error } = await serviceClient.rpc('create_game_design_system_version', {
    p_system_id: input.systemId,
    p_parent_version_id: parent.id,
    p_document: document,
    p_art_style: artStyleJson,
    p_inherit_art_style: inheritArtStyle,
    p_rules: rules,
    p_rendered_markdown: renderedMarkdown,
    p_source_snapshots: parent.source_snapshots ?? [],
    p_diff: diff,
    p_conflicts: diff.conflicts,
    p_content_hash: hashCompleteVersion({ document, rules, artStyle: artStyleJson }),
    p_created_by: input.actorId,
    p_generation_job_id: null,
    p_expected_current_version_id: request.expectedCurrentVersionId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throw mapRpcError(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new PublicGameDesignSystemVersionError('VERSION_CREATE_FAILED');
  return hydrateGameDesignSystemVersionRow(
    row as Record<string, unknown>,
    { title: system.title, summary: system.summary },
    diff,
  );
}
