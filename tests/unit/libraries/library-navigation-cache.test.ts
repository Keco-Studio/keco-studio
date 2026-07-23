import { describe, expect, it } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';

import { primeLibraryNavigationCache } from '@/components/layout/libraryNavigationCache';
import { queryKeys } from '@/lib/utils/queryKeys';
import type { Library } from '@/lib/services/libraryService';

const conversation: Library = {
  id: 'conversation-id',
  project_id: 'project-id',
  folder_id: null,
  name: 'Story Conversation',
  description: null,
  created_at: '2026-07-23T00:00:00.000Z',
  updated_at: '2026-07-23T00:00:00.000Z',
  updated_by: null,
  source_document_id: 'document-id',
  document_export_type: 'script',
};

describe('library navigation cache', () => {
  it('primes the selected conversion metadata before the first navigation render', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.library(conversation.id), {
      ...conversation,
      document_export_type: 'table',
    });

    primeLibraryNavigationCache(queryClient, conversation);

    expect(queryClient.getQueryData(queryKeys.library(conversation.id))).toEqual(conversation);
  });
});
