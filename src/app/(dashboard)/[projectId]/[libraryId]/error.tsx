'use client';

import { RouteErrorBoundary } from '@/components/shared/RouteBoundary';

export default function LibraryError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteErrorBoundary
      title="Unable to load this library"
      message="The library view hit an unexpected error."
      reset={reset}
    />
  );
}
