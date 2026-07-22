
import { parseImportFolderId } from '@/lib/services/importService';

describe('parseImportFolderId', () => {
  it('treats empty as root', () => {
    expect(parseImportFolderId('')).toBeNull();
    expect(parseImportFolderId(null)).toBeNull();
  });
  it('accepts uuid folders', () => {
    expect(parseImportFolderId('11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
  });
  it('rejects garbage', () => {
    expect(() => parseImportFolderId('nope')).toThrow(/Invalid folderId/);
  });
});
