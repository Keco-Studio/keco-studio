import { isStorageQuotaResponse, storageQuotaMessage } from '@/lib/storageQuotaMessage';

describe('storage quota upload messages', () => {
  it('tells owners and collaborators the appropriate cleanup or upgrade action', () => {
    expect(storageQuotaMessage(true)).toBe('Your storage is full. Clean up space or upgrade your plan.');
    expect(storageQuotaMessage(false)).toBe('This project storage is full. Contact the project owner to clean up space or upgrade the plan.');
  });

  it('recognizes the safe quota API response without exposing internal codes', () => {
    expect(isStorageQuotaResponse(new Response(null, { status: 409 }), { error: 'Storage quota exceeded' })).toBe(true);
  });
});
