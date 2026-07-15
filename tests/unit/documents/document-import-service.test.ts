import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const parseDocument = jest.fn();
const validateDesignFile = jest.fn();
const getCurrentUserId = jest.fn();
const uploadDocumentImagesAtomically = jest.fn();
const cleanupUploadedDocumentImages = jest.fn();
const createDocument = jest.fn();
const deleteDocument = jest.fn();
const initialize = jest.fn();
const createDocumentImportCheckpoint = jest.fn();
const rpc = jest.fn();
const publishImportedDocument = jest.fn();

jest.mock('@/lib/document-parser', () => ({
  parseDocument: (...args: unknown[]) => parseDocument(...args),
  validateDesignFile: (...args: unknown[]) => validateDesignFile(...args),
}));
jest.mock('@/lib/services/authorizationService', () => ({
  getCurrentUserId: (...args: unknown[]) => getCurrentUserId(...args),
}));
jest.mock('@/lib/services/documentImageUpload', () => ({
  uploadDocumentImagesAtomically: (...args: unknown[]) => uploadDocumentImagesAtomically(...args),
  cleanupUploadedDocumentImages: (...args: unknown[]) => cleanupUploadedDocumentImages(...args),
}));
jest.mock('@/lib/services/documentService', () => ({
  createDocument: (...args: unknown[]) => createDocument(...args),
  deleteDocument: (...args: unknown[]) => deleteDocument(...args),
}));
jest.mock('@/lib/documents/documentStateGateway', () => ({
  documentStateGateway: {
    initialize: (...args: unknown[]) => initialize(...args),
  },
}));
jest.mock('@/lib/documents/documentVersionService', () => ({
  createDocumentImportCheckpoint: (...args: unknown[]) => createDocumentImportCheckpoint(...args),
}));
jest.mock('@/lib/documents/documentContentCodec', () => ({
  documentContentCodec: {
    markdownToYjsState: async (markdown: string) => `state:${markdown}`,
  },
}));
jest.mock('@/lib/documents/documentImportPublisher', () => ({
  publishImportedDocument: (...args: unknown[]) => publishImportedDocument(...args),
  isDocumentImportDefinitelyUnpublished: (error: unknown) =>
    typeof error === 'object' &&
    error !== null &&
    (error as { publicationState?: unknown }).publicationState === 'not-published',
}));

import {
  buildImportedDocumentMarkdown,
  createImportedDocument,
  documentNameFromFile,
} from '../../../src/lib/documents/documentImportService';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const PLACEHOLDER = 'https://document-import.invalid/image-0';
const PUBLIC_URL = 'https://storage.example/user/image.png';
const client = { rpc } as never;

function file(name: string): File {
  return new File(['source'], name, { type: 'application/octet-stream' });
}

