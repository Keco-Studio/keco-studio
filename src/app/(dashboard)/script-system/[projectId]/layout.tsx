'use client';

import { useParams } from 'next/navigation';
import { ScriptShell } from '@/components/script-system/ScriptShell';

export default function ScriptProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const projectId = params.projectId as string;
  return <ScriptShell projectId={projectId}>{children}</ScriptShell>;
}
