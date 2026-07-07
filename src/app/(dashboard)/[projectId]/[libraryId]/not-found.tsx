import { RouteNotFoundBoundary } from '@/components/shared/RouteBoundary';

export default function LibraryNotFound() {
  return (
    <RouteNotFoundBoundary
      title="Library not found"
      message="The requested library does not exist or is no longer available."
    />
  );
}
