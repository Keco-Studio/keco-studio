/**
 * Library Asset Table - shared utilities
 * Asset avatar colors, display text, etc.
 */

export const ASSET_COLOR_PALETTE = [
  '#f56a00', '#7265e6', '#ffbf00', '#00a2ae', '#87d068', '#f50', '#2db7f5', '#108ee9',
  '#FF6CAA', '#52c41a', '#fa8c16', '#eb2f96', '#13c2c2', '#722ed1', '#faad14', '#a0d911',
  '#1890ff', '#f5222d', '#fa541c', '#2f54eb', '#096dd9', '#531dab', '#c41d7f', '#cf1322',
  '#d4380d', '#7cb305', '#389e0d', '#0958d9', '#1d39c4', '#10239e', '#061178', '#780650',
];

/** Consistent color for asset avatar by id + name */
export function getAssetAvatarColor(assetId: string, name: string): string {
  const hash =
    assetId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) +
    name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const index = hash % ASSET_COLOR_PALETTE.length;
  return ASSET_COLOR_PALETTE[index];
}

/** First letter for avatar display */
export function getAssetAvatarText(name: string): string {
  return name.charAt(0).toUpperCase();
}
