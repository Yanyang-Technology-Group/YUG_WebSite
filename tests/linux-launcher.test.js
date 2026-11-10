import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, access, stat } from 'node:fs/promises';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const shell = process.env.PORTAL_TEST_SH || (process.platform === 'linux' ? '/bin/sh' : null);
const shellArgs = shell && /busybox[^/\\]*$/i.test(shell) ? ['sh'] : [];
const shellOptions = { skip: shell ? false : 'Linux /bin/sh is unavailable; set PORTAL_TEST_SH for portable shell checks' };
const archiveName = 'node-v24.21.0-linux-x64.tar.gz';
const archiveHash = '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portal Linux 中文 空格 '));
  t.after(async () => {
    // Stop before removing cwd/runtime so cleanup cannot invalidate ownership.
    if (process.platform === 'linux') run(root, 'stop.sh', ['--no-browser']);
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'deployment'));
  await mkdir(path.join(root, 'runtime'));
  await writeFile(path.join(root, 'server.mjs'), 'throw new Error("invalid fixture runtime must never run this server");\n');
  for (const name of ['start.sh', 'stop.sh', 'start-lan.sh']) {
    await copyFile(path.join(projectRoot, 'deployment', name), path.join(root, 'deployment', name));
    await copyFile(path.join(projectRoot, 'deployment', name), path.join(root, name));
  }
  return root;
}

function run(root, script, args = [], env = {}) {
  return spawnSync(shell, [...shellArgs, path.join(root, script), ...args], {
    cwd: os.tmpdir(), env: { ...process.env, ...env }, encoding: 'utf8', timeout: 20000, windowsHide: true
  });
}

// Removing option validation must expose the runtime error instead of rejecting
// the bad input, even when the invocation path contains spaces and Chinese.
test('Linux launchers reject invalid ports and unknown options before touching the runtime', shellOptions, async t => {
  const root = await fixture(t);
  for (const [script, args, env] of [
    ['start.sh', ['--port', '1023'], {}],
    ['deployment/start.sh', ['--port', '65536'], {}],
    ['start-lan.sh', ['--port', '12x'], {}],
    ['deployment/start-lan.sh', ['--port'], {}],
    ['start.sh', [], { PORT: '1' }],
    ['start.sh', ['--unexpected'], {}]
  ]) {
    const result = run(root, script, args, env);
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /1024|65535|--port|未知|unknown/i);
    assert.doesNotMatch(result.stdout + result.stderr, /运行环境缺失|仅支持 Linux/);
  }
  await assert.rejects(access(path.join(root, 'data')));
});

// Bypassing the pinned archive checksum must stop rejecting this intentionally
// corrupt runtime, including stop and an already extracted binary.
test('Linux start and stop reject a changed archive before executing an extracted runtime', shellOptions, async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'runtime', archiveName), 'corrupted archive');
  const bin = path.join(root, 'runtime/linux/node-v24.21.0-linux-x64/bin');
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, 'node'), '#!/bin/sh\necho UNVERIFIED_RUNTIME_EXECUTED\n');
  for (const script of ['start.sh', 'deployment/start.sh', 'start-lan.sh', 'deployment/stop.sh', 'stop.sh']) {
    const result = run(root, script, ['--no-browser']);
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /SHA-256|校验/);
    assert.doesNotMatch(result.stdout + result.stderr, /UNVERIFIED_RUNTIME_EXECUTED/);
  }
  await assert.rejects(access(path.join(root, 'data')));
});

