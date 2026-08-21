export interface RunRecord {
    goal: string;
    runtimeId: string;
    model?: string;
    status: string;
    attempts: number;
    startedAt?: string;
    finishedAt: string;
    durationMs?: number;
}
export declare function historyPath(root: string): string;
export declare function appendRunRecord(root: string, record: RunRecord): Promise<void>;
export declare function listRunRecords(root: string, limit?: number): Promise<RunRecord[]>;
