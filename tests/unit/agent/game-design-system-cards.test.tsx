import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMessage } from '@/components/agent/ChatMessage';
import { mapHistoryMessagesToChatItems } from '@/components/agent/historyMessageMapper';
import type { ChatItem } from '@/components/agent/types';

jest.mock('@/components/agent/AssistantMarkdown', () => ({ AssistantMarkdown: () => null }));

const warning = 'Professional GDD generation may automatically submit up to three paid map images.';

describe('GDS generation cards', () => {
  it('shows the sealed target, mode, version and paid warning before GDD approval', () => {
    const item: ChatItem = { id: 'confirm', role: 'confirmation', confirmation: {
      actionId: 'action', tool: 'generate_gdd', confirmationMode: 'pre_execute',
      args: { projectId: 'project-a', designSystemId: 'system-a', versionId: 'version-a', mode: 'professional', warning },
    } };
    const markup = renderToStaticMarkup(<ChatMessage item={item} streaming={false} onDecision={jest.fn()} />);
    for (const text of ['project-a', 'system-a', 'version-a', 'professional', warning, 'Approve action']) expect(markup).toContain(text);
  });

  it('shows the exact explicit apply target before approval', () => {
    const item: ChatItem = { id: 'confirm', role: 'confirmation', confirmation: {
      actionId: 'action', tool: 'apply_game_design_system', confirmationMode: 'pre_execute',
      args: { projectId: 'project-a', designSystemId: 'system-a', versionId: 'version-a' },
    } };
    const markup = renderToStaticMarkup(<ChatMessage item={item} streaming={false} onDecision={jest.fn()} />);
    for (const text of ['project-a', 'system-a', 'version-a']) expect(markup).toContain(text);
  });

  it.each(['gdd', 'game-design-system'])('renders bounded %s job status live and from history', (jobType) => {
    const data = { jobType, jobId: 'job-a', status: 'queued', private: 'private-sentinel' };
    const item: ChatItem = { id: 'tool', role: 'tool', toolCall: { tool: 'get_generation_status', status: 'success', data } };
    const markup = renderToStaticMarkup(<ChatMessage item={item} streaming={false} onDecision={jest.fn()} />);
    expect(markup).toContain('queued'); expect(markup).toContain('job-a'); expect(markup).not.toContain('private-sentinel');
    const history = mapHistoryMessagesToChatItems([{ id: 'old', role: 'tool', content: { name: 'get_generation_status', content: JSON.stringify({ success: true, displayHint: 'text', data }) } }]);
    expect(renderToStaticMarkup(<ChatMessage item={history[0]} streaming={false} onDecision={jest.fn()} />)).toContain('generation-job-status');
    expect(renderToStaticMarkup(<ChatMessage item={{ ...item, toolCall: { ...item.toolCall!, status: 'failure' } }} streaming={false} onDecision={jest.fn()} />)).toBe('');
  });

  it.each([null, {}, { jobType: 'gdd', jobId: {}, status: 'queued' }, { jobType: 'other', jobId: 'a', status: 'queued' }])('does not render malformed generation status %#', (data) => {
    const item: ChatItem = { id: 'tool', role: 'tool', toolCall: { tool: 'get_generation_status', status: 'success', data } };
    expect(renderToStaticMarkup(<ChatMessage item={item} streaming={false} onDecision={jest.fn()} />)).toBe('');
  });
});
