import { buildSystemPrompt } from '../../../src/lib/agent/prompts';

describe('buildSystemPrompt design-document table rules', () => {
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
