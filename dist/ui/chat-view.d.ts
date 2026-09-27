import type { RuntimeWorkflowState } from '../runtimes/runtime-orchestrator.js';
import { type Theme } from './ascii.js';
import { type ChatHeaderInfo } from './chat.js';
export interface ChatViewOptions {
    theme: Theme;
    /** Approval mode shown in the footer, e.g. `ask`. */
    approvalMode: string;
    /**
     * Runs one task through the orchestrator. Resolves with the final state so
     * the view can print the run summary; throwing prints a failure line.
     */
    onSubmit(task: string): Promise<RuntimeWorkflowState | undefined>;
    /** Hard interrupt (Esc / ctrl+c while running): kill agents, abort the run. */
    onInterrupt(): void;
    /** Pause switch (ctrl+p while running). */
    onPauseToggle(): void;
}
/**
 * The interactive terminal surface: Claude Code-style scrollback chat with a
 * transient input box pinned to the bottom. Finished output stays in the
 * scrollback; only the bottom block (status line, input box, footer) is
 * redrawn in place.
 */
export declare class ChatView {
    #private;
    constructor(options: ChatViewOptions);
    /** Live theme switch (/theme): future frames and blocks use the new colors. */
    setTheme(theme: Theme): void;
    setCommandHandler(handler: (command: string) => Promise<void> | void): void;
    get busy(): boolean;
    start(header: ChatHeaderInfo): void;
    /** Resolves once the user exits (ctrl+c, /exit). */
    loop(): Promise<void>;
    exit(): void;
    stop(): void;
    /** Prints finished chat content between the scrollback and the input box. */
    printLines(lines: string[]): void;
    printError(error: unknown): void;
    /**
     * Called by the orchestrator on every state publication: renders newly
     * arrived events into the scrollback and refreshes the status line.
     */
    onWorkflowState(state: RuntimeWorkflowState): void;
    /** Frees the terminal for a cooked-mode modal prompt (approval, /model). */
    suspendFor<T>(action: () => Promise<T>): Promise<T>;
    clearScreen(): void;
}
