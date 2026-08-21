export interface AgentRole {
    id: string;
    name: string;
    description: string;
    systemPrompt: string;
    canModifyFiles: boolean;
    dependsOn: string[];
    budget: {
        maxSteps: number;
        maxToolCalls: number;
    };
}
export declare const roles: AgentRole[];
export declare function getRole(id: string): AgentRole;
export declare function isReadOnlyRole(id: string): boolean;
