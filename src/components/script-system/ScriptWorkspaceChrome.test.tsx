/** @jest-environment jsdom */

import React from 'react';
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ScriptStructureTemplate } from '@/lib/script-system/scriptStructureTemplates';
import type { ScriptStructureValidation } from '@/lib/script-system/scriptWorkspaceStructure';
import { ScriptWorkspaceToolbar } from './ScriptWorkspaceToolbar';
import { ScriptStructureCheckModal } from './ScriptStructureCheckModal';
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
  name: '我的模板',
  description: '用于悬疑场景',
  createdAt: '2026-10-30T10:00:00.000Z',
  graph: {
    nodes: [{ id: 'entry', label: '开场', rowIndex: 0, rowIndexes: [0] }],
    edges: [],
  },
  counts: { nodes: 1, choices: 0, merges: 0, endings: 0 },
  isBuiltIn: false,
};

describe('ScriptWorkspaceToolbar', () => {
  it('exposes all approved actions without an animation action', () => {
    const callbacks = {
      onOpenTemplates: jest.fn(),
      onSaveAsTemplate: jest.fn(),
      onOpenChecks: jest.fn(),
      onSave: jest.fn(),
    };
    render(
      <ScriptWorkspaceToolbar
        libraryName="深夜客房"
        issueCount={2}
        isSaving={false}
        {...callbacks}
      />,
    );

    expect(screen.getByText('剧情脚本')).not.toBeNull();
    expect(screen.getByText('深夜客房')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '模板' }));
    fireEvent.click(screen.getByRole('button', { name: '保存为模板' }));
    fireEvent.click(screen.getByRole('button', { name: '结构检查，2 个问题' }));
    fireEvent.click(screen.getByRole('button', { name: '保存脚本' }));

    expect(callbacks.onOpenTemplates).toHaveBeenCalledTimes(1);
    expect(callbacks.onSaveAsTemplate).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenChecks).toHaveBeenCalledTimes(1);
    expect(callbacks.onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('生成动画')).toBeNull();
  });
});

describe('ScriptStructureCheckModal', () => {
  it('lets an evidence-bearing issue navigate to its node', () => {
    const onSelectNode = jest.fn();
    const validation: ScriptStructureValidation = {
      issues: [{
        id: 'unreachable-orphan',
        code: 'unreachable-node',
        severity: 'warning',
        message: '“遗漏场景”无法从入口到达',
        nodeId: 'orphan',
      }],
      errorCount: 0,
      warningCount: 1,
    };
    render(
      <ScriptStructureCheckModal
        open
        validation={validation}
        onClose={jest.fn()}
        onSelectNode={onSelectNode}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /遗漏场景/ }));
    expect(onSelectNode).toHaveBeenCalledWith('orphan');
  });
});

describe('ScriptTemplateModal', () => {
  it('uses references without mutating them and permits only personal deletion', () => {
    const builtIn = { ...template, id: 'built-in-linear', name: '线性场景', isBuiltIn: true };
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

    fireEvent.click(screen.getByRole('button', { name: '使用 线性场景 作为参考' }));
    fireEvent.click(screen.getByRole('button', { name: '删除 我的模板' }));

    expect(onUseReference).toHaveBeenCalledWith('built-in-linear');
    expect(onDeleteTemplate).toHaveBeenCalledWith('personal-one');
    expect(screen.queryByRole('button', { name: '删除 线性场景' })).toBeNull();
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

    fireEvent.click(screen.getByRole('button', { name: '确认保存模板' }));
    expect(screen.getByText('请输入模板名称')).not.toBeNull();
    expect(onSaveTemplate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: '模板名称' }), {
      target: { value: '  深夜分支  ' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '模板说明' }), {
      target: { value: '  两路汇合  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认保存模板' }));

    await waitFor(() => {
      expect(onSaveTemplate).toHaveBeenCalledWith('深夜分支', '两路汇合');
      expect(screen.getByRole('button', { name: '确认保存模板' }).hasAttribute('disabled'))
        .toBe(false);
    });
  });
});
