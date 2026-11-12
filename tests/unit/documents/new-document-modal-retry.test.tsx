/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockCreateDocument = jest.fn();

jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: () => ({ client: 'supabase' }),
}));

jest.mock('@/lib/services/documentService', () => ({
  createDocument: (...args: unknown[]) => mockCreateDocument(...args),
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt = '', ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} {...props} />
  ),
}));

import { NewDocumentModal } from '@/components/documents/NewDocumentModal';

describe('NewDocumentModal creation retry', () => {
  it('retries post-create work with the same document instead of creating a duplicate', async () => {
    mockCreateDocument.mockResolvedValue({ id: 'document-1' });
    const onCreated = jest
      .fn()
      .mockRejectedValueOnce(new Error('Failed to add document to Script workspace'))
      .mockResolvedValueOnce(undefined);
    const onClose = jest.fn();

    render(
      <NewDocumentModal
        open
        projectId="project-1"
        folderId="folder-1"
        onClose={onClose}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByLabelText('Document Name'), {
      target: { value: 'Opening Scene' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(
      await screen.findByText('Failed to add document to Script workspace'),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(2));
    expect(onCreated).toHaveBeenNthCalledWith(1, 'document-1');
    expect(onCreated).toHaveBeenNthCalledWith(2, 'document-1');
    expect(mockCreateDocument).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
