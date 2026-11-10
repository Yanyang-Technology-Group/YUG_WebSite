import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const linuxArchive = 'node-v24.21.0-linux-x64.tar.gz';
const longUnicodePath = 'public/assets/' + '城市😀'.repeat(9) + '/' + '图😀'.repeat(10) + '.svg';

function zipEntries(buffer) {
  const files = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    const raw = buffer.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(raw) : raw);
    offset = start + size;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'ZIP central directory is present');
  return files;
}

function tarEntries(buffer) {
  const raw = gunzipSync(buffer);
  const files = new Map();
  let offset = 0;
  const field = (start, length) => raw.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '');
  while (raw[offset] !== 0) {
    const prefix = field(offset + 345, 155);
    const name = (prefix ? prefix + '/' : '') + field(offset, 100);
    const size = parseInt(field(offset + 124, 12), 8);
    files.set(name, { mode: parseInt(field(offset + 100, 8), 8), type: field(offset + 156, 1), contents: raw.subarray(offset + 512, offset + 512 + size) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(raw.subarray(offset, offset + 1024).every(byte => byte === 0), 'tar ends in two zero blocks');
  return files;
}

async function dualPlatformFixture(t) {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'portal dual 平台 '));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  for (const dir of ['public/assets', 'lib', 'deployment', '.runtime', 'data']) await mkdir(path.join(fixture, dir), { recursive: true });
  for (const name of ['server.mjs', 'public/index.html', 'public/assets/城市图.svg', 'lib/cms.mjs']) await writeFile(path.join(fixture, name), 'deployable source');
  await mkdir(path.dirname(path.join(fixture, longUnicodePath)), { recursive: true });
  await writeFile(path.join(fixture, longUnicodePath), '<svg>long UTF-8 path</svg>');
  await writeFile(path.join(fixture, 'package.json'), '{"type":"module","version":"2.4.0"}');
  for (const name of ['package.mjs', 'start.cmd', 'stop.cmd', 'start-lan.cmd', 'start.sh', 'stop.sh', 'start-lan.sh', 'README.txt', 'README-linux.txt']) await writeFile(path.join(fixture, 'deployment', name), name.endsWith('.sh') ? '#!/bin/sh\r\nexit 0\r\n' : 'deployment fixture');
  for (const name of ['node.exe', linuxArchive]) await copyFile(path.join(projectRoot, '.runtime', name), path.join(fixture, '.runtime', name));
  await writeFile(path.join(fixture, 'data/articles.json'), '{"version":1,"articles":[{"id":"snapshot","title":"迁移草稿","status":"draft"}]}');
  await writeFile(path.join(fixture, 'data/site-content.json'), '{"version":1,"values":{"site.name":"迁移区域"}}');
  await writeFile(path.join(fixture, 'data/admin.json'), 'private-account');
  await writeFile(path.join(fixture, 'data/server.pid'), 'private-process');
  return fixture;
}

