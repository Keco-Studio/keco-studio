import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Keco Script - Keco Studio',
  description: 'Manage and config game assets for game designers.',
};

export default function ScriptSystemLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
