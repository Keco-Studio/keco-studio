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
    expect(source).toContain('requestAiFieldMappings');
    expect(source).toContain('supabase.auth.getSession()');
    expect(source).toContain('LLM auto-mapping...');
    expect(source).toContain('styles.aiMappingSpinner');
    expect(read('SimulationWorkbench.module.css')).toContain('@keyframes aiMappingSpin');
    expect(source).toContain('importSimulationSnapshot');
    expect(source).toContain('commitImport');
    expect(source).toContain('result.errors');
    expect(source).toContain('SIM_FIELDS');
    expect(source).toContain('commitImport(result.snapshot, name)');
    expect(source).not.toContain('commitImport(result.snapshot, name, activeSession?.id)');
    expect(source).not.toContain('createDemoImportedSnapshot');
    expect(source).not.toContain('Use demo data');
    expect(source).not.toContain('Need a ready-to-play setup?');
    expect(source).toContain('Import libraries');
    expect(source).toContain('drag unmapped columns');
    expect(source).toContain('buildMappingLayout');
    expect(source).toContain('applyMappingDrag');
    expect(source).toContain('mapping-unmapped');
    expect(source).toContain('finalizeFieldMapping');
    expect(source).toContain('orderSlotsForDisplay');
    expect(source).toContain('mapping-drag-preview');
    expect(source).toContain('showUnmappedPool');
    expect(source).not.toContain('drag from a source port');
    expect(source).not.toContain('bezierPath');
    expect(source).not.toContain('startWire');
    expect(source).toContain('Continue to characters');
    expect(source).toContain('Imported with warnings');
    expect(source).toContain('result.warnings');
    expect(source).not.toContain('autoMapFields(');
  });

  it('shows the LLM mapping status in the Studio source header', () => {
    const source = read('ImportScreen.tsx');
    const sourceHeaderStart = source.indexOf('Studio source table');
    const sourceHeaderEnd = source.indexOf('gridColumn: 2', sourceHeaderStart);
    const targetHeaderStart = source.indexOf('Simulation fields', sourceHeaderEnd);
    const targetHeaderEnd = source.indexOf('ref={sourceListRef}', targetHeaderStart);

    expect(source.slice(sourceHeaderStart, sourceHeaderEnd)).toContain('styles.aiMappingSpinner');
    expect(source.slice(sourceHeaderStart, sourceHeaderEnd)).toContain('LLM auto-mapping...');
    expect(source.slice(sourceHeaderStart, sourceHeaderEnd)).toContain('AI mapping failed - map manually');
    expect(source.slice(targetHeaderStart, targetHeaderEnd)).not.toContain('styles.aiMappingSpinner');
    expect(source.slice(targetHeaderStart, targetHeaderEnd)).not.toContain('AI mapping failed - map manually');

    const sourceRowsStart = source.indexOf('ref={sourceListRef}', targetHeaderEnd);
    const sourceRowsEnd = source.indexOf('title="Rows align left to right"', sourceRowsStart);
    const targetRowsStart = source.indexOf('ref={targetListRef}', sourceRowsEnd);
    const targetRowsEnd = source.indexOf('{errors.length ? (', targetRowsStart);
    expect(source.slice(sourceRowsStart, sourceRowsEnd)).toContain('AI mapping...');
    expect(source.slice(sourceRowsStart, sourceRowsEnd)).toContain('showUnmappedPool');
    expect(source.slice(sourceRowsStart, sourceRowsEnd)).toContain('Unmapped');
    expect(source.slice(targetRowsStart, targetRowsEnd)).not.toContain('AI mapping...');
  });

  it('uses imported catalogs and rule tables for configuration', () => {
    expect(read('CharactersScreen.tsx')).toContain('snapshot.catalog.characters');
    expect(read('SkillsScreen.tsx')).toContain('snapshot.catalog.skills');
    expect(read('SkillsScreen.tsx')).toContain('>= 6');
    expect(read('ProgressionScreen.tsx')).toContain('snapshot.skillCostRules');
    expect(read('ProgressionScreen.tsx')).toContain('snapshot.levelRules');
    expect(read('ProgressionScreen.tsx')).toContain("'Rule missing'");
    expect(read('ProgressionScreen.tsx')).toContain('if (cost === null) return;');
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
    expect(workbench).toContain('sessions.isHydrating');
    expect(workbench).toContain('sessions.retryPersistence');
    expect(workbench).toContain('sessions.loadCloudVersion');
    expect(workbench).toContain('actionLabel');
  });
});
