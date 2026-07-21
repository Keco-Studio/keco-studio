import { buildSystemPrompt } from '../../../src/lib/agent/prompts';

describe('buildSystemPrompt design-document table rules', () => {
  it('states implemented document capabilities', () => {
    const prompt = buildSystemPrompt({ projectId: 'project-1', userRole: 'editor' });

    expect(prompt).toContain('.txt, .md, and .docx');
    expect(prompt).toContain('parsed by the application before');
    expect(prompt).toContain('visible JSON');
    expect(prompt).toContain('headings, lists, tables, links');
    expect(prompt).toContain('Legacy .doc is not supported');
    expect(prompt).toContain('custom XML');
    expect(prompt).toContain('must not deny DOCX support');
  });

  it('states that eligible embedded images are preserved semantically', () => {
    const prompt = buildSystemPrompt({ projectId: 'project-1', userRole: 'editor' });

    expect(prompt).toContain('eligible embedded images');
  });

  it('states that hidden Word custom properties are unsupported', () => {
    const prompt = buildSystemPrompt({ projectId: 'project-1', userRole: 'editor' });

    expect(prompt).toContain('hidden Word custom properties');
  });

  it('routes analysis separately from tables', () => {
    const prompt = buildSystemPrompt({ projectId: 'project-1', userRole: 'editor' });

    expect(prompt).toContain('[Document intent]\nanalyze');
    expect(prompt).toContain('answer from the supplied document content');
    expect(prompt).toContain('do not call project-schema or write tools');
    expect(prompt).toContain('unless the user explicitly asks for a project operation');
    expect(prompt).toContain('[Document intent]\ntables');
    expect(prompt).toContain('FIRST call list_project_structure');
  });

  it('includes current document metadata and safe target resolution rules', () => {
    const prompt = buildSystemPrompt({
      projectId: 'project-1',
      currentDocumentId: 'doc-1',
      currentDocumentName: 'Design Guide',
      userRole: 'editor',
    });

    expect(prompt).toContain('Current document: Design Guide (id: doc-1)');
    expect(prompt).toContain('current document is the default target only');
    expect(prompt).toContain('explicitly names a different same-project document');
    expect(prompt).toContain('list_documents or list_project_structure');
    expect(prompt).toContain('Never guess among duplicate document names');
    expect(prompt).toContain('read_document before editing document content');
    expect(prompt).toContain('living project documents');
  });

  it('separates table extraction from prose generation and blocks low-quality tables', () => {
    const prompt = buildSystemPrompt({
      projectId: 'project-1',
      userRole: 'editor',
    });

    expect(prompt).toContain('EXTRACT EXISTING TABLES');
    expect(prompt).toContain('preserve the explicit table headers and rows');
    expect(prompt).toContain('Generate/infer/build tables from prose ONLY when the user explicitly asks');
    expect(prompt).toContain('do NOT call setup_library');
    expect(prompt).toContain('quality would be poor');
  });

  it('keeps import parsing in the tool and selects exact source spans', () => {
    const prompt = buildSystemPrompt({ projectId: 'project-1', userRole: 'editor' });

    expect(prompt).toContain('select the exact sourceStart/sourceEnd span');
    expect(prompt).toContain('never rewrite or normalize the story text');
    expect(prompt).not.toContain('Branch labels use letter O + digit');
  });
});
