import {
  applyDialogueResourceReferences,
  coerceDialoguePlanInput,
  extractDialoguePlanMarker,
  materializeDialogueResources,
  normalizeDialoguePlans,
  renderDialogueReferences,
  renderPendingDialogueReferences,
  sanitizeDialogueResourcesForPersistence,
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

  it('ignores unknown fields after coercion', () => {
    const result = extractDialoguePlanMarker(
      `<!-- KECO_DIALOGUE_PLAN ${JSON.stringify([{ ...validPlan, unexpected: true }])} -->`,
    );
    expect(result.plans).toEqual([validPlan]);
    expect(result.warning).toBeNull();
  });

  it('coerces common LLM field aliases before validation', () => {
    expect(normalizeDialoguePlans([{
      chapter_key: 'chapter-2',
      name: 'Departure',
      dialogue: 'Clerk: Tickets please.',
      has_choices: true,
      branches: ['Buy ticket', 'Walk away'],
    }])).toEqual([{
      chapterKey: 'chapter-2',
      title: 'Departure',
      content: 'Clerk: Tickets please.',
      hasChoices: true,
      branchSummary: ['Buy ticket', 'Walk away'],
    }]);
  });

  it('coerces dialogue plan records through the shared preprocessor', () => {
    expect(coerceDialoguePlanInput({
      key: 'chapter-3',
      title: 'Finale',
      text: 'Hero: We finish this today.',
      branch_summary: [],
    })).toEqual({
      chapterKey: 'chapter-3',
      title: 'Finale',
      content: 'Hero: We finish this today.',
      hasChoices: false,
      branchSummary: [],
    });
  });

  it('merges dialogue plans that target the same chapter', () => {
    const result = extractDialoguePlanMarker(
      `<!-- KECO_DIALOGUE_PLAN ${JSON.stringify([
        validPlan,
        {
          ...validPlan,
          title: 'Arrival follow-up',
          content: 'The conductor explains the final clue.',
          branchSummary: ['Inspect the timetable'],
        },
      ])} -->`,
    );
    expect(result.plans).toEqual([{
      ...validPlan,
      content: `${validPlan.content}\n\nThe conductor explains the final clue.`,
      branchSummary: [...validPlan.branchSummary, 'Inspect the timetable'],
    }]);
    expect(result.warning).toBeNull();
  });

  it('keeps explicitly distinct chapter keys separate while merging case-insensitive duplicates', () => {
    expect(normalizeDialoguePlans([
      validPlan,
      { ...validPlan, chapterKey: 'CHAPTER-1', content: 'Follow-up.', hasChoices: false, branchSummary: [] },
      { ...validPlan, chapterKey: 'chapter-1-2', title: 'Explicit suffix' },
    ])).toEqual([
      { ...validPlan, content: `${validPlan.content}\n\nFollow-up.` },
      { ...validPlan, chapterKey: 'chapter-1-2', title: 'Explicit suffix' },
    ]);
  });

  it('keeps merged duplicate chapters within dialogue schema limits', () => {
    const longContent = 'x'.repeat(70_000);
    const plans = normalizeDialoguePlans([
      { ...validPlan, content: longContent, branchSummary: Array.from({ length: 30 }, (_, index) => `A${index}`) },
      { ...validPlan, content: `y${longContent}`, branchSummary: Array.from({ length: 30 }, (_, index) => `B${index}`) },
    ]);

    expect(plans).toHaveLength(1);
    expect(plans[0]!.content.length).toBeLessThanOrEqual(120_000);
    expect(plans[0]!.branchSummary).toHaveLength(50);
  });

  it('returns a bounded warning and no plans for schema-invalid dialogue entries', () => {
    const result = extractDialoguePlanMarker(
      'Body\n<!-- KECO_DIALOGUE_PLAN [{"hasChoices":false,"branchSummary":[]}] -->\n',
    );
    expect(result.markdown).toBe('Body');
    expect(result.plans).toEqual([]);
    expect(result.warning).toBeTruthy();
    expect(result.warning?.length).toBeLessThanOrEqual(300);
  });

  it('rejects multiple dialogue plan markers instead of silently ignoring later plans', () => {
    expect(() => extractDialoguePlanMarker([
      `<!-- KECO_DIALOGUE_PLAN ${JSON.stringify([validPlan])} -->`,
      `<!-- KECO_DIALOGUE_PLAN ${JSON.stringify([{ ...validPlan, chapterKey: 'chapter-2' }])} -->`,
    ].join('\n'))).toThrow(/multiple KECO dialogue plan markers/i);
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

  it('strips UI-only metadata before sending dialogue resources to Postgres', () => {
    const [resource] = materializeDialogueResources('gdd-job-1', [validPlan]);
    expect(sanitizeDialogueResourcesForPersistence([resource])).toEqual([{
      dialogueJobId: resource.dialogueJobId,
      documentId: resource.documentId,
      chapterKey: validPlan.chapterKey,
      title: validPlan.title,
      content: validPlan.content,
      hasChoices: validPlan.hasChoices,
      branchSummary: validPlan.branchSummary,
    }]);
    expect(sanitizeDialogueResourcesForPersistence([resource])[0]).not.toHaveProperty('documentName');
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

  it('uses the Dialogue Document name as the async placeholder', () => {
    const [resource] = materializeDialogueResources('gdd-job-1', [validPlan]);
    const markdown = renderPendingDialogueReferences([resource]);

    expect(markdown).toContain('- Document: Arrival dialogue');
    expect(markdown).toContain('  - Status: Generating');
    expect(markdown).not.toContain('Script:');
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

  it('replaces an anchored legacy Dialogue Resources section instead of appending to it', () => {
    const [resource] = materializeDialogueResources('gdd-job-1', [validPlan]);
    const markdown = applyDialogueResourceReferences([
      '# <BlockAnchor id="root" />GDD',
      '',
      '## <BlockAnchor id="dialogue" />Dialogue Resources',
      '',
      '* Old chapter: [Old dialogue](/project-1/doc/old-document)',
      '  * <BlockAnchor id="job" />GDD dialogue job: old-job',
      '',
      '<GddScriptBranchSnapshot dialogueJobId="old-job" chapterKey="old" title="Old" projectId="project-1" dialogueDocumentId="old-document" scriptLibraryId="old-script" tree="[]" />',
      '',
      '* <BlockAnchor id="status" />Script: Generating',
      '* <BlockAnchor id="placeholder" />Document: Old dialogue',
      '  * <BlockAnchor id="generating" />Status: Generating',
      '',
      '## <BlockAnchor id="maps" />Maps and Levels',
      '',
      'Map body.',
    ].join('\n'), 'project-1', [resource]);

    expect(markdown.match(/Dialogue Resources/g)).toHaveLength(1);
    expect(markdown).toContain(`GDD dialogue job: ${resource.dialogueJobId}`);
    expect(markdown).toContain('## <BlockAnchor id="maps" />Maps and Levels');
    expect(markdown).not.toContain('old-job');
    expect(markdown).not.toContain('Old dialogue');
    expect(markdown).not.toContain('GddScriptBranchSnapshot');
    expect(markdown).not.toContain('Document:');
  });
});
