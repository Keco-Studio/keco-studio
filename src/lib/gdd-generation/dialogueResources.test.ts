import {
  extractDialoguePlanMarker,
  materializeDialogueResources,
  renderDialogueReferences,
} from './dialogueResources';

const validPlan = {
  chapterKey: 'chapter-1',
  title: 'Arrival',
  content: 'The protagonist arrives at the station.',
  hasChoices: true,
  branchSummary: ['Ask about the train', 'Leave the station'],
};

describe('GDD dialogue resources', () => {
  it('extracts a valid dialogue marker and removes it from the GDD body', () => {
    const result = extractDialoguePlanMarker([
      '# Game Design Document',
      '',
      `<!-- KECO_DIALOGUE_PLAN ${JSON.stringify([validPlan])} -->`,
      '',
    ].join('\n'));

    expect(result).toEqual({
      markdown: '# Game Design Document',
      plans: [validPlan],
      warning: null,
    });
  });

  it('rejects dialogue plans with unknown fields', () => {
    expect(() => extractDialoguePlanMarker(
      `<!-- KECO_DIALOGUE_PLAN ${JSON.stringify([{ ...validPlan, unexpected: true }])} -->`,
    )).toThrow();
  });

  it('rejects duplicate dialogue chapter keys', () => {
    expect(() => extractDialoguePlanMarker(
      `<!-- KECO_DIALOGUE_PLAN ${JSON.stringify([validPlan, { ...validPlan, title: 'Again' }])} -->`,
    )).toThrow('Duplicate dialogue chapter key');
  });

  it('returns a bounded warning and no plans for malformed whole marker JSON', () => {
    const result = extractDialoguePlanMarker('Body\n<!-- KECO_DIALOGUE_PLAN [{bad json] -->\n');

    expect(result.markdown).toBe('Body');
    expect(result.plans).toEqual([]);
    expect(result.warning).toMatch(/not valid JSON/i);
    expect(result.warning?.length).toBeLessThanOrEqual(300);
  });

  it('returns trimmed markdown without plans when no dialogue marker exists', () => {
    expect(extractDialoguePlanMarker('\n  # Plain GDD  \n')).toEqual({
      markdown: '# Plain GDD',
      plans: [],
      warning: null,
    });
  });

  it('materializes dialogue resources and renders generating GDD references', () => {
    const [resource] = materializeDialogueResources('gdd-job-1', [validPlan]);
    const markdown = renderDialogueReferences('project-1', [resource]);

    expect(resource).toMatchObject({
      ...validPlan,
      documentName: 'Arrival dialogue',
    });
    expect(resource.documentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(resource.dialogueJobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(markdown).toContain(`[Arrival dialogue](/project-1/doc/${resource.documentId})`);
    expect(markdown).toContain(`GDD dialogue job: ${resource.dialogueJobId}`);
    expect(markdown).toContain('Generating');
  });

  it('links a completed dialogue resource to its script library', () => {
    const [resource] = materializeDialogueResources('gdd-job-1', [validPlan]);
    const markdown = renderDialogueReferences('project-1', [resource], [{
      dialogueJobId: resource.dialogueJobId,
      status: 'completed',
      scriptLibraryId: 'script-1',
    }]);

    expect(markdown).toContain('Completed');
    expect(markdown).toContain('[Script](/script-system/project-1/script/script-1)');
  });
});
