import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { readFile, writeFile, mkdir, mkdtemp, access, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { inflateRawSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
if (process.platform !== 'win32') throw new Error('此验收脚本须在 Windows 上运行。');

const root = fileURLToPath(new URL('../../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const archive = path.join(root, `downloads/${version}/yanyang-government-${version}-windows-x64.zip`);
const reportPath = path.join(root, `artifacts/reports/windows-deployment-${version}.json`);
const windowsPowerShell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const report = { version: version, startedAt: new Date().toISOString(), archive, isolated: true, stages: [], passed: false };
let extracted, port, base;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stage = (name, result = {}) => { report.stages.push({ name, at: new Date().toISOString(), ...result }); console.log(name); };

function powershell(command, extraEnv = {}) {
  const result = spawnSync(windowsPowerShell, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    windowsHide: true, cwd: os.tmpdir(), stdio: 'ignore', timeout: 45000,
    env: { ...process.env, PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules'), VERIFY_DEPLOY_ROOT: extracted || '', VERIFY_DEPLOY_PORT: String(port || ''), ...extraEnv }
  });
  assert.equal(result.error, undefined, [result.error?.message, result.stdout, result.stderr].join('\n'));
  assert.equal(result.status, 0, `PowerShell failed: ${result.stdout}\n${result.stderr}`);
  return { exitCode: result.status };
}
function launcher(name) {
  return powershell(`& (Join-Path $env:VERIFY_DEPLOY_ROOT '${name}')${name === 'start.cmd' ? ' -NoBrowser -Port ([int]$env:VERIFY_DEPLOY_PORT)' : ''}; exit $LASTEXITCODE`);
}
async function extractArchive() {
  const child = spawn(windowsPowerShell, ['-NoLogo', '-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:VERIFY_ARCHIVE -DestinationPath $env:VERIFY_DEPLOY_ROOT'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules'), VERIFY_ARCHIVE: archive, VERIFY_DEPLOY_ROOT: extracted } });
  let diagnostics = ''; child.stderr.on('data', bytes => { diagnostics += bytes; });
  const timer = setTimeout(() => child.kill(), 240000);
  try { await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Archive extraction failed: ' + code + ' ' + diagnostics))); }); }
  finally { clearTimeout(timer); }
}
async function exists(filename) { try { await access(filename); return true; } catch { return false; } }
async function readJson(filename) { return JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/, '')); }
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const available = server.address().port;
  await new Promise(resolve => server.close(resolve));
  assert.notEqual(available, 5173);
  return available;
}
async function fetchRequest(route, { method = 'GET', data, actor } = {}) {
  const response = await fetch(base + route, {
    method, signal: AbortSignal.timeout(60000),
    headers: { ...(data ? { 'Content-Type': 'application/json', Origin: base } : {}), ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.token } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {})
  });
  const contentType = response.headers.get('content-type') || '';
  const value = contentType.includes('application/json') ? await response.json() : /application\/(zip|gzip)/.test(contentType) ? Buffer.from(await response.arrayBuffer()) : await response.text();
  return { status: response.status, contentType, headers: response.headers, value };
}
async function login(credentials, setup = false) {
  const result = await fetchRequest(`/api/admin/${setup ? 'setup' : 'login'}`, { method: 'POST', data: credentials });
  assert.equal(result.status, setup ? 201 : 200);
  return { cookie: result.headers.get('set-cookie').split(';')[0], token: result.value.csrfToken };
}
function zipEntries(buffer) {
  const entries = new Map(); let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8), size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26), extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength, bytes = buffer.subarray(start, start + size);
    entries.set(name, method === 8 ? inflateRawSync(bytes) : bytes); offset = start + size;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
  return entries;
}
function tarEntries(buffer) {
  const bytes = gunzipSync(buffer), entries = new Map(); let offset = 0;
  const field = (start, length) => bytes.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '');
  while (bytes[offset] !== 0) {
    const prefix = field(offset + 345, 155), name = (prefix ? prefix + '/' : '') + field(offset, 100), size = parseInt(field(offset + 124, 12), 8);
    if (field(offset + 156, 1) !== '5') entries.set(name, bytes.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(bytes.subarray(offset, offset + 1024).every(byte => byte === 0));
  return entries;
}
function assertPrivateExcluded(entries, syntheticSecrets) {
  const forbidden = ['data/admin.json', 'data/feedback.json', 'data/requests.json', 'data/logs.json', 'data/server.pid', 'data/server.log', 'data/server-error.log', 'data/transaction.json'];
  for (const name of forbidden) assert.equal(entries.has(name), false, name);
  assert.deepEqual([...entries.keys()].filter(name => name.startsWith('data/')).sort(), ['data/articles.json', 'data/site-content.json']);
  for (const [name, bytes] of entries) for (const secret of syntheticSecrets) assert.equal(bytes.includes(Buffer.from(secret)), false, `private synthetic marker leaked: ${name}`);
  return { entries: entries.size, dataEntries: ['data/articles.json', 'data/site-content.json'], privateFilesExcluded: true, syntheticMarkersExcluded: true };
}
async function closedPort() {
  try { await fetch(base + '/api/health', { signal: AbortSignal.timeout(1500) }); return false; } catch { return true; }
}

try {
  const archiveBytes = await readFile(archive);
  const manifest = JSON.parse(await readFile(path.join(root, `downloads/${version}/release.json`), 'utf8'));
  const entry = manifest.packages.find(item => item.platform === 'windows-x64');
  assert.equal(manifest.version, version); assert.equal(entry.sha256, hash(archiveBytes)); assert.equal(entry.bytes, archiveBytes.length);
  report.archiveSha256 = entry.sha256;
  const originalEntries = zipEntries(archiveBytes);
  assertPrivateExcluded(originalEntries, []);
  extracted = await mkdtemp(path.join(os.tmpdir(), 'portal-tests-owned 部署验证 中文 空格 '));
  assert.ok(path.resolve(extracted).startsWith(path.resolve(os.tmpdir()) + path.sep));
  report.extractedRoot = extracted;
  await extractArchive();
  assert.equal(JSON.parse(await readFile(path.join(extracted, 'package.json'), 'utf8')).version, version);
  for (const [name, bytes] of originalEntries) assert.equal(hash(await readFile(path.join(extracted, name))), hash(bytes), 'extracted file: ' + name);
  stage('archive-extracted-verified', { entries: originalEntries.size, root: extracted });
  port = await freePort(); base = `http://127.0.0.1:${port}`; report.port = port;
  stage('first-start', launcher('start.cmd'));
  if (!(await exists(path.join(extracted, 'data/server.pid')))) {
    for (const name of ['server.log', 'server-error.log']) { try { console.error(name + ': ' + await readFile(path.join(extracted, 'data', name), 'utf8')); } catch {} }
    throw new Error('Launcher returned without a running service');
  }
  const firstPid = (await readJson(path.join(extracted, 'data/server.pid'))).pid;
  report.firstPid = firstPid;
  for (const route of ['/api/health', '/', '/admin']) assert.equal((await fetchRequest(route)).status, 200, route);
  assert.equal((await fetchRequest('/api/health')).value.ok, true);
  stage('health-home-admin-200');
  stage('duplicate-start', launcher('start.cmd'));
  const duplicatePid = (await readJson(path.join(extracted, 'data/server.pid'))).pid;
  assert.equal(duplicatePid, firstPid); stage('duplicate-start-same-pid', { pid: duplicatePid });
  const ownerCredentials = { username: 'verify_owner_qa', password: 'verify-owner-private-password-qa' };
  const ordinaryCredentials = { username: 'verify_editor_qa', password: 'verify-editor-private-password-qa' };
  let ownerActor = await login(ownerCredentials, true);
  const ordinary = await fetchRequest('/api/admin/users', { method: 'POST', actor: ownerActor, data: { ...ordinaryCredentials, role: 'admin' } });
  assert.equal(ordinary.status, 201);
  const seniorCredentials = { username: 'verify_senior_qa', password: 'verify-senior-private-password-qa' };
  const senior = await fetchRequest('/api/admin/users', { method: 'POST', actor: ownerActor, data: { ...seniorCredentials, role: 'senioradmin' } });
  assert.equal(senior.status, 201); let seniorActor = await login(seniorCredentials);
  assert.equal((await fetchRequest('/api/admin/users/' + ordinary.value.user.id, { method: 'PUT', actor: seniorActor, data: { role: 'senioradmin' } })).status, 403);
  assert.equal((await fetchRequest('/api/admin/users', { method: 'POST', actor: seniorActor, data: { username: 'verify_forbidden_qa', password: 'verify-forbidden-password-qa', role: 'superadmin' } })).status, 403);
  for (const route of ['/api/admin/site-content', '/api/admin/logs', '/api/admin/users']) assert.equal((await fetchRequest(route, { actor: seniorActor })).status, 200, route);
  stage('senior-permissions-and-role-controls-verified');
  const feedbackInput = { type: 'suggestion', gameName: 'WINDOWS_VERIFY_PRIVATE_PLAYER_qa', qq: '987654320111', title: '隔离验收意见', content: 'WINDOWS_VERIFY_PRIVATE_FEEDBACK_qa 仅用于隔离部署验证。' };
  const submitted = await fetchRequest('/api/feedback', { method: 'POST', data: feedbackInput }); assert.equal(submitted.status, 201);
  const opinionId = submitted.value.feedback.id;
  const read = await fetchRequest('/api/admin/feedback/' + opinionId, { method: 'PATCH', actor: ownerActor, data: { status: 'read' } }); assert.equal(read.status, 200);
  const articleResult = await fetchRequest('/api/admin/articles', { method: 'POST', actor: seniorActor, data: { title: 'Windows 部署重启保留验证', category: '通知公告', date: '2026-10-11', summary: '隔离合成文章', body: ['隔离部署的合成文章，验证停止及重启后内容保留。'], source: '晏阳联合政府', status: 'published' } });
  assert.equal(articleResult.status, 201); const articleId = articleResult.value.article.id;
  const ordinaryActor = await login(ordinaryCredentials);
  const adminList = await fetchRequest('/api/admin/feedback?search=' + encodeURIComponent(feedbackInput.qq), { actor: ordinaryActor });
  assert.equal(adminList.status, 200); assert.equal(adminList.value.feedback[0].qq, feedbackInput.qq); assert.equal(adminList.value.feedback[0].gameName, feedbackInput.gameName);
  for (const platform of ['windows-x64', 'linux-x64']) assert.equal((await fetchRequest('/api/admin/deployment?platform=' + platform, { actor: ordinaryActor })).status, 403);
  stage('temporary-owner-editor-feedback-created', { ordinaryCanReadIdentity: true, ordinaryExportsDenied: ['windows-x64', 'linux-x64'] });
  const filesBefore = {};
  for (const name of ['articles.json', 'site-content.json', 'admin.json', 'feedback.json']) filesBefore[name] = hash(await readFile(path.join(extracted, 'data', name)));
  stage('stop-before-restart', launcher('stop.cmd')); assert.equal(await closedPort(), true); assert.equal(await exists(path.join(extracted, 'data/server.pid')), false);
  stage('restart', launcher('start.cmd'));
  const secondPid = (await readJson(path.join(extracted, 'data/server.pid'))).pid; report.restartPid = secondPid; assert.notEqual(secondPid, firstPid);
  for (const [name, previous] of Object.entries(filesBefore)) assert.equal(hash(await readFile(path.join(extracted, 'data', name))), previous, 'data preserved: ' + name);
  ownerActor = await login(ownerCredentials);
  seniorActor = await login(seniorCredentials);
  const persisted = await fetchRequest('/api/admin/feedback?search=' + encodeURIComponent(feedbackInput.qq), { actor: ownerActor });
  assert.equal(persisted.value.feedback[0].id, opinionId); assert.equal(persisted.value.feedback[0].status, 'read'); assert.equal(persisted.value.feedback[0].qq, feedbackInput.qq);
  const persistedArticles = await fetchRequest('/api/admin/articles', { actor: ownerActor }); assert.ok(persistedArticles.value.articles.some(item => item.id === articleId));
  stage('restart-private-and-public-data-preserved', { files: Object.keys(filesBefore), differentPid: true, ownerLoginPreserved: true, feedbackIdentityAndStatusPreserved: true, articlePreserved: true });
  const runningContent = await fetchRequest('/api/admin/site-content', { actor: ownerActor }); assert.equal(runningContent.status, 200);
  const storedContent = await readJson(path.join(extracted, 'data/site-content.json'));
  for (const [key, value] of Object.entries(storedContent.values)) assert.equal(runningContent.value.content.values[key], value, 'stored site override: ' + key);
  const exportedSnapshots = [];
  const exports = {};
  for (const platform of ['windows-x64', 'linux-x64']) {
    stage('begin-senior-export-' + platform);
    const result = await fetchRequest('/api/admin/deployment?platform=' + platform, { actor: seniorActor }); assert.equal(result.status, 200);
    assert.equal(result.contentType, platform === 'windows-x64' ? 'application/zip' : 'application/gzip');
    const entries = platform === 'windows-x64' ? zipEntries(result.value) : tarEntries(result.value);
    const privacy = assertPrivateExcluded(entries, [feedbackInput.qq, feedbackInput.gameName, feedbackInput.content, ownerCredentials.username, ownerCredentials.password, ordinaryCredentials.username, ordinaryCredentials.password, seniorCredentials.username, seniorCredentials.password]);
    assert.deepEqual(entries.get('data/articles.json'), await readFile(path.join(extracted, 'data/articles.json')));
    assert.deepEqual(JSON.parse(entries.get('data/site-content.json')), runningContent.value.content);
    exportedSnapshots.push({ articles: hash(entries.get('data/articles.json')), content: hash(entries.get('data/site-content.json')) });
    assert.equal(JSON.parse(entries.get('package.json')).version, version);
    exports[platform] = { status: result.status, mime: result.contentType, bytes: result.value.length, sha256: hash(result.value), ...privacy, snapshotsMatchRunningDeployment: true };
    stage('senior-export-' + platform + '-verified', exports[platform]);
  }
  assert.deepEqual(exportedSnapshots[0], exportedSnapshots[1]);
  report.crossPlatformSnapshotsIdentical = true;
  report.exports = exports;
  const audit = await fetchRequest('/api/admin/logs', { actor: ownerActor }); assert.equal(audit.status, 200); assert.equal(JSON.stringify(audit.value).includes(feedbackInput.qq), false);
  assert.ok(audit.value.logs.some(log => log.actor.role === 'senioradmin' && log.action === 'deployment.export'));
  stage('qq-not-written-to-audit', { passed: true });
  assert.equal((await fetchRequest('/api/admin/users/' + senior.value.user.id, { method: 'PUT', actor: ownerActor, data: { role: 'admin' } })).status, 200);
  assert.equal((await fetchRequest('/api/admin/logs', { actor: seniorActor })).status, 401);
  const downgraded = await login(seniorCredentials);
  assert.equal((await fetchRequest('/api/admin/logs', { actor: downgraded })).status, 403);
  stage('superadmin-downgrade-and-session-revocation-verified');
  stage('final-stop', launcher('stop.cmd')); assert.equal(await closedPort(), true); assert.equal(await exists(path.join(extracted, 'data/server.pid')), false);
  report.passed = true;
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack };
  console.error(error.stack); process.exitCode = 1;
} finally {
  if (extracted && port) {
    try { report.cleanup = { ...launcher('stop.cmd'), portClosed: await closedPort(), pidFileRemoved: !(await exists(path.join(extracted, 'data/server.pid'))) }; }
    catch (error) { report.cleanup = { failed: true, message: error.message }; report.passed = false; process.exitCode = 1; }
  }
  if (extracted && (!report.cleanup || report.cleanup.portClosed)) await rm(extracted, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log('report: ' + reportPath);
  console.log('passed: ' + report.passed);
}
