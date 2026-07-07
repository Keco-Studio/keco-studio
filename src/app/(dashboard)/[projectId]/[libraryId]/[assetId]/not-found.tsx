import { RouteNotFoundBoundary } from '@/components/shared/RouteBoundary';

export default function AssetNotFound() {
  return (
    <RouteNotFoundBoundary
      title="Asset not found"
      message="The requested asset does not exist or is no longer available."
    />
  );
}
