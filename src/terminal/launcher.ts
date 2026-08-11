import { spawn } from 'node:child_process';
import type { TerminalLauncher, TerminalOptions, TerminalProcess } from './terminal.js';

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildWindowsTerminalArgs(options: TerminalOptions): string[] {
  const title = options.title ?? 'AI Development Team Runtime';
  const terminalScript = [
    `$Host.UI.RawUI.WindowTitle = ${powershellLiteral(title)}`,
    `& ${[options.command, ...options.args].map(powershellLiteral).join(' ')}`,
    '$exitCode = $LASTEXITCODE',
    'if ($exitCode -ne 0) { Write-Warning "Runtime follower exited with code $exitCode." }',
    'exit $exitCode',
  ].join('; ');
  const terminalEncoded = Buffer.from(terminalScript, 'utf16le').toString('base64');
  const startScript = [
    `$arguments = @('-NoLogo', '-NoProfile', '-EncodedCommand', ${powershellLiteral(terminalEncoded)})`,
    `if ($null -ne (Get-Command 'wt.exe' -ErrorAction SilentlyContinue)) {`,
    `  $terminalArguments = @('-w', 'new', 'nt', '--title', ${powershellLiteral(title)}, '-d', ${powershellLiteral(options.cwd)}, 'powershell.exe') + $arguments`,
    `  $process = Start-Process -FilePath 'wt.exe' -WorkingDirectory ${powershellLiteral(options.cwd)} -ArgumentList $terminalArguments -PassThru`,
    '} else {',
    `  $process = Start-Process -FilePath 'powershell.exe' -WorkingDirectory ${powershellLiteral(options.cwd)} -ArgumentList $arguments -WindowStyle Normal -PassThru`,
    '}',
    'if ($null -eq $process) { throw "Start-Process did not return a process." }',
    '$process.Id',
  ].join('; ');
  return [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(startScript, 'utf16le').toString('base64'),
  ];
}

function openWindowsTerminal(options: TerminalOptions): Promise<TerminalProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', buildWindowsTerminalArgs(options), {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `PowerShell Start-Process failed with code ${code ?? -1}: ${stderr.trim() || stdout.trim() || 'no diagnostic output'}`,
          ),
        );
        return;
      }
      const processId = Number.parseInt(stdout.trim().split(/\s+/u).at(-1) ?? '', 10);
      resolve({
        ...(Number.isFinite(processId) ? { processId } : {}),
        command: options.command,
      });
    });
  });
}

export class SystemTerminalLauncher implements TerminalLauncher {
  async open(options: TerminalOptions): Promise<TerminalProcess> {
    if (process.platform === 'win32') return openWindowsTerminal(options);
    const command = process.platform === 'darwin' ? 'open' : 'x-terminal-emulator';
    const args =
      process.platform === 'darwin'
        ? ['-a', 'Terminal', options.cwd]
        : ['--working-directory', options.cwd, '-e', options.command, ...options.args];
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return {
      ...(child.pid === undefined ? {} : { processId: child.pid }),
      command: options.command,
    };
  }
}
