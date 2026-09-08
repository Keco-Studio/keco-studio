import { z } from 'zod';
import type { CompiledGameArtDirection } from './development';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const ratio = z.number().min(0).max(1);

export const visualOutputObservationSchema = z.object({
  schemaVersion: z.literal(1),
  sha256,
  format: z.enum(['png', 'jpeg', 'webp', 'gif', 'avif']),
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
  hasAlpha: z.boolean(),
  visiblePixels: z.number().int().nonnegative(),
  approximatePaletteCardinality: z.number().int().nonnegative().max(65_536),
  semitransparentPixelRatio: ratio,
  edgeDensity: ratio,
  nearestNeighborBlockConsistency: ratio.nullable(),
}).strict();

export const structuredVisualReviewSchema = z.object({
  reviewer: z.string().trim().min(1).max(200),
  reviewedAt: z.string().datetime(),
  assertions: z.array(z.object({
    criterion: z.enum(['semantic_palette', 'silhouette', 'composition', 'perspective', 'subject_matter', 'outline_behavior', 'ui_contrast', 'frame_consistency']),
    status: z.enum(['pass', 'fail']),
    evidence: z.string().trim().min(1).max(1_000),
  }).strict()).min(1).max(50),
}).strict().superRefine((review, context) => {
  const seen = new Set<string>();
  review.assertions.forEach((assertion, index) => {
    if (seen.has(assertion.criterion)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Visual review criteria must be unique.', path: ['assertions', index, 'criterion'] });
    }
    seen.add(assertion.criterion);
  });
});

export type VisualOutputObservation = z.infer<typeof visualOutputObservationSchema>;
export type StructuredVisualReview = z.infer<typeof structuredVisualReviewSchema>;

export type VisualOutputEvaluation = {
  provenanceStatus: 'pass' | 'fail' | 'blocked';
  visualStyleStatus: 'pass' | 'fail' | 'blocked';
  assertions: Array<{ criterion: string; status: 'pass' | 'fail' | 'blocked'; evidence: string }>;
};

const requiredReviewCriteria: Record<CompiledGameArtDirection['category'], StructuredVisualReview['assertions'][number]['criterion'][]> = {
  map: ['semantic_palette', 'composition', 'perspective', 'subject_matter'],
  character: ['semantic_palette', 'silhouette', 'subject_matter', 'outline_behavior'],
  ui: ['semantic_palette', 'composition', 'subject_matter', 'ui_contrast'],
  vfx: ['semantic_palette', 'silhouette', 'composition', 'subject_matter'],
  animation: ['semantic_palette', 'silhouette', 'subject_matter', 'frame_consistency'],
};

export function evaluateVisualOutput(
  observation: VisualOutputObservation,
  direction: CompiledGameArtDirection,
  input: {
    observedStyleHash?: string | null;
    expectedAssetHash?: string | null;
    maxPaletteColors?: number | null;
    pixelArt?: boolean;
    visualReview?: StructuredVisualReview | null;
  } = {},
): VisualOutputEvaluation {
  const observed = visualOutputObservationSchema.parse(observation);
  const assertions: VisualOutputEvaluation['assertions'] = [];
  const measured = (criterion: string, pass: boolean, evidence: string) => assertions.push({ criterion, status: pass ? 'pass' : 'fail', evidence });
  if (direction.constraints.outputWidth !== null) measured('width', observed.width === direction.constraints.outputWidth, `${observed.width} px observed; ${direction.constraints.outputWidth} px required.`);
  if (direction.constraints.outputHeight !== null) measured('height', observed.height === direction.constraints.outputHeight, `${observed.height} px observed; ${direction.constraints.outputHeight} px required.`);
  if (direction.constraints.transparent !== null) measured('transparency', observed.hasAlpha === direction.constraints.transparent, `Alpha=${observed.hasAlpha}; required=${direction.constraints.transparent}.`);
  if (input.maxPaletteColors != null) measured('palette_cardinality', observed.approximatePaletteCardinality <= input.maxPaletteColors, `${observed.approximatePaletteCardinality} approximate colors; maximum ${input.maxPaletteColors}.`);
  if (input.pixelArt) {
    measured('semitransparent_pixels', observed.semitransparentPixelRatio <= 0.01, `${observed.semitransparentPixelRatio} semitransparent ratio.`);
    measured('nearest_neighbor_blocks', (observed.nearestNeighborBlockConsistency ?? 0) >= 0.7, `${observed.nearestNeighborBlockConsistency ?? 'unavailable'} block consistency.`);
  }
  const review = input.visualReview ? structuredVisualReviewSchema.parse(input.visualReview) : null;
  if (review) {
    assertions.push(...review.assertions.map((assertion) => ({ criterion: assertion.criterion, status: assertion.status, evidence: assertion.evidence })));
    const reviewed = new Set(review.assertions.map((assertion) => assertion.criterion));
    for (const criterion of requiredReviewCriteria[direction.category]) {
      if (!reviewed.has(criterion)) assertions.push({ criterion, status: 'blocked', evidence: `Structured review is required for ${criterion}.` });
    }
  } else {
    assertions.push(...requiredReviewCriteria[direction.category].map((criterion) => ({ criterion, status: 'blocked' as const, evidence: `Structured review is required for ${criterion}.` })));
  }

  const provenanceStatus = input.observedStyleHash == null
    ? 'blocked'
    : input.observedStyleHash === direction.snapshotHash && (!input.expectedAssetHash || input.expectedAssetHash === observed.sha256)
      ? 'pass'
      : 'fail';
  const visualStyleStatus = assertions.some((assertion) => assertion.status === 'fail')
    ? 'fail'
    : assertions.some((assertion) => assertion.status === 'blocked') ? 'blocked' : 'pass';
  return { provenanceStatus, visualStyleStatus, assertions };
}
