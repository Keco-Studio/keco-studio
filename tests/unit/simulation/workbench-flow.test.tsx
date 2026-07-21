import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.cwd(), 'src/components/simulation/workbench');
const read = (name: string) => readFileSync(resolve(dir, name), 'utf8');

describe('simulation workbench flow', () => {
  it('contains all five native workflow screens', () => {
    for (const name of ['ImportScreen', 'CharactersScreen', 'SkillsScreen', 'ProgressionScreen', 'BattleScreen']) {
      expect(read(name + '.tsx')).toContain('export function ' + name);
    }
  });

  it('imports real Studio sources atomically through the adapter', () => {
    const source = read('ImportScreen.tsx');
    expect(source).toContain('loadSources');
    expect(source).toContain('importSimulationSnapshot');
    expect(source).toContain('commitImport');
    expect(source).toContain('result.errors');
    expect(source).toContain('SIM_FIELDS');
    expect(source).toContain('commitImport(result.snapshot, name)');
    expect(source).not.toContain('commitImport(result.snapshot, name, activeSession?.id)');
    expect(source).toContain('createDemoImportedSnapshot');
    expect(source).toContain('Use demo data');
    expect(source).toContain('Import Studio data');
  });

  it('uses imported catalogs and rule tables for configuration', () => {
    expect(read('CharactersScreen.tsx')).toContain('snapshot.catalog.characters');
    expect(read('SkillsScreen.tsx')).toContain('snapshot?.catalog.skills');
    expect(read('SkillsScreen.tsx')).toContain('>= 6');
    expect(read('ProgressionScreen.tsx')).toContain('snapshot.skillCostRules');
    expect(read('ProgressionScreen.tsx')).toContain('snapshot.levelRules');
  });

  it('wires battle playback and project-scoped providers in the workbench', () => {
    const battle = read('BattleScreen.tsx');
    expect(battle).toContain('useBattlePlayback');
    expect(battle).toContain('runBatch');
    expect(battle).toContain('updateProgression');
    const workbench = read('SimulationWorkbench.tsx');
    expect(workbench).toContain('useSimulationProject');
    expect(workbench).toContain('useSimulationSession');
    expect(workbench).toContain('data-simulation-root');
    expect(workbench).toContain('<SimulationSidebar');
    expect(workbench).toContain('<SimulationHeader');
    expect(workbench).toContain('requestedScreen?.sessionId === sessions.activeSession.id');
    expect(workbench).toContain('requestedScreen?.projectId === project.selectedProjectId');
  });
});
