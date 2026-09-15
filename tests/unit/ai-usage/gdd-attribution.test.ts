import { describe, expect, it, jest } from '@jest/globals';
import type { AiUsageBinding } from '@/lib/ai-usage/types';
import { generateGdd } from '@/lib/gddGeneration';
import { generateGddMarkdownV2, reviewGddMarkdownV2 } from '@/lib/gdd-generation/v2/generator';
import { generateProfessionalStage } from '@/lib/gdd-generation/v2/professionalStages';
import { planDialogueScene } from '@/lib/gdd-generation/v2/dialoguePlanner';
import { compileGddMapBriefs } from '@/lib/gdd-generation/maps/compiler';
import { processClaimedGddResourceJob } from '@/lib/gdd-generation/resources/worker';
import { processClaimedDialogueJob } from '@/lib/gdd-generation/dialogueWorker';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/documents/documentContentCodec', () => ({
  documentContentCodec: { markdownToYjsState: jest.fn(async () => 'encoded-yjs') },
}));

const binding = (): AiUsageBinding => ({
  context: {
    actorUserId: 'owner-1', projectId: 'project-1', feature: 'gdd', operation: 'root',
    correlationId: 'gdd-job-1', jobId: 'gdd-job-1',
  },
  recorder: jest.fn(async () => undefined),
});

const v2Input = {
  contractVersion: 2, mode: 'quick', language: 'en', projectId: 'project-1', projectName: 'Test',
  designSystemId: 'system-1', versionId: 'version-1', versionNumber: 1, systemTitle: 'System',
  rules: { schemaVersion: 1, genres: [], philosophies: [], suitableFor: 'Test', rules: [], tableGuidance: [] },
  designDocument: {
    gameBackground: '', designIntent: 'Intent', playerFantasy: 'Fantasy', coreLoop: 'Loop',
    decisionStructure: 'Choice', systemBoundaries: 'Bounds', progressionEconomy: 'Economy',
    contentModel: 'Content', difficultyBalance: 'Balance', experiencePresentation: 'Presentation',
  },
  projectSources: [], artStyle: null,
} as const;

const legacyInput = {
  ...v2Input,
  rules: {
    schemaVersion: 1, genres: ['Test'], philosophies: ['Clarity'], suitableFor: 'Test', tableGuidance: [],
    rules: [{ id: 'clarity', kind: 'principle', title: 'Clarity', statement: 'Be clear.', appliesWhen: 'Always', severity: 'required' }],
  },
};

