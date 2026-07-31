import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Keco Script split view wiring', () => {
  it('splitRatioStorage exports read/write/clamp with persistence key', () => {
    const source = read('src/lib/script-system/splitRatioStorage.ts');
    expect(source).toContain('keco.script.splitRatio');
    expect(source).toContain('0.68');
    expect(source).toContain('0.35');
    expect(source).toContain('0.8');
    expect(source).toMatch(/export function readSplitRatio/);
    expect(source).toMatch(/export function writeSplitRatio/);
    expect(source).toMatch(/export function clampSplitRatio/);
  });

  it('script page guards script export type + workspace membership then renders ScriptSplitView', () => {
    const source = read(
      'src/app/(dashboard)/script-system/[projectId]/script/[libraryId]/page.tsx'
    );
    expect(source).toContain('getLibrary');
    expect(source).toContain("document_export_type");
    expect(source).toContain("'script'");
    expect(source).toContain('source_document_id');
    expect(source).toContain('useScriptWorkspaceMembership');
    expect(source).toMatch(/router\.(replace|push)/);
    expect(source).toContain(`/script-system/\${projectId}`);
    expect(source).toContain('getLibraryAssetsWithProperties');
    expect(source).toContain('getLibrarySchema');
    expect(source).toMatch(/schemaError|assetsError/);
    expect(source).toContain('showErrorToast');
    expect(source).toMatch(/assetsSchemaSettled|schemaFetched|assetsFetched/);
    expect(source).toMatch(/detectScriptColumns|scriptColumns/);
    expect(source).toContain('ScriptSplitView');
    expect(source).not.toContain('LibraryAssetsTable');
  });

  it('ScriptSplitView wires VN pane, divider persistence, and collapsible Flow chart', () => {
    const source = read(
      'src/components/script-system/ScriptSplitView.tsx'
    );
    expect(source).toContain('VisualNovelScriptView');
    expect(source).toContain('FlowChartPanel');
    expect(source).toContain('readSplitRatio');
    expect(source).toContain('writeSplitRatio');
    expect(source).toMatch(/mousemove|mouseup/);
    expect(source).toContain('240');
    expect(source).toContain('Flow chart');
    expect(source).toMatch(/collapse|collapsed|setCollapsed/i);
  });

  it('FlowChartPanel builds SVG graph from buildScriptFlowGraph', () => {
    const source = read(
      'src/components/script-system/FlowChartPanel.tsx'
    );
    expect(source).toContain('buildScriptFlowGraph');
    expect(source).toContain('<svg');
    expect(source).toContain('Flow chart');
    expect(source).toMatch(/selected|onClick/);
    expect(source).toMatch(/empty|no nodes|No flow/i);
  });
});
