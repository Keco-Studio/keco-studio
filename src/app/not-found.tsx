import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ padding: 32, maxWidth: 720 }}>
      <h1>View not found</h1>
      <p>The requested Keco Studio view does not exist or is no longer available.</p>
      <Link href="/projects">Back to projects</Link>
    </main>
  );
}
