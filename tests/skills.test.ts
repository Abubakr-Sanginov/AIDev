import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatSkillsForPrompt,
  SKILLS,
  skillsForRole,
  writeSkillsToProject,
} from '../src/skills.js';

describe('skills', () => {
  it('maps bundled skills to their roles only', () => {
    expect(skillsForRole('frontend').map((skill) => skill.id)).toEqual([
      'frontend-design',
      'web-design-guidelines',
    ]);
    expect(skillsForRole('fixer').map((skill) => skill.id)).toEqual(['diagnosing-bugs']);
    expect(skillsForRole('reviewer').map((skill) => skill.id)).toEqual(['code-review']);
    expect(skillsForRole('manager')).toEqual([]);
  });

  it('renders a capped prompt section and nothing for skill-less roles', async () => {
    const block = await formatSkillsForPrompt('reviewer');
    expect(block).toContain('Active skills');
    expect(block).toContain('Code Review');
    await expect(formatSkillsForPrompt('architect')).resolves.toBe('');
  });

  it('publishes all bundled skills into the project state directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-dev-team-skills-'));
    const written = await writeSkillsToProject(root);
    expect(written).toHaveLength(SKILLS.length);
    const content = await readFile(path.join(root, '.ai-dev-team', 'skills', 'tdd.md'), 'utf8');
    expect(content).toContain('Test-Driven Development');
    expect(content).toContain('skills.sh');
  });
});
