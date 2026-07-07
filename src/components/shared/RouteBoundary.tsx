'use client';

import Link from 'next/link';

/**
 * Shared chrome for App Router error.tsx / not-found.tsx boundaries.
 *
 * Previously 8 near-identical boundary files hand-copied the same layout,
 * padding, retry button, and back-link. Centralize the presentation here so a
 * chrome change (padding, button style, back-link target) is a single edit.
 */

const containerStyle: React.CSSProperties = { padding: 32, maxWidth: 720 };

/** error.tsx boundary: shows a message and a retry button wired to `reset`. */
export function RouteErrorBoundary({
  title,
  message,
  reset,
}: {
  title: string;
  message: string;
  reset: () => void;
}) {
  return (
    <main style={containerStyle}>
      <h1>{title}</h1>
      <p>{message}</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}

/** not-found.tsx boundary: shows a message and a back-link (defaults to /projects). */
export function RouteNotFoundBoundary({
  title,
  message,
  backHref = '/projects',
  backLabel = 'Back to projects',
}: {
  title: string;
  message: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <main style={containerStyle}>
      <h1>{title}</h1>
      <p>{message}</p>
      <Link href={backHref}>{backLabel}</Link>
    </main>
  );
}
