import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Keco Script - Keco Studio',
  description: 'Turn design documents into editable dialogue scripts and branching flows.',
};

export default function ScriptSystemLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
