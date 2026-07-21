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
    expect(source).toContain('loadSimulationProjectSources');
    expect(source).toContain('requestGenerationRef');
    expect(source).toContain('readSimulationProjectHandoff');
    expect(source).toContain('requestedProjectId');
  });

  it('hydrates before saving and uses the storage repository boundary', () => {
    const source = read('src/lib/simulation/SimulationSessionProvider.tsx');
    expect(source).toContain('createSimulationStorageRepository');
    expect(source).not.toMatch(/localStorage\.(?:getItem|setItem|removeItem)/);
    expect(source).toContain('hydratedNamespace');
    expect(source).toContain('blockedNamespace');
    expect(source).toContain('repository.save');
    expect(source).toContain('repository.clear');
    expect(source).toContain('IMPORT_COMMITTED');
    expect(source).toContain('getBrowserStorage');
    expect(source).toContain('snapshot.sourceProjectId !== selectedProjectId');
  });

  it('owns battle timers and clears them on stop and unmount', () => {
    const source = read('src/lib/simulation/useBattlePlayback.ts');
    expect(source).toContain('setInterval');
    expect(source).toContain('clearInterval');
    expect(source).toMatch(/useEffect\(\(\) => \(\) =>/);
    expect(source).toContain('simulate(');
    expect(source).toContain('buildFighters(');
    expect(source).toContain('displayUnits(');
  });
});
