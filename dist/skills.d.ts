/**
 * Bundled agent skills (https://skills.sh). The Markdown sources live in the
 * top-level skills/ directory, which is published with the npm package, and
 * are resolved relative to this module (dist/skills.js -> ../skills).
 */
export interface SkillMeta {
    id: string;
    name: string;
    source: string;
    roles: string[];
}
export declare const SKILLS: SkillMeta[];
export declare function skillsForRole(roleId: string): SkillMeta[];
/** Renders the role's skills as a prompt section, each capped for size. */
export declare function formatSkillsForPrompt(roleId: string): Promise<string>;
/**
 * Copies every bundled skill into <root>/.ai-dev-team/skills/ so the user and
 * the agents can inspect what the team follows. Best effort, never throws.
 */
export declare function writeSkillsToProject(root: string): Promise<string[]>;
