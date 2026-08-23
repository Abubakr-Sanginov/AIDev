import { StringDecoder } from 'node:string_decoder';
import spawn from 'cross-spawn';
export function runProcess(command, args, cwd, timeoutMs, onActivity) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: process.env });
        void onActivity?.({
            type: 'started',
            ...(child.pid === undefined ? {} : { processId: child.pid }),
        });
        let stdout = '';
        let stderr = '';
        child.stdin?.end();
        // Decode with StringDecoder so multibyte characters (e.g. Cyrillic) split
        // across pipe chunks are not mangled into U+FFFD replacement characters.
        const stdoutDecoder = new StringDecoder('utf8');
        const stderrDecoder = new StringDecoder('utf8');
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
