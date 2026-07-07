'use client';

import { RouteErrorBoundary } from '@/components/shared/RouteBoundary';

export default function AssetError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteErrorBoundary
      title="Unable to load this asset"
      message="The asset view hit an unexpected error."
      reset={reset}
    />
  );
}
