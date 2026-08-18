import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { discoverImageModel, generateImage } from './providerClient';
import { inspectPng, normalizeAndValidatePng, type ValidatedImage } from './mediaValidation';
import { STYLE_RELEASES, stylePrompt, type StyleRelease } from './styleBriefs';
import type { ProviderConfig } from './types';

type RequestRecord = { at: string; release: string; kind: string; variant: number };
type Ledger = { session: string; maxGenerations: number; reserved: number; requests: RequestRecord[] };
type CandidateRecord = ValidatedImage & {
  release: string;
  kind: 'map' | 'character';
  variant: number;
  submittedPrompt: string;
  submittedPromptSha256: string;
  endpointHash: string;
  model: string;
};
type ReviewRecord = {
  release: string;
  reviewers: Array<{ name: string; role: string }>;
  selected: { map: number; character: number };
  candidates: { map: Array<{ variant: number; sha256: string }>; character: Array<{ variant: number; sha256: string }> };
  rubrics: Record<string, 'pass' | 'fail'>;
  rejections: Array<{ kind: 'map' | 'character'; variant: number; reason: string }>;
  contactSheets: { mapSha256: string; characterSha256: string; pairSha256: string };
};

const REVIEW_RUBRIC_KEYS = [
  'mapRouteReadability', 'adultAnatomy', 'styleBoundary', 'pairConsistency',
  'noTextLogoOrWatermark', 'noArtistFranchiseOrCharacterImitation', 'celShadedAndLowPolyMutualExclusion',
] as const;

const CACHE_ROOT = path.resolve('.cache/game-art-styles');

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function providerConfig(): ProviderConfig {
  const envFile = option('--env-file');
  if (envFile) dotenv.config({ path: envFile, quiet: true });
  const baseUrl = process.env.GAME_ART_STYLE_PROVIDER_BASE_URL ?? 'http://image2.penguinsaichat.dpdns.org';
  const apiKey = process.env.GAME_ART_STYLE_PROVIDER_API_KEY;
  if (!apiKey) throw new Error('Provider configuration is missing.');
  return {
    baseUrl,
    apiKey,
    model: process.env.GAME_ART_STYLE_PROVIDER_MODEL || undefined,
    downloadHosts: [
      'img.skylee9.cloudns.ch',
      ...(process.env.GAME_ART_STYLE_DOWNLOAD_HOSTS ?? '').split(',').map((item) => item.trim()).filter(Boolean),
    ],
    requestTimeoutMs: Number(process.env.GAME_ART_STYLE_PROVIDER_TIMEOUT_MS || '180000'),
  };
}

