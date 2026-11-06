/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ScriptFlowEditor } from './ScriptFlowEditor';
const snapshot = { fingerprint: 'a'.repeat(32), canEdit: true, diagnostics: [], rows: [
  { id: '11111111-1111-4111-8111-111111111111', values: { Content: 'Opening', Label: 'A' } },
  { id: '22222222-2222-4222-8222-222222222222', values: { Content: 'Ending', Label: 'B', Commands: 'End' } },
] };
describe('Script flow editor', () => {
  beforeEach(() => { global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => snapshot }); });
  it('flushes dialogue before loading and allows cancel without a write', async () => {
    const flush = jest.fn().mockResolvedValue(true);
    render(<ScriptFlowEditor projectId="p" libraryId="l" selectedRowIds={[]} beforeOpen={flush} onSaved={jest.fn()} />);
    fireEvent.click(screen.getByText('Edit flow'));
    await screen.findByLabelText('Source row');
    expect(flush).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Cancel'));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not open if the dialogue draft failed to save', async () => {
    render(<ScriptFlowEditor projectId="p" libraryId="l" selectedRowIds={[]} beforeOpen={async () => false} onSaved={jest.fn()} />);
    fireEvent.click(screen.getByText('Edit flow'));
    await screen.findByRole('alert');
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('keeps the draft on conflict and does not offer writes to a viewer', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ ...snapshot, canEdit: false }) });
    render(<ScriptFlowEditor projectId="p" libraryId="l" selectedRowIds={[]} beforeOpen={async () => true} onSaved={jest.fn()} />);
    fireEvent.click(screen.getByText('Edit flow'));
    await screen.findByText('Read-only access');
    expect(screen.queryByText('Save flow')).toBeNull();
  });
  it('retains request identity for retry and prevents a second simultaneous submit', async () => {
    const onSaved = jest.fn();
    render(<ScriptFlowEditor projectId="p" libraryId="l" selectedRowIds={[]} beforeOpen={async () => true} onSaved={onSaved} />);
    fireEvent.click(screen.getByText('Edit flow'));
    await screen.findByLabelText('Source row');
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: 'end' } });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, json: async () => ({ error: 'Conflict' }) });
    fireEvent.click(screen.getByText('Save flow'));
    await screen.findByText('Conflict');
    fireEvent.click(screen.getByText('Save flow'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(JSON.parse(calls[1][1].body).requestId).toBe(JSON.parse(calls[2][1].body).requestId);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
