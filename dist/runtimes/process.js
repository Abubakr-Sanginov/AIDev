import { TextDecoder } from 'node:util';
import spawn from 'cross-spawn';
const REPLACEMENT_CHAR = '\uFFFD';
/**
 * Child CLIs normally write UTF-8, but Windows console programs emit localized
 * text in the OEM code page (CP866 on Russian systems). Decoding those bytes as
 * UTF-8 mangles them into U+FFFD/CJK garbage, so fall back to CP866 when UTF-8
 * clearly does not fit.
 */
export function decodeConsoleText(data) {
    const text = data.toString('utf8');
    return text.includes(REPLACEMENT_CHAR) ? new TextDecoder('ibm866').decode(data) : text;
}
function decodeHasReplacement(data) {
    return data.toString('utf8').includes(REPLACEMENT_CHAR);
}
/** True when bytes are the truncated start of a multibyte UTF-8 sequence. */
function isUtf8Prefix(bytes) {
    const first = bytes.at(0);
    if (first === undefined)
        return false;
    const expected = first >= 0xf0 ? 4 : first >= 0xe0 ? 3 : first >= 0xc0 ? 2 : 0;
    return expected > bytes.length && [...bytes.subarray(1)].every((b) => b >= 0x80 && b < 0xc0);
}
/**
 * Incremental console decoder: multibyte characters (e.g. Cyrillic) split
 * across pipe chunks are carried into the next chunk instead of being mangled.
 */
function createConsoleDecoder() {
    let carry = Buffer.alloc(0);
    return {
        write(chunk) {
            const data = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
            carry = Buffer.alloc(0);
            if (!decodeHasReplacement(data))
                return data.toString('utf8');
            // Otherwise-valid UTF-8 ending in a truncated sequence: hold the
            // incomplete tail bytes and prepend them to the next chunk.
            for (let tail = 1; tail <= 3 && tail < data.length; tail += 1) {
                const head = data.subarray(0, data.length - tail);
                const rest = data.subarray(data.length - tail);
                if (isUtf8Prefix(rest) && !decodeHasReplacement(head)) {
                    carry = Buffer.from(rest);
                    return decodeConsoleText(head);
                }
            }
            return decodeConsoleText(data);
        },
        end() {
            const rest = carry;
            carry = Buffer.alloc(0);
            return rest.length > 0 ? decodeConsoleText(rest) : '';
        },
    };
}
export function runProcess(command, args, cwd, timeoutMs, onActivity, stdinText) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: process.env });
        void onActivity?.({
            type: 'started',
            ...(child.pid === undefined ? {} : { processId: child.pid }),
        });
        let stdout = '';
        let stderr = '';
        // Prompt-sized payloads travel through stdin, not argv: Windows cmd.exe
        // shims reject command lines longer than 8191 characters, and orchestrated
        // prompts with skills and artifacts routinely exceed that limit.
        if (stdinText === undefined)
            child.stdin?.end();
        else
            child.stdin?.end(stdinText, 'utf8');
        const stdoutDecoder = createConsoleDecoder();
        const stderrDecoder = createConsoleDecoder();
        const append = (current, text) => (current + text).slice(-200_000);
        child.stdout?.on('data', (chunk) => {
            const text = stdoutDecoder.write(chunk);
            if (text === '')
                return;
            stdout = append(stdout, text);
            void onActivity?.({ type: 'stdout', text });
        });
        child.stderr?.on('data', (chunk) => {
            const text = stderrDecoder.write(chunk);
            if (text === '')
                return;
            stderr = append(stderr, text);
            void onActivity?.({ type: 'stderr', text });
        });
        let settled = false;
        let timedOut = false;
        const timer = timeoutMs === undefined
            ? undefined
            : setTimeout(() => {
                timedOut = true;
                child.stdout?.removeAllListeners('data');
                child.stderr?.removeAllListeners('data');
                if (process.platform === 'win32' && child.pid !== undefined) {
                    spawn.sync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
                        shell: false,
                        windowsHide: true,
                    });
                }
                else {
                    child.kill('SIGKILL');
                }
                if (!settled) {
                    settled = true;
                    reject(new Error(`Runtime timed out after ${timeoutMs}ms.`));
                }
            }, timeoutMs);
        child.on('error', (error) => {
            if (timer !== undefined)
                clearTimeout(timer);
            if (settled)
                return;
            settled = true;
            reject(error);
        });
        child.on('close', (code) => {
            if (timer !== undefined)
                clearTimeout(timer);
            if (settled || timedOut)
                return;
            settled = true;
            stdout = append(stdout, stdoutDecoder.end());
            stderr = append(stderr, stderrDecoder.end());
            resolve({ code: code ?? -1, stdout, stderr });
        });
    });
}
