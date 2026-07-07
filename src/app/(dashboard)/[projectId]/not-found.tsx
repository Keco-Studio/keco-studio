import { RouteNotFoundBoundary } from '@/components/shared/RouteBoundary';

export default function ProjectNotFound() {
  return (
    <RouteNotFoundBoundary
      title="Project not found"
      message="The requested project does not exist or is no longer available."
    />
  );
}
