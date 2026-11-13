import 'server-only';

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProjectTemplateKey } from '@/components/projects/projectTemplates';
import type { Project } from '@/lib/services/projectService';
import type {
  ProjectTemplateManifest,
  TemplateCellValue,
  TemplateRowReference,
} from './schema';
import type { TemplateInstantiationClaim } from './instantiationStore.server';
import { resolveProjectTemplate } from './registry.server';

type ManifestTable = ProjectTemplateManifest['tables'][number];
type ManifestField = ManifestTable['fields'][number];
type ManifestRow = ManifestTable['rows'][number];
type ManifestAsset = ProjectTemplateManifest['assets'][number];

export class ProjectTemplateInProgressError extends Error {
  constructor() {
    super('Project template creation is already in progress.');
    this.name = 'ProjectTemplateInProgressError';
  }
}

export class ProjectTemplateRequestConflictError extends Error {
  constructor() {
    super('Project template request conflicts with an earlier request.');
    this.name = 'ProjectTemplateRequestConflictError';
  }
}

export type InstantiateProjectTemplateInput = {
  authClient: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  templateKey: Exclude<ProjectTemplateKey, 'blank'>;
  name: string;
  description: string | null;
};

export type ProjectTemplateInstantiationDependencies = {
  claim(input: {
    ownerId: string;
    requestId: string;
    templateKey: string;
    templateVersion: number;
  }): Promise<TemplateInstantiationClaim>;
  createBlankProject(input: { name: string; description: string | null }): Promise<{
    project: Project;
    defaultFolderId: string;
  }>;
  checkpoint(input: {
    instantiationId: string;
    ownerId: string;
    projectId?: string;
    defaultFolderId?: string;
    designSystemId?: string;
  }): Promise<unknown>;
  createFolder(input: {
    projectId: string;
    parentFolderId: string;
    key: string;
    name: string;
    description: string;
  }): Promise<string>;
  createTable(input: {
    projectId: string;
    folderId: string;
    key: string;
    name: string;
    description: string;
  }): Promise<string>;
  createField(input: {
    tableId: string;
    tableKey: string;
    field: ManifestField;
    referenceTableIds: string[];
  }): Promise<string>;
  createRow(input: {
    tableId: string;
    tableKey: string;
    row: ManifestRow;
    values: Record<string, unknown>;
    rowIndex: number;
  }): Promise<string>;
  updateRow(input: {
    rowId: string;
    row: ManifestRow;
    values: Record<string, unknown>;
  }): Promise<void>;
  createGdd(input: {
    projectId: string;
    folderId: string;
    name: string;
    description: string;
    markdown: string;
  }): Promise<string>;
  createGds(input: {
    ownerId: string;
    projectName: string;
    manifest: ProjectTemplateManifest;
  }): Promise<{ id: string; currentVersionId: string }>;
  bindGds(input: {
    projectId: string;
    designSystemId: string;
    versionId: string;
    userId: string;
  }): Promise<void>;
  activateAssetsWorkspace(projectId: string): Promise<void>;
  readAssetBytes(input: {
    manifest: ProjectTemplateManifest;
    fileName: string;
  }): Promise<Buffer>;
  uploadAsset(input: {
    projectId: string;
    userId: string;
    descriptor: ManifestAsset;
    bytes: Buffer;
  }): Promise<string>;
  verify(input: {
    projectId: string;
    defaultFolderId: string;
    designSystemId: string;
    expectedAssetCount: number;
    expectAssetsWorkspaceEnabled: boolean;
  }): Promise<void>;
  complete(input: {
    instantiationId: string;
    ownerId: string;
    projectId: string;
    defaultFolderId: string;
    designSystemId: string;
  }): Promise<unknown>;
  fetchCompletedProject(input: {
    projectId: string;
    defaultFolderId: string;
  }): Promise<{ project: Project; defaultFolderId: string }>;
  cleanup(input: {
    instantiationId: string;
    ownerId: string;
    errorCode: string;
  }): Promise<{ cleanupJobIds: string[] }>;
  processCleanupJob(cleanupJobId: string): Promise<void>;
};

function isReference(value: TemplateCellValue): value is TemplateRowReference {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'rowRefs' in value;
}

function mapScalarValues(
  table: ManifestTable,
  row: ManifestRow,
  fieldIds: Map<string, string>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [fieldKey, value] of Object.entries(row.values)) {
    if (isReference(value)) continue;
    const fieldId = fieldIds.get(`${table.key}.${fieldKey}`);
    if (!fieldId) throw new Error(`Missing field mapping for ${table.key}.${fieldKey}`);
    values[fieldId] = value;
  }
  return values;
}

