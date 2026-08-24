import fs from 'node:fs';
import path from 'node:path';

const editorPath = path.resolve(
  __dirname,
  '../../../src/components/documents/MdxDocumentEditor.tsx',
);
const pluginPath = path.resolve(
  __dirname,
  '../../../src/components/documents/documentTableCopyPlugin.tsx',
);
const selectionPluginPath = path.resolve(
  __dirname,
  '../../../src/components/documents/documentTableCellSelectionPlugin.tsx',
);

const pastePluginPath = path.resolve(
  __dirname,
  '../../../src/components/documents/documentTablePastePlugin.tsx',
);

describe('document table copy wiring', () => {
  const editorSource = fs.readFileSync(editorPath, 'utf8');
  const pluginSource = fs.readFileSync(pluginPath, 'utf8');
  const selectionPluginSource = fs.readFileSync(selectionPluginPath, 'utf8');
  const pastePluginSource = fs.readFileSync(pastePluginPath, 'utf8');

  it('registers the table copy plugin alongside the table plugin', () => {
    expect(editorSource).toContain("import { documentTableCopyPlugin } from './documentTableCopyPlugin'");
    expect(editorSource).toContain("import { documentTableCellSelectionPlugin } from './documentTableCellSelectionPlugin'");
    expect(editorSource).toContain('tablePlugin()');
    expect(editorSource).toContain('documentTableCellSelectionPlugin()');
    expect(editorSource).toContain('documentTableCopyPlugin()');
    expect(editorSource).toContain('documentTablePastePlugin()');
    const tablePluginIndex = editorSource.indexOf('tablePlugin()');
    const selectionPluginIndex = editorSource.indexOf('documentTableCellSelectionPlugin()');
    const copyPluginIndex = editorSource.indexOf('documentTableCopyPlugin()');
    const pastePluginIndex = editorSource.indexOf('documentTablePastePlugin()');
    expect(selectionPluginIndex).toBeGreaterThan(tablePluginIndex);
    expect(copyPluginIndex).toBeGreaterThan(selectionPluginIndex);
    expect(pastePluginIndex).toBeGreaterThan(copyPluginIndex);
  });

  it('handles copy in both the root editor and nested table cell editors', () => {
    expect(pluginSource).toContain('addComposerChild$');
    expect(pluginSource).toContain('addTableCellEditorChild$');
    expect(pluginSource).toContain('COPY_COMMAND');
    expect(pluginSource).toContain('$isTableNode');
    expect(pluginSource).toContain('documentTableSelection$');
    expect(pluginSource).toContain('contentEditableWrapperElement$');
    expect(pluginSource).toContain('document.addEventListener(\'copy\', onCopy, true)');
    expect(pluginSource).toContain('stopImmediatePropagation');
    expect(pluginSource).toContain('resolveMatrixFromTableElement');
    expect(pluginSource).not.toContain("from '@/lib/documents/documentTablePaste'");
  });

  it('supports drag selection through a dedicated composer child', () => {
    expect(selectionPluginSource).toContain('addComposerChild$');
    expect(selectionPluginSource).toContain('documentTableSelection$');
    expect(selectionPluginSource).toContain('contentEditableWrapperElement$');
  });

  it('pastes tabular clipboard data into the active table instead of inserting a new block', () => {
    expect(pastePluginSource).toContain('PASTE_COMMAND');
    expect(pastePluginSource).toContain('locateTableNodeFromTableElement');
    expect(pastePluginSource).toContain('addTableCellEditorChild$');
  });
});