test('portable archive includes current article and website-region snapshots without credentials or sessions', async (t) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'portal-deployment-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  for (const dir of ['public/assets', 'lib', 'deployment', '.runtime', 'data', 'artifacts']) {
    await mkdir(path.join(fixture, dir), { recursive: true });
  }
  for (const file of ['public/index.html', 'public/styles.css', 'public/app.js', 'public/portal-data.js', 'public/portal-utils.js', 'public/admin.html', 'public/admin.js', 'public/admin-site-content.js', 'public/admin-management.js', 'public/admin.css', 'public/site-content-schema.js', 'server.mjs', 'package.json']) {
    await writeFile(path.join(fixture, file), file === 'package.json' ? '{"type":"module"}' : 'site fixture');
  }
  await writeFile(path.join(fixture, 'public/assets/city.svg'), '<svg></svg>');
  await writeFile(path.join(fixture, 'lib/cms.mjs'), 'export const cms = true;');
  for (const file of ['package.mjs', 'start.ps1', 'stop.ps1', 'start.cmd', 'stop.cmd', 'start-lan.cmd', 'start.sh', 'stop.sh', 'start-lan.sh', 'README.txt', 'README-linux.txt']) {
    await writeFile(path.join(fixture, 'deployment', file), 'deployment fixture');
  }
  await copyFile(path.join(projectRoot, '.runtime/node.exe'), path.join(fixture, '.runtime/node.exe'));
  await copyFile(path.join(projectRoot, '.runtime', linuxArchive), path.join(fixture, '.runtime', linuxArchive));
  await writeFile(path.join(fixture, 'data/admin.json'), '{"passwordHash":"must-stay-private"}');
  await writeFile(path.join(fixture, 'data/sessions.json'), '{"token":"must-stay-private"}');
  await writeFile(path.join(fixture, 'data/requests.json'), '{"requests":"must-stay-private"}');
  await writeFile(path.join(fixture, 'data/feedback.json'), '{"content":"must-stay-private"}');
  await writeFile(path.join(fixture, 'data/logs.json'), '{"actor":"must-stay-private"}');
  await writeFile(path.join(fixture, 'data/server.log'), 'must-stay-private');
  await writeFile(path.join(fixture, 'artifacts/preview.html'), 'must-stay-private');
  const original = [{ id: 'old', title: '先前文章', status: 'published', body: ['旧内容'] }];
  await writeFile(path.join(fixture, 'data/articles.json'), JSON.stringify({ version: 1, articles: original }));
  const originalSite = { version: 1, values: { 'site.name': '晏阳联合政府', 'footer.contact': '修改后的联系电话' } };
  await writeFile(path.join(fixture, 'data/site-content.json'), JSON.stringify(originalSite));
  const { buildDeploymentPackage } = await import('../deployment/package.mjs');
  const zipPath = await buildDeploymentPackage({ rootDir: fixture });
  assert.equal(zipPath, path.join(fixture, 'downloads/yanyang-government-windows-x64.zip'));
  const files = zipEntries(await readFile(zipPath));
  for (const file of ['public/index.html', 'public/admin.html', 'public/admin.js', 'public/admin-site-content.js', 'public/admin-management.js', 'public/site-content-schema.js', 'server.mjs', 'lib/cms.mjs', 'public/assets/city.svg', 'runtime/node.exe', 'deployment/package.mjs', 'start.cmd', 'stop.cmd', 'start-lan.cmd', '启动网站.cmd', '停止网站.cmd', '局域网启动.cmd', 'data/articles.json', 'data/site-content.json']) {
    assert.ok(files.has(file), `Missing required deployable file: ${file}`);
  }
  assert.ok(!files.has('index.html'), 'Public files keep their deployment directory');
  assert.ok(![...files.keys()].some((name) => name.startsWith('artifacts/')), 'Local artifacts are excluded');
  assert.deepEqual(JSON.parse(files.get('data/articles.json').toString()), { version: 1, articles: original });
  assert.equal(files.get('data/site-content.json').toString(), JSON.stringify(originalSite, null, 2) + '\n');
  assert.deepEqual([...files.keys()].filter((name) => name.startsWith('data/')), ['data/articles.json', 'data/site-content.json']);
  for (const [name, contents] of files) {
    assert.ok(!name.includes('..') && !path.isAbsolute(name), `Unsafe archive path: ${name}`);
    assert.ok(!contents.includes(Buffer.from('must-stay-private')), `Credential leaked into ${name}`);
  }
  const snapshot = [{ id: 'new', title: '迁移快照', status: 'draft', body: ['未发布的内容'] }, { id: 'plan', title: '已批准的发布计划', status: 'scheduled', scheduledAt: '2050-10-11T05:00:00.000Z', body: ['到期才公开的内容'] }];
  const siteSnapshot = { version: 1, values: { 'site.name': '另一份晏阳网站', 'footer.contact': '当前内存中的联系方式' } };
  const replacement = zipEntries(await readFile(await buildDeploymentPackage({ rootDir: fixture, articles: snapshot, siteContent: siteSnapshot })));
  assert.deepEqual(JSON.parse(replacement.get('data/articles.json').toString()), { version: 1, articles: snapshot });
  assert.equal(replacement.get('data/site-content.json').toString(), JSON.stringify(siteSnapshot, null, 2) + '\n');
  const defaultArchive = await readFile(zipPath);
  const outputDir = path.join(fixture, 'data/test-downloads');
  const customZipPath = await buildDeploymentPackage({ rootDir: fixture, outputDir, articles: original, siteContent: originalSite });
  assert.equal(customZipPath, path.join(outputDir, 'yanyang-government-windows-x64.zip'));
  const customFiles = zipEntries(await readFile(customZipPath));
  assert.deepEqual(JSON.parse(customFiles.get('data/articles.json').toString()), { version: 1, articles: original });
  assert.deepEqual(await readFile(zipPath), defaultArchive, 'Custom outputs preserve the default download archive');
  assert.deepEqual([...customFiles.keys()].filter((name) => name.startsWith('data/')), ['data/articles.json', 'data/site-content.json']);
});

