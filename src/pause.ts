export type PausePhase = 'running' | 'pausing' | 'paused';

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
  readonly #release: Array<() => void> = [];
  readonly #cancellations: Array<(error: PauseCancelledError) => void> = [];
  readonly #listeners = new Set<(phase: PausePhase) => void>();
  readonly #abortController = new AbortController();

  get phase(): PausePhase {
    if (!this.#requested) return 'running';
    return this.#waiters > 0 || this.#frozen ? 'paused' : 'pausing';
  }

  get requested(): boolean {
    return this.#requested;
  }

  get cancelled(): boolean {
    return this.#cancelled;
  }

  /** Aborted once cancel() is called; passed into provider fetches. */
  get signal(): AbortSignal {
    return this.#abortController.signal;
  }

  cancel(): void {
    if (this.#cancelled) return;
    this.#cancelled = true;
    const error = new PauseCancelledError();
    for (const reject of this.#cancellations.splice(0)) reject(error);
    this.#release.splice(0);
    this.#abortController.abort(error);
  }

  pause(): void {
    if (this.#requested) return;
    this.#requested = true;
    this.#emit();
  }

  resume(): void {
    if (!this.#requested) return;
    this.#requested = false;
    this.#frozen = false;
    for (const release of this.#release.splice(0)) release();
    this.#emit();
  }

  /** Records that the running agent processes are frozen: the pause is complete. */
  markFrozen(frozen: boolean): void {
    if (this.#frozen === frozen || !this.#requested) return;
    this.#frozen = frozen;
    this.#emit();
  }

  /** Resolves immediately while running; rejects once cancelled. */
  async wait(): Promise<void> {
    if (this.#cancelled) throw new PauseCancelledError();
    if (!this.#requested) return;
    this.#waiters += 1;
    this.#emit();
    try {
      await new Promise<void>((resolve, reject) => {
        this.#release.push(resolve);
        this.#cancellations.push(reject);
      });
    } finally {
      this.#waiters -= 1;
    }
  }

  onChange(listener: (phase: PausePhase) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    const phase = this.phase;
    for (const listener of this.#listeners) listener(phase);
  }
}
