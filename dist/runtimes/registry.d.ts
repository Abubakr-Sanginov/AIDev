import type { CodingRuntime } from './runtime.js';
export declare class RuntimeRegistry {
    #private;
    register(runtime: CodingRuntime): void;
    get(id: string): CodingRuntime;
    list(): CodingRuntime[];
}
