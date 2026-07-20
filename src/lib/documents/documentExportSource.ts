export type DocumentExportSource = {
  documentId: string;
  documentName: string;
  projectId: string;
  folderId: string | null;
  markdown: string;
  token: { epoch: number; revision: number };
};
