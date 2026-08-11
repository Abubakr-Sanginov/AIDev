import spawn from 'cross-spawn';

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}
export interface ProcessActivity {
  type: 'started' | 'stdout' | 'stderr';
  text?: string;
  processId?: number;
}
export type ProcessActivityHandler = (activity: ProcessActivity) => Promise<void> | void;
export type ProcessRunner = (
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number,
  onActivity?: ProcessActivityHandler,
) => Promise<ProcessResult>;
export function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number,
  onActivity?: ProcessActivityHandler,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: process.env });
    void onActivity?.({
      type: 'started',
      ...(child.pid === undefined ? {} : { processId: child.pid }),
    });
    let stdout = '';
    let stderr = '';
    child.stdin?.end();
    const append = (current: string, chunk: Buffer): string =>
      (current + chunk.toString('utf8')).slice(-200_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout = append(stdout, chunk);
      void onActivity?.({ type: 'stdout', text });
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr = append(stderr, chunk);
      void onActivity?.({ type: 'stderr', text });
    });
    let settled = false;
    let timedOut = false;
    const timer =
      timeoutMs === undefined
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
            } else {
              child.kill('SIGKILL');
            }
            if (!settled) {
              settled = true;
              reject(new Error(`Runtime timed out after ${timeoutMs}ms.`));
            }
          }, timeoutMs);
    child.on('error', (error) => {
      if (timer !== undefined) clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on('close', (code) => {
      if (timer !== undefined) clearTimeout(timer);
      if (settled || timedOut) return;
      settled = true;
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
