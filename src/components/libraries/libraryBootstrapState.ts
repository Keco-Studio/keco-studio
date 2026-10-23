export type BlankLibraryBootstrapStatus = 'idle' | 'running' | 'settled' | 'failed';

export function shouldWaitForBlankLibraryBootstrap({
  schemaLoading,
  propertyCount,
  canInitialize,
  isGeneratedLibrary,
  viewingCurrentVersion,
  bootstrapStatus,
}: {
  schemaLoading: boolean;
  propertyCount: number;
  canInitialize: boolean;
  isGeneratedLibrary: boolean;
  viewingCurrentVersion: boolean;
  bootstrapStatus: BlankLibraryBootstrapStatus;
}): boolean {
  if (bootstrapStatus === 'running') return true;
  if (bootstrapStatus !== 'idle') return false;
  return (
    !schemaLoading
    && propertyCount === 0
    && canInitialize
    && !isGeneratedLibrary
    && viewingCurrentVersion
  );
}