function mapAllValues(
  table: ManifestTable,
  row: ManifestRow,
  fieldIds: Map<string, string>,
  rowIds: Map<string, string>,
): Record<string, unknown> {
  const values = mapScalarValues(table, row, fieldIds);
  for (const [fieldKey, value] of Object.entries(row.values)) {
    if (!isReference(value)) continue;
    const fieldId = fieldIds.get(`${table.key}.${fieldKey}`);
    if (!fieldId) throw new Error(`Missing field mapping for ${table.key}.${fieldKey}`);
    values[fieldId] = value.rowRefs.map((rowKey) => {
      const rowId = rowIds.get(rowKey);
      if (!rowId) throw new Error(`Missing row mapping for ${rowKey}`);
      return rowId;
    });
  }
  return values;
}

async function compensate(
  dependencies: ProjectTemplateInstantiationDependencies,
  claim: TemplateInstantiationClaim,
  ownerId: string,
): Promise<void> {
  const cleanup = await dependencies.cleanup({
    instantiationId: claim.id,
    ownerId,
    errorCode: 'TEMPLATE_INSTANTIATION_FAILED',
  });
  await Promise.allSettled(cleanup.cleanupJobIds.map((id) => dependencies.processCleanupJob(id)));
}

export async function instantiateProjectTemplate(
  input: InstantiateProjectTemplateInput,
  dependencies: ProjectTemplateInstantiationDependencies = productionDependencies(input),
): Promise<{ project: Project; defaultFolderId: string }> {
  const manifest = resolveProjectTemplate(input.templateKey);
  let claim: TemplateInstantiationClaim;
  try {
    claim = await dependencies.claim({
      ownerId: input.userId,
      requestId: input.requestId,
      templateKey: manifest.key,
      templateVersion: manifest.version,
    });
  } catch (error) {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    if (record.code === 'PT409') throw new ProjectTemplateRequestConflictError();
    throw error;
  }
  if (!claim.claimed) {
    if (claim.status === 'running') throw new ProjectTemplateInProgressError();
    if (claim.status === 'completed' && claim.projectId && claim.defaultFolderId) {
      return dependencies.fetchCompletedProject({
        projectId: claim.projectId,
        defaultFolderId: claim.defaultFolderId,
      });
    }
    throw new ProjectTemplateRequestConflictError();
  }

  let projectCreated = false;
  try {
    const created = await dependencies.createBlankProject({
      name: input.name,
      description: input.description,
    });
    projectCreated = true;
    await dependencies.checkpoint({
      instantiationId: claim.id,
      ownerId: input.userId,
      projectId: created.project.id,
      defaultFolderId: created.defaultFolderId,
    });

    const folderIds = new Map<string, string>();
    for (const folder of manifest.folders) {
      folderIds.set(folder.key, await dependencies.createFolder({
        projectId: created.project.id,
        parentFolderId: created.defaultFolderId,
        ...folder,
      }));
    }

    const tableIds = new Map<string, string>();
    for (const table of manifest.tables) {
      const folderId = folderIds.get(table.folderKey);
      if (!folderId) throw new Error(`Missing folder mapping for ${table.folderKey}`);
      tableIds.set(table.key, await dependencies.createTable({
        projectId: created.project.id,
        folderId,
        key: table.key,
        name: table.name,
        description: table.description,
      }));
    }

    const fieldIds = new Map<string, string>();
    for (const table of manifest.tables) {
      const tableId = tableIds.get(table.key)!;
      for (const field of table.fields) {
        const referenceTableIds = (field.referenceTableKeys ?? []).map((key) => {
          const id = tableIds.get(key);
          if (!id) throw new Error(`Missing table mapping for ${key}`);
          return id;
        });
        fieldIds.set(`${table.key}.${field.key}`, await dependencies.createField({
          tableId,
          tableKey: table.key,
          field,
          referenceTableIds,
        }));
      }
    }

    const rowIds = new Map<string, string>();
    for (const table of manifest.tables) {
      const tableId = tableIds.get(table.key)!;
      for (const [rowIndex, row] of table.rows.entries()) {
        rowIds.set(row.key, await dependencies.createRow({
          tableId,
          tableKey: table.key,
          row,
          values: mapScalarValues(table, row, fieldIds),
          rowIndex,
        }));
      }
    }
    for (const table of manifest.tables) {
      for (const row of table.rows) {
        await dependencies.updateRow({
          rowId: rowIds.get(row.key)!,
          row,
          values: mapAllValues(table, row, fieldIds, rowIds),
        });
      }
    }

    await dependencies.createGdd({
      projectId: created.project.id,
      folderId: folderIds.get('game-design')!,
      name: `${manifest.theme} GDD`,
      description: manifest.gdd.description,
      markdown: manifest.gdd.markdown,
    });
    const designSystem = await dependencies.createGds({
      ownerId: input.userId,
      projectName: created.project.name,
      manifest,
    });
    await dependencies.checkpoint({
      instantiationId: claim.id,
      ownerId: input.userId,
      designSystemId: designSystem.id,
    });
    await dependencies.bindGds({
      projectId: created.project.id,
      designSystemId: designSystem.id,
      versionId: designSystem.currentVersionId,
      userId: input.userId,
    });
    if (manifest.assets.length > 0) {
      await dependencies.activateAssetsWorkspace(created.project.id);
      for (const descriptor of manifest.assets) {
        const bytes = await dependencies.readAssetBytes({ manifest, fileName: descriptor.fileName });
        await dependencies.uploadAsset({
          projectId: created.project.id,
          userId: input.userId,
          descriptor,
          bytes,
        });
      }
    }
    await dependencies.verify({
      projectId: created.project.id,
      defaultFolderId: created.defaultFolderId,
      designSystemId: designSystem.id,
      expectedAssetCount: manifest.assets.length,
      expectAssetsWorkspaceEnabled: manifest.assets.length > 0,
    });
    await dependencies.complete({
      instantiationId: claim.id,
      ownerId: input.userId,
      projectId: created.project.id,
      defaultFolderId: created.defaultFolderId,
      designSystemId: designSystem.id,
    });
    return created;
  } catch (error) {
    if (projectCreated) {
      try {
        await compensate(dependencies, claim, input.userId);
      } catch {
        // Preserve the original domain failure; durable state retains cleanup context.
      }
    }
    throw error;
  }
}

