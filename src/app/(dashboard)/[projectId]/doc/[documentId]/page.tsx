'use client';

import { useParams } from 'next/navigation';
import { DocumentEditor } from '@/components/documents/DocumentEditor';

export default function DocumentPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const documentId = params.documentId as string;

  return (
    <DocumentEditor
      key={documentId}
      projectId={projectId}
      documentId={documentId}
    />
  );
}
