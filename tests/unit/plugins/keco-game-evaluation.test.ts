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
});
