import type { AgentWorkspace } from '../types';

const projectWorkspaceTools: ReadonlySet<string> = new Set([
  'list_projects', 'create_project', 'select_project', 'set_conversation_option',
]);

const discoveryAndSettings: ReadonlySet<string> = new Set([
  'list_projects', 'select_project', 'set_conversation_option',
]);

const studioTools: ReadonlySet<string> = new Set([
  'set_conversation_option',
  'list_project_structure', 'list_documents', 'query_assets', 'semantic_search',
  'create_document', 'read_document', 'propose_document_edit',
  'insert_resource_reference', 'rename_document', 'move_document',
  'delete_document', 'generate_from_document', 'read_story_graph',
  'propose_story_graph_edit', 'query_script_lines', 'add_field',
  'create_asset', 'update_asset', 'delete_asset', 'import_script',
  'create_library', 'create_folder', 'delete_library', 'rename_library',
  'update_row', 'set_reference', 'setup_library', 'list_field_types',
  'get_library_schema',
]);

const scriptTools: ReadonlySet<string> = new Set([
  ...discoveryAndSettings,
  'list_project_structure', 'list_documents', 'read_document',
  'semantic_search', 'query_script_lines', 'import_script',
  'read_story_graph', 'propose_story_graph_edit', 'generate_from_document',
]);

const createMapTools: ReadonlySet<string> = new Set([
  ...discoveryAndSettings,
  'list_maps', 'read_map', 'create_map_draft', 'generate_map_image',
  'get_map_generation_status', 'retry_map_generation',
]);

const gameDesignSystemTools: ReadonlySet<string> = new Set([
  ...discoveryAndSettings,
  'list_game_design_systems', 'read_game_design_system',
  'generate_game_design_system', 'copy_game_design_system',
  'apply_game_design_system', 'generate_gdd', 'get_generation_status',
]);

const toolsByWorkspace: Record<AgentWorkspace, ReadonlySet<string>> = {
  projects: projectWorkspaceTools,
  studio: studioTools,
  script: scriptTools,
  'create-map': createMapTools,
  'game-design-systems': gameDesignSystemTools,
};

export function getAllowedToolNames(workspace: AgentWorkspace): ReadonlySet<string> {
  return toolsByWorkspace[workspace];
}
