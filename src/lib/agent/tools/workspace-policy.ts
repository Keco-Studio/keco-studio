import type { AgentWorkspace } from '../types';

const projectWorkspaceTools: ReadonlySet<string> = new Set([
  'list_projects', 'create_project', 'select_project', 'update_project', 'delete_project', 'set_conversation_option',
]);

const discoveryAndSettings: ReadonlySet<string> = new Set([
  'list_projects', 'select_project', 'set_conversation_option',
]);

const studioTools: ReadonlySet<string> = new Set([
  'set_conversation_option',
  'update_project', 'delete_project',
  'list_project_structure', 'list_documents', 'query_assets', 'list_game_media', 'upload_game_media', 'semantic_search',
  'create_document', 'read_document', 'propose_document_edit',
  'list_document_versions', 'create_document_version', 'restore_document_version', 'delete_document_version',
  'list_project_collaborators', 'invite_project_collaborator',
  'change_project_collaborator_role', 'remove_project_collaborator',
  'insert_resource_reference', 'rename_document', 'move_document',
  'delete_document', 'generate_from_document', 'read_story_graph',
  'propose_story_graph_edit', 'query_script_lines', 'add_field',
  'create_asset', 'update_asset', 'delete_asset', 'import_script',
  'create_library', 'create_folder', 'delete_library', 'rename_library',
  'update_folder', 'move_folder', 'duplicate_folder', 'delete_folder',
  'update_library_metadata', 'move_library', 'duplicate_library',
  'reorder_library_fields', 'edit_library_field', 'delete_library_field',
  'update_row', 'set_reference', 'setup_library', 'list_field_types',
  'get_library_schema',
]);

const scriptTools: ReadonlySet<string> = new Set([
  ...discoveryAndSettings,
  'list_documents', 'read_document',
  'rename_document',
  'query_script_lines', 'import_script',
  'read_story_graph', 'propose_story_graph_edit', 'generate_from_document',
  'add_script_document', 'remove_script_document', 'rename_script', 'delete_script',
  'reorder_script_dialogue', 'edit_script_dialogue', 'change_script_dialogue_speaker',
  'insert_script_dialogue', 'delete_script_dialogue_block', 'undo_script_dialogue_action',
]);

const createMapTools: ReadonlySet<string> = new Set([
  ...discoveryAndSettings,
  'list_maps', 'read_map', 'read_map_detail', 'update_map_draft',
  'read_map_collision_grid', 'change_map_collision_grid',
  'list_map_references', 'change_map_reference', 'list_map_generation_history',
  'upload_map_reference',
  'analyze_map_collision_grid',
  'create_map_draft', 'generate_map_image',
  'get_map_generation_status', 'retry_map_generation',
]);

const gameDesignSystemTools: ReadonlySet<string> = new Set([
  ...discoveryAndSettings,
  'list_game_design_systems', 'read_game_design_system', 'create_game_design_system',
  'create_game_design_system_version', 'update_game_design_system', 'delete_game_design_system',
  'unbind_game_design_system', 'retry_game_design_system_generation', 'cancel_gdd_generation',
  'retry_gdd_resource_job', 'retry_gdd_dialogue_job',
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
