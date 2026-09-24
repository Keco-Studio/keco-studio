/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { DirectMapSourceForm } from '@/features/create-map/components/DirectMapSourceForm';

afterEach(cleanup);
const props = () => ({
  title: 'Village map', onBack: jest.fn(), onCreate: jest.fn(), onCreatePlan: jest.fn(), canCreate: true, busy: false,
  readOnly: false, error: null, attachedDocument: null, onClearAttachedDocument: jest.fn(), onAttachFile: jest.fn(),
  onAttachKecoDocument: jest.fn(), revisionNumber: 2, downloadUrl: 'https://example.test/map.png',
  history: [{ revisionId: 'revision-1', revisionNumber: 1 }], onViewMapPlan: jest.fn(),
});

describe('direct Map source controls', () => {
  it('keeps create/view/download/history and source attachments without a chat entry', () => {
    const input = props();
    render(<DirectMapSourceForm {...input} />);
    expect(screen.getByText('Village map')).toBeTruthy();
    expect(screen.getByText('Map generation history')).toBeTruthy();
    expect(screen.getByText('Download map').getAttribute('download')).toBe('');
    expect(screen.queryByText('Send')).toBeNull();
    expect(screen.queryByLabelText('Ask AI to help')).toBeNull();
    fireEvent.click(screen.getByText('Attach Keco Document'));
    fireEvent.click(screen.getByText('View map plan'));
    fireEvent.click(screen.getByText('Create map'));
    expect(input.onAttachKecoDocument).toHaveBeenCalledTimes(1);
    expect(input.onViewMapPlan).toHaveBeenCalledTimes(1);
    expect(input.onCreate).toHaveBeenCalledTimes(1);
  });

  it('creates a plan from the ordinary description form and supports file attachment', () => {
    const input = props();
    render(<DirectMapSourceForm {...input} />);
    fireEvent.change(screen.getByLabelText('Map description'), { target: { value: 'A village beside a lake' } });
    fireEvent.click(screen.getByText('Create plan'));
    expect(input.onCreatePlan).toHaveBeenCalledWith('A village beside a lake');
    const file = new File(['Design'], 'map.md', { type: 'text/markdown' });
    fireEvent.change(screen.getByLabelText('Attach design file'), { target: { files: [file] } });
    expect(input.onAttachFile).toHaveBeenCalledWith(file);
  });

  it('keeps viewers out of creation and attachment controls', () => {
    render(<DirectMapSourceForm {...props()} readOnly />);
    expect(screen.queryByLabelText('Map description')).toBeNull();
    expect((screen.getByText('Create map') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('View map plan')).toBeTruthy();
  });
});
