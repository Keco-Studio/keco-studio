import type {
  GameDesignSourceSnapshot,
  GameDesignSystemDetail,
  GameDesignSystemVersion,
} from '@/lib/services/gameDesignSystemService';

type SourceVisibility = {
  viewerUserId: string;
  readableProjectIds: ReadonlySet<string>;
};

function redactSnapshot(
  snapshot: GameDesignSourceSnapshot,
  detail: GameDesignSystemDetail,
  visibility: SourceVisibility,
): GameDesignSourceSnapshot {
  const canRead = snapshot.projectId
    ? visibility.readableProjectIds.has(snapshot.projectId)
    : snapshot.kind === 'legacy_markdown' && detail.owner_id === visibility.viewerUserId;
  if (canRead) return { ...snapshot };
  const { excerpt: _excerpt, ...metadata } = snapshot;
  return metadata;
}

export function redactGameDesignSystemDetailSources(
  detail: GameDesignSystemDetail,
  visibility: SourceVisibility,
): GameDesignSystemDetail {
  const versions = detail.versions.map((version): GameDesignSystemVersion => {
    const { art_style: _rawArtStyle, ...safeVersion } = version as GameDesignSystemVersion & {
      art_style?: unknown;
    };
    return {
      ...safeVersion,
      source_snapshots: version.source_snapshots.map((snapshot) =>
        redactSnapshot(snapshot, detail, visibility)),
    };
  });
  return {
    ...detail,
    versions,
    current_version: versions.find((version) => version.id === detail.current_version?.id) ?? null,
  };
}
