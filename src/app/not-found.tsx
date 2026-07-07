import { RouteNotFoundBoundary } from '@/components/shared/RouteBoundary';

export default function NotFound() {
  return (
    <RouteNotFoundBoundary
      title="View not found"
      message="The requested Keco Studio view does not exist or is no longer available."
    />
  );
}
