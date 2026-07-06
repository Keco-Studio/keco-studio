'use client';

export default function LibraryError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ padding: 32, maxWidth: 720 }}>
      <h1>Unable to load this library</h1>
      <p>The library view hit an unexpected error.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
