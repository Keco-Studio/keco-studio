/**
 * Builds (and parses) the chat message handed to the agent when a user uploads a
 * design document and asks it to infer tables and fill data.
 *
 * The message is written in English to stay consistent with the agent system
 * prompt (`buildSystemPrompt`), which already instructs the agent to reply in
 * the user's own language. The raw document text is appended verbatim.
 *
 * The structure is intentionally machine-parseable so the chat UI can show a
 * compact "file + instructions" view (via `parseDesignMessage`) instead of the
 * full document body, while the model still receives the entire text.
 */

const DOC_HEADER = '[Design document]';
const INSTRUCTIONS_HEADER = '[User instructions]';
const CONTENT_HEADER = '[Document content]';

export interface BuildDesignMessageParams {
  fileName: string;
  documentText: string;
  documentId?: string;
  additionalInstructions?: string;
}

export function buildDesignMessage(params: BuildDesignMessageParams): string {
  const parts: string[] = [];

  parts.push(DOC_HEADER);
  parts.push(
    `The user uploaded a design document "${params.fileName}". First call ` +
      'list_project_structure and list_field_types, then analyze the content, infer ' +
      'which tables (libraries) are needed, design appropriate fields (columns) using ' +
      'only supported field types. EXTRACTION mode: when the document contains explicit ' +
      'tables, preserve the explicit table headers and rows and use nearby prose only ' +
      'as context for table names or obvious field labels. Do not convert surrounding ' +
      'story/prose into extra rows unless the user explicitly asks to generate/infer/build ' +
      'tables from prose. QUALITY GATE: if there is no reliable table evidence and no ' +
      'clear design entities, do not call setup_library or other write tools; tell the ' +
      'user the table quality would be poor and ask for clearer source data or an explicit ' +
      'generation instruction. Present a short summary of the planned tables before creating anything.'
  );
  if (params.documentId) {
    parts.push(
      `The uploaded source is also stored as project document ${params.documentId}. ` +
        'Use read_document when you need the latest logical document state.'
    );
  }

  const extra = params.additionalInstructions?.trim();
  if (extra) {
    parts.push('');
    parts.push(INSTRUCTIONS_HEADER);
    parts.push(extra);
  }

  parts.push('');
  parts.push(CONTENT_HEADER);
  parts.push(params.documentText);

  return parts.join('\n');
}

export interface ParsedDesignMessage {
  fileName: string;
  instructions?: string;
}

/**
 * Inverse of `buildDesignMessage` for display purposes. Returns the original
 * file name and the user's instructions (without the document body), or `null`
 * when `message` is not a design-document message.
 */
export function parseDesignMessage(message: string): ParsedDesignMessage | null {
  if (!message.startsWith(DOC_HEADER)) return null;

  const fileMatch = message.match(/design document "([^"]+)"/);
  const fileName = fileMatch?.[1] ?? 'document';

  let instructions: string | undefined;
  const instrMarker = `${INSTRUCTIONS_HEADER}\n`;
  const instrStart = message.indexOf(instrMarker);
  if (instrStart !== -1) {
    const from = instrStart + instrMarker.length;
    const contentStart = message.indexOf(`\n${CONTENT_HEADER}`, from);
    const to = contentStart === -1 ? message.length : contentStart;
    const sliced = message.slice(from, to).trim();
    instructions = sliced || undefined;
  }

  return { fileName, instructions };
}
