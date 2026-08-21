export interface ProjectLayers {
    frontend: boolean;
    backend: boolean;
}
export declare function detectProjectLayers(root: string): Promise<ProjectLayers>;
