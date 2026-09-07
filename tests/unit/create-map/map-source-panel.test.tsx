import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapSourcePanel } from '@/features/create-map/components/MapSourcePanel';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

describe('MapSourcePanel', () => {
  const baseProps = {
    projects: [{ id: 'project-1', name: 'Project one' }],
    onProjectChange: jest.fn(),
  };

  it('renders Map Generator branding and the selected project', () => {
    const markup = renderToStaticMarkup(React.createElement(MapSourcePanel, {
      ...baseProps,
      projectId: 'project-1',
    }));

    expect(markup).toContain('Map Generator');
    expect(markup).toContain('Manage and config game assets for game designers.');
    expect(markup).toContain('Project one');
    expect(markup).toContain('aria-label="Project"');
  });

  it('prompts for a project when none is selected', () => {
    const markup = renderToStaticMarkup(React.createElement(MapSourcePanel, {
      ...baseProps,
      projectId: '',
    }));

    expect(markup).toContain('Select project');
  });

  it('disables the project picker while busy or read-only', () => {
    const busy = renderToStaticMarkup(React.createElement(MapSourcePanel, {
      ...baseProps, projectId: 'project-1', busy: true,
    }));
    const readOnly = renderToStaticMarkup(React.createElement(MapSourcePanel, {
      ...baseProps, projectId: 'project-1', readOnly: true,
    }));

    expect(busy).toContain('disabled=""');
    expect(readOnly).toContain('disabled=""');
  });
});