describe('GDD usage attribution', () => {
  it('labels quick generation and its JSON repair', async () => {
    const complete = jest.fn(async () => 'not-json');
    await expect(generateGdd(legacyInput as never, { complete, usageBinding: binding() } as never)).rejects.toThrow();
    expect(complete.mock.calls.map(([, options]) => (options as any).usageBinding.context.operation)).toEqual([
      'quick_generate', 'quick_repair',
    ]);
  });

  it('labels a truncated v2 stream recovery with the same correlation', async () => {
    const stream = jest.fn(async function* () {
      yield { type: 'text_delta' as const, content: '# Draft\n\nComplete body.' };
      yield { type: 'finish' as const, reason: stream.mock.calls.length === 1 ? 'length' : 'stop' };
    });
    await generateGddMarkdownV2(v2Input as never, { stream, complete: jest.fn(async () => '[]'), usageBinding: binding() } as never);
    const bindings = stream.mock.calls.map(([, options]) => (options as any).usageBinding);
    expect(bindings.map((value) => value.context.operation)).toEqual(['quick_generate', 'truncation_recovery']);
    expect(bindings.every((value) => value.context.correlationId === 'gdd-job-1')).toBe(true);
  });

  it('labels table repair and dialogue-scene recovery calls', async () => {
    const tableComplete = jest.fn(async () => '<!-- KECO_TABLE_PLAN [{"table":"Skills","purpose":"Actions","fields":["name"],"rows":[{"name":"Basic","values":{"name":"Basic"}}]}] -->');
    await reviewGddMarkdownV2({
      ...v2Input,
      rules: { ...v2Input.rules, tableGuidance: [{ table: 'Skills', purpose: 'Actions', fields: ['name'] }] },
    } as never, '# GDD\n\n<!-- KECO_TABLE_REF Skills -->', { complete: tableComplete, usageBinding: binding() } as never);
    expect((tableComplete.mock.calls[0]![1] as any).usageBinding.context.operation).toBe('repair_missing_table');

    const dialogueComplete = jest.fn(async () => '[]');
    await reviewGddMarkdownV2({
      ...v2Input,
      rules: { ...v2Input.rules, genres: ['Narrative'] },
    } as never, '# GDD\n\nA complete story.', { complete: dialogueComplete, usageBinding: binding() } as never);
    expect((dialogueComplete.mock.calls[0]![1] as any).usageBinding.context.operation).toBe('recover_scenes');
  });

  it('labels every professional primary and repair completion at its call site', async () => {
    const complete = jest.fn(async () => 'not-json');
    await expect(generateProfessionalStage(v2Input as never, 'planning', {
      blueprint: null, section_drafts: [], review_report: null, repair_round: 0,
    }, { complete, usageBinding: binding() } as never)).rejects.toThrow();
    expect(complete.mock.calls.map(([, options]) => (options as any).usageBinding.context.operation)).toEqual([
      'professional_planning', 'professional_planning_repair',
    ]);
  });

  it.each([
    ['generating_core', 'professional_core', 'Core'],
    ['generating_systems', 'professional_systems', 'Systems'],
    ['generating_content', 'professional_content', 'Content'],
  ] as const)('labels %s', async (stage, operation, title) => {
    const complete = jest.fn(async () => `## ${title}\n\nBody.`);
    await generateProfessionalStage(v2Input as never, stage, {
      blueprint: {
        version: 1, title: 'Test', sections: [{ id: stage, title, stage: stage.replace('generating_', ''), instructions: ['Write the section.'] }], invariants: [],
      },
      section_drafts: [], review_report: null, repair_round: 0,
    } as never, { complete, usageBinding: binding() } as never);
    expect((complete.mock.calls[0]![1] as any).usageBinding.context.operation).toBe(operation);
  });

  it('labels dialogue planning repairs and keeps scene metadata bounded', async () => {
    const complete = jest.fn(async () => 'not-json');
    await expect(planDialogueScene({
      event: { chapterKey: 'arrival', title: 'Arrival', scene: 'A gate meeting.', participants: [], choices: [], consequences: 'Entry.' },
      gddContext: '# GDD',
    }, { complete, usageBinding: binding() } as never, { sceneIndex: 4 } as never)).rejects.toThrow();
    const usage = complete.mock.calls.map(([, options]) => (options as any).usageBinding);
    expect(usage.map((value) => value.context.operation)).toEqual(['plan_scene', 'repair_scene']);
    expect(usage.every((value) => value.metadata.sceneIndex === 4)).toBe(true);
    expect(JSON.stringify(usage)).not.toContain('A gate meeting.');
  });

  it('labels map compilation and repair without storing GDD text in usage metadata', async () => {
    const complete = jest.fn(async () => 'not-json');
    await expect(compileGddMapBriefs({ markdown: '# Map\nPrivate route.', artStyle: null, complete, usageBinding: binding() } as never)).rejects.toThrow();
    const usage = complete.mock.calls.map(([, options]) => (options as any).usageBinding);
    expect(usage.map((value) => value.context.operation)).toEqual(['compile_briefs', 'repair_briefs']);
    expect(JSON.stringify(usage)).not.toContain('Private route.');
  });

  it('builds a service binding for asynchronous map resource jobs from the parent owner', async () => {
    const compile = jest.fn(async () => []);
    const query: any = { maybeSingle: jest.fn(async () => ({ data: { owner_id: 'owner-1' }, error: null })) };
    query.select = jest.fn(() => query);
    query.eq = jest.fn(() => query);
    const serviceClient = { from: jest.fn(() => query) };
    await processClaimedGddResourceJob({ serviceClient: serviceClient as never, workerId: 'worker-1', job: {
      id: 'resource-1', project_id: 'project-1', gdd_generation_job_id: 'gdd-job-1', document_id: 'document-1',
      kind: 'maps', payload: { markdown: '# Map', artStyle: null }, attempt_count: 1,
    } as never }, {
      compile, claim: jest.fn(), finish: jest.fn(async () => 'completed'), retry: jest.fn(), materialize: jest.fn(), review: jest.fn(),
      usageBindingForJob: jest.fn(async () => ({
        ...binding(),
        context: {
          ...binding().context,
          feature: 'gdd_map', operation: 'resource', artifactId: 'resource-1',
        },
      })),
    } as never);
    expect(compile).toHaveBeenCalledWith(expect.objectContaining({
      usageBinding: expect.objectContaining({ context: expect.objectContaining({
        actorUserId: 'owner-1', projectId: 'project-1', jobId: 'gdd-job-1', artifactId: 'resource-1', correlationId: 'gdd-job-1',
      }) }),
    }));
  });

  it('passes the parent GDD service binding into Script AI conversion without a second recorder', async () => {
    const resolve = jest.fn(async () => ({ document: { nodes: [] }, plotPlan: { nodes: [] } }));
    await processClaimedDialogueJob({ serviceClient: {} as never, workerId: 'worker-1', job: {
      id: 'dialogue-1', project_id: 'project-1', gdd_generation_job_id: 'gdd-job-1', chapter_key: 'arrival', title: 'Arrival',
      document_id: 'document-1', status: 'running', attempt_count: 1, max_attempts: 2,
    } as never }, {
      heartbeat: jest.fn(async () => undefined), read: jest.fn(async () => ({ markdown: 'Dialogue' })), resolve,
      resolveOwner: jest.fn(async () => 'owner-1'), findExistingScript: jest.fn(async () => null),
      importStory: jest.fn(async () => ({ libraryId: 'library-1' })), updateReference: jest.fn(), updateSnapshot: jest.fn(),
      complete: jest.fn(), fail: jest.fn(), retry: jest.fn(),
    } as never);
    expect(resolve).toHaveBeenCalledWith('Dialogue', expect.objectContaining({
      usageBinding: expect.objectContaining({ context: expect.objectContaining({
        actorUserId: 'owner-1', projectId: 'project-1', jobId: 'gdd-job-1', artifactId: 'dialogue-1', correlationId: 'gdd-job-1',
      }) }),
    }));
  });
});
