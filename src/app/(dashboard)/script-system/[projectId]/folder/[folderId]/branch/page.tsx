'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { DocumentBranchStructure, type DocumentBranchDocument, type DocumentBranchEdge } from '@/components/script-system/DocumentBranchStructure';

export default function DocumentBranchPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const folderId = params.folderId as string;
  const [data, setData] = useState<{ documents: DocumentBranchDocument[]; edges: DocumentBranchEdge[]; folderName: string }>({ documents: [], edges: [], folderName: 'Folder' });

  useEffect(() => {
    let active = true;
    void fetch(`/api/script-document-edges/${projectId}/${folderId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load branch structure');
        return response.json() as Promise<{ folderName: string; documents: DocumentBranchDocument[]; edges: DocumentBranchEdge[] }>;
      })
      .then((next) => { if (active) setData(next); })
      .catch(() => { if (active) setData({ documents: [], edges: [], folderName: 'Folder' }); });
    return () => { active = false; };
  }, [folderId, projectId]);

  return <DocumentBranchStructure projectId={projectId} folderId={folderId} folderName={data.folderName} documents={data.documents} edges={data.edges} />;
}
