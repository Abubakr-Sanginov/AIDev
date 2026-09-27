import { execFile, spawnSync, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * A timeout that stops counting while the workflow is paused, so a frozen
 * agent is not killed for "running too long" the moment it is thawed.
 */
export class PausableTimer {
  #remaining: number;
  #startedAt = 0;
  #handle: NodeJS.Timeout | undefined;
  #done = false;
  readonly #callback: () => void;

  constructor(milliseconds: number, callback: () => void) {
    this.#remaining = Math.max(0, milliseconds);
    this.#callback = callback;
    // trackProcess() pauses it when the timer starts mid-freeze.
    this.#arm();
  }

  pause(): void {
    if (this.#done || this.#handle === undefined) return;
    clearTimeout(this.#handle);
    this.#handle = undefined;
    this.#remaining = Math.max(0, this.#remaining - (Date.now() - this.#startedAt));
  }

  resume(): void {
    if (this.#done || this.#handle !== undefined) return;
    this.#arm();
  }

  clear(): void {
    this.#done = true;
    if (this.#handle !== undefined) clearTimeout(this.#handle);
    this.#handle = undefined;
  }

  #arm(): void {
    this.#startedAt = Date.now();
    this.#handle = setTimeout(() => {
      this.#done = true;
      this.#handle = undefined;
      this.#callback();
    }, this.#remaining);
  }
}

interface TrackedProcess {
  pid: number;
  timer: PausableTimer | undefined;
}

const tracked = new Set<TrackedProcess>();
let frozen = false;
// Freeze and thaw each take a second or two on Windows; a quick double press
// must not interleave them.
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation, operation);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Registers an agent/command process so a pause can freeze it (and its
 * timeout). Returns the function that unregisters it once it exits.
 */
export function trackProcess(child: ChildProcess, timer?: PausableTimer): () => void {
  if (child.pid === undefined) return () => undefined;
  const entry: TrackedProcess = { pid: child.pid, timer };
  tracked.add(entry);
  if (frozen) {
    // Started in the gap while a freeze was being applied: freeze it too.
    timer?.pause();
    void setTreeState([entry.pid], 'suspend').catch(() => undefined);
  }
  return () => {
    tracked.delete(entry);
  };
}

export function processesFrozen(): boolean {
  return frozen;
}

/** Freezes every tracked process tree; resolves to how many roots were frozen. */
export function freezeProcesses(): Promise<number> {
  return serialize(async () => {
    if (frozen) return tracked.size;
    frozen = true;
    for (const entry of tracked) entry.timer?.pause();
    const pids = [...tracked].map((entry) => entry.pid);
    if (pids.length === 0) return 0;
    await setTreeState(pids, 'suspend');
    return pids.length;
  });
}

/** Thaws every tracked process tree and restarts their timeouts. */
export function thawProcesses(): Promise<void> {
  return serialize(async () => {
    if (!frozen) return;
    const pids = [...tracked].map((entry) => entry.pid);
    try {
      if (pids.length > 0) await setTreeState(pids, 'resume');
    } finally {
      frozen = false;
      for (const entry of tracked) entry.timer?.resume();
    }
  });
}

/**
 * Exit hook: a frozen process tree outlives its parent forever, so if the
 * CLI quits mid-pause, kill what it froze. Synchronous by necessity.
 */
export function killFrozenProcessesSync(): void {
  if (!frozen) return;
  for (const { pid } of tracked) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }
}

/**
 * Hard interrupt (the chat UI's Esc): kills every tracked process tree —
 * running or frozen — so agent CLI processes and spawned shell commands stop
 * immediately. Their timers are cleared so no timeout callback fires on a
 * dead pid afterwards. Returns how many process trees were killed.
 */
export function killRunningProcesses(): number {
  const pids = [...tracked].map((entry) => entry.pid);
  for (const { pid, timer } of tracked) {
    timer?.clear();
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }
  tracked.clear();
  return pids.length;
}

// NtSuspendProcess/NtResumeProcess freeze every thread of a process: the same
// call Resource Monitor's "Suspend process" makes. Descendants are collected
// by parent id, and a child must be younger than its parent so a reused pid
// of an unrelated older process is never touched.
function windowsScript(pids: readonly number[], action: 'suspend' | 'resume'): string {
  const call = action === 'suspend' ? 'NtSuspendProcess' : 'NtResumeProcess';
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Namespace AiDevTeam -Name Nt -MemberDefinition '[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h); [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);'
$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate)
$born = @{}
foreach ($p in $all) { $born[[int]$p.ProcessId] = $p.CreationDate }
$seen = New-Object 'System.Collections.Generic.HashSet[int]'
$queue = New-Object 'System.Collections.Generic.Queue[int]'
foreach ($root in @(${pids.join(',')})) { $queue.Enqueue($root) }
while ($queue.Count -gt 0) {
  $id = $queue.Dequeue()
  if (-not $seen.Add($id)) { continue }
  foreach ($p in $all) {
    if ([int]$p.ParentProcessId -eq $id -and $p.CreationDate -ge $born[$id]) { $queue.Enqueue([int]$p.ProcessId) }
  }
}
foreach ($id in $seen) {
  $proc = Get-Process -Id $id
  if ($proc) { [void][AiDevTeam.Nt]::${call}($proc.Handle) }
}
`;
}

async function posixDescendants(roots: readonly number[]): Promise<number[]> {
  const { stdout } = await execFileAsync('ps', ['-A', '-o', 'pid=', '-o', 'ppid=']);
  const children = new Map<number, number[]>();
  for (const line of stdout.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || ppid === undefined || Number.isNaN(pid) || Number.isNaN(ppid))
      continue;
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const seen = new Set<number>();
  const pending = [...roots];
  while (pending.length > 0) {
    const pid = pending.pop();
    if (pid === undefined || seen.has(pid)) continue;
    seen.add(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  return [...seen];
}

async function setTreeState(pids: readonly number[], action: 'suspend' | 'resume'): Promise<void> {
  if (process.platform === 'win32') {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        windowsScript(pids, action),
      ],
      { windowsHide: true, timeout: 60_000 },
    );
    return;
  }
  const signal = action === 'suspend' ? 'SIGSTOP' : 'SIGCONT';
  for (const pid of await posixDescendants(pids)) {
    try {
      process.kill(pid, signal);
    } catch {
      // Exited meanwhile.
    }
  }
}
