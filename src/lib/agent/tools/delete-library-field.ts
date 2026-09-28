import type { AgentTool } from '../types';

export const deleteLibraryFieldTool: AgentTool = {
  name: 'delete_library_field',
  description: 'Permanently delete an exact field and its stored values from the current project library. Always confirms a preview with the affected-value count and rejects stale schema approvals.',
  category: 'write', requiredPermission: 'editor', confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false, properties: {
    projectId: { type: 'string', format: 'uuid' }, libraryId: { type: 'string', format: 'uuid' },
    fieldId: { type: 'string', format: 'uuid' }, clearValues: { type: 'boolean', enum: [true] },
  }, required: ['projectId', 'libraryId', 'fieldId', 'clearValues'] },
  async prepareConfirmation(params, ctx) {
    const { prepareFieldDelete, preparationFailure } = await import('../field-schema-cas-tool-service');
    try { return { success: true, ...await prepareFieldDelete(ctx, params) }; }
    catch (error) { return preparationFailure(error); }
  },
  async execute(params, ctx) {
    const { deleteField } = await import('../field-schema-cas-tool-service');
    return deleteField(ctx, params);
  },
};
