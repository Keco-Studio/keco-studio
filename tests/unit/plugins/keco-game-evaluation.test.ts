import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const skillRoot = path.join(
  repositoryRoot,
  'plugins',
  'keco-codex',
  'skills',
  'keco-evaluate-game',
);

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
});
