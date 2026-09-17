export type DesktopSession = {
  accessToken: string;
  refreshToken: string;
};

export function parseDesktopSessionHash(hash: string): DesktopSession | null {
  if (!hash.startsWith('#')) return null;

  const values = new URLSearchParams(hash.slice(1));
  const accessToken = values.get('access_token');
  const refreshToken = values.get('refresh_token');
  if (!accessToken || !refreshToken) return null;

  return { accessToken, refreshToken };
}
