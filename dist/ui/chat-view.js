import { visibleWidth } from './ascii.js';
import { ChatRenderer, parseChatKeys, renderChatHeader, renderRunSummary, renderStatusLine, wordWrap, } from './chat.js';
function truncatePlain(text, width) {
    return text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`;
}
/** Keeps the caret (always at the end) inside the box: shows the input tail. */
function tailPlain(text, width) {
    return text.length <= width ? text : `…${text.slice(text.length - width + 1)}`;
}
/**
 * The interactive terminal surface: Claude Code-style scrollback chat with a
 * transient input box pinned to the bottom. Finished output stays in the
 * scrollback; only the bottom block (status line, input box, footer) is
 * redrawn in place.
 */
export class ChatView {
    #options;
    #theme;
    #renderer;
    #header = { version: '', runtimeName: '', modelLabel: '', root: '' };
    #buffer = '';
    #history = [];
    #historyIndex = -1;
    #busy = false;
    #queued;
    #state;
    #activity;
    #bottomRows = 0;
    #spinnerTimer;
    #stdinAttached = false;
    #exited = false;
    #exitResolve;
    #commandHandler;
    constructor(options) {
        this.#options = options;
        this.#theme = options.theme;
        this.#renderer = new ChatRenderer(options.theme);
    }
    /** Live theme switch (/theme): future frames and blocks use the new colors. */
    setTheme(theme) {
        this.#theme = theme;
        this.#renderer = new ChatRenderer(theme);
        this.#renderBottom();
    }
    setCommandHandler(handler) {
        this.#commandHandler = handler;
    }
    get busy() {
        return this.#busy;
    }
    start(header) {
        this.#header = header;
        process.stdout.write(renderChatHeader(this.#theme, header));
        this.#attachStdin();
        this.#renderBottom();
        this.#spinnerTimer = setInterval(() => {
            if (this.#busy && this.#stdinAttached)
                this.#renderBottom();
        }, 120);
    }
    /** Resolves once the user exits (ctrl+c, /exit). */
    loop() {
        return new Promise((resolve) => {
            if (this.#exited) {
                resolve();
                return;
            }
            this.#exitResolve = resolve;
        });
    }
    exit() {
        this.#exited = true;
        this.#exitResolve?.();
    }
    stop() {
        if (this.#spinnerTimer !== undefined) {
            clearInterval(this.#spinnerTimer);
            this.#spinnerTimer = undefined;
        }
        this.#detachStdin();
        this.#clearBottom();
    }
    /** Prints finished chat content between the scrollback and the input box. */
    printLines(lines) {
        if (lines.length === 0)
            return;
        this.#clearBottom();
        process.stdout.write(`${lines.join('\n')}\n`);
        this.#renderBottom();
    }
    printError(error) {
        const message = error instanceof Error ? error.message : String(error);
        this.printLines([this.#theme.failure(`✖ ${truncatePlain(message, this.#columns() - 2)}`)]);
    }
    /**
     * Called by the orchestrator on every state publication: renders newly
     * arrived events into the scrollback and refreshes the status line.
     */
    onWorkflowState(state) {
        this.#state = state;
        const { lines, activity } = this.#renderer.consume(state, this.#columns());
        if (activity !== undefined)
            this.#activity = activity;
        if (lines.length > 0)
            this.printLines(lines);
        else
            this.#renderBottom();
    }
    /** Frees the terminal for a cooked-mode modal prompt (approval, /model). */
    async suspendFor(action) {
        if (!this.#stdinAttached)
            return action();
        this.#detachStdin();
        this.#clearBottom();
        try {
            return await action();
        }
        finally {
            this.#attachStdin();
            this.#renderBottom();
        }
    }
    clearScreen() {
        this.#clearBottom();
        process.stdout.write(`\x1B[2J\x1B[H${renderChatHeader(this.#theme, this.#header)}`);
        this.#renderBottom();
    }
    #columns() {
        return Math.max(40, process.stdout.columns || 100);
    }
    #onData = (chunk) => {
        for (const event of parseChatKeys(chunk))
            this.#handleKey(event);
    };
    #onResize = () => {
        if (this.#stdinAttached)
            this.#renderBottom();
    };
    #attachStdin() {
        if (!process.stdin.isTTY || this.#stdinAttached)
            return;
        this.#stdinAttached = true;
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', this.#onData);
        process.stdout.on('resize', this.#onResize);
    }
    #detachStdin() {
        if (!this.#stdinAttached)
            return;
        this.#stdinAttached = false;
        process.stdin.off('data', this.#onData);
        process.stdout.off('resize', this.#onResize);
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
            process.stdin.pause();
        }
    }
    #handleKey(event) {
        switch (event.type) {
            case 'ctrl-c':
                if (this.#buffer !== '') {
                    this.#buffer = '';
                    this.#renderBottom();
                    return;
                }
                if (this.#busy)
                    this.#options.onInterrupt();
                this.exit();
                return;
            case 'ctrl-p':
                if (this.#busy)
                    this.#options.onPauseToggle();
                return;
            case 'ctrl-u':
                this.#buffer = '';
                this.#renderBottom();
                return;
            case 'escape':
                if (this.#busy) {
                    this.#options.onInterrupt();
                    return;
                }
                if (this.#buffer !== '') {
                    this.#buffer = '';
                    this.#renderBottom();
                }
                return;
            case 'up':
                this.#historyNav(1);
                return;
            case 'down':
                this.#historyNav(-1);
                return;
            case 'backspace':
                this.#buffer = this.#buffer.slice(0, -1);
                this.#renderBottom();
                return;
            case 'char':
                this.#buffer += event.text;
                this.#renderBottom();
                return;
            case 'enter':
                void this.#submit();
                return;
        }
    }
    #historyNav(direction) {
        if (this.#history.length === 0)
            return;
        if (this.#historyIndex === -1) {
            if (direction !== 1)
                return;
            this.#historyIndex = this.#history.length - 1;
        }
        else {
            this.#historyIndex = Math.min(this.#history.length - 1, Math.max(0, this.#historyIndex + direction));
        }
        this.#buffer = this.#history[this.#historyIndex] ?? '';
        this.#renderBottom();
    }
    async #submit() {
        const text = this.#buffer.trim();
        if (text === '') {
            this.#renderBottom();
            return;
        }
        if (this.#busy) {
            // Claude Code-style queueing: the next task starts when the team finishes.
            this.#buffer = '';
            this.#queued = text;
            this.#renderBottom();
            return;
        }
        if (text.startsWith('/')) {
            this.#buffer = '';
            this.printLines([`${this.#theme.muted('❯')} ${text}`]);
            try {
                await this.#commandHandler?.(text);
            }
            catch (error) {
                this.printError(error);
            }
            return;
        }
        await this.#runTask(text);
    }
    async #runTask(text) {
        this.#history.push(text);
        this.#historyIndex = -1;
        this.#buffer = '';
        this.#busy = true;
        this.#activity = undefined;
        this.printLines([
            `${this.#theme.secondary('❯')} ${wordWrap(text, this.#columns() - 4).join('\n   ')}`,
        ]);
        this.#renderBottom();
        let finalState;
        try {
            finalState = await this.#options.onSubmit(text);
        }
        catch (error) {
            this.printError(error);
        }
        // Flip busy first: the summary must be followed by an idle input box, not
        // by one last busy status frame.
        this.#busy = false;
        if (finalState !== undefined) {
            // Flush any events published after the last onState call, then the verdict.
            const { lines } = this.#renderer.consume(finalState, this.#columns());
            const summary = [renderRunSummary(this.#theme, finalState, Date.now()), ''];
            this.printLines([...lines, ...summary]);
        }
        this.#renderBottom();
        const queued = this.#queued;
        this.#queued = undefined;
        if (queued !== undefined && !this.#exited)
            await this.#runTask(queued);
    }
    #clearBottom() {
        if (this.#bottomRows > 0)
            process.stdout.write(`\x1B[${this.#bottomRows}A\r\x1B[J`);
        this.#bottomRows = 0;
    }
    #renderBottom() {
        if (!this.#stdinAttached)
            return;
        const theme = this.#theme;
        const columns = this.#columns();
        const lines = [];
        if (this.#busy && this.#state !== undefined)
            lines.push(renderStatusLine(theme, {
                state: this.#state,
                now: Date.now(),
                activity: this.#activity,
                queued: this.#queued,
            }));
        const boxWidth = Math.min(Math.max(30, columns - 4), 96);
        // Row budget: │ + space + > + space + content + space + │ = 6 + inner.
        const inner = boxWidth - 6;
        const border = theme.muted('─'.repeat(boxWidth - 2));
        lines.push(theme.muted(`╭${border}╮`));
        const placeholder = this.#busy
            ? 'Add the next task — Enter queues it…'
            : 'Describe the task for the team… (/help for commands)';
        const content = this.#buffer === ''
            ? theme.muted(truncatePlain(placeholder, inner))
            : theme.secondary(tailPlain(this.#buffer, inner));
        // ANSI-aware padding: the content must fill the row to the right border.
        const padded = content + ' '.repeat(Math.max(0, inner - visibleWidth(content)));
        lines.push(`${theme.muted('│')} ${theme.secondary('>')} ${padded} ${theme.muted('│')}`);
        lines.push(theme.muted(`╰${border}╯`));
        lines.push(this.#footer());
        this.#writeBottom(lines);
    }
    #footer() {
        const theme = this.#theme;
        const star = theme.accent('✳');
        const items = this.#busy
            ? ['esc interrupt', 'ctrl+p pause', 'ctrl+c exit']
            : [`${this.#options.approvalMode} approval`, '/help for commands', 'ctrl+c exit'];
        return `${star} ${theme.muted(items.join(' · '))}`;
    }
    #writeBottom(lines) {
        this.#clearBottom();
        process.stdout.write(lines.join('\n'));
        this.#bottomRows = lines.length;
    }
}
