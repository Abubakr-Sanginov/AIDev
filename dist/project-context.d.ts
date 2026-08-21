export declare const PROJECT_CONTEXT_VERSION: 1;
export interface ProjectContext {
    version: typeof PROJECT_CONTEXT_VERSION;
    targetRoot: string;
    existingProject: boolean;
    truncated: boolean;
    inspectedEntries: number;
    manifests: string[];
    scripts: string[];
    packageManager?: string;
    lockfiles: string[];
    languages: string[];
    buildConfigs: string[];
    testConfigs: string[];
    lintConfigs: string[];
    formatConfigs: string[];
    instructionDocs: string[];
    topLevelTree: string[];
    representativeSourcePaths: string[];
    representativeTestPaths: string[];
    layers: {
        frontend: boolean;
        backend: boolean;
    };
}
export interface InspectProjectOptions {
    maxEntries?: number;
    maxDepth?: number;
    maxPathsPerCategory?: number;
    maxManifestBytes?: number;
}
export declare function validateProjectRoot(root: string): Promise<string>;
export declare function inspectProject(root: string, options?: InspectProjectOptions): Promise<ProjectContext>;
export declare function formatProjectContext(context: ProjectContext, maxCharacters?: number): string;
