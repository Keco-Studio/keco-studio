import { allTools, getToolsForLlm, resolveAllowedTool } from '@/lib/agent/tools';
import { getAllowedToolNames } from '@/lib/agent/tools/workspace-policy';

const projectTools = [
  'list_projects', 'create_project', 'select_project', 'update_project', 'delete_project', 'set_conversation_option',
];
const discoveryAndSettings = ['list_projects', 'select_project', 'set_conversation_option'];
const mapTools = [
  'list_maps', 'read_map', 'read_map_detail', 'update_map_draft',
  'read_map_collision_grid', 'change_map_collision_grid',
  'list_map_references', 'change_map_reference', 'list_map_generation_history',
  'upload_map_reference',
  'analyze_map_collision_grid',
  'create_map_draft', 'generate_map_image',
  'get_map_generation_status', 'retry_map_generation',
];
const gdsTools = [
  'list_game_design_systems', 'read_game_design_system', 'create_game_design_system',
  'create_game_design_system_version', 'update_game_design_system', 'delete_game_design_system',
  'unbind_game_design_system', 'retry_game_design_system_generation', 'cancel_gdd_generation',
  'retry_gdd_resource_job', 'retry_gdd_dialogue_job',
  'generate_game_design_system', 'copy_game_design_system',
  'apply_game_design_system', 'generate_gdd', 'get_generation_status',
];
const scriptOnlyTools = [
  'add_script_document', 'remove_script_document', 'rename_script', 'delete_script',
  'reorder_script_dialogue', 'edit_script_dialogue', 'change_script_dialogue_speaker',
  'insert_script_dialogue', 'delete_script_dialogue_block', 'undo_script_dialogue_action',
];

describe('workspace Tool policy', () => {
  it('keeps Projects limited to project actions and conversation settings', () => {
    expect([...getAllowedToolNames('projects')]).toEqual(projectTools);
    expect(getToolsForLlm({ workspace: 'projects' }).map((tool) => tool.function.name))
      .toEqual(projectTools);
  });

  it('gives Create Map and GDS their own literal bundles', () => {
    expect([...getAllowedToolNames('create-map')]).toEqual([...discoveryAndSettings, ...mapTools]);
    expect([...getAllowedToolNames('game-design-systems')]).toEqual([...discoveryAndSettings, ...gdsTools]);
    expect(getAllowedToolNames('create-map').has('create_project')).toBe(false);
    expect(getAllowedToolNames('game-design-systems').has('create_project')).toBe(false);
    expect(getToolsForLlm({ workspace: 'create-map' }).map((tool) => tool.function.name).sort())
      .toEqual([...discoveryAndSettings, ...mapTools].sort());
    expect(getToolsForLlm({ workspace: 'game-design-systems' }).map((tool) => tool.function.name).sort())
      .toEqual([...discoveryAndSettings, ...gdsTools].sort());
  });

  it('retains the current registry in Studio and limits Script mutations', () => {
    expect([...getAllowedToolNames('studio')].sort()).toEqual(
      allTools.map((tool) => tool.name).filter((name) => !['list_projects', 'create_project', 'select_project', ...mapTools, ...gdsTools, ...scriptOnlyTools].includes(name)).sort()
    );
    for (const name of ['list_projects', 'create_project', 'select_project']) {
      expect(getAllowedToolNames('studio').has(name)).toBe(false);
    }
    expect(getAllowedToolNames('script').has('create_project')).toBe(false);
    expect(getAllowedToolNames('script').has('import_script')).toBe(true);
    expect(getAllowedToolNames('script').has('propose_story_graph_edit')).toBe(true);
    expect(getAllowedToolNames('script').has('rename_document')).toBe(true);
    expect(getAllowedToolNames('script').has('add_script_document')).toBe(true);
    for (const name of ['create_asset', 'update_asset', 'delete_asset', 'add_field', 'create_library']) {
      expect(getAllowedToolNames('script').has(name)).toBe(false);
    }
  });

  it('applies the same policy to resolution even when a registered Tool is fabricated', () => {
    expect(resolveAllowedTool('create_asset', 'projects')).toBeUndefined();
    expect(resolveAllowedTool('create_asset', 'studio')?.name).toBe('create_asset');
    expect(resolveAllowedTool('not_registered', 'studio')).toBeUndefined();
  });
});