test('deployment directory uses public seed and schema defaults when storage does not yet exist', async (t) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'portal-default-deployment-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  for (const dir of ['public/assets', 'lib', 'deployment']) await mkdir(path.join(fixture, dir), { recursive: true });
  for (const file of ['public/index.html', 'public/styles.css', 'public/app.js', 'public/portal-utils.js', 'public/admin.html', 'public/admin.js', 'public/admin-site-content.js', 'public/admin-management.js', 'public/admin.css', 'server.mjs', 'package.json']) {
    await writeFile(path.join(fixture, file), file === 'package.json' ? '{"type":"module"}' : 'site fixture');
  }
  await writeFile(path.join(fixture, 'public/portal-data.js'), 'export const articles = [{id:"seed",title:"默认文章",body:["默认内容"]}];');
  await writeFile(path.join(fixture, 'public/site-content-schema.js'), 'export const defaultSiteContent = {version:1,values:{"site.name":"晏阳联合政府网站","news.heading":"政务资讯"}};');
  for (const file of ['start.cmd', 'stop.cmd', 'start-lan.cmd', 'start.sh', 'stop.sh', 'start-lan.sh', 'README.txt', 'README-linux.txt']) await writeFile(path.join(fixture, 'deployment', file), 'deployment fixture');
  const { buildDeploymentDirectory } = await import('../deployment/package.mjs');
  const outputDir = path.join(fixture, 'dist');
  await buildDeploymentDirectory({ rootDir: fixture, outputDir });
  assert.deepEqual(JSON.parse(await readFile(path.join(outputDir, 'data/articles.json'), 'utf8')), { version: 1, articles: [{ id: 'seed', title: '默认文章', body: ['默认内容'], status: 'published', isSample: true, source: '晏阳联合政府（示例）' }] });
  assert.equal(await readFile(path.join(outputDir, 'public/index.html'), 'utf8'), 'site fixture');
  assert.equal(await readFile(path.join(outputDir, 'data/site-content.json'), 'utf8'), '{\n  "version": 1,\n  "values": {\n    "site.name": "晏阳联合政府网站",\n    "news.heading": "政务资讯"\n  }\n}\n');
  const supplied = { version: 1, values: { 'site.name': '指定部署配置' } };
  await buildDeploymentDirectory({ rootDir: fixture, outputDir, articles: [], siteContent: supplied });
  assert.equal(await readFile(path.join(outputDir, 'data/site-content.json'), 'utf8'), JSON.stringify(supplied, null, 2) + '\n');
  for (const directory of ['out/admin', 'out/_next/static/chunks']) await mkdir(path.join(fixture, directory), { recursive: true });
  for (const [file, contents] of [['out/index.html', 'Next home'], ['out/admin/index.html', 'Next admin'], ['out/_headers', 'Next CSP'], ['out/_next/static/chunks/portal.js', 'Next chunk'], ['out/portal-seed.json', 'public seed']]) await writeFile(path.join(fixture, file), contents);
  await writeFile(path.join(fixture, 'public/_headers'), 'source CSP');
  await buildDeploymentDirectory({ rootDir: fixture, outputDir, articles: [], siteContent: supplied });
  assert.equal(await readFile(path.join(outputDir, 'public/index.html'), 'utf8'), 'Next home');
  assert.equal(await readFile(path.join(outputDir, 'public/admin.html'), 'utf8'), 'Next admin');
  assert.equal(await readFile(path.join(outputDir, 'public/_headers'), 'utf8'), 'Next CSP');
  assert.equal(await readFile(path.join(outputDir, 'public/_next/static/chunks/portal.js'), 'utf8'), 'Next chunk');
  await assert.rejects(readFile(path.join(outputDir, 'public/portal-seed.json')), { code: 'ENOENT' });
});

