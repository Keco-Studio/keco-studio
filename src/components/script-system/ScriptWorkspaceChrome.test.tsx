/** @jest-environment jsdom */

import React from 'react';
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ScriptStructureTemplate } from '@/lib/script-system/scriptStructureTemplates';
import { ScriptWorkspaceToolbar } from './ScriptWorkspaceToolbar';
import { ScriptTemplateModal } from './ScriptTemplateModal';

beforeAll(() => {
  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = (element: Element) => getComputedStyle(element);
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  });
});

afterEach(cleanup);

const template: ScriptStructureTemplate = {
  id: 'personal-one',
  name: 'My Template',
  description: 'For suspense scenes',
  createdAt: '2026-10-30T10:00:00.000Z',
  graph: {
    nodes: [{ id: 'entry', label: 'Opening', rowIndex: 0, rowIndexes: [0] }],
    edges: [],
  },
  counts: { nodes: 1, choices: 0, merges: 0, endings: 0 },
  isBuiltIn: false,
};

describe('ScriptWorkspaceToolbar', () => {
  it('exposes only the approved template actions', () => {
    const callbacks = {
      onOpenTemplates: jest.fn(),
      onSaveAsTemplate: jest.fn(),
    };
    render(
      <ScriptWorkspaceToolbar
        libraryName="Midnight Guest Room"
        {...callbacks}
      />,
    );

    expect(screen.getByText('Story Script')).not.toBeNull();
    expect(screen.getByText('Midnight Guest Room')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save as Template' }));

    expect(callbacks.onOpenTemplates).toHaveBeenCalledTimes(1);
    expect(callbacks.onSaveAsTemplate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Structure Check/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save Script' })).toBeNull();
    expect(screen.queryByText('Generate Animation')).toBeNull();
  });
});

describe('ScriptTemplateModal', () => {
  it('uses references without mutating them and permits only personal deletion', () => {
    const builtIn = { ...template, id: 'built-in-linear', name: 'Linear Scene', isBuiltIn: true };
    const onUseReference = jest.fn();
    const onDeleteTemplate = jest.fn();
    render(
      <ScriptTemplateModal
        open
        mode="browse"
        templates={[builtIn, template]}
        activeReferenceId={null}
        onClose={jest.fn()}
        onUseReference={onUseReference}
        onDeleteTemplate={onDeleteTemplate}
        onSaveTemplate={jest.fn((_name: string, _description: string) => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use Linear Scene as reference' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete My Template' }));

    expect(onUseReference).toHaveBeenCalledWith('built-in-linear');
    expect(onDeleteTemplate).toHaveBeenCalledWith('personal-one');
    expect(screen.queryByRole('button', { name: 'Delete Linear Scene' })).toBeNull();
  });

  it('validates the template name before requesting a save', async () => {
    const onSaveTemplate = jest.fn((_name: string, _description: string) => undefined);
    render(
      <ScriptTemplateModal
        open
        mode="save"
        templates={[]}
        activeReferenceId={null}
        onClose={jest.fn()}
        onUseReference={jest.fn()}
        onDeleteTemplate={jest.fn()}
        onSaveTemplate={onSaveTemplate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirm save template' }));
    expect(screen.getByText('Please enter a template name')).not.toBeNull();
    expect(onSaveTemplate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Template name' }), {
      target: { value: '  Midnight Branch  ' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Template description' }), {
      target: { value: '  Two paths rejoin  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm save template' }));

    await waitFor(() => {
      expect(onSaveTemplate).toHaveBeenCalledWith('Midnight Branch', 'Two paths rejoin');
      expect(screen.getByRole('button', { name: 'Confirm save template' }).hasAttribute('disabled'))
        .toBe(false);
    });
  });
});
