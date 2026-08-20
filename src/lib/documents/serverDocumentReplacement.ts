import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { documentContentCodec, mergeYjsState } from './documentContentCodec';
import { documentStateGateway } from './documentStateGateway';
import { DocumentAccessError, DocumentStateConflictError } from './documentStateTypes';
import { coerceSanctionedMdx } from './sanctionedMdx';

export async function replaceDialogueReference(
  serviceClient: SupabaseClient,
  input: {
    actorUserId: string;
    projectId: string;
    documentId: string;
    dialogueJobId: string;
    scriptLibraryId: string;
  },
): Promise<boolean> {
  const current = await documentStateGateway.read(serviceClient, input.documentId);
  if (current.projectId !== input.projectId) throw new DocumentAccessError();
  if (!current.yjsStateBase64) return false;

  const escapedJobId = input.dialogueJobId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const marker = new RegExp(`(^[ \\t]*- GDD dialogue job: ${escapedJobId}\\s*$\\n)[ \\t]*- Script: [^\\n]*`, 'm');
  if (!marker.test(current.markdown)) return false;
  const scriptHref = `/script-system/${encodeURIComponent(input.projectId)}/script/${encodeURIComponent(input.scriptLibraryId)}`;
  const replacementMarkdown = coerceSanctionedMdx(current.markdown.replace(
    marker,
    `$1  - Script: Completed - [Script](${scriptHref})`,
  ));
  const currentYjsState = mergeYjsState(
    current.yjsStateBase64,
    current.updateTail.map((update) => update.updateBase64),
  );
  const { data, error } = await serviceClient.rpc('replace_document_with_markdown', {
    p_document_id: input.documentId,
    p_actor_user_id: input.actorUserId,
    p_backup_version_id: randomUUID(),
    p_expected_epoch: current.token.epoch,
    p_expected_revision: current.token.revision,
    p_included_update_ids: current.updateTail.map((update) => update.id),
    p_current_yjs_state: currentYjsState,
    p_current_markdown: current.markdown,
    p_replacement_yjs_state: await documentContentCodec.markdownToYjsState(replacementMarkdown),
    p_replacement_markdown: replacementMarkdown,
  });
  if (error) {
    if (error.code === 'PT409') throw new DocumentStateConflictError(error.message, current.token);
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new DocumentAccessError('Dialogue reference replacement returned no state');
  return true;
}

type DialogueSnapshotReplacementInput = {
  actorUserId: string;
  projectId: string;
  documentId: string;
  dialogueJobId: string;
  chapterKey: string;
  chapterTitle: string;
  snapshotMarkdown: string;
};

function normalizeChapter(value: string): string {
  return value.toLocaleLowerCase().replace(/[`*_#[\]()-]/g, '').replace(/\s+/g, ' ').trim();
}

function headingMatches(heading: string, chapterKey: string, chapterTitle: string): boolean {
  const normalized = normalizeChapter(heading.replace(/\s+#+\s*$/, ''));
  const key = normalizeChapter(chapterKey);
  const title = normalizeChapter(chapterTitle);
  if (!normalized) return false;
  if (key && normalized === key) return true;
  if (title && normalized === title) return true;
  // Soft match: "### 2. Opening dialogue" vs title "Opening dialogue" / key "opening-dialogue".
  if (title && title.length >= 2 && (normalized.includes(title) || title.includes(normalized))) {
    return true;
  }
  if (key && key.length >= 2 && (normalized.includes(key) || key.includes(normalized))) {
    return true;
  }
  return false;
}

function removeSnapshotForJob(markdown: string, dialogueJobId: string): string {
  const escaped = dialogueJobId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutLegacy = markdown.replace(
    new RegExp(`^[ \\t]*<!--\\s*KECO_GDD_DIALOGUE_SNAPSHOT\\b[\\s\\S]*?dialogueJobId=["']${escaped}["'][\\s\\S]*?<!--\\s*/KECO_GDD_DIALOGUE_SNAPSHOT\\s*-->[ \\t]*\\n?`, 'gmi'),
    '',
  );
  return withoutLegacy.replace(
    new RegExp(`^[ \\t]*<GddScriptBranchSnapshot\\b(?=[^>]*\\bdialogueJobId=["']${escaped}["'])[^>]*/>[ \\t]*\\n?`, 'gmi'),
    '',
  );
}

function insertAfterLine(
  markdown: string,
  lineIndex: number,
  snapshotMarkdown: string,
): string {
  const lines = markdown.split('\n');
  const before = lines.slice(0, lineIndex + 1).join('\n').replace(/[ \t]+$/, '');
  const after = lines.slice(lineIndex + 1).join('\n').replace(/^\n+/, '');
  const separator = before.endsWith('\n') ? '' : '\n';
  const trailing = after ? `\n\n${after}` : '';
  return `${before}${separator}\n${snapshotMarkdown.trim()}${trailing}`;
}

function insertSnapshotInChapter(
  markdown: string,
  input: Pick<DialogueSnapshotReplacementInput, 'chapterKey' | 'chapterTitle' | 'dialogueJobId' | 'snapshotMarkdown'>,
): string {
  const lines = markdown.split('\n');
  const headings = lines.map((line, index) => {
    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    return match ? { index, level: match[1].length, title: match[2] } : null;
  }).filter((item): item is { index: number; level: number; title: string } => Boolean(item));

  // Prefer the most specific (deepest) matching heading so scene subsections win
  // over parent chapters when both soft-match.
  const heading = [...headings]
    .reverse()
    .find((item) => headingMatches(item.title, input.chapterKey, input.chapterTitle));

  if (heading) {
    const nextSameOrHigher = headings.find((item) => item.index > heading.index && item.level <= heading.level);
    const nested = headings.find((item) => item.index > heading.index && item.level > heading.level);
    const end = nested && (!nextSameOrHigher || nested.index < nextSameOrHigher.index)
      ? nested.index
      : (nextSameOrHigher?.index ?? lines.length);
    const before = lines.slice(0, end).join('\n').replace(/[ \t]+$/, '');
    const after = lines.slice(end).join('\n').replace(/^\n+/, '');
    const separator = before.endsWith('\n') ? '' : '\n';
    const trailing = after ? `\n\n${after}` : '';
    return `${before}${separator}\n${input.snapshotMarkdown.trim()}${trailing}`;
  }

  // Fallback: park the card under the Dialogue Resources bullet for this job.
  const jobLine = lines.findIndex((line) => (
    line.includes(`GDD dialogue job: ${input.dialogueJobId}`)
  ));
  if (jobLine >= 0) {
    let end = jobLine;
    while (end + 1 < lines.length && /^[ \t]+- /.test(lines[end + 1] ?? '')) end += 1;
    return insertAfterLine(markdown, end, input.snapshotMarkdown);
  }

  // Last resort: append so conversion still surfaces a navigable tree card.
  const trimmed = markdown.replace(/\s+$/, '');
  return `${trimmed}\n\n### Script branch: ${input.chapterTitle || input.chapterKey}\n\n${input.snapshotMarkdown.trim()}\n`;
}

export async function replaceGddDialogueSnapshot(
  serviceClient: SupabaseClient,
  input: DialogueSnapshotReplacementInput,
): Promise<{ updated: boolean; reason?: 'missing-chapter' | 'missing-state' }> {
  const current = await documentStateGateway.read(serviceClient, input.documentId);
  if (current.projectId !== input.projectId) throw new DocumentAccessError();
  if (!current.yjsStateBase64) return { updated: false, reason: 'missing-state' };

  const withoutPrevious = removeSnapshotForJob(current.markdown, input.dialogueJobId);
  const inserted = insertSnapshotInChapter(withoutPrevious, input);
  const replacementMarkdown = coerceSanctionedMdx(inserted);

  const currentYjsState = mergeYjsState(
    current.yjsStateBase64,
    current.updateTail.map((update) => update.updateBase64),
  );
  const { data, error } = await serviceClient.rpc('replace_document_with_markdown', {
    p_document_id: input.documentId,
    p_actor_user_id: input.actorUserId,
    p_backup_version_id: randomUUID(),
    p_expected_epoch: current.token.epoch,
    p_expected_revision: current.token.revision,
    p_included_update_ids: current.updateTail.map((update) => update.id),
    p_current_yjs_state: currentYjsState,
    p_current_markdown: current.markdown,
    p_replacement_yjs_state: await documentContentCodec.markdownToYjsState(replacementMarkdown),
    p_replacement_markdown: replacementMarkdown,
  });
  if (error) {
    if (error.code === 'PT409') throw new DocumentStateConflictError(error.message, current.token);
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new DocumentAccessError('Dialogue snapshot replacement returned no state');
  return { updated: true };
}
