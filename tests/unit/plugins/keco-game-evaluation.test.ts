import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const repositoryRoot = process.cwd();
const skillRoot = path.join(repositoryRoot, 'plugins', 'keco-codex', 'skills', 'keco-evaluate-game');
const profileScript = path.join(skillRoot, 'scripts', 'create_evaluation_profile.py');
const scoreScript = path.join(skillRoot, 'scripts', 'score_game_evaluation.py');
const reportValidator = path.join(skillRoot, 'scripts', 'validate_game_evaluation_report.py');
const fixturePath = path.join(repositoryRoot, 'tests', 'fixtures', 'plugins', 'keco-game-evaluation-evidence.json');

const expectedItems = {
  artStyle: {
    styleConsistency: 20,
    assetQualityAndFit: 15,
    uiReadabilityAndLayout: 10,
    visualFeedbackAndEmotion: 5,
  },
  playerFun: {
    coreLoopAppeal: 20,
    meaningfulChoices: 15,
    feedbackPacingAndGoals: 10,
    motivationToContinue: 5,
  },
};

function readFixture(): Record<string, any> {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, any>;
}

describe('Keco game evaluation scoring', () => {
  let tempRoot: string;
  let profilePath: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-game-evaluation-'));
    profilePath = path.join(tempRoot, 'profile.json');
    const result = spawnSync('python3', [
      profileScript,
      '--game-id', 'village-rpg',
      '--stage', 'beta',
      '--genre', 'rpg',
      '--gdd-revision', 'sha256:gdd123',
      '--build-hash', 'sha256:build123',
      '--locked-at', '2026-08-26T00:00:00Z',
      '--output', profilePath,
    ], { encoding: 'utf8' });
    expect(result.status).toBe(0);
  });

  afterEach(() => rmSync(tempRoot, { recursive: true, force: true }));

  function score(evidence: Record<string, any> = readFixture()) {
    const evidencePath = path.join(tempRoot, 'evidence.json');
    const reportPath = path.join(tempRoot, 'report.json');
    writeFileSync(evidencePath, JSON.stringify(evidence));
    const result = spawnSync('python3', [
      scoreScript, '--profile', profilePath, '--evidence', evidencePath, '--output', reportPath,
    ], { encoding: 'utf8' });
    const report = existsSync(reportPath)
      ? JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, any>
      : null;
    return { result, report, reportPath };
  }

  function validate(report: Record<string, any>) {
    const candidate = path.join(tempRoot, 'candidate.json');
    writeFileSync(candidate, JSON.stringify(report));
    return spawnSync('python3', [reportValidator, candidate], { encoding: 'utf8' });
  }

  it('creates the fixed version 1 two-dimension, eight-item profile', () => {
    const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as Record<string, any>;
    expect(profile).toMatchObject({
      version: 1,
      profileId: 'village-rpg-beta-v1',
      gameId: 'village-rpg',
      stage: 'beta',
      genre: 'rpg',
      gddRevision: 'sha256:gdd123',
      buildHash: 'sha256:build123',
      thresholds: { alpha: 60, beta: 70, rc: 80, release: 85 },
    });
    expect(Object.keys(profile.dimensions)).toEqual(['artStyle', 'playerFun']);
    for (const [dimension, items] of Object.entries(expectedItems)) {
      expect(profile.dimensions[dimension].max).toBe(50);
      expect(Object.fromEntries(profile.dimensions[dimension].items.map(
        (item: Record<string, any>) => [item.id, item.max],
      ))).toEqual(items);
      for (const item of profile.dimensions[dimension].items) {
        expect(item.dimension).toBe(dimension);
        expect(item.anchors).toEqual(expect.objectContaining({ zero: expect.any(String), full: expect.any(String) }));
        expect(item.requiredEvidence.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps genre as metadata without changing weights', () => {
    const actionPath = path.join(tempRoot, 'action.json');
    const result = spawnSync('python3', [
      profileScript, '--game-id', 'village-rpg', '--stage', 'beta', '--genre', 'action',
      '--gdd-revision', 'sha256:gdd123', '--build-hash', 'sha256:build123',
      '--locked-at', '2026-08-26T00:00:00Z', '--output', actionPath,
    ], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    const base = JSON.parse(readFileSync(profilePath, 'utf8')) as Record<string, any>;
    const action = JSON.parse(readFileSync(actionPath, 'utf8')) as Record<string, any>;
    expect(action.genre).toBe('action');
    expect(action.dimensions).toEqual(base.dimensions);
  });

  it('scores only the complete external Claude review and leaves human review empty', () => {
    const { result, report } = score();
    expect(result.status).toBe(0);
    expect(report.version).toBe(1);
    expect(report).not.toHaveProperty('score');
    expect(report.claudeReview).toMatchObject({
      status: 'complete',
      dimensions: {
        artStyle: { score: 50, max: 50 },
        playerFun: { score: 50, max: 50 },
      },
      total: { score: 100, max: 100 },
    });
    expect(report.humanReview).toEqual({
      artStyle: { score: null, max: 50, comment: null, nextIteration: null },
      playerFun: { score: null, max: 50, comment: null, nextIteration: null },
      total: { score: null, max: 100 },
    });
    expect(report.coverage).toBe(1);
    expect(report.decision.status).toBe('passed');
  });

  it('does not convert mandatory automation or technical evidence into player fun points', () => {
    const evidence = readFixture();
    evidence.claudeReview.items = evidence.claudeReview.items.map((item: Record<string, any>) => ({
      ...item, score: 0,
    }));
    evidence.technicalEvidence = {
      stability: 'all checks passed', coverage: 1, sliceEvalReport: 'KECO_EVAL:passed',
    };
    const { result, report } = score(evidence);
    expect(result.status).toBe(0);
    expect(report.claudeReview.total.score).toBe(0);
    expect(report.claudeReview.dimensions.playerFun.score).toBe(0);
    expect(report.mandatoryEvaluations[0].status).toBe('passed');
    expect(report.decision.status).toBe('failed');
  });

  it('uses not_evaluated when evidence is insufficient and withholds affected totals', () => {
    const evidence = readFixture();
    evidence.claudeReview.items[0] = {
      ...evidence.claudeReview.items[0],
      status: 'not_evaluated', score: null, evidence: [],
      reason: 'The captured frames do not show repeated gameplay states.',
      limitations: ['No comparable gameplay frames are available.'],
    };
    const { result, report } = score(evidence);
    expect(result.status).toBe(0);
    expect(report.coverage).toBe(0.875);
    expect(report.claudeReview.status).toBe('pending');
    expect(report.claudeReview.dimensions.artStyle.score).toBeNull();
    expect(report.claudeReview.dimensions.playerFun.score).toBe(50);
    expect(report.claudeReview.total.score).toBeNull();
    expect(report.decision.status).toBe('partial');
  });

  it('keeps the Claude review pending when no external review is supplied', () => {
    const evidence = readFixture();
    delete evidence.claudeReview;
    const { result, report } = score(evidence);
    expect(result.status).toBe(0);
    expect(report.claudeReview.status).toBe('pending');
    expect(report.claudeReview.total.score).toBeNull();
    expect(report.coverage).toBe(0);
  });

  it.each([
    ['over-limit score', (e: Record<string, any>) => { e.claudeReview.items[0].score = 21; }, /maximum|score/i],
    ['duplicate item', (e: Record<string, any>) => { e.claudeReview.items[1] = structuredClone(e.claudeReview.items[0]); }, /duplicate|exactly/i],
    ['unknown item', (e: Record<string, any>) => { e.claudeReview.items[0].itemId = 'stability'; }, /unknown|exactly/i],
    ['evaluated item without evidence', (e: Record<string, any>) => { e.claudeReview.items[0].evidence = []; }, /evidence/i],
    ['profile identity mismatch', (e: Record<string, any>) => { e.profileId = 'other-beta-v1'; }, /identity|profile/i],
  ])('rejects %s without writing a report', (_label, mutate, expected) => {
    const evidence = readFixture();
    mutate(evidence);
    const { result, report } = score(evidence);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(expected);
    expect(result.stderr).not.toMatch(/Traceback/);
    expect(report).toBeNull();
  });

  it('keeps P0 and mandatory failures as non-scoring acceptance gates', () => {
    const evidence = readFixture();
    evidence.findings = [{
      issueId: 'ISSUE-P0', severity: 'P0', primaryMetricId: 'playerFun.coreLoopAppeal',
      linkedMetricIds: [], evidence: ['slice-eval:crash'],
    }];
    evidence.mandatoryEvaluations = [{ evalId: 'core-flow', status: 'failed', evidence: ['KECO_EVAL:failed'] }];
    const { result, report } = score(evidence);
    expect(result.status).toBe(0);
    expect(report.claudeReview.total.score).toBe(100);
    expect(report.decision.status).toBe('failed');
    expect(report.decision.reasons.join(' ')).toMatch(/P0.*mandatory|mandatory.*P0/i);
  });

  it('validates a generated report and a coherent manually completed review', () => {
    const { report } = score();
    expect(validate(report).status).toBe(0);
    report.humanReview = {
      artStyle: { score: 42, max: 50, comment: 'Coherent visual direction.', nextIteration: 'Improve combat readability.' },
      playerFun: { score: 40, max: 50, comment: 'Promising loop in the session.', nextIteration: 'Test more build choices.' },
      total: { score: 82, max: 100 },
    };
    expect(validate(report).status).toBe(0);
  });

  it('records one JSONL fact per operation and generates the Markdown projection', () => {
    const { report, reportPath } = score();
    const validated = spawnSync('python3', [reportValidator, reportPath], { encoding: 'utf8' });
    expect(validated.status).toBe(0);
    const progressPath = path.join(tempRoot, 'progress.jsonl');
    const markdownPath = path.join(tempRoot, 'progress.md');
    const events = readFileSync(progressPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(events.map(event => event.segment)).toEqual(['profile', 'score', 'validate']);
    for (const event of events) {
      expect(event).toEqual(expect.objectContaining({
        goal: expect.any(String), inputs: expect.any(Object), execution: expect.any(String),
        expectedOutput: expect.any(String), actualResult: expect.any(Object),
        meaning: expect.any(String), nextImpact: expect.any(String),
        operationKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        inputHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        outputHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        outcome: 'created',
      }));
    }
    const markdown = readFileSync(markdownPath, 'utf8');
    expect(markdown).toMatch(/Goal:[\s\S]*Operation key:[\s\S]*Input hash:[\s\S]*Output hash:[\s\S]*Actual result:/);
    expect(markdown).toContain('```json\n{\n  "');
    expect(report.claudeReview.total.score).toBe(100);
  });

  it('reuses unchanged profile, score, and validation executions without duplicate facts', () => {
    const profileAgain = spawnSync('python3', [
      profileScript, '--game-id', 'village-rpg', '--stage', 'beta', '--genre', 'rpg',
      '--gdd-revision', 'sha256:gdd123', '--build-hash', 'sha256:build123',
      '--locked-at', '2026-08-26T00:00:00Z', '--output', profilePath,
    ], { encoding: 'utf8' });
    expect(JSON.parse(profileAgain.stdout).outcome).toBe('reused');

    const evidencePath = path.join(tempRoot, 'evidence.json');
    const reportPath = path.join(tempRoot, 'report.json');
    writeFileSync(evidencePath, JSON.stringify(readFixture()));
    const scoreArgs = [scoreScript, '--profile', profilePath, '--evidence', evidencePath, '--output', reportPath];
    const firstScore = spawnSync('python3', scoreArgs, { encoding: 'utf8' });
    const secondScore = spawnSync('python3', scoreArgs, { encoding: 'utf8' });
    expect(JSON.parse(firstScore.stdout).outcome).toBe('created');
    expect(JSON.parse(secondScore.stdout).outcome).toBe('reused');

    const firstValidate = spawnSync('python3', [reportValidator, reportPath], { encoding: 'utf8' });
    const secondValidate = spawnSync('python3', [reportValidator, reportPath], { encoding: 'utf8' });
    expect(JSON.parse(firstValidate.stdout).outcome).toBe('created');
    expect(JSON.parse(secondValidate.stdout).outcome).toBe('reused');

    const events = readFileSync(path.join(tempRoot, 'progress.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line));
    expect(events.map(event => event.segment)).toEqual(['profile', 'score', 'validate']);
  });

  it('documents the two score dimensions and the external Claude boundary', () => {
    const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const rubric = readFileSync(path.join(skillRoot, 'references', 'rubric.md'), 'utf8');
    const contract = readFileSync(path.join(skillRoot, 'references', 'report-contract.md'), 'utf8');
    expect(skill).toMatch(/`artStyle` \(50 points\)[\s\S]*`playerFun` \(50 points\)/);
    expect(skill).toMatch(/does not provide a Claude MCP[\s\S]*externally generated/i);
    expect(skill).toMatch(/Never merge Claude and human scores automatically/i);
    expect(skill).toMatch(/progress\.jsonl[\s\S]*progress\.md/);
    for (const item of Object.values(expectedItems).flatMap(items => Object.keys(items))) {
      expect(rubric).toContain(item);
    }
    expect(contract).toMatch(/Only complete Claude item scores contribute[\s\S]*never creates a combined score/i);
  });

  it('locks every game evaluation contract surface to Art Style 50 + Player Fun 50', () => {
    const files = [
      path.join(repositoryRoot, 'plugins', 'keco-codex', '.codex-plugin', 'plugin.json'),
      path.join(skillRoot, 'SKILL.md'),
      path.join(skillRoot, 'references', 'rubric.md'),
      path.join(skillRoot, 'references', 'report-contract.md'),
      profileScript,
      scoreScript,
      reportValidator,
    ];
    const corpus = files.map(file => readFileSync(file, 'utf8')).join('\n');
    expect(corpus).not.toMatch(/80\s*\+\s*20|token-efficiency-human-review/i);
    expect(corpus).toMatch(/Art Style 50 \+ Player Fun 50/i);
    expect(corpus).toMatch(/artStyle[\s\S]*50[\s\S]*playerFun[\s\S]*50/i);
  });

  it.each([
    ['item maximum', (r: Record<string, any>) => { r.claudeReview.dimensions.artStyle.items[0].max = 21; }, /maximum|max/i],
    ['dimension sum', (r: Record<string, any>) => { r.claudeReview.dimensions.artStyle.score = 49; }, /dimension|sum/i],
    ['total sum', (r: Record<string, any>) => { r.claudeReview.total.score = 99; }, /total/i],
    ['missing evidence', (r: Record<string, any>) => { r.claudeReview.dimensions.playerFun.items[0].evidence = []; }, /evidence/i],
    ['partial human score', (r: Record<string, any>) => { r.humanReview.artStyle.score = 40; }, /human/i],
    ['automatic combined score', (r: Record<string, any>) => { r.combinedScore = 95; }, /combined/i],
    ['report identity', (r: Record<string, any>) => { r.reportId = 'wrong'; }, /identity|reportId/i],
  ])('validator rejects %s', (_label, mutate, expected) => {
    const { report } = score();
    mutate(report);
    const result = validate(report);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(expected);
    expect(result.stderr).not.toMatch(/Traceback/);
  });
});
