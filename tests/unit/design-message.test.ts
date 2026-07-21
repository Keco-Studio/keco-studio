import { buildDesignMessage, parseDesignMessage } from '../../src/lib/design-message';

describe('buildDesignMessage', () => {
  it('builds neutral analysis without table directives', () => {
    const message = buildDesignMessage({
      fileName: 'story.docx',
      documentText: 'Visible body',
      additionalInstructions: 'What is in this file?',
      intent: 'analyze',
    });
    expect(message).toContain('[Document attachment]');
    expect(message).toContain('[Document intent]\nanalyze');
    expect(message).toContain('[User instructions]\nWhat is in this file?');
    expect(message).toContain('[Document content]\nVisible body');
    expect(message).toContain('already parsed');
    expect(message).not.toContain('First call list_project_structure and list_field_types');
  });

  it('summarizes analysis attachments with no instructions', () => {
    const message = buildDesignMessage({
      fileName: 'story.docx',
      documentText: 'Visible body',
      intent: 'analyze',
    });
    expect(message).toContain('provide a concise summary of the document');
  });

  it('retains the workflow for table intent', () => {
    const message = buildDesignMessage({
      fileName: 'design.docx',
      documentText: '| Name | Value |',
      intent: 'tables',
    });
    expect(message).toContain('[Document intent]\ntables');
    expect(message).toContain('First call list_project_structure and list_field_types');
    expect(message).toContain('EXTRACTION mode');
    expect(message).toContain('QUALITY GATE');
  });

  it('includes the file name in the system instruction', () => {
    const msg = buildDesignMessage({
      fileName: 'worldview.md',
      documentText: 'A fantasy continent with three factions.',
      intent: 'analyze',
    });
    expect(msg).toContain('worldview.md');
  });

  it('includes the full document text', () => {
    const documentText = 'A fantasy continent with three factions.';
    const msg = buildDesignMessage({ fileName: 'a.txt', documentText, intent: 'analyze' });
    expect(msg).toContain(documentText);
  });

  it('includes additional instructions when provided', () => {
    const msg = buildDesignMessage({
      fileName: 'a.txt',
      documentText: 'doc',
      additionalInstructions: 'Only create a characters table.',
      intent: 'analyze',
    });
    expect(msg).toContain('Only create a characters table.');
  });

  it('omits the additional-instructions section when blank', () => {
    const withBlank = buildDesignMessage({
      fileName: 'a.txt',
      documentText: 'doc',
      additionalInstructions: '   ',
      intent: 'analyze',
    });
    const without = buildDesignMessage({ fileName: 'a.txt', documentText: 'doc', intent: 'analyze' });
    expect(withBlank).toBe(without);
  });

  it('instructs the agent to extract explicit tables before generating from prose', () => {
    const msg = buildDesignMessage({
      fileName: 'mixed.docx',
      documentText: 'Story paragraph\n\n| Name | Value |\n| --- | --- |\n| A | 1 |',
      additionalInstructions: 'Extract the tables from the document',
      intent: 'tables',
    });

    expect(msg).toContain('EXTRACTION mode');
    expect(msg).toContain('preserve the explicit table headers and rows');
    expect(msg).toContain('Do not convert surrounding story/prose into extra rows');
  });

  it('adds a quality gate for unrelated prose with no reliable table evidence', () => {
    const msg = buildDesignMessage({
      fileName: 'random.txt',
      documentText: 'Dinner was delicious tonight, and it rained outside.',
      additionalInstructions: 'Generate a table',
      intent: 'tables',
    });

    expect(msg).toContain('QUALITY GATE');
    expect(msg).toContain('do not call setup_library');
    expect(msg).toContain('table quality would be poor');
  });

  it('describes a project document without claiming it was uploaded and keeps parsing stable', () => {
    const msg = buildDesignMessage({
      fileName: 'Project notes',
      documentText: '| Name | Value |\n| --- | --- |\n| A | 1 |',
      documentId: 'document-id',
      sourceKind: 'project-document',
      intent: 'tables',
    });

    expect(msg).toContain('The user selected the project document "Project notes".');
    expect(msg).not.toContain('The user uploaded a design document');
    expect(msg).toContain('signed frozen snapshot');
    expect(msg).not.toContain('Use read_document when you need the latest logical document state.');
    expect(parseDesignMessage(msg)).toEqual({ fileName: 'Project notes' });
  });
});

describe('parseDesignMessage', () => {
  it('parses a legacy design-document envelope', () => {
    expect(parseDesignMessage(
      '[Design document]\nThe user uploaded a design document "legacy.docx".\n\n' +
      '[User instructions]\nSummarize it\n\n[Document content]\nSECRET',
    )).toEqual({ fileName: 'legacy.docx', instructions: 'Summarize it' });
  });
  it('returns null for a plain (non-design) message', () => {
    expect(parseDesignMessage('Hello, can you help me?')).toBeNull();
  });

  it('extracts the file name and instructions from a built design message', () => {
    const msg = buildDesignMessage({
      fileName: 'worldview.docx',
      documentText: 'A fantasy continent with three factions.',
      additionalInstructions: 'Only create a characters table.',
      intent: 'analyze',
    });
    const parsed = parseDesignMessage(msg);
    expect(parsed?.fileName).toBe('worldview.docx');
    expect(parsed?.instructions).toBe('Only create a characters table.');
  });

  it('leaves instructions undefined when none were provided', () => {
    const msg = buildDesignMessage({
      fileName: 'a.txt',
      documentText: 'doc body',
      intent: 'analyze',
    });
    const parsed = parseDesignMessage(msg);
    expect(parsed?.fileName).toBe('a.txt');
    expect(parsed?.instructions).toBeUndefined();
  });

  it('does not leak the document content into instructions', () => {
    const msg = buildDesignMessage({
      fileName: 'a.txt',
      documentText: 'SECRET-DOC-BODY',
      additionalInstructions: 'do a thing',
      intent: 'analyze',
    });
    const parsed = parseDesignMessage(msg);
    expect(parsed?.instructions).not.toContain('SECRET-DOC-BODY');
  });

  it('preserves multi-line instructions', () => {
    const msg = buildDesignMessage({
      fileName: 'a.txt',
      documentText: 'body',
      additionalInstructions: 'line one\nline two',
      intent: 'analyze',
    });
    const parsed = parseDesignMessage(msg);
    expect(parsed?.instructions).toBe('line one\nline two');
  });
});
