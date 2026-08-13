import fs from 'node:fs';
import path from 'node:path';

describe('script dialogue editing chrome', () => {
  const componentSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/script-system/ScriptEditableDialogBlock.tsx'),
    'utf8',
  );
  const stylesSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/libraries/components/VisualNovelScriptView.module.css'),
    'utf8',
  );

  it('shows drag and delete controls for hover, editing, or an open picker', () => {
    expect(componentSource).toMatch(
      /<div className=\{styles\.editControls\}[^>]*>\s*\{showChrome \? \(/,
    );
    expect(componentSource).not.toMatch(
      /<div className=\{styles\.editControls\}[^>]*>\s*\{isEditing \? \(/,
    );
  });

  it('matches the 32px bordered undo and redo button specification', () => {
    const historyButtonRule = stylesSource.match(/\.historyButton \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(historyButtonRule).toContain('width: 2rem;');
    expect(historyButtonRule).toContain('height: 2rem;');
    expect(historyButtonRule).toContain('box-sizing: border-box;');
    expect(historyButtonRule).toContain('padding: 6px;');
    expect(historyButtonRule).toContain('gap: 4px;');
    expect(historyButtonRule).toContain('border: 1px solid #e7e7e7;');
    expect(historyButtonRule).toContain('background: #ffffff;');
  });

  it('uses the screenshot-style linear undo and redo icons', () => {
    const viewSource = fs.readFileSync(
      path.join(process.cwd(), 'src/components/libraries/components/VisualNovelScriptView.tsx'),
      'utf8',
    );

    expect(viewSource).toContain('function HistoryIcon');
    expect(viewSource).toContain('direction="undo"');
    expect(viewSource).toContain('direction="redo"');
    expect(viewSource).not.toContain('UndoOutlined');
    expect(viewSource).not.toContain('RedoOutlined');
  });

  it('opens a character switcher from the avatar and persists the selection', () => {
    expect(componentSource).toContain('aria-label={`Switch ${block.speaker} character`}');
    expect(componentSource).toContain('aria-label="SWITCH CHARACTER"');
    expect(componentSource).toContain('await onChangeSpeaker(character.name)');
  });

  it('switches between action and dialogue editors without saving on internal blur', () => {
    expect(componentSource).toContain("beginEditAt('action')");
    expect(componentSource).toContain("beginEditAt('dialogue')");
    expect(componentSource).not.toContain('onBlur={() => { void commitDrafts(); }}');
  });

  it('deletes an empty block when editing finishes outside it', () => {
    expect(componentSource).toContain('if (isDialogueDraftEmpty(reconciledDrafts))');
    expect(componentSource).toContain('await deleteDialogueBlockAndHide(onDelete');
  });

  it('keeps the drag handle on the outer edge for both dialogue alignments', () => {
    expect(stylesSource).toMatch(
      /\.editableDialogRow\.right \.editControls \{[\s\S]*?flex-direction: row-reverse;/,
    );
  });
});