function productionDependencies(input: InstantiateProjectTemplateInput): ProjectTemplateInstantiationDependencies {
  return {
    claim: async (claimInput) => {
      const { claimProjectTemplateInstantiation } = await import('./instantiationStore.server');
      return claimProjectTemplateInstantiation(input.serviceClient, claimInput);
    },
    createBlankProject: async (projectInput) => {
      const { createBlankProject } = await import('@/lib/services/projectService');
      return createBlankProject(input.authClient, {
        name: projectInput.name,
        description: projectInput.description ?? undefined,
      });
    },
    checkpoint: async (checkpointInput) => {
      const { checkpointProjectTemplateInstantiation } = await import('./instantiationStore.server');
      return checkpointProjectTemplateInstantiation(input.serviceClient, checkpointInput);
    },
    createFolder: async (folder) => {
      const { createFolder } = await import('@/lib/services/folderService');
      return createFolder(input.authClient, {
        projectId: folder.projectId,
        parentFolderId: folder.parentFolderId,
        name: folder.name,
        description: folder.description,
      });
    },
    createTable: async (table) => {
      const { createLibrary } = await import('@/lib/services/libraryService');
      return createLibrary(input.authClient, {
        projectId: table.projectId,
        folderId: table.folderId,
        name: table.name,
        description: table.description,
      });
    },
    createField: async ({ tableId, field, referenceTableIds }) => {
      const { addLibraryField } = await import('@/lib/services/libraryAssetsService');
      const created = await addLibraryField(input.authClient, tableId, {
        label: field.label,
        dataType: field.dataType,
        required: field.required,
        enumOptions: field.enumOptions,
        referenceLibraries: referenceTableIds,
      });
      return created.id;
    },
    createRow: async ({ tableId, row, values, rowIndex }) => {
      const { createAsset } = await import('@/lib/services/libraryAssetsService');
      return createAsset(input.authClient, tableId, row.name, values, { rowIndex });
    },
    updateRow: async ({ rowId, row, values }) => {
      const { updateAsset } = await import('@/lib/services/libraryAssetsService');
      await updateAsset(input.authClient, rowId, row.name, values);
    },
    createGdd: async (gdd) => {
      const { createDocument } = await import('@/lib/services/documentService');
      const document = await createDocument(input.authClient, {
        projectId: gdd.projectId,
        folderId: gdd.folderId,
        name: gdd.name,
        description: gdd.description,
        content: gdd.markdown,
      });
      return document.id;
    },
    createGds: async ({ ownerId, projectName, manifest }) => {
      const { createGameDesignSystem } = await import('@/lib/services/gameDesignSystemService');
      const system = await createGameDesignSystem(input.serviceClient, ownerId, {
        title: `${projectName} Game Design System`,
        summary: manifest.gds.summary,
        genres: manifest.gds.rules.genres,
        philosophies: manifest.gds.rules.philosophies,
        suitableFor: manifest.gds.rules.suitableFor,
        document: manifest.gds.document,
        rules: manifest.gds.rules,
        artStyle: manifest.gds.artStyle,
        provenance: {
          source: 'project-template',
          description: 'Created from a project template.',
          templateKey: manifest.key,
          templateVersion: manifest.version,
        } as Parameters<typeof createGameDesignSystem>[2]['provenance'] & {
          source: 'project-template';
          templateKey: string;
          templateVersion: number;
        },
      });
      if (!system.current_version_id) throw new Error('Template Game Design System has no current version');
      return { id: system.id, currentVersionId: system.current_version_id };
    },
    bindGds: async ({ projectId, designSystemId, versionId, userId }) => {
      const { setProjectGameDesignSystem } = await import('@/lib/services/gameDesignSystemService');
      await setProjectGameDesignSystem(input.authClient, projectId, designSystemId, versionId, userId);
    },
    activateAssetsWorkspace: async (projectId) => {
      const { error } = await input.authClient.from('projects')
        .update({ assets_workspace_enabled: true }).eq('id', projectId);
      if (error) throw error;
    },
    readAssetBytes: async ({ manifest, fileName }) => {
      const root = path.resolve(
        process.cwd(),
        'public/project-templates',
        manifest.key,
        `v${manifest.version}`,
      );
      const absolute = path.resolve(root, fileName);
      if (!absolute.startsWith(`${root}${path.sep}`)) {
        throw new Error('Template asset path escaped its root');
      }
      return readFile(absolute);
    },
    uploadAsset: async ({ projectId, userId, descriptor, bytes }) => {
      const { registerProjectGameAssetBuffer } = await import('@/lib/server/projectGameAssetUpload');
      const asset = await registerProjectGameAssetBuffer({
        client: input.authClient,
        userId,
        projectId,
        category: descriptor.category,
        fileName: descriptor.fileName,
        mimeType: descriptor.mimeType,
        bytes,
      });
      return asset.assetId;
    },
    verify: async ({
      projectId,
      defaultFolderId,
      designSystemId,
      expectedAssetCount,
      expectAssetsWorkspaceEnabled,
    }) => {
      const folders = await input.serviceClient.from('folders')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId).eq('parent_folder_id', defaultFolderId);
      const tables = await input.serviceClient.from('libraries')
        .select('id', { count: 'exact', head: true }).eq('project_id', projectId);
      const rows = await input.serviceClient.from('library_assets')
        .select('id,libraries!inner(project_id)', { count: 'exact', head: true })
        .eq('libraries.project_id', projectId);
      const documents = await input.serviceClient.from('documents')
        .select('id', { count: 'exact', head: true }).eq('project_id', projectId);
      const assets = await input.serviceClient.from('project_game_assets')
        .select('id', { count: 'exact', head: true }).eq('project_id', projectId);
      const binding = await input.serviceClient.from('project_game_design_systems')
        .select('design_system_id').eq('project_id', projectId).maybeSingle();
      const projectResult = await input.serviceClient.from('projects')
        .select('assets_workspace_enabled').eq('id', projectId).single();
      const results = [folders, tables, rows, documents, assets, binding, projectResult];
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
      if (folders.count !== 3 || tables.count !== 6 || rows.count !== 30
        || documents.count !== 1 || assets.count !== expectedAssetCount
        || binding.data?.design_system_id !== designSystemId
        || projectResult.data?.assets_workspace_enabled !== expectAssetsWorkspaceEnabled) {
        throw new Error('Project template verification failed');
      }
    },
    complete: async (completeInput) => {
      const { completeProjectTemplateInstantiation } = await import('./instantiationStore.server');
      return completeProjectTemplateInstantiation(input.serviceClient, completeInput);
    },
    fetchCompletedProject: async ({ projectId, defaultFolderId }) => {
      const { getProject } = await import('@/lib/services/projectService');
      const project = await getProject(input.authClient, projectId);
      if (!project) throw new Error('Completed template project was not found');
      return { project, defaultFolderId };
    },
    cleanup: async (cleanupInput) => {
      const { cleanupProjectTemplateInstantiation } = await import('./instantiationStore.server');
      return cleanupProjectTemplateInstantiation(input.serviceClient, cleanupInput);
    },
    processCleanupJob: async (cleanupJobId) => {
      const { processProjectStorageCleanupJob } = await import('@/lib/server/projectDeletion');
      await processProjectStorageCleanupJob({ cleanupJobId, serviceClient: input.serviceClient });
    },
  };
}
