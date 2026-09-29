export type PersistedMapVersion = {
  mapRevisionId: string;
  mapVersionNumber: number;
};

export function mapVersionLabelForRevision(
  versions: PersistedMapVersion[],
  revisionId: string | null,
): string | null {
  if (!revisionId) return null;
  const version = versions.find((candidate) => candidate.mapRevisionId === revisionId);
  return version ? `Map V${version.mapVersionNumber}` : null;
}
