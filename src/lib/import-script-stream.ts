import type { StoryPlanProgressEvent as ImportProgressEvent } from './story-plan/conversion';
import type { ImportScriptResult } from './services/scriptImportService';

type ImportStreamRecord =
  | { type: 'progress'; progress: ImportProgressEvent }
  | { type: 'result'; result: ImportScriptResult }
  | { type: 'error'; error: string };

export async function consumeImportStream(
  response: Response,
  onProgress: (event: ImportProgressEvent) => void
): Promise<ImportScriptResult> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error || `Import failed (${response.status})`);
  }
  if (!response.body) throw new Error('Import response has no stream body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: ImportScriptResult | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) result = handleRecord(parseRecord(line), onProgress, result);
      newline = buffer.indexOf('\n');
    }
  }

  const finalLine = buffer.trim();
  if (finalLine) result = handleRecord(parseRecord(finalLine), onProgress, result);
  if (!result) throw new Error('Import stream ended without a result');
  return result;
}

function parseRecord(line: string): ImportStreamRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error('Import stream contained malformed JSON');
  }
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
    throw new Error('Import stream contained an invalid record');
  }
  return parsed as ImportStreamRecord;
}

function handleRecord(
  record: ImportStreamRecord,
  onProgress: (event: ImportProgressEvent) => void,
  currentResult: ImportScriptResult | undefined
): ImportScriptResult | undefined {
  if (record.type === 'progress') {
    onProgress(record.progress);
    return currentResult;
  }
  if (record.type === 'error') throw new Error(record.error || 'Import failed');
  if (record.type === 'result') return record.result;
  throw new Error('Import stream contained an unknown record type');
}
