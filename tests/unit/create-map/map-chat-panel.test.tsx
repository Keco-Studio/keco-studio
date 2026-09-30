/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

const messages = [
  { id: '1', role: 'user' as const, text: 'Make a village map' },
  { id: '2', role: 'assistant' as const, text: 'Here is the created map plan' },
  { id: '3', role: 'assistant' as const, text: 'Here is the created map' },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof MapChatPanel>> = {}) {
  const props: React.ComponentProps<typeof MapChatPanel> = {
    mapTitle: 'Village map',
    messages,
    onBack: jest.fn(),
    onCreate: jest.fn(),
    onAsk: jest.fn(),
    canAsk: true,
    mapPlan: { title: 'Village map plan', versionLabel: 'Version1' },
    mapImage: { title: 'Village map', versionLabel: 'Version1', downloadUrl: '/map.png' },
    generationHistory: [{ mapRevisionId: 'revision-1', mapVersionNumber: 1, planVersionNumber: 1, isCurrent: true }],
    onSelectMapVersion: jest.fn(),
    onViewMapPlan: jest.fn(),
    ...overrides,
  };
  render(<MapChatPanel {...props} />);
  return props;
}

describe('MapChatPanel', () => {
  it('renders chat header actions and search without a generate control', () => {
    const markup = renderToStaticMarkup(React.createElement(MapChatPanel, {
      mapTitle: 'Village map',
      messages,
      onBack: jest.fn(),
      onCreate: jest.fn(),
      onAsk: jest.fn(),
      canAsk: true,
      mapPlan: { title: 'Village map plan', versionLabel: 'Version1' },
      mapImage: { title: 'Village map', versionLabel: 'Version1', downloadUrl: 'https://example.test/map.png' },
      onViewMapPlan: jest.fn(),
      generationHistory: [
        { mapRevisionId: 'revision-2', mapVersionNumber: 2, planVersionNumber: 4, isCurrent: true },
        { mapRevisionId: 'revision-1', mapVersionNumber: 1, planVersionNumber: 1, isCurrent: false },
      ],
      onSelectMapVersion: jest.fn(),
    }));

    expect(markup).toContain('Village map');
    expect(markup).toContain('aria-label="Create map"');
    expect(markup).toContain('aria-label="Show map generation history"');
    expect(markup).not.toMatch(/aria-label="Show map generation history"[^>]*disabled/);
    expect(markup).not.toContain('aria-label="Filter messages"');
    expect(markup).toContain('aria-label="Search messages"');
    expect(markup).toContain('Make a village map');
    expect(markup).not.toContain('Generate Map');
    expect(markup).toContain('Village map plan');
    expect(markup).toContain('aria-label="View map plan"');
    expect(markup).toContain('MAP V1');
    expect(markup).toContain('MAP V2');
    expect(markup).toContain('Plan V1');
    expect(markup).toContain('Plan V4');
    expect(markup).toContain('data-history-version="1"');
    expect(markup).toContain('data-history-version="2"');
    expect(markup).toContain('aria-label="Open Map V1 with Plan V1"');
    expect(markup).toContain('aria-label="Open Map V2 with Plan V4"');
    expect(markup).toContain('aria-label="Download map"');
    expect(markup).toContain('Ask AI to help...');
    expect(markup).toMatch(/aria-label="Send"[^>]*>[\s\S]*?anticon-arrow-up/);
  });

  it('renders searchable messages, plan and image cards, and generation history', () => {
    renderPanel();
    expect(screen.getByRole('region', { name: 'Map conversation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View map plan' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download map' }).getAttribute('href')).toBe('/map.png');
    fireEvent.click(screen.getByRole('button', { name: 'Show map generation history' }));
    expect(screen.getByText('MAP V1')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search messages' }), { target: { value: 'village' } });
    expect(screen.getByText('Make a village map')).toBeTruthy();
    expect(screen.queryByText('Here is the created map plan')).toBeNull();
  });

  it('submits a prompt and opens the attachment actions', () => {
    const onAsk = jest.fn();
    const onAttachKecoDocument = jest.fn();
    renderPanel({ onAsk, onAttachFile: jest.fn(), onAttachKecoDocument });
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask AI to help' }), { target: { value: 'A river crossing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAsk).toHaveBeenCalledWith('A river crossing');
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(screen.getByRole('menuitem', { name: 'File' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keco Document' }));
    expect(onAttachKecoDocument).toHaveBeenCalledTimes(1);
  });
});
