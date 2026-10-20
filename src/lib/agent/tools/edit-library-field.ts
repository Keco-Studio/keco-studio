import type { AgentTool } from '../types';

export const editLibraryFieldTool: AgentTool = {
  name: 'edit_library_field',
  description: 'Edit an exact non-formula field in the current project library, including image, file, multimedia, and audio fields. Type changes with stored values require explicit clearValuesOnTypeChange and always show a confirmation preview. Formula fields are not editable through this tool.',
  category: 'write', requiredPermission: 'editor', confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false, properties: {
    projectId: { type: 'string', format: 'uuid' }, libraryId: { type: 'string', format: 'uuid' },
    fieldId: { type: 'string', format: 'uuid' }, label: { type: 'string', minLength: 1, maxLength: 200 },
    dataType: { type: 'string', enum: ['string', 'string_array', 'int', 'int_array', 'float', 'float_array',
      'boolean', 'enum', 'date', 'reference', 'image', 'file', 'multimedia', 'audio'] },
    description: { type: ['string', 'null'], maxLength: 1000 }, required: { type: 'boolean' },
    enumOptions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 },
    referenceTableIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 20 },
    clearValuesOnTypeChange: { type: 'boolean', description: 'Set true only when the user explicitly agrees to clear stored values during a type change.' },
  }, required: ['projectId', 'libraryId', 'fieldId', 'label', 'dataType', 'required'] },
  async prepareConfirmation(params, ctx) {
    const { prepareFieldEdit, preparationFailure } = await import('../field-schema-cas-tool-service');
    try { return { success: true, ...await prepareFieldEdit(ctx, params) }; }
    catch (error) { return preparationFailure(error); }
  },
  async execute(params, ctx) {
    const { editField } = await import('../field-schema-cas-tool-service');
    return editField(ctx, params);
  },
};
