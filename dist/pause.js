/** Thrown out of PauseGate.wait() once cancel() was called; never retried. */
export class PauseCancelledError extends Error {
    constructor() {
        super('Interrupted by user.');
        this.name = 'PauseCancelledError';
    }
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
export class PauseGate {
    #requested = false;
    #waiters = 0;
    #frozen = false;
    #cancelled = false;
    #release = [];
    #cancellations = [];
    #listeners = new Set();
    #abortController = new AbortController();
    get phase() {
        if (!this.#requested)
            return 'running';
        return this.#waiters > 0 || this.#frozen ? 'paused' : 'pausing';
    }
    get requested() {
        return this.#requested;
    }
    get cancelled() {
        return this.#cancelled;
    }
    /** Aborted once cancel() is called; passed into provider fetches. */
    get signal() {
        return this.#abortController.signal;
    }
    cancel() {
        if (this.#cancelled)
            return;
        this.#cancelled = true;
        const error = new PauseCancelledError();
        for (const reject of this.#cancellations.splice(0))
            reject(error);
        this.#release.splice(0);
        this.#abortController.abort(error);
    }
    pause() {
        if (this.#requested)
            return;
        this.#requested = true;
        this.#emit();
    }
    resume() {
        if (!this.#requested)
            return;
        this.#requested = false;
        this.#frozen = false;
        for (const release of this.#release.splice(0))
            release();
        this.#emit();
    }
    /** Records that the running agent processes are frozen: the pause is complete. */
    markFrozen(frozen) {
        if (this.#frozen === frozen || !this.#requested)
            return;
        this.#frozen = frozen;
        this.#emit();
    }
    /** Resolves immediately while running; rejects once cancelled. */
    async wait() {
        if (this.#cancelled)
            throw new PauseCancelledError();
        if (!this.#requested)
            return;
        this.#waiters += 1;
        this.#emit();
        try {
            await new Promise((resolve, reject) => {
                this.#release.push(resolve);
                this.#cancellations.push(reject);
            });
        }
        finally {
            this.#waiters -= 1;
        }
    }
    onChange(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    #emit() {
        const phase = this.phase;
        for (const listener of this.#listeners)
            listener(phase);
    }
}