test('portable packaging rejects a modified runtime rather than delivering an unverified executable', async (t) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'portal-runtime-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await mkdir(path.join(fixture, '.runtime'));
  await writeFile(path.join(fixture, '.runtime/node.exe'), 'untrusted executable');
  const { buildDeploymentPackage } = await import('../deployment/package.mjs');
  await assert.rejects(buildDeploymentPackage({ rootDir: fixture, articles: [] }), /SHA-256|校验/);
});

test('Linux tarball preserves executable launchers and private data modes with both verified runtimes', async t => {
  const fixture = await dualPlatformFixture(t);
  const { buildDeploymentPackage } = await import('../deployment/package.mjs');
  const target = await buildDeploymentPackage({ rootDir: fixture, platform: 'linux-x64' });
  assert.equal(target, path.join(fixture, 'downloads/yanyang-government-linux-x64.tar.gz'));
  const files = tarEntries(await readFile(target));
  for (const name of ['start.sh', 'stop.sh', 'start-lan.sh', 'deployment/start.sh']) {
    assert.equal(files.get(name)?.mode, 0o755, `${name} must be executable after extraction`);
    assert.ok(!files.get(name).contents.includes(13), `${name} must have LF newlines`);
  }
  assert.equal(files.get('data/')?.mode, 0o700);
  assert.equal(files.get('data/articles.json')?.mode, 0o600);
  assert.equal(files.get('data/site-content.json')?.mode, 0o600);
  assert.ok(files.has('public/assets/城市图.svg'), 'UTF-8 paths survive tar extraction');
  assert.ok(files.has(longUnicodePath), 'Long paths retain multibyte directories when split into a USTAR prefix');
  for (const name of ['node.exe', linuxArchive]) assert.deepEqual(files.get('runtime/' + name)?.contents, await readFile(path.join(fixture, '.runtime', name)));
  assert.deepEqual(JSON.parse(files.get('data/articles.json').contents), { version: 1, articles: [{ id: 'snapshot', title: '迁移草稿', status: 'draft' }] });
  assert.deepEqual([...files.keys()].filter(name => name.startsWith('data/') && !name.endsWith('/')), ['data/articles.json', 'data/site-content.json']);
  for (const { contents } of files.values()) assert.ok(!contents.includes(Buffer.from('private-account')) && !contents.includes(Buffer.from('private-process')));
});

test('packaging rejects unknown platforms and a tampered Linux runtime before publishing any archive', async t => {
  const fixture = await dualPlatformFixture(t);
  const { buildDeploymentPackage, getPackageInfo } = await import('../deployment/package.mjs');
  assert.equal(typeof getPackageInfo, 'function', 'platform metadata is available to API callers');
  assert.throws(() => getPackageInfo('linux-arm64'), /平台/);
  await assert.rejects(buildDeploymentPackage({ rootDir: fixture, platform: '../../outside' }), /平台/);
  await writeFile(path.join(fixture, '.runtime', linuxArchive), 'untrusted archive');
  await assert.rejects(buildDeploymentPackage({ rootDir: fixture }), /SHA-256|校验/);
  assert.deepEqual(await readdir(path.join(fixture, 'downloads')), [], 'a rejected runtime never publishes a partial archive');
});

