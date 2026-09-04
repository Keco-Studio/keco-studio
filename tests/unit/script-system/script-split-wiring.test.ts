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
    expect(source).toContain('isFetching');
    // Redirect waits for settled fetch; render keeps going while refetching.
    expect(source).toMatch(/membershipSettled\s*=\s*membershipReady\s*&&\s*!isFetching/);
    expect(source).toMatch(/canRender\s*=\s*membershipReady/);
    expect(source).not.toMatch(/canRender\s*=\s*[^\n]*!isFetching/);
    expect(source).toMatch(/router\.(replace|push)/);
    expect(source).toContain(`/script-system/\${projectId}`);
    expect(source).toContain('getLibraryAssetsWithProperties');
    expect(source).toContain('getLibrarySchema');
    expect(source).toMatch(/schemaError|assetsError/);
    expect(source).toContain('showErrorToast');
    expect(source).toMatch(/assetsSchemaSettled|schemaFetched|assetsFetched/);
    expect(source).toMatch(/detectScriptColumns|scriptColumns/);
    expect(source).toContain('ScriptSplitView');
    expect(source).toContain('summarizeScriptPlotTitlesClient');
    expect(source).toContain('openingGraph');
    expect(source).toContain('!openingGraph');
    expect(source).not.toMatch(/setAiReady\(\s*\{\s*key:\s*titleWaitKey,\s*graph:\s*baseGraph/);
    expect(source).not.toContain('LibraryAssetsTable');
  });

  it('ScriptSplitView wires VN pane, divider persistence, and TopBar Flow chart toggle', () => {
    const source = read(
      'src/components/script-system/ScriptSplitView.tsx'
    );
    expect(source).toContain('VisualNovelScriptView');
    expect(source).toContain('FlowChartPanel');
    expect(source).toContain('readSplitRatio');
    expect(source).toContain('writeSplitRatio');
    expect(source).toMatch(/mousemove|mouseup/);
    expect(source).toContain('240');
    expect(source).toMatch(/collapse|collapsed|setCollapsed/i);
    expect(source).toContain('SCRIPT_FLOW_CHART_TOGGLE_EVENT');
    expect(source).toContain('broadcastScriptFlowChartState');
    expect(source).toContain('selectedPlotNodeId');
    expect(source).toContain('selectedRows');
    expect(source).toContain('mode="plot-node"');
    expect(source).not.toContain('Show Flow chart');
    expect(source).not.toContain('summarizeScriptPlotTitlesClient');
  });

  it('TopBar Script actions reuse Share and Flow chart toggle', () => {
    const topBar = read('src/components/layout/TopBar.tsx');
    const actions = read(
      'src/components/script-system/ScriptTopBarActions.tsx'
    );
    expect(topBar).toContain('ScriptTopBarActions');
    expect(topBar).toContain('isScriptSystemPath');
    expect(actions).toContain('InviteCollaboratorModal');
    expect(actions).toContain('script-flow-chart-toggle');
    expect(actions).toContain('requestScriptFlowChartToggle');
  });

  it('FlowChartPanel renders plot SVG nodes and option labels', () => {
    const source = read(
      'src/components/script-system/FlowChartPanel.tsx'
    );
    expect(source).toContain('<svg');
    expect(source).toContain('Flow chart');
    expect(source).toContain('selectedPlotNodeId');
    expect(source).toContain('onSelectPlotNode');
    expect(source).toContain('edge.optionText');
    expect(source).toMatch(/empty|no nodes|No flow/i);
  });
});