async function availableArchive() {
  for (const candidate of [process.env.PORTAL_TEST_LINUX_ARCHIVE, path.join(projectRoot, '.runtime/linux', archiveName), path.join(projectRoot, '.runtime', archiveName)]) {
    if (!candidate) continue;
    try { if (createHash('sha256').update(await readFile(candidate)).digest('hex') === archiveHash) return candidate; } catch {}
  }
  return null;
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

const archive = process.platform === 'linux' && process.arch === 'x64' ? await availableArchive() : null;
const integrationOptions = { skip: archive ? false : 'Requires Linux x64 and the verified official archive (PORTAL_TEST_LINUX_ARCHIVE)' };

// A duplicate launcher must retain the same PID, and stop must preserve user
// files while removing only this bundle's owned service.
test('Linux launcher starts from either layout, reuses its own healthy service and preserves data on stop', integrationOptions, async t => {
  const root = await fixture(t);
  await copyFile(archive, path.join(root, 'runtime', archiveName));
  await writeFile(path.join(root, 'server.mjs'), `import http from 'node:http';
http.createServer((req,res) => { res.setHeader('content-type','application/json'); res.end(JSON.stringify({ ok:true, service:'yunchuan-government-portal' })); }).listen(Number(process.env.PORT),process.env.HOST);
`);
  const port = await unusedPort();
  t.after(() => run(root, 'stop.sh', ['--no-browser']));
  const started = run(root, 'deployment/start.sh', ['--port', String(port), '--no-browser']);
  assert.equal(started.status, 0, started.stdout + started.stderr);
  const record = JSON.parse(await readFile(path.join(root, 'data/server.pid'), 'utf8'));
  assert.equal((await stat(path.join(root, 'data'))).mode & 0o777, 0o700);
  await writeFile(path.join(root, 'data/articles.json'), '{"keep":"articles"}\n');
  assert.equal(record.port, port);
  assert.equal(record.host, '127.0.0.1');
  const repeated = run(root, 'start.sh', ['--no-browser'], { PORT: String(port) });
  assert.equal(repeated.status, 0, repeated.stdout + repeated.stderr);
  assert.equal(JSON.parse(await readFile(path.join(root, 'data/server.pid'), 'utf8')).pid, record.pid);
  const wrongMode = run(root, 'start-lan.sh', ['--port', String(port), '--no-browser']);
  assert.notEqual(wrongMode.status, 0, 'Changing an existing service binding requires stop first');
  // All other identity fields match a real owned process: removing the start
  // time check would make stop kill it instead of refusing the reused record.
  await writeFile(path.join(root, 'data/server.pid'), JSON.stringify({ ...record, startTime: '0' }));
  try {
    const reused = run(root, 'stop.sh');
    assert.notEqual(reused.status, 0);
    process.kill(record.pid, 0);
  } finally {
    await writeFile(path.join(root, 'data/server.pid'), JSON.stringify(record));
  }
  const stopped = run(root, 'deployment/stop.sh');
  assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
  await assert.rejects(access(path.join(root, 'data/server.pid')));
  assert.equal(await readFile(path.join(root, 'data/articles.json'), 'utf8'), '{"keep":"articles"}\n');
  const nodeFile = path.join(root, 'runtime/linux/node-v24.21.0-linux-x64/bin/node');
  const verifiedNode = await readFile(nodeFile);
  try {
    await writeFile(nodeFile, '#!/bin/sh\necho UNVERIFIED_RUNTIME_EXECUTED\n');
    const changedNode = run(root, 'stop.sh');
    assert.notEqual(changedNode.status, 0);
    assert.match(changedNode.stdout + changedNode.stderr, /SHA-256|校验/);
    assert.doesNotMatch(changedNode.stdout + changedNode.stderr, /UNVERIFIED_RUNTIME_EXECUTED/);
  } finally { await writeFile(nodeFile, verifiedNode); }
});

// Dropping start-time ownership must kill this live process with a forged PID
// record. Dropping port ownership must falsely claim the other portal as ours.
test('Linux launcher refuses reused PID records and another bundle on the chosen port', integrationOptions, async t => {
  const root = await fixture(t);
  await copyFile(archive, path.join(root, 'runtime', archiveName));
  await mkdir(path.join(root, 'data'));
  const port = await unusedPort();
  const rival = spawn(process.execPath, ['--input-type=module', '-e', `import http from 'node:http'; http.createServer((req,res)=>res.end(JSON.stringify({ok:true,service:'yunchuan-government-portal'}))).listen(${port},'127.0.0.1',()=>console.log('ready'));`], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => rival.kill());
  await new Promise((resolve, reject) => { rival.stdout.once('data', resolve); rival.once('error', reject); });
  const conflict = run(root, 'start.sh', ['--port', String(port), '--no-browser']);
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stdout + conflict.stderr, /端口|port/i);
  await assert.rejects(access(path.join(root, 'data/server.pid')));
  const nodeFile = path.join(root, 'runtime/linux/node-v24.21.0-linux-x64/bin/node');
  await writeFile(path.join(root, 'data/server.pid'), JSON.stringify({ pid: rival.pid, root, node: nodeFile, server: path.join(root, 'server.mjs'), startTime: '0', port, host: '127.0.0.1' }));
  const refused = run(root, 'stop.sh');
  assert.notEqual(refused.status, 0);
  process.kill(rival.pid, 0);
  assert.equal(JSON.parse(await readFile(path.join(root, 'data/server.pid'), 'utf8')).pid, rival.pid);
});
