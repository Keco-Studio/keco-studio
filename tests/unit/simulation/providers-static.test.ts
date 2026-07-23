import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(resolve(root, relativePath), 'utf8');

describe('simulation provider contracts', () => {
  it('scopes project queries and source loads to the selected Studio project', () => {
    const source = read('src/lib/simulation/SimulationProjectProvider.tsx');
    expect(source).toContain('useSidebarProjects');
    expect(source).toContain("['simulation-libraries', selectedProjectId]");
    expect(source).toContain("['simulation-folders', selectedProjectId]");
    expect(source).toContain('folderNameById');
    expect(source).toContain('loadSimulationProjectSources');
    expect(source).toContain('loadSimulationLibraryFields');
    expect(source).toContain('requestGenerationRef');
    expect(source).toContain('readSimulationProjectPreference');
    expect(source).toContain('requestedProjectId');
  });

  it('hydrates before saving and uses the storage repository boundary', () => {
    const source = read('src/lib/simulation/SimulationSessionProvider.tsx');
    expect(source).toContain('useSupabase');
    expect(source).toContain('createSimulationStorageRepository');
    expect(source).toContain('await repository.load');
    expect(source).toContain('SimulationSaveQueue');
    expect(source).toContain('requestGenerationRef');
    expect(source).toContain('queue.stop()');
    expect(source).toContain('repository.clear');
    expect(source).toContain('IMPORT_COMMITTED');
    expect(source).not.toMatch(/getBrowserStorage|simulationStorageKey|localStorage/);
    expect(source).toContain('snapshot.sourceProjectId !== selectedProjectId');
    expect(source).toContain('const targetId = sessionId;');
    expect(source).not.toContain('sessionId ?? state.activeSessionId');
  });

  it('owns battle timers and clears them on stop, unmount and scope changes', () => {
    const source = read('src/lib/simulation/useBattlePlayback.ts');
    expect(source).toContain('setInterval');
    expect(source).toContain('clearInterval');
    expect(source).toMatch(/useEffect\(\(\) => \(\) =>/);
    expect(source).toContain('simulate(');
    expect(source).toContain('buildFighters(');
    expect(source).toContain('displayUnits(');
    expect(source).toContain('scopeKey');
    expect(source).toContain('[scopeKey, clearTimer]');
  });
});
