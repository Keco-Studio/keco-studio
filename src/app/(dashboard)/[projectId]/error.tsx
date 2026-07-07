'use client';

import { RouteErrorBoundary } from '@/components/shared/RouteBoundary';

export default function ProjectError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteErrorBoundary
      title="Unable to load this project"
      message="The project view hit an unexpected error."
      reset={reset}
    />
  );
}
