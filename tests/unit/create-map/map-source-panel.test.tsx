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
    documents: [{ id: 'document-1', name: 'Document one' }],
    onDescriptionChange: jest.fn(),
    onProjectChange: jest.fn(),
    onDocumentChange: jest.fn(),
    onCreatePlan: jest.fn(),
  };

  it.each(['调用 API 生成地图', 'Authorization: Bearer secret'])('marks a disallowed description Invalid: %s', (description) => {
    const markup = renderToStaticMarkup(React.createElement(MapSourcePanel, {
      ...baseProps, description, projectId: 'project-1', documentId: '',
    }));

    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('Invalid');
    expect(markup).toContain('Description contains disallowed content');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Generate map plan<\/button>/);
  });

  it('allows token as ordinary game-design language', () => {
    const markup = renderToStaticMarkup(React.createElement(MapSourcePanel, {
      ...baseProps,
      description: 'Place a collectible token beside the village gate.',
      projectId: 'project-1',
      documentId: '',
    }));

    expect(markup).not.toContain('aria-invalid="true"');
    expect(markup).not.toContain('Description contains disallowed content');
  });

  it('orders Project and Document before an empty optional Description', () => {
    const markup = renderToStaticMarkup(React.createElement(MapSourcePanel, {
      ...baseProps, description: '', projectId: 'project-1', documentId: 'document-1',
    }));

    expect(markup.indexOf('Project')).toBeLessThan(markup.indexOf('Document'));
    expect(markup.indexOf('Document')).toBeLessThan(markup.indexOf('Description'));
    expect(markup).toContain('placeholder="Optional additions or changes to the selected document"');
    expect(markup).not.toContain('Save draft');
    expect(markup).not.toMatch(/>Generate map<\/button>/);
    expect(markup).toMatch(/<button[^>]*>Generate map plan<\/button>/);
  });

  it('requires a Project and either a Document or Description', () => {
    const noProject = renderToStaticMarkup(React.createElement(MapSourcePanel, {
      ...baseProps, description: 'A village map', projectId: '', documentId: '',
    }));
    const noSource = renderToStaticMarkup(React.createElement(MapSourcePanel, {
      ...baseProps, description: '', projectId: 'project-1', documentId: '',
    }));
    const documentOnly = renderToStaticMarkup(React.createElement(MapSourcePanel, {
      ...baseProps, description: '', projectId: 'project-1', documentId: 'document-1',
    }));

    expect(noProject).toMatch(/<button[^>]*disabled=""[^>]*>Generate map plan<\/button>/);
    expect(noSource).toMatch(/<button[^>]*disabled=""[^>]*>Generate map plan<\/button>/);
    expect(documentOnly).toMatch(/<button[^>]*>Generate map plan<\/button>/);
  });
});
