import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
/**
 * A timeout that stops counting while the workflow is paused, so a frozen
 * agent is not killed for "running too long" the moment it is thawed.
 */
export class PausableTimer {
    #remaining;
    #startedAt = 0;
    #handle;
    #done = false;
    #callback;
    constructor(milliseconds, callback) {
        this.#remaining = Math.max(0, milliseconds);
        this.#callback = callback;
        // trackProcess() pauses it when the timer starts mid-freeze.
        this.#arm();
    }
    pause() {
        if (this.#done || this.#handle === undefined)
            return;
        clearTimeout(this.#handle);
        this.#handle = undefined;
        this.#remaining = Math.max(0, this.#remaining - (Date.now() - this.#startedAt));
    }
    resume() {
        if (this.#done || this.#handle !== undefined)
            return;
        this.#arm();
    }
    clear() {
        this.#done = true;
        if (this.#handle !== undefined)
            clearTimeout(this.#handle);
        this.#handle = undefined;
    }
    #arm() {
        this.#startedAt = Date.now();
        this.#handle = setTimeout(() => {
            this.#done = true;
            this.#handle = undefined;
            this.#callback();
        }, this.#remaining);
    }
}
const tracked = new Set();
let frozen = false;
// Freeze and thaw each take a second or two on Windows; a quick double press
// must not interleave them.
let queue = Promise.resolve();
function serialize(operation) {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
}
/**
 * Registers an agent/command process so a pause can freeze it (and its
 * timeout). Returns the function that unregisters it once it exits.
 */
export function trackProcess(child, timer) {
    if (child.pid === undefined)
        return () => undefined;
    const entry = { pid: child.pid, timer };
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
export function processesFrozen() {
    return frozen;
}
/** Freezes every tracked process tree; resolves to how many roots were frozen. */
export function freezeProcesses() {
    return serialize(async () => {
        if (frozen)
            return tracked.size;
        frozen = true;
        for (const entry of tracked)
            entry.timer?.pause();
        const pids = [...tracked].map((entry) => entry.pid);
        if (pids.length === 0)
            return 0;
        await setTreeState(pids, 'suspend');
        return pids.length;
    });
}
/** Thaws every tracked process tree and restarts their timeouts. */
export function thawProcesses() {
    return serialize(async () => {
        if (!frozen)
            return;
        const pids = [...tracked].map((entry) => entry.pid);
        try {
            if (pids.length > 0)
                await setTreeState(pids, 'resume');
        }
        finally {
            frozen = false;
            for (const entry of tracked)
                entry.timer?.resume();
        }
    });
}
/**
 * Exit hook: a frozen process tree outlives its parent forever, so if the
 * CLI quits mid-pause, kill what it froze. Synchronous by necessity.
 */
export function killFrozenProcessesSync() {
    if (!frozen)
        return;
    for (const { pid } of tracked) {
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
                windowsHide: true,
                stdio: 'ignore',
            });
        }
        else {
            try {
                process.kill(pid, 'SIGKILL');
            }
            catch {
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
export function killRunningProcesses() {
    const pids = [...tracked].map((entry) => entry.pid);
    for (const { pid, timer } of tracked) {
        timer?.clear();
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
                windowsHide: true,
                stdio: 'ignore',
            });
        }
        else {
            try {
                process.kill(pid, 'SIGKILL');
            }
            catch {
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
function windowsScript(pids, action) {
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
async function posixDescendants(roots) {
    const { stdout } = await execFileAsync('ps', ['-A', '-o', 'pid=', '-o', 'ppid=']);
    const children = new Map();
    for (const line of stdout.split('\n')) {
        const [pid, ppid] = line.trim().split(/\s+/).map(Number);
        if (pid === undefined || ppid === undefined || Number.isNaN(pid) || Number.isNaN(ppid))
            continue;
        children.set(ppid, [...(children.get(ppid) ?? []), pid]);
    }
    const seen = new Set();
    const pending = [...roots];
    while (pending.length > 0) {
        const pid = pending.pop();
        if (pid === undefined || seen.has(pid))
            continue;
        seen.add(pid);
        pending.push(...(children.get(pid) ?? []));
    }
    return [...seen];
}
async function setTreeState(pids, action) {
    if (process.platform === 'win32') {
        await execFileAsync('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            windowsScript(pids, action),
        ], { windowsHide: true, timeout: 60_000 });
        return;
    }
    const signal = action === 'suspend' ? 'SIGSTOP' : 'SIGCONT';
    for (const pid of await posixDescendants(pids)) {
        try {
            process.kill(pid, signal);
        }
        catch {
            // Exited meanwhile.
        }
    }
}
