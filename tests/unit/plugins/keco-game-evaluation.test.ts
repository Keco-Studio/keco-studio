import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const repositoryRoot = process.cwd();
const skillRoot = path.join(
  repositoryRoot,
  'plugins',
  'keco-codex',
  'skills',
  'keco-evaluate-game',
);
const profileScript = path.join(skillRoot, 'scripts', 'create_evaluation_profile.py');
const scoreScript = path.join(skillRoot, 'scripts', 'score_game_evaluation.py');
const reportValidator = path.join(skillRoot, 'scripts', 'validate_game_evaluation_report.py');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), 'utf8')) as T;
}

describe('Keco EDD game evaluation Skill', () => {
  it('ships an implicitly triggerable game evaluation entry', () => {
    const skillPath = path.join(skillRoot, 'SKILL.md');
    const metadataPath = path.join(skillRoot, 'agents', 'openai.yaml');

    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync(metadataPath)).toBe(true);
    if (!existsSync(skillPath) || !existsSync(metadataPath)) return;

    const skill = readFileSync(skillPath, 'utf8');
    const metadata = readFileSync(metadataPath, 'utf8');

    expect(skill).toMatch(/^---\nname: keco-evaluate-game\n/);
    expect(skill).toMatch(/^description: Use when[^\n]*(?:score|evaluate)[^\n]*(?:game|Godot)/m);
    expect(skill).toContain(
      '[shared interaction contract](../../references/interaction-contract.md)',
    );
    expect(skill).toMatch(/Before expensive or mutating work[\s\S]{0,240}Goal[\s\S]{0,120}Source[\s\S]{0,120}Scope[\s\S]{0,120}Success[\s\S]{0,120}Next/i);
    expect(skill).toMatch(/80[\s\S]*20[\s\S]*100-point/i);
    expect(skill).toMatch(
      /Slice[\s\S]*Alpha[\s\S]*Beta[\s\S]*Release Candidate[\s\S]*Release/i,
    );
    expect(skill).toMatch(/manual_required[\s\S]*visual[\s\S]*experience/i);
    expect(metadata).toMatch(/default_prompt: "Use \$keco-evaluate-game/);
    expect(metadata).toMatch(/allow_implicit_invocation: true/);
  });

  it('defines positive, pressure, and negative trigger cases', () => {
    const fixture = readJson<{
      skill: string;
      invocation: string;
      cases: Array<{
        id: string;
        kind: string;
        prompt: string;
        expectedSkill: string;
        requiredBehaviors: string[];
      }>;
    }>('tests/fixtures/plugins/keco-game-evaluation-skill-evals.json');

    expect(fixture.skill).toBe('keco-evaluate-game');
    expect(fixture.invocation).toBe('$keco-evaluate-game');
    expect(fixture.cases).toHaveLength(6);
    expect(fixture.cases.filter((item) => item.expectedSkill === 'keco-evaluate-game')).toHaveLength(4);
    expect(fixture.cases).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'full-beta', kind: 'positive' }),
      expect.objectContaining({ id: 'missing-human-evidence', kind: 'pressure' }),
      expect.objectContaining({ id: 'implementation', expectedSkill: 'keco-develop-godot-slice-v2' }),
      expect.objectContaining({ id: 'analysis-only', expectedSkill: 'none' }),
    ]));
  });

  describe('evaluation profile', () => {
    let tempRoot: string;

    beforeEach(() => {
      tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-game-profile-'));
    });

    afterEach(() => {
      rmSync(tempRoot, { recursive: true, force: true });
    });

    function createProfile(extraArgs: string[] = []) {
      const output = path.join(tempRoot, 'profile.json');
      const result = spawnSync('python3', [
        profileScript,
        '--game-id', 'village-rpg',
        '--stage', 'beta',
        '--genre', 'rpg',
        '--gdd-revision', 'sha256:gdd123',
        '--build-hash', 'sha256:build123',
        '--locked-at', '2026-08-12T12:00:00Z',
        '--output', output,
        ...extraArgs,
      ], { encoding: 'utf8' });
      return { output, result };
    }

    it('creates a locked 80 plus 20 RPG profile', () => {
      const { output, result } = createProfile();

      expect(result.status).toBe(0);
      const profile = JSON.parse(readFileSync(output, 'utf8')) as {
        version: number;
        profileId: string;
        gameId: string;
        stage: string;
        genre: string;
        gddRevision: string;
        buildHash: string;
        lockedAt: string;
        subjectiveWeight: number;
        thresholds: Record<string, number>;
        generalMetrics: Array<{ id: string; weight: number; anchors: Record<string, string>; requiredEvidence: string[] }>;
        specializedMetrics: Array<{ id: string; weight: number; anchors: Record<string, string>; requiredEvidence: string[] }>;
      };

      expect(profile).toMatchObject({
        version: 1,
        gameId: 'village-rpg',
        stage: 'beta',
        genre: 'rpg',
        gddRevision: 'sha256:gdd123',
        buildHash: 'sha256:build123',
        lockedAt: '2026-08-12T12:00:00Z',
        subjectiveWeight: 0.2,
        thresholds: { alpha: 60, beta: 70, rc: 80, release: 85 },
      });
      expect(profile.profileId).toBe('village-rpg-beta-v1');
      expect(profile.generalMetrics.reduce((sum, metric) => sum + metric.weight, 0)).toBe(80);
      expect(profile.specializedMetrics.reduce((sum, metric) => sum + metric.weight, 0)).toBe(20);
      expect([...profile.generalMetrics, ...profile.specializedMetrics]).toHaveLength(39);
      for (const metric of [...profile.generalMetrics, ...profile.specializedMetrics]) {
        expect(metric.id).toMatch(/^(?:general|specialized)\./);
        expect(metric.weight).toBeGreaterThan(0);
        expect(metric.anchors).toEqual(expect.objectContaining({ '1': expect.any(String), '3': expect.any(String), '5': expect.any(String) }));
        expect(metric.requiredEvidence.length).toBeGreaterThan(0);
      }
    });

    it('rejects a custom profile that replaces more than ten points', () => {
      const customPath = path.join(tempRoot, 'custom.json');
      writeFileSync(customPath, JSON.stringify({
        replaceMetricIds: [
          'specialized.rpg.character-growth',
          'specialized.rpg.builds',
          'specialized.rpg.quest-exploration',
        ],
        customMetrics: [
          {
            id: 'specialized.project.custom-a',
            name: 'Custom A',
            weight: 12,
            gddSource: 'GDD-6.3',
            anchors: { '1': 'Absent', '3': 'Partial', '5': 'Strong' },
            requiredEvidence: ['player event'],
          },
        ],
      }));

      const { result } = createProfile(['--specialized-config', customPath]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/custom specialized weight must not exceed 10/i);
      expect(result.stderr).not.toMatch(/Traceback/);
    });

    it('documents all seven specialized genre templates', () => {
      const rubricPath = path.join(skillRoot, 'references', 'rubric.md');
      expect(existsSync(rubricPath)).toBe(true);
      if (!existsSync(rubricPath)) return;
      const rubric = readFileSync(rubricPath, 'utf8');
      for (const genre of [
        'Action',
        'RPG',
        'Simulation And Management',
        'Puzzle',
        'Visual Novel And Narrative',
        'Strategy',
        'Platformer',
      ]) expect(rubric).toContain(`### ${genre}`);
    });
  });

  describe('score and decision', () => {
    let tempRoot: string;
    let profilePath: string;
    let baseEvidence: Record<string, any>;

    beforeEach(() => {
      tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-game-score-'));
      profilePath = path.join(tempRoot, 'profile.json');
      const profile = spawnSync('python3', [
        profileScript,
        '--game-id', 'village-rpg',
        '--stage', 'beta',
        '--genre', 'rpg',
        '--gdd-revision', 'sha256:gdd123',
        '--build-hash', 'sha256:build123',
        '--locked-at', '2026-08-12T12:00:00Z',
        '--output', profilePath,
      ], { encoding: 'utf8' });
      expect(profile.status).toBe(0);
      baseEvidence = readJson<Record<string, any>>(
        'tests/fixtures/plugins/keco-game-evaluation-evidence.json',
      );
    });

    afterEach(() => {
      rmSync(tempRoot, { recursive: true, force: true });
    });

    function score(evidence: Record<string, any> = baseEvidence) {
      const evidencePath = path.join(tempRoot, 'evidence.json');
      const reportPath = path.join(tempRoot, 'report.json');
      writeFileSync(evidencePath, JSON.stringify(evidence));
      const result = spawnSync('python3', [
        scoreScript,
        '--profile', profilePath,
        '--evidence', evidencePath,
        '--output', reportPath,
      ], { encoding: 'utf8' });
      const report = existsSync(reportPath)
        ? JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, any>
        : null;
      return { result, report };
    }

    function replaceItem(metricId: string, value: Record<string, any>) {
      return {
        ...baseEvidence,
        itemResults: baseEvidence.itemResults.map((item: Record<string, any>) =>
          item.metricId === metricId ? { ...item, ...value } : item),
      };
    }

    it('scores complete evidence and passes the Beta gate', () => {
      const { result, report } = score();
      expect(result.status).toBe(0);
      expect(report.score).toMatchObject({ total: 80, generalWeight: 80, specializedWeight: 20 });
      expect(report.coverage).toBe(1);
      expect(report.decision).toMatchObject({ status: 'passed', stage: 'beta' });
      expect(report.severityCounts).toEqual({ P0: 0, P1: 0, P2: 0, P3: 0 });
    });

    it('uses the group subjective rating for exactly twenty percent', () => {
      const evidence = {
        ...baseEvidence,
        subjectiveResults: baseEvidence.subjectiveResults.map((item: Record<string, any>) =>
          item.groupId === 'general.core' ? { ...item, ratings: [3, 3, 3, 3, 3] } : item),
      };
      const { result, report } = score(evidence);
      expect(result.status).toBe(0);
      expect(report.score.total).toBeCloseTo(78.2, 2);
      expect(report.score.groups['general.core'].structuredRate).toBe(0.8);
      expect(report.score.groups['general.core'].subjectiveRate).toBe(0.3);
      expect(report.score.groups['general.core'].score).toBeCloseTo(12.6, 2);
    });

    it('normalizes not applicable metrics without reducing coverage', () => {
      const evidence = replaceItem('general.pacing.reward-spacing', {
        status: 'not_applicable', rating: undefined, evidence: [],
      });
      const { result, report } = score(evidence);
      expect(result.status).toBe(0);
      expect(report.coverage).toBe(1);
      expect(report.score.total).toBe(80);
    });

    it('keeps not evaluated metrics in the denominator and lowers coverage', () => {
      const evidence = replaceItem('general.core.core-loop', {
        status: 'not_evaluated', rating: undefined, evidence: [],
      });
      const { result, report } = score(evidence);
      expect(result.status).toBe(0);
      expect(report.coverage).toBeCloseTo(0.96, 4);
      expect(report.score.groups['general.core'].coverage).toBeLessThan(1);
    });

    it('flags low confidence and high disagreement', () => {
      const evidence = {
        ...baseEvidence,
        subjectiveResults: baseEvidence.subjectiveResults.map((item: Record<string, any>) =>
          item.groupId === 'general.core' ? { ...item, ratings: [5, 9] } : item),
      };
      const { result, report } = score(evidence);
      expect(result.status).toBe(0);
      expect(report.subjective['general.core']).toMatchObject({
        count: 2, lowConfidence: true, highDisagreement: true, min: 5, max: 9,
      });
    });

    it('returns partial without a formal pass below seventy percent coverage', () => {
      const evidence = {
        ...baseEvidence,
        itemResults: baseEvidence.itemResults.map((item: Record<string, any>, index: number) =>
          index < 15 ? item : { ...item, status: 'not_evaluated', rating: undefined, evidence: [] }),
      };
      const { result, report } = score(evidence);
      expect(result.status).toBe(0);
      expect(report.coverage).toBeLessThan(0.7);
      expect(report.decision.status).toBe('partial');
      expect(report.score.formalTotal).toBeNull();
    });

    it('fails on a P0 finding', () => {
      const evidence = {
        ...baseEvidence,
        findings: [{
          issueId: 'ISSUE-P0', severity: 'P0', primaryMetricId: 'general.stability.crash-block',
          linkedMetricIds: [], evidence: ['crash log'],
        }],
      };
      const { result, report } = score(evidence);
      expect(result.status).toBe(0);
      expect(report.decision.status).toBe('failed');
      expect(report.decision.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/P0/i)]));
    });

    it('makes a managed Beta P1 conditional', () => {
      const evidence = {
        ...baseEvidence,
        findings: [{
          issueId: 'ISSUE-P1', severity: 'P1', primaryMetricId: 'general.clarity.next-action',
          linkedMetricIds: [], evidence: ['session:s2'], owner: 'designer',
          targetVersion: 'beta-2', fixedAcceptanceRule: '4 of 5 players progress in 15 seconds',
        }],
      };
      const { result, report } = score(evidence);
      expect(result.status).toBe(0);
      expect(report.decision.status).toBe('conditional');
    });

    it('fails RC when a P1 remains open', () => {
      profilePath = path.join(tempRoot, 'rc-profile.json');
      const profile = spawnSync('python3', [
        profileScript, '--game-id', 'village-rpg', '--stage', 'rc', '--genre', 'rpg',
        '--gdd-revision', 'sha256:gdd123', '--build-hash', 'sha256:build123',
        '--locked-at', '2026-08-12T12:00:00Z', '--output', profilePath,
      ], { encoding: 'utf8' });
      expect(profile.status).toBe(0);
      const evidence = {
        ...baseEvidence,
        profileId: 'village-rpg-rc-v1',
        findings: [{
          issueId: 'ISSUE-P1', severity: 'P1', primaryMetricId: 'general.clarity.next-action',
          linkedMetricIds: [], evidence: ['session:s2'], owner: 'designer',
          targetVersion: 'rc-2', fixedAcceptanceRule: '4 of 5 players progress in 15 seconds',
        }],
      };
      const { result, report } = score(evidence);
      expect(result.status).toBe(0);
      expect(report.decision.status).toBe('failed');
    });

    it('fails when a mandatory evaluation fails', () => {
      const evidence = {
        ...baseEvidence,
        mandatoryEvaluations: [{ evalId: 'core-flow', status: 'failed', evidence: ['KECO_EVAL:failed'] }],
      };
      const { result, report } = score(evidence);
      expect(result.status).toBe(0);
      expect(report.decision.status).toBe('failed');
      expect(report.decision.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/mandatory/i)]));
    });

    it('fails when a critical group minimum is missed', () => {
      const evidence = {
        ...baseEvidence,
        itemResults: baseEvidence.itemResults.map((item: Record<string, any>) =>
          item.metricId.startsWith('general.core.') ? { ...item, rating: 2 } : item),
        subjectiveResults: baseEvidence.subjectiveResults.map((item: Record<string, any>) =>
          item.groupId === 'general.core' ? { ...item, ratings: [4, 4, 4, 4, 4] } : item),
      };
      const { result, report } = score(evidence);
      expect(result.status).toBe(0);
      expect(report.decision.status).toBe('failed');
      expect(report.decision.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/core/i)]));
    });

    it('rejects duplicate issue IDs instead of double counting them', () => {
      const finding = {
        issueId: 'ISSUE-DUP', severity: 'P2', primaryMetricId: 'general.core.core-loop',
        linkedMetricIds: [], evidence: ['session:s1'],
      };
      const { result } = score({ ...baseEvidence, findings: [finding, finding] });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/duplicate issue ID/i);
      expect(result.stderr).not.toMatch(/Traceback/);
    });
  });

  describe('report validator', () => {
    let tempRoot: string;
    let validReport: Record<string, any>;

    beforeEach(() => {
      tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-game-report-'));
      const profilePath = path.join(tempRoot, 'profile.json');
      const reportPath = path.join(tempRoot, 'report.json');
      const profile = spawnSync('python3', [
        profileScript, '--game-id', 'village-rpg', '--stage', 'beta', '--genre', 'rpg',
        '--gdd-revision', 'sha256:gdd123', '--build-hash', 'sha256:build123',
        '--locked-at', '2026-08-12T12:00:00Z', '--output', profilePath,
      ], { encoding: 'utf8' });
      expect(profile.status).toBe(0);
      const evidencePath = path.join(
        repositoryRoot,
        'tests',
        'fixtures',
        'plugins',
        'keco-game-evaluation-evidence.json',
      );
      const scored = spawnSync('python3', [
        scoreScript, '--profile', profilePath, '--evidence', evidencePath, '--output', reportPath,
      ], { encoding: 'utf8' });
      expect(scored.status).toBe(0);
      validReport = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, any>;
    });

    afterEach(() => {
      rmSync(tempRoot, { recursive: true, force: true });
    });

    function validate(value: Record<string, any>) {
      const reportPath = path.join(tempRoot, 'candidate.json');
      writeFileSync(reportPath, JSON.stringify(value));
      return spawnSync('python3', [reportValidator, reportPath], { encoding: 'utf8' });
    }

    it('accepts a valid generated game evaluation report', () => {
      const result = validate(validReport);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true, status: 'passed', stage: 'beta', score: 80, coverage: 1,
      });
    });

    it.each([
      ['weights not equal to 100', (report: Record<string, any>) => {
        report.score.generalWeight = 79;
      }, /weight/i],
      ['score outside range', (report: Record<string, any>) => {
        report.score.total = 101;
      }, /score/i],
      ['coverage outside range', (report: Record<string, any>) => {
        report.coverage = 1.1;
      }, /coverage/i],
      ['Release pass below 85', (report: Record<string, any>) => {
        report.stage = 'release';
        report.decision = { stage: 'release', status: 'passed', threshold: 85, reasons: [] };
      }, /Release.*85|85.*Release/i],
      ['RC conditional result', (report: Record<string, any>) => {
        report.stage = 'rc';
        report.decision = { stage: 'rc', status: 'conditional', threshold: 80, reasons: [] };
      }, /conditional/i],
      ['passed report with P0', (report: Record<string, any>) => {
        report.findings = [{
          issueId: 'P0', severity: 'P0', primaryMetricId: 'general.core.core-loop',
          linkedMetricIds: [], evidence: ['x'],
        }];
        report.severityCounts.P0 = 1;
      }, /P0|P1/i],
      ['Release below full coverage', (report: Record<string, any>) => {
        report.stage = 'release';
        report.decision = { stage: 'release', status: 'passed', threshold: 85, reasons: [] };
        for (const group of Object.values(report.score.groups) as Array<Record<string, any>>) {
          group.score = group.weight * 0.9;
        }
        report.score.total = 90;
        report.score.formalTotal = 90;
        report.coverage = 0.99;
      }, /coverage/i],
      ['evaluated item without evidence', (report: Record<string, any>) => {
        report.itemResults[0].evidence = [];
      }, /evidence/i],
      ['profile and report identity mismatch', (report: Record<string, any>) => {
        report.reportId = 'other-profile-report';
      }, /identity|reportId/i],
      ['duplicate issue ID', (report: Record<string, any>) => {
        const issue = {
          issueId: 'DUP', severity: 'P2', primaryMetricId: 'general.core.core-loop',
          linkedMetricIds: [], evidence: ['x'],
        };
        report.findings = [issue, issue];
        report.severityCounts.P2 = 2;
      }, /duplicate/i],
      ['missing raw result references', (report: Record<string, any>) => {
        delete report.rawResultReferences;
      }, /raw result references|required/i],
    ])('rejects %s without crashing', (_label, mutate, expected) => {
      const candidate = structuredClone(validReport);
      mutate(candidate);
      const result = validate(candidate);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(expected);
      expect(result.stderr).not.toMatch(/Traceback/);
    });
  });

  it('documents the end-to-end triggers, script chain, and report boundary', () => {
    const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const triggerFixture = readFileSync(
      path.join(repositoryRoot, 'tests', 'fixtures', 'plugins', 'keco-game-evaluation-skill-evals.json'),
      'utf8',
    );
    expect(skill).toContain('Use $keco-evaluate-game to run a Beta EDD evaluation');
    expect(triggerFixture).toContain('对 Keco 项目执行 Beta 阶段 EDD 游戏评价');
    expect(triggerFixture).toContain('对刚完成的战斗玩法切片执行 EDD 快速评价');
    expect(skill).toMatch(/create_evaluation_profile\.py[\s\S]*score_game_evaluation\.py[\s\S]*validate_game_evaluation_report\.py/);
    expect(skill).toMatch(/GameEvaluationReport[\s\S]*Slice[\s\S]*EvalReport/);
    expect(skill).toMatch(/docs\/keco-game-evaluations\/<evaluationId>/);
    expect(skill).toMatch(/KECO_EVAL[\s\S]*manual_required[\s\S]*improvement[\s\S]*retest/i);
    expect(skill).toMatch(/validate_game_evaluation_report\.py[\s\S]*before claiming/i);
  });

  it('routes full EDD scoring away from Slice implementation', () => {
    const v2Skill = readFileSync(
      path.join(
        repositoryRoot,
        'plugins',
        'keco-codex',
        'skills',
        'keco-develop-godot-slice-v2',
        'SKILL.md',
      ),
      'utf8',
    );
    expect(v2Skill).toMatch(/full[\s\S]{0,160}100-point[\s\S]{0,160}keco-evaluate-game/i);
    expect(v2Skill).toMatch(/milestone[\s\S]{0,160}Alpha[\s\S]{0,160}Beta[\s\S]{0,160}Release/i);
  });
});
