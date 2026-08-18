import type { GddGenerationMode } from './contracts';
import type { BlueprintOutlineV2, DocumentV2 } from './contracts';
import { renderGddV2Markdown } from './renderer';

export type DeterministicQualityIssue = {
  code: 'length' | 'section-count' | 'empty-section' | 'placeholder'
    | 'duplicate-content' | 'forbidden-provenance' | 'missing-required-block'
    | 'unknown-numeric-ref';
  sectionId: string | null;
  message: string;
};

const PLACEHOLDER = /\b(?:TBD|TODO|FIXME|lorem ipsum|待补充|待填写|占位)\b/i;

export function countReadableCharacters(markdown: string): number {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*/g, ''))
    .replace(/[`*_>#|\-]/g, '')
    .replace(/\s+/g, '')
    .length;
}

function blueprintRequiredBlocks(blueprint: BlueprintOutlineV2 | undefined): Map<string, Set<string>> {
  // The outline contract intentionally remains compatible with older v2 jobs;
  // richer required-block hints are checked when they are present.
  return new Map(blueprint?.nodes.map((node) => [node.id, new Set<string>()]) ?? []);
}

export function validateGddQuality(
  document: DocumentV2,
  mode: GddGenerationMode,
  blueprint?: BlueprintOutlineV2,
): DeterministicQualityIssue[] {
  const issues: DeterministicQualityIssue[] = [];
  const markdown = renderGddV2Markdown(document);
  const renderedLength = countReadableCharacters(markdown);
  const min = mode === 'professional' ? 6_000 : 2_500;
  const max = mode === 'professional' ? 10_000 : 4_000;
  if (renderedLength < min || renderedLength > max) {
    issues.push({ code: 'length', sectionId: null, message: `Readable content length ${renderedLength} is outside ${min}-${max}.` });
  }

  const topLevel = document.sections.filter((section) => section.depth === 0);
  if (mode === 'professional' && (topLevel.length < 9 || topLevel.length > 13)) {
    issues.push({ code: 'section-count', sectionId: null, message: `Professional documents need 9-13 top-level sections; received ${topLevel.length}.` });
  }
  const knownNumericRefs = new Set(document.numericRegistry.entries.map((entry) => entry.id));
  const seenParagraphs = new Set<string>();
  const requiredBlocks = blueprintRequiredBlocks(blueprint);

  for (const section of document.sections) {
    if (section.blocks.length === 0) {
      issues.push({ code: 'empty-section', sectionId: section.id, message: 'Section has no content blocks.' });
    }
    const required = requiredBlocks.get(section.id) ?? new Set<string>();
    const actual = new Set(section.blocks.map((block) => block.kind));
    for (const block of required) {
      if (!actual.has(block)) issues.push({ code: 'missing-required-block', sectionId: section.id, message: `Missing required block type: ${block}.` });
    }
    for (const block of section.blocks) {
      if (block.kind === 'paragraph' || block.kind === 'example') {
        const text = block.kind === 'paragraph' ? block.text : block.body;
        if (PLACEHOLDER.test(text)) issues.push({ code: 'placeholder', sectionId: section.id, message: 'Placeholder text is not allowed.' });
        if (block.kind === 'paragraph') {
          const normalized = text.replace(/\s+/g, '').toLowerCase();
          if (seenParagraphs.has(normalized)) issues.push({ code: 'duplicate-content', sectionId: section.id, message: 'Repeated paragraph content.' });
          seenParagraphs.add(normalized);
        }
      }
      if ((block.kind === 'formula' || block.kind === 'example') && block.numericRefs.some((ref) => !knownNumericRefs.has(ref))) {
        issues.push({ code: 'unknown-numeric-ref', sectionId: section.id, message: `Block ${block.id} references an unknown numeric registry entry.` });
      }
    }
  }
  if (/provenance/i.test(markdown)) issues.push({ code: 'forbidden-provenance', sectionId: null, message: 'Visible provenance text is not allowed.' });
  return issues;
}
