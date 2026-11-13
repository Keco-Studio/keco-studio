import 'server-only';

import type { ProjectTemplateKey } from '@/components/projects/projectTemplates';
import type { ProjectTemplateManifest } from './schema';
import { tacticalDeckbuilderTemplate } from './tacticalDeckbuilder';

export type InstantiableProjectTemplateKey = 'tactical-deckbuilder';

export function resolveProjectTemplate(
  key: Exclude<ProjectTemplateKey, 'blank'>,
): ProjectTemplateManifest {
  if (key === 'tactical-deckbuilder') return tacticalDeckbuilderTemplate;
  throw new Error(`Project template is not available: ${key}`);
}
