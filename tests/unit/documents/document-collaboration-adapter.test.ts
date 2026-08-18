import { readFileSync } from 'node:fs';
import path from 'node:path';

const pluginPath = path.join(
  process.cwd(),
  'src/components/documents/documentCollaborationPlugin.ts'
);
const editorPath = path.join(
  process.cwd(),
  'src/components/documents/MdxDocumentEditor.tsx'
);
const editorCssPath = path.join(
  process.cwd(),
  'src/components/documents/MdxDocumentEditor.module.css'
);
const plugin = readFileSync(pluginPath, 'utf8');
const editor = readFileSync(editorPath, 'utf8');
const editorCss = readFileSync(editorCssPath, 'utf8');

describe('document Lexical Yjs adapter contract', () => {
  it('consumes one shared session instead of duplicate provider/doc state', () => {
    expect(plugin).toContain('session: DocumentCollaborationSession');
    expect(editor).toContain('session: DocumentCollaborationSession');
    expect(editor).not.toMatch(/provider: Provider;[\s\S]+doc: Doc;/);
  });

  it('keeps one stable plugin set while read-only status changes', () => {
    expect(editor).toContain('useMemo(');
    expect(editor).toContain('showToolbar');
    expect(editor).not.toContain('if (!readOnly)');
    expect(editor).not.toContain('showToolbar && !readOnly');
    expect(editor).toMatch(/if \(showToolbar\) \{[\s\S]*toolbarPlugin\(/);
    // readOnly must not gate plugin registration — MDXEditor only inits plugins once.
    expect(editor).not.toMatch(/readOnly[\s\S]{0,40}toolbarPlugin/);
  });

  it('keeps the formatting toolbar sticky in the content scroll viewport', () => {
    expect(editor).toMatch(
      /toolbarPlugin\(\{[\s\S]*toolbarClassName:\s*styles\.stickyToolbar/
    );
    expect(editorCss).toMatch(/\.stickyToolbar\s*\{[^}]*position:\s*sticky/);
    expect(editorCss).toMatch(
      /\.stickyToolbar\s*\{[^}]*top:\s*var\(--document-sticky-chrome-height/
    );
    expect(editorCss).toMatch(/\.editor\s*\{[^}]*overflow:\s*visible/);
    expect(editorCss).not.toMatch(/\.editor\s*\{[^}]*overflow:\s*hidden/);
  });

  it('creates the binding only from a committed Lexical composer effect', () => {
    expect(plugin).toContain('addComposerChild$');
    expect(plugin).toContain('useLexicalComposerContext');
    expect(plugin).toContain('useEffect(');
    expect(plugin).not.toContain('createRootEditorSubscription$');
  });

  it('shares one binding across the Strict Effect cleanup and setup cycle', () => {
    expect(plugin).toContain('activeEditorBindings');
    expect(plugin).toContain('WeakMap<LexicalEditor');
    expect(plugin).toContain('existing.refs += 1');
    expect(plugin).toContain('entry.refs -= 1');
    expect(plugin).toContain('entry.releasePending = true');
    expect(plugin).toContain('existing.releasePending = false');
  });

  it('attaches the durable state only after the Yjs observer is registered', () => {
    const observeIndex = plugin.indexOf('.observeDeep(onYjsTreeChanges)');
    const attachIndex = plugin.indexOf('session.attachBinding()');
    expect(observeIndex).toBeGreaterThan(0);
    expect(attachIndex).toBeGreaterThan(observeIndex);
  });

  it('keeps Chinese IME intermediates out of Yjs and flushes once after composition', () => {
    expect(plugin).toContain('editor.isComposing()');
    expect(plugin).toContain("addEventListener('compositionend'");
    expect(plugin).toContain('queuedRemote');
    expect(plugin).toContain('compositionState');
    expect(plugin).toContain('compositionState.prevEditorState');
    expect(plugin).toContain('mergeCompositionChanges');
    expect(plugin).not.toContain('editorState,\n    editorState,');
    expect(plugin).toContain('queueMicrotask(flushAfterComposition)');
  });

  it('uses Yjs-local Undo/Redo instead of MDXEditor shared history', () => {
    expect(plugin).toContain('createUndoManager');
    expect(plugin).toContain('UNDO_COMMAND');
    expect(plugin).toContain('REDO_COMMAND');
    expect(plugin).toContain('undoManager.undo()');
    expect(plugin).toContain('undoManager.redo()');
    expect(editor).toContain('suppressSharedHistory={Boolean(collaboration)}');
  });

  it('fails the session closed and rethrows every structural sync error', () => {
    expect(plugin).not.toContain('sync skipped');
    expect(plugin).not.toContain('console.warn');
    expect(plugin).toContain('session.reportBindingFailure');
    expect(plugin).toMatch(
      /catch \(error\) \{[\s\S]{0,240}session\.reportBindingFailure\([\s\S]{0,160}throw error;/
    );
  });

  it('cleans observers, commands, cursor overlays, and UndoManager exactly once', () => {
    expect(plugin).toContain('.unobserveDeep(onYjsTreeChanges)');
    expect(plugin).toContain('removeUpdateListener()');
    expect(plugin).toContain('removeUndo()');
    expect(plugin).toContain('removeRedo()');
    expect(plugin).toContain('undoManager.destroy()');
    expect(plugin).toContain('binding.cursorsContainer?.remove()');
    expect(plugin).toContain('cancelAnimationFrame(cursorRefreshFrame)');
    expect(plugin).toContain('cursorMutationObserver.disconnect()');
  });

  it('moves cursor observation and composition handling when Lexical replaces its root', () => {
    expect(plugin).toContain('editor.registerRootListener');
    expect(plugin).toContain("previousRoot?.removeEventListener('compositionend'");
    expect(plugin).toContain("nextRoot.addEventListener('compositionend'");
    expect(plugin).toContain('binding.cursorsContainer?.parentElement !== parent');
    expect(plugin).toContain('cursorMutationObserver.disconnect()');
    expect(plugin).toContain('isDetachedNodeError');
    expect(plugin).toContain('Keep the overlay attached across temporary null roots');
  });
});
