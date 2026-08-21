import { mkdir, rename, rm } from 'node:fs/promises';
interface WritableHandle {
    writeFile(data: string, options: {
        encoding: 'utf8';
    }): Promise<void>;
    sync(): Promise<void>;
    close(): Promise<void>;
}
export interface DurableFileSystem {
    mkdir: typeof mkdir;
    open: (file: string, flags: string) => Promise<WritableHandle>;
    rename: typeof rename;
    rm: typeof rm;
}
export interface DurableWriteOptions {
    fs?: Partial<DurableFileSystem>;
    retryDelays?: readonly number[];
    sleep?: (milliseconds: number) => Promise<void>;
}
export declare function durableWriteFile(target: string, content: string, options?: DurableWriteOptions): Promise<void>;
export {};
