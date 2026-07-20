import {
  createDocumentExportSnapshotToken,
  verifyDocumentExportSnapshotToken,
} from '@/lib/server/documentExportSnapshotSigning';

jest.mock('server-only', () => ({}));

const source = {
  documentId: '55555555-5555-4555-8555-555555555555',
  documentName: 'World Notes',
  projectId: '22222222-2222-4222-8222-222222222222',
  folderId: null,
  markdown: '# World\n\nFrozen content',
  token: { epoch: 3, revision: 9 },
};

describe('document export snapshot signing', () => {
  it('round-trips the canonical source through a signed token', () => {
    const token = createDocumentExportSnapshotToken(source);
    expect(verifyDocumentExportSnapshotToken(token)).toEqual(source);
  });

  it('rejects a token whose payload was tampered with', () => {
    const token = createDocumentExportSnapshotToken(source);
    const [payload, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown[];
    decoded[5] = '# Forged';
    const forgedPayload = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');

    expect(() => verifyDocumentExportSnapshotToken(`${forgedPayload}.${signature}`)).toThrow(
      'Invalid document export snapshot token'
    );
  });

  it('rejects malformed and truncated signatures', () => {
    const token = createDocumentExportSnapshotToken(source);
    const [payload] = token.split('.');
    expect(() => verifyDocumentExportSnapshotToken('not-a-token')).toThrow();
    expect(() => verifyDocumentExportSnapshotToken(`${payload}.00`)).toThrow();
  });
});