describe('document import service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    validateDesignFile.mockReturnValue({ ok: true });
    getCurrentUserId.mockResolvedValue('user-1');
    uploadDocumentImagesAtomically.mockResolvedValue([]);
    cleanupUploadedDocumentImages.mockResolvedValue(undefined);
    createDocument.mockResolvedValue({
      id: DOCUMENT_ID,
      project_id: PROJECT_ID,
      folder_id: null,
      name: 'world',
      content: '',
      created_by: 'user-1',
      created_at: '2026-07-15T00:00:00.000Z',
      updated_at: '2026-07-15T00:00:00.000Z',
    });
    initialize.mockResolvedValue({ token: { epoch: 1, revision: 1 } });
    createDocumentImportCheckpoint.mockResolvedValue({ type: 'import' });
    deleteDocument.mockResolvedValue(undefined);
    rpc.mockResolvedValue({
      data: [{
        id: DOCUMENT_ID,
        project_id: PROJECT_ID,
        folder_id: null,
        name: 'world',
        content: '# World',
        created_by: 'user-1',
        created_at: '2026-07-15T00:00:00.000Z',
        updated_at: '2026-07-15T00:00:00.000Z',
      }],
      error: null,
    });
    publishImportedDocument.mockResolvedValue({
      id: DOCUMENT_ID,
      project_id: PROJECT_ID,
      folder_id: null,
      name: 'world',
      content: '# World',
      created_by: 'user-1',
      created_at: '2026-07-15T00:00:00.000Z',
      updated_at: '2026-07-15T00:00:00.000Z',
    });
  });

  it('derives a stable document name from the source filename', () => {
    expect(documentNameFromFile('world.design.md')).toBe('world.design');
    expect(documentNameFromFile('.md')).toBe('Imported document');
  });

  it('preserves validated Markdown without adding a duplicate heading', () => {
    expect(
      buildImportedDocumentMarkdown({
        fileName: 'guide.md',
        text: '# Existing\n\n<Callout type="note">\nRead me.\n</Callout>',
        imageUrls: [],
      })
    ).toBe('# Existing\n\n<Callout type="note">\nRead me.\n</Callout>');
  });

  it('turns plain text into a titled document and appends uploaded images', () => {
    const markdown = buildImportedDocumentMarkdown({
      fileName: 'notes.txt',
      text: 'First paragraph.\n\nSecond paragraph.',
      imageUrls: ['https://example.com/one.png'],
    });

    expect(markdown).toContain('# notes');
    expect(markdown).toContain('First paragraph.\n\nSecond paragraph.');
    expect(markdown).toContain('![Imported image 1](https://example.com/one.png)');
  });

  it('turns each non-empty plain-text line into a Markdown paragraph', () => {
    const markdown = buildImportedDocumentMarkdown({
      fileName: 'notes.txt',
      text: 'First line\nSecond line',
      imageUrls: [],
    });

    expect(markdown).toContain('First line\n\nSecond line');
  });

  it('rejects empty and unsafe imported content before persistence', () => {
    expect(() =>
      buildImportedDocumentMarkdown({ fileName: 'empty.txt', text: '   ', imageUrls: [] })
    ).toThrow('Could not extract any text');
    expect(() =>
      buildImportedDocumentMarkdown({ fileName: 'unsafe.md', text: '<Unknown />', imageUrls: [] })
    ).toThrow();
  });

  it('validates provisional Markdown before uploading or publishing', async () => {
    parseDocument.mockResolvedValue({ text: '<Unknown />', images: [] });

    await expect(createImportedDocument(client, {
      projectId: PROJECT_ID,
      file: file('unsafe.md'),
    })).rejects.toThrow();

    expect(uploadDocumentImagesAtomically).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('reuses file validation before parsing or persistence', async () => {
    validateDesignFile.mockReturnValue({ ok: false, error: 'The file is too large (limit is 10MB).' });

    await expect(createImportedDocument(client, {
      projectId: PROJECT_ID,
      file: file('large.docx'),
    })).rejects.toThrow('too large');

    expect(parseDocument).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('keeps DOCX images in place and creates an initial import checkpoint', async () => {
    parseDocument.mockResolvedValue({
      text: `# World\n\nBefore ![Imported image 1](${PLACEHOLDER}) after.`,
      images: [{ data: new ArrayBuffer(6000), contentType: 'image/png', placeholder: PLACEHOLDER }],
    });
    uploadDocumentImagesAtomically.mockResolvedValue([{ placeholder: PLACEHOLDER, url: PUBLIC_URL, storagePath: 'user-1/image.png' }]);

    const imported = await createImportedDocument(client, {
      projectId: PROJECT_ID,
      folderId: '33333333-3333-4333-8333-333333333333',
      file: file('world.docx'),
    });

    expect(imported.markdown).toContain(`Before ![Imported image 1](${PUBLIC_URL}) after.`);
    expect(publishImportedDocument).toHaveBeenCalledWith(client, expect.objectContaining({
      documentId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      versionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      projectId: PROJECT_ID,
      folderId: '33333333-3333-4333-8333-333333333333',
      markdown: expect.stringContaining(PUBLIC_URL),
    }));
    expect(createDocument).not.toHaveBeenCalled();
    expect(initialize).not.toHaveBeenCalled();
    expect(createDocumentImportCheckpoint).not.toHaveBeenCalled();
  });

  it('removes uploaded images when document publication fails', async () => {
    parseDocument.mockResolvedValue({
      text: `Image ![Imported image 1](${PLACEHOLDER})`,
      images: [{ data: new ArrayBuffer(6000), contentType: 'image/png', placeholder: PLACEHOLDER }],
    });
    const uploaded = [{ placeholder: PLACEHOLDER, url: PUBLIC_URL, storagePath: 'user-1/image.png' }];
    uploadDocumentImagesAtomically.mockResolvedValue(uploaded);
    publishImportedDocument.mockRejectedValue(
      Object.assign(new Error('create failed'), { publicationState: 'not-published' })
    );

    await expect(createImportedDocument(client, {
      projectId: PROJECT_ID,
      file: file('world.docx'),
    })).rejects.toThrow('create failed');

    expect(cleanupUploadedDocumentImages).toHaveBeenCalledWith(client, uploaded);
  });

  it('preserves uploaded images when document publication may already be committed', async () => {
    parseDocument.mockResolvedValue({
      text: `Image ![Imported image 1](${PLACEHOLDER})`,
      images: [{ data: new ArrayBuffer(6000), contentType: 'image/png', placeholder: PLACEHOLDER }],
    });
    const uploaded = [{ placeholder: PLACEHOLDER, url: PUBLIC_URL, storagePath: 'user-1/image.png' }];
    uploadDocumentImagesAtomically.mockResolvedValue(uploaded);
    publishImportedDocument.mockRejectedValue(
      Object.assign(new Error('publish response was lost'), { publicationState: 'unknown' })
    );

    await expect(createImportedDocument(client, {
      projectId: PROJECT_ID,
      file: file('world.docx'),
    })).rejects.toThrow('publish response was lost');

    expect(cleanupUploadedDocumentImages).not.toHaveBeenCalled();
  });

  it('deletes the document and images when checkpoint creation fails', async () => {
    parseDocument.mockResolvedValue({
      text: `Image ![Imported image 1](${PLACEHOLDER})`,
      images: [{ data: new ArrayBuffer(6000), contentType: 'image/png', placeholder: PLACEHOLDER }],
    });
    const uploaded = [{ placeholder: PLACEHOLDER, url: PUBLIC_URL, storagePath: 'user-1/image.png' }];
    uploadDocumentImagesAtomically.mockResolvedValue(uploaded);
    publishImportedDocument.mockRejectedValue(
      Object.assign(new Error('checkpoint failed'), { publicationState: 'not-published' })
    );

    await expect(createImportedDocument(client, {
      projectId: PROJECT_ID,
      file: file('world.docx'),
    })).rejects.toThrow('checkpoint failed');

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(cleanupUploadedDocumentImages).toHaveBeenCalledWith(client, uploaded);
  });

  it('reports cleanup failures together with the publication failure', async () => {
    parseDocument.mockResolvedValue({
      text: `Image ![Imported image 1](${PLACEHOLDER})`,
      images: [{ data: new ArrayBuffer(6000), contentType: 'image/png', placeholder: PLACEHOLDER }],
    });
    uploadDocumentImagesAtomically.mockResolvedValue([{ placeholder: PLACEHOLDER, url: PUBLIC_URL, storagePath: 'user-1/image.png' }]);
    publishImportedDocument.mockRejectedValue(
      Object.assign(new Error('create failed'), { publicationState: 'not-published' })
    );
    cleanupUploadedDocumentImages.mockRejectedValue(new Error('cleanup failed'));

    await expect(createImportedDocument(client, {
      projectId: PROJECT_ID,
      file: file('world.docx'),
    })).rejects.toThrow(/create failed[\s\S]*cleanup failed/i);
  });
});
