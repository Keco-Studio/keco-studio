export function isScriptSystemPath(pathname: string | null): boolean {
  return (pathname ?? '').startsWith('/script-system');
}
