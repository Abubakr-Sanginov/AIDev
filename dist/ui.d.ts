import type { ProjectState } from './types.js';
export interface UI {
    render(state: ProjectState, activity: string[]): void;
    log(line: string): void;
}
export declare class LiveUI implements UI {
    #private;
    constructor(options?: {
        color?: boolean;
        interactive?: boolean;
    });
    render(state: ProjectState, activity: string[]): void;
    log(line: string): void;
}
