'use client';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ padding: 32, maxWidth: 720 }}>
      <h1>Unable to load Keco Studio</h1>
      <p>The app hit an unexpected error.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