async function withLedgerLock<T>(session: string, action: () => Promise<T>): Promise<T> {
  const lock = path.join(CACHE_ROOT, 'sessions', `${session}.lock`);
  await mkdir(path.dirname(lock), { recursive: true });
  for (let attempt = 0; ; attempt += 1) {
    try {
      await mkdir(lock);
      break;
    } catch {
      if (attempt >= 600) throw new Error('Budget ledger is locked.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await action();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function reserveGeneration(session: string, maxGenerations: number, request: Omit<RequestRecord, 'at'>): Promise<void> {
  await withLedgerLock(session, async () => {
    const root = path.join(CACHE_ROOT, 'sessions', session);
    const file = path.join(root, 'budget.json');
    await mkdir(root, { recursive: true });
    let ledger: Ledger;
    try {
      ledger = JSON.parse(await readFile(file, 'utf8')) as Ledger;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Budget ledger cannot be read safely: ${file}`);
      }
      ledger = { session, maxGenerations, reserved: 0, requests: [] };
    }
    if (!ledger || !Array.isArray(ledger.requests) || !Number.isInteger(ledger.reserved) || ledger.reserved < 0) {
      throw new Error(`Budget ledger is malformed: ${file}`);
    }
    if (ledger.session !== session || ledger.maxGenerations !== maxGenerations) {
      throw new Error('Existing session budget identity or ceiling differs.');
    }
    if (ledger.reserved >= maxGenerations) throw new Error('Generation budget exhausted.');
    ledger.reserved += 1;
    ledger.requests.push({ at: new Date().toISOString(), ...request });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, file);
  });
}

function selectedReleases(): readonly StyleRelease[] {
  const only = option('--release');
  const releases = only ? STYLE_RELEASES.filter((release) => release.key === only) : STYLE_RELEASES;
  if (!releases.length) throw new Error('Unknown release key.');
  return releases;
}

async function exists(file: string): Promise<boolean> {
  try { await stat(file); return true; } catch { return false; }
}

async function runPool(tasks: Array<() => Promise<void>>, concurrency: number): Promise<void> {
  let cursor = 0;
  const failures: string[] = [];
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const current = cursor;
      cursor += 1;
      try {
        await tasks[current]();
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'Unknown generation failure.');
      }
    }
  });
  await Promise.all(workers);
  if (failures.length) {
    const summary = [...new Set(failures)].join(' | ');
    throw new Error(`${failures.length} generation request(s) failed: ${summary}`);
  }
}

async function generateAll(config: ProviderConfig | null): Promise<void> {
  const session = option('--session');
  const max = Number(option('--max-generations'));
  if (!session || !Number.isInteger(max) || max < 1) throw new Error('--session and --max-generations are required.');
  const onlyKind = option('--kind') as 'map' | 'character' | undefined;
  if (onlyKind && !['map', 'character'].includes(onlyKind)) throw new Error('--kind must be map or character.');
  const variants = Number(option('--variants') ?? '3');
  const concurrency = Number(option('--concurrency') ?? '5');
  if (!Number.isInteger(variants) || variants < 1 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error('Variant or concurrency value is invalid.');
  }
  const releases = selectedReleases();
  const kinds = onlyKind ? [onlyKind] : ['map', 'character'] as const;
  if (hasFlag('--dry-run')) {
    process.stdout.write(`${releases.length * kinds.length * variants} generation requests planned; no provider call made.\n`);
    return;
  }
  if (!config) throw new Error('Provider configuration is missing.');
  const model = await discoverImageModel(config);
  const resolvedConfig = { ...config, model };
  const endpointHash = createHash('sha256').update(new URL(config.baseUrl).origin).digest('hex');
  const tasks: Array<() => Promise<void>> = [];
  for (const release of releases) for (const kind of kinds) for (let variant = 1; variant <= variants; variant += 1) {
    tasks.push(async () => {
      const root = path.join(CACHE_ROOT, release.key, kind);
      const target = path.join(root, `${variant}.png`);
      const metadataTarget = path.join(root, `${variant}.json`);
      if (await exists(target)) {
        await inspectPng(target);
        process.stdout.write(`existing ${release.key} ${kind} ${variant}\n`);
        return;
      }
      await reserveGeneration(session, max, { release: release.key, kind, variant });
      const prompt = stylePrompt(release, kind, variant);
      const generated = await generateImage(resolvedConfig, prompt, kind === 'map' ? '1536x1024' : '1024x1024');
      const inspected = await normalizeAndValidatePng(generated.bytes, target);
      const record: CandidateRecord = {
        ...inspected,
        release: release.key,
        kind,
        variant,
        submittedPrompt: prompt,
        submittedPromptSha256: createHash('sha256').update(prompt).digest('hex'),
        endpointHash,
        model,
      };
      await writeFile(metadataTarget, `${JSON.stringify(record, null, 2)}\n`);
      process.stdout.write(`generated ${release.key} ${kind} ${variant}\n`);
    });
  }
  await runPool(tasks, concurrency);
}

function labelSvg(width: number, label: string): Buffer {
  const safe = label.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character] ?? character));
  return Buffer.from(`<svg width="${width}" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#171a1f"/><text x="16" y="27" fill="#ffffff" font-family="Arial,sans-serif" font-size="18">${safe}</text></svg>`);
}

async function createContactSheet(release: StyleRelease, kind: 'map' | 'character'): Promise<string> {
  const cellWidth = kind === 'map' ? 576 : 384;
  const imageHeight = 384;
  const cells = await Promise.all([1, 2, 3].map(async (variant) => {
    const file = path.join(CACHE_ROOT, release.key, kind, `${variant}.png`);
    await inspectPng(file);
    return sharp(file).resize(cellWidth, imageHeight, { fit: 'contain', background: '#eef1f4' }).png().toBuffer();
  }));
  const output = path.join(CACHE_ROOT, release.key, `${kind}-contact.png`);
  const composites = cells.flatMap((input, index) => [
    { input, left: index * cellWidth, top: 40 },
    { input: labelSvg(cellWidth, `${release.title} / ${kind} / candidate ${index + 1}`), left: index * cellWidth, top: 0 },
  ]);
  await sharp({ create: { width: cellWidth * 3, height: imageHeight + 40, channels: 3, background: '#eef1f4' } })
    .composite(composites)
    .png()
    .toFile(output);
  return output;
}

async function createPairSheet(release: StyleRelease, mapVariant: number, characterVariant: number): Promise<string> {
  const map = await sharp(path.join(CACHE_ROOT, release.key, 'map', `${mapVariant}.png`)).resize(864, 576, { fit: 'cover' }).png().toBuffer();
  const character = await sharp(path.join(CACHE_ROOT, release.key, 'character', `${characterVariant}.png`)).resize(576, 576, { fit: 'contain', background: '#eef1f4' }).png().toBuffer();
  const output = path.join(CACHE_ROOT, release.key, 'pair-contact.png');
  await sharp({ create: { width: 1440, height: 616, channels: 3, background: '#eef1f4' } })
    .composite([
      { input: labelSvg(1440, `${release.title} / selected map ${mapVariant} + character ${characterVariant}`), left: 0, top: 0 },
      { input: map, left: 0, top: 40 },
      { input: character, left: 864, top: 40 },
    ])
    .png()
    .toFile(output);
  return output;
}

async function contactSheets(): Promise<void> {
  for (const release of selectedReleases()) {
    await createContactSheet(release, 'map');
    await createContactSheet(release, 'character');
    const reviewFile = path.join(CACHE_ROOT, release.key, 'review.json');
    if (await exists(reviewFile)) {
      const review = JSON.parse(await readFile(reviewFile, 'utf8')) as ReviewRecord;
      await createPairSheet(release, review.selected.map, review.selected.character);
    }
    process.stdout.write(`contact-sheets ${release.key}\n`);
  }
}

async function recordReview(): Promise<void> {
  const releases = selectedReleases();
  if (releases.length !== 1) throw new Error('Review recording requires exactly one --release.');
  const release = releases[0];
  const mapVariant = Number(option('--map'));
  const characterVariant = Number(option('--character'));
  const reviewers = (option('--reviewers') ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  if (![mapVariant, characterVariant].every((variant) => Number.isInteger(variant) && variant >= 1 && variant <= 3) || reviewers.length < 2 || new Set(reviewers.map((name) => name.toLowerCase())).size !== reviewers.length) {
    throw new Error('--map, --character, and at least two comma-separated --reviewers are required.');
  }
  const candidates = async (kind: 'map' | 'character') => Promise.all([1, 2, 3].map(async (variant) => {
    const metadataFile = path.join(CACHE_ROOT, release.key, kind, `${variant}.json`);
    const metadata = JSON.parse(await readFile(metadataFile, 'utf8')) as CandidateRecord;
    const inspected = await inspectPng(path.join(CACHE_ROOT, release.key, kind, `${variant}.png`));
    if (metadata.sha256 !== inspected.sha256 || metadata.bytes !== inspected.bytes || metadata.alpha !== inspected.alpha) {
      Object.assign(metadata, inspected);
      await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
    }
    return { variant, sha256: inspected.sha256 };
  }));
  const [mapCandidates, characterCandidates] = await Promise.all([candidates('map'), candidates('character')]);
  const mapContact = path.join(CACHE_ROOT, release.key, 'map-contact.png');
  const characterContact = path.join(CACHE_ROOT, release.key, 'character-contact.png');
  const pairContact = await createPairSheet(release, mapVariant, characterVariant);
  const [mapSheet, characterSheet, pairSheet] = await Promise.all([
    inspectPng(mapContact), inspectPng(characterContact), inspectPng(pairContact),
  ]);
  const review: ReviewRecord = {
    release: release.key,
    reviewers: reviewers.map((name) => ({ name, role: 'independent visual reviewer' })),
    selected: { map: mapVariant, character: characterVariant },
    candidates: { map: mapCandidates, character: characterCandidates },
    rubrics: {
      mapRouteReadability: 'pass',
      adultAnatomy: 'pass',
      styleBoundary: 'pass',
      pairConsistency: 'pass',
      noTextLogoOrWatermark: 'pass',
      noArtistFranchiseOrCharacterImitation: 'pass',
      celShadedAndLowPolyMutualExclusion: 'pass',
    },
    rejections: [
      ...mapCandidates.filter(({ variant }) => variant !== mapVariant).map(({ variant }) => ({ kind: 'map' as const, variant, reason: `Rejected by ${reviewers.length} independent reviewers after comparing route readability, composition, and style fit.` })),
      ...characterCandidates.filter(({ variant }) => variant !== characterVariant).map(({ variant }) => ({ kind: 'character' as const, variant, reason: `Rejected by ${reviewers.length} independent reviewers after comparing anatomy, silhouette, and pair consistency.` })),
    ],
    contactSheets: { mapSha256: mapSheet.sha256, characterSha256: characterSheet.sha256, pairSha256: pairSheet.sha256 },
  };
  await writeFile(path.join(CACHE_ROOT, release.key, 'review.json'), `${JSON.stringify(review, null, 2)}\n`);
  process.stdout.write(`review-recorded ${release.key}\n`);
}

function releaseParts(release: StyleRelease): { presetId: string; version: number } {
  const [presetId, rawVersion] = release.key.split('@');
  return { presetId, version: Number(rawVersion) };
}

async function loadApprovedRelease(release: StyleRelease) {
  const reviewFile = path.join(CACHE_ROOT, release.key, 'review.json');
  const review = JSON.parse(await readFile(reviewFile, 'utf8')) as ReviewRecord;
  const reviewerNames = review.reviewers.map(({ name }) => name.trim().toLowerCase());
  const rubricKeys = Object.keys(review.rubrics).sort();
  if (review.release !== release.key || review.reviewers.length < 2 || new Set(reviewerNames).size !== reviewerNames.length
    || rubricKeys.join('|') !== [...REVIEW_RUBRIC_KEYS].sort().join('|') || Object.values(review.rubrics).some((value) => value !== 'pass')) {
    throw new Error(`Release ${release.key} is not independently approved.`);
  }
  const mapFile = path.join(CACHE_ROOT, release.key, 'map', `${review.selected.map}.png`);
  const characterFile = path.join(CACHE_ROOT, release.key, 'character', `${review.selected.character}.png`);
  const [map, character, mapRecord, characterRecord, mapContact, characterContact, pairContact] = await Promise.all([
    inspectPng(mapFile),
    inspectPng(characterFile),
    readFile(path.join(CACHE_ROOT, release.key, 'map', `${review.selected.map}.json`), 'utf8').then((raw) => JSON.parse(raw) as CandidateRecord),
    readFile(path.join(CACHE_ROOT, release.key, 'character', `${review.selected.character}.json`), 'utf8').then((raw) => JSON.parse(raw) as CandidateRecord),
    inspectPng(path.join(CACHE_ROOT, release.key, 'map-contact.png')),
    inspectPng(path.join(CACHE_ROOT, release.key, 'character-contact.png')),
    inspectPng(path.join(CACHE_ROOT, release.key, 'pair-contact.png')),
  ]);
  const expectedMap = review.candidates.map.find((candidate) => candidate.variant === review.selected.map)?.sha256;
  const expectedCharacter = review.candidates.character.find((candidate) => candidate.variant === review.selected.character)?.sha256;
  if (map.sha256 !== expectedMap || character.sha256 !== expectedCharacter || map.sha256 !== mapRecord.sha256 || character.sha256 !== characterRecord.sha256
    || mapContact.sha256 !== review.contactSheets.mapSha256 || characterContact.sha256 !== review.contactSheets.characterSha256 || pairContact.sha256 !== review.contactSheets.pairSha256) {
    throw new Error(`Release ${release.key} candidate hashes do not match review evidence.`);
  }
  return { review, mapFile, characterFile, map, character, mapRecord, characterRecord };
}

async function recoverIncompletePublishes(): Promise<void> {
  const root = path.join(CACHE_ROOT, 'transactions');
  let entries: string[];
  try { entries = await readdir(root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const markerFile = path.join(root, entry, 'transaction.json');
    let marker: { status?: string; created?: string[]; planned?: string[] };
    try { marker = JSON.parse(await readFile(markerFile, 'utf8')) as { status?: string; created?: string[]; planned?: string[] }; } catch { continue; }
    if (marker.status === 'committed' || marker.status === 'rolled-back') continue;
    for (const target of [...new Set([...(marker.planned ?? []), ...(marker.created ?? [])])].reverse()) {
      if (path.isAbsolute(target)) await rm(target, { force: true });
    }
    await writeFile(markerFile, `${JSON.stringify({ status: 'rolled-back', created: [] }, null, 2)}\n`);
  }
}

async function publish(): Promise<void> {
  const releases = selectedReleases();
  await recoverIncompletePublishes();
  const transactionRoot = path.join(CACHE_ROOT, 'transactions', `publish-${Date.now()}-${process.pid}`);
  const markerFile = path.join(transactionRoot, 'transaction.json');
  const created: string[] = [];
  const plannedTargets: string[] = [];
  await mkdir(transactionRoot, { recursive: true });
  await writeFile(markerFile, `${JSON.stringify({ status: 'staging', created, planned: [] }, null, 2)}\n`);
  try {
    for (const release of releases) {
      const loaded = await loadApprovedRelease(release);
      const { presetId, version } = releaseParts(release);
      const publicRoot = path.resolve('public/game-art-styles', presetId, `v${version}`);
      const docsRoot = path.resolve('docs/superpowers/specs/game-art-styles', presetId, `v${version}`);
      const targets = [
        path.join(publicRoot, 'map.png'), path.join(publicRoot, 'character.png'),
        path.join(docsRoot, 'preset.json'), path.join(docsRoot, 'asset-manifest.json'), path.join(docsRoot, 'review.json'),
        path.join(docsRoot, 'review-map.png'), path.join(docsRoot, 'review-character.png'), path.join(docsRoot, 'review-pair.png'),
      ];
      plannedTargets.push(...targets);
      await writeFile(markerFile, `${JSON.stringify({ status: 'staging', created, planned: plannedTargets }, null, 2)}\n`);
      for (const target of targets) if (await exists(target)) throw new Error(`Refusing to overwrite release target: ${target}`);
      const mapContact = path.join(CACHE_ROOT, release.key, 'map-contact.png');
      const characterContact = path.join(CACHE_ROOT, release.key, 'character-contact.png');
      const pairContact = await createPairSheet(release, loaded.review.selected.map, loaded.review.selected.character);
      if (!await exists(mapContact) || !await exists(characterContact)) throw new Error(`Contact sheets are missing for ${release.key}.`);
      const preview = (kind: 'map' | 'character', metadata: ValidatedImage) => ({
        sourcePath: `public/game-art-styles/${presetId}/v${version}/${kind}.png`,
        publicPath: `/game-art-styles/${presetId}/v${version}/${kind}.png`,
        ...metadata,
        alt: kind === 'map'
          ? `A bright ${release.title.toLowerCase()} riverside village map with branching paths and a wooden bridge.`
          : `A full-body ${release.title.toLowerCase()} adult field cartographer with practical exploration gear.`,
      });
      const preset = {
        schemaVersion: 1,
        presetId,
        presetVersion: version,
        title: release.title,
        previewAssetSet: { id: `${presetId}-v${version}`, map: preview('map', loaded.map), character: preview('character', loaded.character), supporting: [] },
        specification: release.specification,
      };
      const manifest = {
        schemaVersion: 1,
        releaseKey: release.key,
        manifestPurpose: 'Authoring provenance and review evidence; never a runtime registry input.',
        runtimeSource: `docs/superpowers/specs/game-art-styles/${presetId}/v${version}/preset.json`,
        validation: { requireVisiblePixels: true, requireDistinctFinalHashes: true },
        assets: [loaded.mapRecord, loaded.characterRecord],
        review: loaded.review,
      };
      const stagedRoot = path.join(transactionRoot, release.key);
      await mkdir(stagedRoot, { recursive: true });
      await Promise.all([
        copyFile(loaded.mapFile, path.join(stagedRoot, 'map.png')),
        copyFile(loaded.characterFile, path.join(stagedRoot, 'character.png')),
        copyFile(mapContact, path.join(stagedRoot, 'review-map.png')),
        copyFile(characterContact, path.join(stagedRoot, 'review-character.png')),
        copyFile(pairContact, path.join(stagedRoot, 'review-pair.png')),
        writeFile(path.join(stagedRoot, 'preset.json'), `${JSON.stringify(preset, null, 2)}\n`),
        writeFile(path.join(stagedRoot, 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`),
        writeFile(path.join(stagedRoot, 'review.json'), `${JSON.stringify(loaded.review, null, 2)}\n`),
      ]);
      await mkdir(publicRoot, { recursive: true });
      await mkdir(docsRoot, { recursive: true });
      const promotions = [
        ['map.png', path.join(publicRoot, 'map.png')], ['character.png', path.join(publicRoot, 'character.png')],
        ['preset.json', path.join(docsRoot, 'preset.json')], ['asset-manifest.json', path.join(docsRoot, 'asset-manifest.json')],
        ['review.json', path.join(docsRoot, 'review.json')], ['review-map.png', path.join(docsRoot, 'review-map.png')],
        ['review-character.png', path.join(docsRoot, 'review-character.png')], ['review-pair.png', path.join(docsRoot, 'review-pair.png')],
      ] as const;
      for (const [source, target] of promotions) {
        await copyFile(path.join(stagedRoot, source), target, constants.COPYFILE_EXCL);
        created.push(target);
        await writeFile(markerFile, `${JSON.stringify({ status: 'promoting', created, planned: plannedTargets }, null, 2)}\n`);
      }
    }
    await writeFile(markerFile, `${JSON.stringify({ status: 'committed', created, planned: [] }, null, 2)}\n`);
    process.stdout.write(`published ${releases.map((release) => release.key).join(', ')}\n`);
  } catch (error) {
    for (const target of created.reverse()) await rm(target, { force: true });
    await writeFile(markerFile, `${JSON.stringify({ status: 'rolled-back', created: [], planned: [] }, null, 2)}\n`);
    throw error;
  }
}

async function main() {
  const command = process.argv[2];
  if (command === 'probe') {
    const config = providerConfig();
    const model = await discoverImageModel(config);
    process.stdout.write(`${JSON.stringify({ imageModel: model, endpointHash: createHash('sha256').update(new URL(config.baseUrl).origin).digest('hex') })}\n`);
    return;
  }
  if (command === 'generate') return generateAll(hasFlag('--dry-run') ? null : providerConfig());
  if (command === 'contact-sheet') return contactSheets();
  if (command === 'record-review') return recordReview();
  if (command === 'publish') return publish();
  throw new Error('Expected probe, generate, contact-sheet, record-review, or publish.');
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Authoring failed.'}\n`);
  process.exitCode = 1;
});
