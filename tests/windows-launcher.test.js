import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const windowsOnly = { skip: process.platform !== 'win32' };

test('Windows launchers load native hash modules and forward options from a Chinese path with spaces', windowsOnly, async t => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'portal 启动 空格 '));
  // mkdtemp returns this test-owned absolute directory; cleanup never targets
  // a supplied or computed workspace path.
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const deployment = path.join(fixture, 'deployment');
  const shadowRoot = path.join(fixture, 'shadow modules');
  const shadowModule = path.join(shadowRoot, 'Microsoft.PowerShell.Utility');
  await mkdir(deployment);
  await mkdir(shadowModule, { recursive: true });
  await writeFile(path.join(shadowModule, 'Microsoft.PowerShell.Utility.psm1'), "function Get-FileHash { throw 'SHADOW_UTILITY_MODULE_USED' }\nExport-ModuleMember -Function Get-FileHash\n");
  await writeFile(path.join(shadowModule, 'Microsoft.PowerShell.Utility.psd1'), "@{ RootModule = 'Microsoft.PowerShell.Utility.psm1'; ModuleVersion = '9.9.9'; FunctionsToExport = @('Get-FileHash'); CmdletsToExport = @(); AliasesToExport = @() }\n");
  const payload = 'launcher module loading fixture\n';
  const expectedHash = createHash('sha256').update(payload).digest('hex').toUpperCase();
  await writeFile(path.join(deployment, 'payload.txt'), payload);
  const powershellScript = kind => `param([switch]$Lan, [int]$Port = 0, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop
$hash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'payload.txt') -Algorithm SHA256).Hash
[Console]::WriteLine('WRAPPER_MARKER|Kind=${kind}|Lan=' + $Lan.IsPresent + '|Port=' + $Port + '|NoBrowser=' + $NoBrowser.IsPresent + '|Hash=' + $hash)
`;
  await writeFile(path.join(deployment, 'start.ps1'), powershellScript('start'));
  await writeFile(path.join(deployment, 'stop.ps1'), powershellScript('stop'));
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const nativeModules = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
  const environment = { ...process.env, PSModulePath: `${shadowRoot};${process.env.PSModulePath || nativeModules}` };
  const cmdExe = path.join(systemRoot, 'System32', 'cmd.exe');
  const run = command => spawnSync(cmdExe, ['/d', '/c', command], { cwd: fixture, env: environment, input: '\r\n', encoding: 'utf8', timeout: 5000, windowsHide: true });

  // This isolated negative control proves the inherited environment is harmful:
  // the same script would load the conflicting utility module without isolation.
  const legacy = '@echo off\r\n"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deployment\\start.ps1" -Port 8135 -NoBrowser\r\n';
  await writeFile(path.join(fixture, 'legacy.cmd'), legacy);
  const poisoned = run('legacy.cmd');
  assert.equal(poisoned.error, undefined, 'the negative control must finish without timing out');
  assert.notEqual(poisoned.status, 0, 'the shadow module must break unisolated launchers');
  assert.match(poisoned.stdout + poisoned.stderr, /SHADOW_UTILITY_MODULE_USED/);

  for (const [wrapper, kind, lan, port] of [
    ['start.cmd', 'start', 'False', 8135],
    ['start-lan.cmd', 'start', 'True', 8136],
    ['stop.cmd', 'stop', 'False', 8137]
  ]) {
    await copyFile(path.join(projectRoot, 'deployment', wrapper), path.join(fixture, wrapper));
    const result = run(`${wrapper} -Port ${port} -NoBrowser`);
    assert.equal(result.error, undefined, `${wrapper} must finish without timing out`);
    assert.equal(result.status, 0, `${wrapper}\n${result.stdout}\n${result.stderr}`);
    assert.ok(result.stdout.includes(`WRAPPER_MARKER|Kind=${kind}|Lan=${lan}|Port=${port}|NoBrowser=True|Hash=${expectedHash}`), `${wrapper} must load Get-FileHash, find its relative deployment path and preserve arguments:\n${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(result.stdout + result.stderr, /SHADOW_UTILITY_MODULE_USED/);
  }
  assert.equal(await readFile(path.join(deployment, 'payload.txt'), 'utf8'), payload);
});
