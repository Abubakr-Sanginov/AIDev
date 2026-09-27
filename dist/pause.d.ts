export type PausePhase = 'running' | 'pausing' | 'paused';
/** Thrown out of PauseGate.wait() once cancel() was called; never retried. */
export declare class PauseCancelledError extends Error {
    constructor();
}
/**
 * Pause switch shared by the CLI, which flips it on a key press, and the
 * workflow, which waits on it before every stage, model request and tool
 * call. A request already in flight finishes first, so the switch reports
 * `pausing` until the workflow actually stops (a waiter blocks here) or the
 * running agent processes are frozen (see runtimes/suspend.ts).
 *
 * cancel() is the hard stop (the chat UI's Esc): waiters reject with
 * PauseCancelledError and the signal aborts in-flight provider requests.
 * Cancellation is sticky — a cancelled gate never resumes.
 */
export declare class PauseGate {
    #private;
    get phase(): PausePhase;
    get requested(): boolean;
    get cancelled(): boolean;
    /** Aborted once cancel() is called; passed into provider fetches. */
    get signal(): AbortSignal;
    cancel(): void;
    pause(): void;
    resume(): void;
    /** Records that the running agent processes are frozen: the pause is complete. */
    markFrozen(frozen: boolean): void;
    /** Resolves immediately while running; rejects once cancelled. */
    wait(): Promise<void>;
    onChange(listener: (phase: PausePhase) => void): () => void;
}
