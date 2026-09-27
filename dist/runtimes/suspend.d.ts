import { type ChildProcess } from 'node:child_process';
/**
 * A timeout that stops counting while the workflow is paused, so a frozen
 * agent is not killed for "running too long" the moment it is thawed.
 */
export declare class PausableTimer {
    #private;
    constructor(milliseconds: number, callback: () => void);
    pause(): void;
    resume(): void;
    clear(): void;
}
/**
 * Registers an agent/command process so a pause can freeze it (and its
 * timeout). Returns the function that unregisters it once it exits.
 */
export declare function trackProcess(child: ChildProcess, timer?: PausableTimer): () => void;
export declare function processesFrozen(): boolean;
/** Freezes every tracked process tree; resolves to how many roots were frozen. */
export declare function freezeProcesses(): Promise<number>;
/** Thaws every tracked process tree and restarts their timeouts. */
export declare function thawProcesses(): Promise<void>;
/**
 * Exit hook: a frozen process tree outlives its parent forever, so if the
 * CLI quits mid-pause, kill what it froze. Synchronous by necessity.
 */
export declare function killFrozenProcessesSync(): void;
/**
 * Hard interrupt (the chat UI's Esc): kills every tracked process tree —
 * running or frozen — so agent CLI processes and spawned shell commands stop
 * immediately. Their timers are cleared so no timeout callback fires on a
 * dead pid afterwards. Returns how many process trees were killed.
 */
export declare function killRunningProcesses(): number;
