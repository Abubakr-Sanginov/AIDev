export type ApprovalMode = 'ask' | 'always' | 'never';
export declare function createApprover(mode: ApprovalMode): (command: string) => Promise<boolean>;
