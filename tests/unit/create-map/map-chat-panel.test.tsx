/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
    generationHistory: [{ revisionId: 'revision-1', label: 'V1', isCurrent: true }],
    onViewMapPlan: jest.fn(),
    ...overrides,
  };
  render(<MapChatPanel {...props} />);
  return props;
}

describe('MapChatPanel', () => {
  it('renders searchable messages, plan and image cards, and generation history', () => {
    renderPanel();
    expect(screen.getByRole('region', { name: 'Map conversation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View map plan' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download map' }).getAttribute('href')).toBe('/map.png');
    fireEvent.click(screen.getByRole('button', { name: 'Show map generation history' }));
    expect(screen.getByText('V1')).toBeTruthy();
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
