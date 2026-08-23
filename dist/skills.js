import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const SKILLS = [
    { id: 'frontend-design', name: 'Frontend Design', source: 'anthropics/skills', roles: ['frontend'] },
    {
        id: 'web-design-guidelines',
        name: 'Web Interface Guidelines',
        source: 'vercel-labs/agent-skills',
        roles: ['frontend'],
    },
    { id: 'implement', name: 'Implement', source: 'mattpocock/skills', roles: ['backend', 'coder'] },
    {
        id: 'tdd',
        name: 'Test-Driven Development',
        source: 'mattpocock/skills',
        roles: ['backend', 'coder', 'tester'],
    },
    {
        id: 'webapp-testing',
        name: 'Web Application Testing',
        source: 'anthropics/skills',
        roles: ['tester'],
    },
    { id: 'diagnosing-bugs', name: 'Diagnosing Bugs', source: 'mattpocock/skills', roles: ['fixer'] },
    {
        id: 'code-review',
        name: 'Code Review (two-axis)',
        source: 'mattpocock/skills (adapted)',
        roles: ['reviewer'],
    },
];
const PROMPT_SKILL_CAP = 4_000;
const bundledSkillsDir = () => path.join(fileURLToPath(new URL('.', import.meta.url)), '..', 'skills');
export function skillsForRole(roleId) {
    return SKILLS.filter((skill) => skill.roles.includes(roleId));
}
async function readBundledSkill(id) {
    try {
        return await readFile(path.join(bundledSkillsDir(), `${id}.md`), 'utf8');
    }
    catch {
        return undefined;
    }
}
/** Renders the role's skills as a prompt section, each capped for size. */
export async function formatSkillsForPrompt(roleId) {
    const skills = skillsForRole(roleId);
    if (skills.length === 0)
        return '';
    const sections = [];
    for (const skill of skills) {
        const content = await readBundledSkill(skill.id);
        if (content === undefined)
            continue;
        const trimmed = content.trim();
        const body = trimmed.length <= PROMPT_SKILL_CAP
            ? trimmed
            : `${trimmed.slice(0, PROMPT_SKILL_CAP)}\n…(truncated — full text: .ai-dev-team/skills/${skill.id}.md)`;
        sections.push(`### ${skill.name}\n\n${body}`);
    }
    if (sections.length === 0)
        return '';
    return `## Active skills — follow them strictly\n\n${sections.join('\n\n')}\n\n`;
}
/**
 * Copies every bundled skill into <root>/.ai-dev-team/skills/ so the user and
 * the agents can inspect what the team follows. Best effort, never throws.
 */
export async function writeSkillsToProject(root) {
    const targetDir = path.join(root, '.ai-dev-team', 'skills');
    const written = [];
    try {
        await mkdir(targetDir, { recursive: true });
    }
    catch {
        return written;
    }
    for (const skill of SKILLS) {
        const content = await readBundledSkill(skill.id);
        if (content === undefined)
            continue;
        try {
            await writeFile(path.join(targetDir, `${skill.id}.md`), `# ${skill.name}\n\n> Source: ${skill.source} via https://www.skills.sh\n\n${content.trim()}\n`, 'utf8');
            written.push(skill.id);
        }
        catch {
            // Best-effort copy; prompt injection is the primary channel.
        }
    }
    return written;
}
