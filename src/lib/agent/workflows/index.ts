/**
 * Skill registry. Skills are code-orchestrated composite tools that internally
 * execute multi-step workflows deterministically. They use the post_preview
 * confirmation mode: execute() returns a preview, executeImport() does the write.
 *
 * Adding a new skill: write one file -> import it -> add it to the allSkills array.
 */

import type { AgentTool } from '../types';
import { updateRow } from './update-row';
import { setReference } from './set-reference';
import { setupLibrary } from './setup-library';
import { listFieldTypes } from './list-field-types';

export const allSkills: AgentTool[] = [
  updateRow,
  setReference,
  setupLibrary,
  listFieldTypes,
];
