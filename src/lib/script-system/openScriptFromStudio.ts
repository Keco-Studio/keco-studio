export type OpenScriptRole = 'admin' | 'editor' | 'viewer';
export type OpenScriptPhase = 'opening' | 'generating';
export type OpenScriptResult =
  | { kind: 'script'; libraryId: string }
  | { kind: 'document'; documentId: string };

export type OpenScriptDependencies = {
  addToWorkspace: () => Promise<void>;
  findNewestScript: () => Promise<{ id: string } | null>;
  generate: () => Promise<{ libraryId: string }>;
};

export async function openScriptFromStudio(input: {
  projectId: string;
  documentId: string;
  role: OpenScriptRole;
  onPhase?: (phase: OpenScriptPhase) => void;
  dependencies: OpenScriptDependencies;
}): Promise<OpenScriptResult> {
  const { documentId, role, dependencies, onPhase } = input;
  onPhase?.('opening');
  await dependencies.addToWorkspace();

  const existing = await dependencies.findNewestScript();
  if (existing) return { kind: 'script', libraryId: existing.id };
  if (role === 'viewer') return { kind: 'document', documentId };

  onPhase?.('generating');
  try {
    const generated = await dependencies.generate();
    return { kind: 'script', libraryId: generated.libraryId };
  } catch (error) {
    const concurrent = await dependencies.findNewestScript();
    if (concurrent) return { kind: 'script', libraryId: concurrent.id };
    throw error;
  }
}
