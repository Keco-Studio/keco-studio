import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapChatPanel } from '@/features/create-map/components/MapChatPanel';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => React.createElement('img', props),
}));

jest.mock('@/assets/images/paper.svg', () => 'paper');

describe('MapChatPanel', () => {
  const baseProps = {
    mapTitle: 'Village map',
    messages: [
      { id: '1', role: 'user' as const, text: 'Make a village map' },
      { id: '2', role: 'assistant' as const, text: 'Here is the created map plan' },
    ],
    onBack: jest.fn(),
    onCreate: jest.fn(),
    onAsk: jest.fn(),
    onGenerate: jest.fn(),
    canAsk: true,
    canGenerate: true,
    showGenerate: true,
  };

  it('renders chat header actions, search, and generate control', () => {
    const markup = renderToStaticMarkup(React.createElement(MapChatPanel, baseProps));

    expect(markup).toContain('Village map');
    expect(markup).toContain('aria-label="Create map"');
    expect(markup).toContain('aria-label="Filter messages"');
    expect(markup).toContain('aria-label="Search messages"');
    expect(markup).toContain('Make a village map');
    expect(markup).toContain('Generate map');
    expect(markup).toContain('Ask AI to help...');
  });

  it('wires the attach control for File and Keco Document actions', () => {
    const markup = renderToStaticMarkup(React.createElement(MapChatPanel, {
      ...baseProps,
      onAttachFile: jest.fn(),
      onAttachKecoDocument: jest.fn(),
    }));

    expect(markup).toContain('aria-label="Attach"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toMatch(/aria-label="Attach"[^>]*aria-haspopup="menu"/);
    expect(markup).not.toMatch(/aria-label="Attach"[^>]*disabled/);
  });
});
