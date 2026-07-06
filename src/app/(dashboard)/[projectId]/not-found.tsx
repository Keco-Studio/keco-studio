import Link from 'next/link';

export default function ProjectNotFound() {
  return (
    <main style={{ padding: 32, maxWidth: 720 }}>
      <h1>Project not found</h1>
      <p>The requested project does not exist or is no longer available.</p>
      <Link href="/projects">Back to projects</Link>
    </main>
  );
}
