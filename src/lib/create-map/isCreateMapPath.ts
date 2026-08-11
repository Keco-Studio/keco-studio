export function isCreateMapPath(pathname: string | null): boolean {
  return pathname === '/create-map' || Boolean(pathname?.startsWith('/create-map/'));
}
