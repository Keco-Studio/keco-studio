'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { App, Button, Spin } from 'antd';
import { DownloadOutlined, FileImageOutlined, FileOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { PanelHeader } from '@/components/shared/PanelHeader';
import {
  parseGameAssetsCategoryParam,
  type GameAssetStatus,
  type ProjectGameAsset,
} from '@/lib/services/gameAssetsService';
import { projectAssetMimeFromName } from '@/lib/services/projectAssetUploadContract';
import styles from './GameAssetsPage.module.css';

type ApiResponse = { assets: ProjectGameAsset[]; warnings: Array<{ source: string; message: string }> };

function formatBytes(value: number | null): string {
  if (!value) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status: GameAssetStatus): string {
  return status === 'generating' ? 'Generating' : status.charAt(0).toUpperCase() + status.slice(1);
}

function isImage(asset: ProjectGameAsset): boolean {
  return asset.mimeType?.startsWith('image/') === true && asset.mimeType !== 'image/vnd.adobe.photoshop';
}

function isVideo(asset: ProjectGameAsset): boolean {
  return asset.mimeType === 'video/mp4';
}

function isAudio(asset: ProjectGameAsset): boolean {
  return asset.mimeType?.startsWith('audio/') === true;
}

const FALLBACK_ASPECT = 4 / 3;
const TARGET_ROW_HEIGHT = 168;
const COL_GAP = 14;

type SizedAsset = {
  asset: ProjectGameAsset;
  previewSrc: string | null;
  aspect: number;
};

type JustifiedItem = SizedAsset & {
  width: number;
  height: number;
};

function resolveSizedAsset(asset: ProjectGameAsset, measuredAspects: Record<string, number>): SizedAsset {
  const width = asset.width;
  const height = asset.height;
  const metaAspect = width && height && width > 0 && height > 0 ? width / height : null;
  const aspect = measuredAspects[asset.id] ?? metaAspect ?? FALLBACK_ASPECT;
  return { asset, previewSrc: asset.previewUrl, aspect };
}

/** Pack items into rows like a desktop photo gallery (justified, no tall empty gaps). */
function buildJustifiedRows(
  items: SizedAsset[],
  containerWidth: number,
  targetRowHeight = TARGET_ROW_HEIGHT,
  gap = COL_GAP,
): JustifiedItem[][] {
  if (containerWidth <= 0 || items.length === 0) return [];

  const rows: JustifiedItem[][] = [];
  let current: SizedAsset[] = [];
  let aspectSum = 0;

  const flush = (stretch: boolean) => {
    if (!current.length) return;
    const gaps = gap * (current.length - 1);
    const available = Math.max(containerWidth - gaps, 1);
    const rowHeight = stretch
      ? available / aspectSum
      : Math.min(targetRowHeight, available / aspectSum);
    rows.push(
      current.map((item) => ({
        ...item,
        width: item.aspect * rowHeight,
        height: rowHeight,
      })),
    );
    current = [];
    aspectSum = 0;
  };

  for (const item of items) {
    const nextAspect = aspectSum + item.aspect;
    const nextWidth = nextAspect * targetRowHeight + gap * current.length;
    if (current.length > 0 && nextWidth > containerWidth) {
      flush(true);
    }
    current.push(item);
    aspectSum += item.aspect;
  }
  flush(false);
  return rows;
}

export function GameAssetsPage({ projectId }: { projectId: string }) {
  const { message } = App.useApp();
  const searchParams = useSearchParams();
  const category = parseGameAssetsCategoryParam(searchParams?.get('category'));
  const [selected, setSelected] = useState<ProjectGameAsset | null>(null);
  const [measuredAspects, setMeasuredAspects] = useState<Record<string, number>>({});
  const gridRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const assetsQuery = useQuery<ApiResponse>({
    queryKey: ['project-game-assets', projectId],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/game-assets`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load game assets');
      return response.json() as Promise<ApiResponse>;
    },
    staleTime: 10_000,
  });
  const assets = useMemo(() => assetsQuery.data?.assets ?? [], [assetsQuery.data?.assets]);
  const filtered = useMemo(() => {
    return assets.filter((asset) => category === 'all' || asset.category === category);
  }, [assets, category]);

  const sized = useMemo(
    () => filtered.map((asset) => resolveSizedAsset(asset, measuredAspects)),
    [filtered, measuredAspects],
  );

  useLayoutEffect(() => {
    const node = gridRef.current;
    if (!node) return;
    const update = () => setContainerWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(
    () => buildJustifiedRows(sized, containerWidth),
    [sized, containerWidth],
  );

  const handleMeasuredAspect = useCallback((assetId: string, aspect: number) => {
    setMeasuredAspects((prev) => {
      const existing = prev[assetId];
      if (existing && Math.abs(existing - aspect) < 0.01) return prev;
      return { ...prev, [assetId]: aspect };
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected]);

  const selectedPreview = useMemo(() => {
    if (!selected) return null;
    return resolveSizedAsset(selected, measuredAspects).previewSrc;
  }, [selected, measuredAspects]);

  const uploadAssets = async (files: FileList | null) => {
    if (!files?.length) return;
    if (files.length > 20) {
      message.error('At most 20 assets can be uploaded at once');
      return;
    }
    setUploading(true);
    try {
      const selectedFiles = Array.from(files);
      const metadata = selectedFiles.map((file) => ({
        fileName: file.name,
        fileType: file.type || projectAssetMimeFromName(file.name) || 'application/octet-stream',
        fileSize: file.size,
      }));
      const prepareResponse = await fetch(`/api/projects/${projectId}/game-assets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'prepare', files: metadata }),
      });
      const prepared = await prepareResponse.json() as {
        error?: string;
        failedCount?: number;
        items?: Array<{
          index: number;
          ok: boolean;
          path?: string;
          file?: typeof metadata[number];
          upload?: { url: string; method: 'PUT'; headers: Record<string, string> };
        }>;
      };
      if (!prepareResponse.ok || !prepared.items) throw new Error(prepared.error ?? 'Upload preparation failed');

      let failedCount = prepared.failedCount ?? 0;
      const completionItems = [];
      for (const item of prepared.items) {
        if (!item.ok || !item.path || !item.file || !item.upload) continue;
        try {
          const uploadResponse = await fetch(item.upload.url, {
            method: item.upload.method,
            headers: item.upload.headers,
            body: selectedFiles[item.index],
          });
          if (!uploadResponse.ok) {
            failedCount += 1;
            continue;
          }
          completionItems.push({ ...item.file, path: item.path });
        } catch {
          failedCount += 1;
        }
      }

      let completedCount = 0;
      if (completionItems.length > 0) {
        const completeResponse = await fetch(`/api/projects/${projectId}/game-assets`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'complete', items: completionItems }),
        });
        const completed = await completeResponse.json() as { completedCount?: number; failedCount?: number; error?: string };
        if (!completeResponse.ok) throw new Error(completed.error ?? 'Upload completion failed');
        completedCount = completed.completedCount ?? 0;
        failedCount += completed.failedCount ?? 0;
      }
      if (failedCount > 0) message.error(`${failedCount} asset(s) failed to upload`);
      else message.success(`${completedCount} asset(s) uploaded`);
      if (completedCount > 0) await assetsQuery.refetch();
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  return (
    <div className={styles.page} data-testid="game-assets-page">
      <div className={styles.workspace}>
        <section className={styles.fileArea} aria-label="Game asset files">
          <div className={styles.toolbar}>
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              hidden
              accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.mp4,.mp3,.m4a,.wav,.ogg,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.json,.psd"
              onChange={(event) => void uploadAssets(event.target.files)}
            />
            <Button loading={uploading} onClick={() => uploadInputRef.current?.click()}>Upload assets</Button>
          </div>
          {assetsQuery.isLoading ? <div className={styles.state}><Spin /><span>Loading project assets…</span></div> : null}
          {assetsQuery.isError ? (
            <div className={styles.state}>
              <span>We couldn’t load the project assets.</span>
              <Button onClick={() => void assetsQuery.refetch().catch(() => message.error('Refresh failed'))}>Try again</Button>
            </div>
          ) : null}
          {!assetsQuery.isLoading && !assetsQuery.isError && filtered.length === 0 ? (
            <div className={styles.empty}>
              <FileImageOutlined />
              <strong>No assets in this view</strong>
              <span>Generated materials will appear here as soon as they are available.</span>
            </div>
          ) : null}
          <div className={styles.grid} ref={gridRef}>
            {rows.map((row, rowIndex) => (
              <div className={styles.row} key={`row-${rowIndex}`}>
                {row.map((item) => (
                  <AssetCard
                    key={item.asset.id}
                    item={item}
                    selected={selected?.id === item.asset.id}
                    onSelect={() => setSelected(item.asset)}
                    onMeasuredAspect={handleMeasuredAspect}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>

        {selected ? (
          <AssetDetail
            asset={selected}
            previewSrc={selectedPreview}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function AssetCard({
  item,
  selected,
  onSelect,
  onMeasuredAspect,
}: {
  item: JustifiedItem;
  selected: boolean;
  onSelect: () => void;
  onMeasuredAspect: (assetId: string, aspect: number) => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
      onClick={onSelect}
      style={{ width: item.width, flex: `0 0 ${item.width}px` }}
      aria-pressed={selected}
    >
      <div className={styles.thumbnail} style={{ width: item.width, height: item.height }}>
        {item.previewSrc && isImage(item.asset) ? (
          // User-uploaded object URLs are not covered by a trusted Next Image remote pattern.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.previewSrc}
            alt=""
            onLoad={(event) => {
              const img = event.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                onMeasuredAspect(item.asset.id, img.naturalWidth / img.naturalHeight);
              }
            }}
          />
        ) : (
          <FileOutlined className={styles.thumbnailFallback} />
        )}
      </div>
      <div className={styles.cardBody}>
        <strong className={styles.cardTitle} title={item.asset.name}>{item.asset.name}</strong>
      </div>
    </button>
  );
}

function AssetDetail({
  asset,
  previewSrc,
  onClose,
}: {
  asset: ProjectGameAsset;
  previewSrc: string | null;
  onClose: () => void;
}) {
  const fields: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: 'Source', value: asset.source },
    { label: 'Status', value: statusLabel(asset.status) },
    { label: 'Format', value: `${asset.format.toUpperCase()} · ${formatBytes(asset.fileSize)}` },
    {
      label: 'Dimensions',
      value: asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—',
    },
    { label: 'SHA-256', value: asset.sha256 ?? '—', mono: true },
    { label: 'Stable ID', value: asset.id, mono: true },
  ];

  return (
    <aside className={styles.detailDrawer} role="dialog" aria-label="Asset detail">
      <PanelHeader title={asset.name} onClose={onClose} closeLabel="Close" />
      <div className={styles.detailDrawerBody}>
        <div className={styles.detailDrawerField}>
          <div className={styles.detailDrawerFieldHeader}>
            <label className={styles.detailDrawerLabel}>Preview</label>
          </div>
          <div className={styles.detailPreview}>
            {previewSrc && isImage(asset) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewSrc} alt={asset.name} />
            ) : previewSrc && isVideo(asset) ? (
              <video src={previewSrc} controls preload="metadata" />
            ) : previewSrc && isAudio(asset) ? (
              <audio src={previewSrc} controls preload="metadata" />
            ) : (
              <>
                <FileOutlined />
                <span>{previewSrc ? 'Download to open this asset' : 'Preview unavailable'}</span>
              </>
            )}
          </div>
          {previewSrc && !isImage(asset) ? (
            <a href={previewSrc} download={asset.name} target="_blank" rel="noreferrer">
              <DownloadOutlined /> Download
            </a>
          ) : null}
        </div>
        {fields.map((field) => (
          <div key={field.label} className={styles.detailDrawerField}>
            <div className={styles.detailDrawerFieldHeader}>
              <label className={styles.detailDrawerLabel}>{field.label}</label>
            </div>
            <div className={styles.detailDrawerValue}>
              <span className={field.mono ? styles.mono : undefined}>{field.value}</span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
