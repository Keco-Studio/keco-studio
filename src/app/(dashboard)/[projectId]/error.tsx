'use client';

export default function ProjectError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ padding: 32, maxWidth: 720 }}>
      <h1>Unable to load this project</h1>
      <p>The project view hit an unexpected error.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
