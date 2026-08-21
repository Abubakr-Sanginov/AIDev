export interface CliConfig {
    runtime?: string;
    model?: string;
    approval?: string;
    theme?: string;
}
declare const CONFIG_KEYS: readonly ['runtime', 'model', 'approval', 'theme'];
export type ConfigKey = (typeof CONFIG_KEYS)[number];
export declare function configPath(root: string): string;
export declare function loadConfig(root: string): Promise<CliConfig>;
export declare function setConfigValue(root: string, key: string, value: string): Promise<CliConfig>;
export declare function resetConfig(root: string): Promise<void>;
export {};
