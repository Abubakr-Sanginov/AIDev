import type { TerminalOptions } from './terminal.js';

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function runtimeTerminalTitle(runtimeName: string, roleId: string): string {
  const roleName = roleId.length === 0 ? roleId : roleId.charAt(0).toUpperCase() + roleId.slice(1);
  return `AI Development Team - ${runtimeName} - ${roleName}`;
}

export function buildLogFollowerOptions(
  cwd: string,
  outputFile: string,
  runtimeName: string,
  roleId: string,
): TerminalOptions {
  const file = powershellLiteral(outputFile);
  const script = [
    `$path = ${file}`,
    '$position = 0',
    '$complete = $false',
    'Write-Host "Waiting for controlled runtime output..."',
    'while (-not $complete) {',
    '  if (Test-Path -LiteralPath $path) {',
    "    $stream = [System.IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')",
    '    try {',
    '      [void]$stream.Seek($position, [System.IO.SeekOrigin]::Begin)',
    '      $reader = [System.IO.StreamReader]::new($stream)',
    '      $text = $reader.ReadToEnd()',
    '      $position = $stream.Position',
    '      if ($text.Length -gt 0) { Write-Host -NoNewline $text }',
    "      if ($text -match '\\[ (COMPLETED|FAILED) \\] Controlled .+ process exited with code') { $complete = $true }",
    '    } finally { $stream.Dispose() }',
    '  }',
    '  if (-not $complete) { Start-Sleep -Milliseconds 250 }',
    '}',
    'Write-Host "`nRuntime complete. This window will close in 5 seconds."',
    'Start-Sleep -Seconds 5',
  ].join('\n');
  return {
    cwd,
    command: 'powershell.exe',
    args: [
      '-NoLogo',
      '-NoProfile',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    title: runtimeTerminalTitle(runtimeName, roleId),
  };
}
