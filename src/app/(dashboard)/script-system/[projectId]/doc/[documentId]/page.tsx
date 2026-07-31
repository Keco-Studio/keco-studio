'use client';

import { useParams } from 'next/navigation';

/**
 * Minimal stub so Import navigation does not 404.
 * Task 5 will embed DocumentEditor + workspace membership guard.
 */
export default function ScriptDocumentPageStub() {
  const params = useParams();
  const documentId = params.documentId as string;

  return (
    <div style={{ padding: 8, color: '#64748b' }}>
      Document {documentId} — editor coming soon.
    </div>
  );
}