test('release publishing creates a versioned pair and matching checksums from one snapshot while retaining history', async t => {
  const fixture = await dualPlatformFixture(t);
  const downloads = path.join(fixture, 'downloads');
  await mkdir(path.join(downloads, '2.3.2'), { recursive: true });
  await writeFile(path.join(downloads, '2.3.2/release.json'), 'previous-release');
  const { buildReleasePackages } = await import('../deployment/package.mjs');
  assert.equal(typeof buildReleasePackages, 'function', 'a release publishes both supported platforms');
  const manifest = await buildReleasePackages({ rootDir: fixture });
  assert.equal(manifest.version, '2.4.0');
  assert.deepEqual(manifest.packages.map(file => file.platform), ['windows-x64', 'linux-x64']);
  assert.deepEqual(JSON.parse(await readFile(path.join(downloads, '2.4.0/release.json'))), manifest);
  let windows, linux;
  for (const file of manifest.packages) {
    const extension = file.platform === 'windows-x64' ? '.zip' : '.tar.gz';
    assert.equal(file.filename, `yanyang-government-2.4.0-${file.platform}${extension}`);
    const contents = await readFile(path.join(downloads, '2.4.0', file.filename));
    assert.equal(file.bytes, contents.length);
    assert.equal(file.sha256, createHash('sha256').update(contents).digest('hex'));
    assert.deepEqual(await readFile(path.join(downloads, `yanyang-government-${file.platform}${extension}`)), contents);
    if (file.platform === 'windows-x64') windows = zipEntries(contents);
    else linux = tarEntries(contents);
  }
  for (const name of ['data/articles.json', 'data/site-content.json', 'package.json']) assert.deepEqual(windows.get(name), linux.get(name).contents, `both packages carry one ${name} snapshot`);
  assert.equal(await readFile(path.join(downloads, '2.3.2/release.json'), 'utf8'), 'previous-release');
  await writeFile(path.join(fixture, '.runtime', linuxArchive), 'invalid runtime');
  await assert.rejects(buildReleasePackages({ rootDir: fixture, version: '2.5.0' }), /SHA-256|校验/);
  assert.ok(!(await readdir(downloads)).includes('2.5.0'), 'an incomplete pair is never advertised as a release');
  assert.equal(await readFile(path.join(downloads, '2.3.2/release.json'), 'utf8'), 'previous-release');
});

// Reverting the release CLI to a Windows-only build or mandatory networking
// must fail this test, even though both genuine runtimes are already bundled.
test('the packaged release command publishes both platforms offline from bundled runtime files', async t => {
  const fixture = await dualPlatformFixture(t);
  await mkdir(path.join(fixture, 'scripts'));
  await copyFile(path.join(projectRoot, 'scripts/package.mjs'), path.join(fixture, 'scripts/package.mjs'));
  await copyFile(path.join(projectRoot, 'deployment/package.mjs'), path.join(fixture, 'deployment/package.mjs'));
  const bootstrap = path.join(fixture, 'deny-network.mjs');
  await writeFile(bootstrap, 'globalThis.fetch = () => { throw new Error("NETWORK_MUST_STAY_OFFLINE"); };\n');
  await mkdir(path.join(fixture, 'runtime'));
  for (const name of ['node.exe', linuxArchive]) await copyFile(path.join(fixture, '.runtime', name), path.join(fixture, 'runtime', name));
  await rm(path.join(fixture, '.runtime'), { recursive: true, force: true });
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(bootstrap).href, path.join(fixture, 'scripts/package.mjs')], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const manifest = JSON.parse(await readFile(path.join(fixture, 'downloads/2.4.0/release.json'), 'utf8'));
  assert.deepEqual(manifest.packages.map(file => file.platform), ['windows-x64', 'linux-x64']);
  assert.doesNotMatch(result.stdout + result.stderr, /NETWORK_MUST_STAY_OFFLINE/);
});

// A failure replacing the second stable download must never leave Windows on
// the new release while Linux or the version directory still points at old data.
test('a blocked second download alias leaves the previous version and both aliases untouched', async t => {
  const fixture = await dualPlatformFixture(t);
  const downloads = path.join(fixture, 'downloads');
  await mkdir(path.join(downloads, '2.4.0'), { recursive: true });
  await writeFile(path.join(downloads, '2.4.0/release.json'), 'old-release-manifest');
  await writeFile(path.join(downloads, 'yanyang-government-windows-x64.zip'), 'old-windows-package');
  const blocked = path.join(downloads, 'yanyang-government-linux-x64.tar.gz');
  await mkdir(blocked);
  await writeFile(path.join(blocked, 'preserve.txt'), 'old-linux-target');
  const { buildReleasePackages } = await import('../deployment/package.mjs');
  await assert.rejects(buildReleasePackages({ rootDir: fixture }), /EISDIR|EPERM|下载|普通|文件/);
  assert.ok((await readFile(path.join(downloads, 'yanyang-government-windows-x64.zip'))).equals(Buffer.from('old-windows-package')), 'failed Linux alias publication must preserve the old Windows alias');
  assert.equal(await readFile(path.join(downloads, '2.4.0/release.json'), 'utf8'), 'old-release-manifest');
  assert.equal(await readFile(path.join(blocked, 'preserve.txt'), 'utf8'), 'old-linux-target');
  assert.ok(!(await readdir(downloads)).some(name => name.startsWith('.')), 'all transaction temporary files are cleaned');
});
