import type { SupabaseClient } from '@supabase/supabase-js';
import { createVersionDiff } from '@/lib/game-design-system/versionDiff';
import { GAME_DESIGN_SYSTEM_VERSION_PLACEHOLDER, renderRuleSetMarkdown } from '@/lib/game-design-system/ruleMarkdown';
import {
  hydrateGameDesignSystemVersionRow, IdempotencyConflictError,
  type GameDesignSystem,
} from '@/lib/services/gameDesignSystemService';

export class CopyOutputDeletedError extends Error {
  constructor() {
    super('The copied Game Design System was deleted; use a new idempotency key.');
  }
}

export async function copyAgentGameDesignSystem(
  service: SupabaseClient,
  source: GameDesignSystem,
  actorId: string,
  idempotencyKey: string,
): Promise<GameDesignSystem> {
  if (!source.current_version_id) throw new Error('Source system has no readable version.');
  const { data, error: readError } = await service.from('game_design_system_versions')
    .select('id,system_id,version_number,parent_version_id,document,rules,art_style,rendered_markdown,source_snapshots,diff,conflicts,content_hash,created_by,created_at')
    .eq('id', source.current_version_id).eq('system_id', source.id).maybeSingle();
  if (readError) throw readError;
  const version = data ? hydrateGameDesignSystemVersionRow(data, {
    title: source.title, summary: source.summary,
  }) : null;
  if (!version || version.system_id !== source.id || !source.current_version_id) {
    throw new Error('Source system has no readable version.');
  }

  const title = `${source.title} (Copy)`;
  const rendered = renderRuleSetMarkdown(version.rules, {
    title, version: GAME_DESIGN_SYSTEM_VERSION_PLACEHOLDER, document: version.document,
  });
  const diff = createVersionDiff(
    { document: version.document, rules: version.rules, artStyle: version.artStyle },
    { document: version.document, rules: version.rules, artStyle: version.artStyle },
  );
  const { data: copiedData, error } = await service.rpc('copy_agent_game_design_system', {
    p_actor_id: actorId,
    p_idempotency_key: idempotencyKey,
    p_source_system_id: source.id,
    p_expected_version_id: source.current_version_id,
    p_expected_updated_at: source.updated_at,
    p_document: version.document,
    p_rendered_markdown: rendered,
    p_diff: diff,
  });
  if (error?.message?.includes('IDEMPOTENCY_CONFLICT')) throw new IdempotencyConflictError();
  if (error?.message?.includes('IDEMPOTENCY_OUTPUT_DELETED')) {
    throw new CopyOutputDeletedError();
  }
  if (error) throw error;
  const row = Array.isArray(copiedData) ? copiedData[0] : copiedData;
  if (!row) throw new Error('Game Design System copy returned no row.');
  return row as GameDesignSystem;
}
