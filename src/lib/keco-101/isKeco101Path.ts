export function isKeco101Path(pathname: string | null): boolean {
  return pathname === '/keco-101' || Boolean(pathname?.startsWith('/keco-101/'));
}
