/**
 * list_field_types — read-only skill that returns the full field type catalog.
 *
 * Read tools execute immediately without confirmation (see core.ts), so calling
 * this feeds the agent the complete, structured capability list it needs before
 * designing tables/fields (e.g. when building tables from a design document).
 */

import { FIELD_TYPE_CATALOG } from '../field-type-catalog';
import type { AgentTool, ToolContext, ToolResult } from '../types';

async function execute(_params: unknown, _ctx: ToolContext): Promise<ToolResult> {
  return {
    success: true,
    displayHint: 'list',
    data: { fieldTypes: FIELD_TYPE_CATALOG },
  };
}

export const listFieldTypes: AgentTool = {
  name: 'list_field_types',
  description:
    'List all field (column) data types supported by keco-studio, including each ' +
    "type's meaning, how to write its cell value, required config (enumOptions / " +
    'referenceLibraries / formulaExpression), whether it is media, and when to use ' +
    'it. Call this BEFORE designing tables/fields (e.g. when building tables from a ' +
    'design document) so you only use real, valid field types. No parameters.',
  category: 'read',
  confirmationMode: 'pre_execute',
  parameters: { type: 'object', properties: {}, required: [] },
  execute,
};
