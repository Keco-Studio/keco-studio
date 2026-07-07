'use client';

import { RouteErrorBoundary } from '@/components/shared/RouteBoundary';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteErrorBoundary
      title="Unable to load Keco Studio"
      message="The app hit an unexpected error."
      reset={reset}
    />
  );
}
