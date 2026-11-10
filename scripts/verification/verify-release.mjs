import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inflateRawSync, gunzipSync } from 'node:zlib';
import { PLATFORMS, getPackageInfo, NODE_SHA256, LINUX_NODE_SHA256, LINUX_NODE_ARCHIVE } from '../../deployment/package.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const directory = path.join(root, 'downloads', version);
const manifest = JSON.parse(await readFile(path.join(directory, 'release.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(manifest.version, version);
assert.deepEqual(manifest.packages.map(item => item.platform).sort(), [...PLATFORMS].sort());

function zipFiles(buffer) {
  const files = new Map(); let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8), size = buffer.readUInt32LE(offset + 18);
    assert.equal(method, 8);
    const nameLength = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extra;
    assert.ok(!files.has(name), '重复 ZIP 路径：' + name);
    const bytes = inflateRawSync(buffer.subarray(start, start + size));
    assert.equal(bytes.length, buffer.readUInt32LE(offset + 22));
    files.set(name, { bytes }); offset = start + size;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
  return files;
}
function tarFiles(buffer) {
  const raw = gunzipSync(buffer), files = new Map(); let offset = 0;
  const field = (at, size) => raw.subarray(at, at + size).toString('utf8').replace(/\0.*$/, '');
  while (raw[offset] !== 0) {
    const header = raw.subarray(offset, offset + 512);
    const checksum = [...header].reduce((total, byte, i) => total + (i >= 148 && i < 156 ? 32 : byte), 0);
    assert.equal(checksum, parseInt(field(offset + 148, 8), 8));
    const prefix = field(offset + 345, 155), name = (prefix ? prefix + '/' : '') + field(offset, 100);
    const size = parseInt(field(offset + 124, 12), 8), mode = parseInt(field(offset + 100, 8), 8);
    const type = field(offset + 156, 1);
    assert.ok(type === '0' || type === '5', '归档只含普通文件或目录头');
    if (type === '5') { offset += 512 + Math.ceil(size / 512) * 512; continue; }
    assert.ok(!files.has(name), '重复 TAR 路径：' + name);
    files.set(name, { bytes: raw.subarray(offset + 512, offset + 512 + size), mode });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(raw.subarray(offset, offset + 1024).every(byte => byte === 0));
  return files;
}
let common;
for (const entry of manifest.packages) {
  const archive = await readFile(path.join(directory, entry.filename));
  assert.equal(archive.length, entry.bytes); assert.equal(hash(archive), entry.sha256);
  assert.equal(hash(await readFile(path.join(root, 'downloads', getPackageInfo(entry.platform).filename))), entry.sha256, '当前下载别名');
  const files = entry.platform === 'windows-x64' ? zipFiles(archive) : tarFiles(archive);
  assert.deepEqual([...files.keys()].filter(name => name.startsWith('data/')).sort(), ['data/articles.json', 'data/site-content.json']);
  const digests = {};
  for (const [name, { bytes, mode }] of files) {
    assert.ok(!name.includes('\\') && !name.startsWith('/') && !name.includes(':') && !name.split('/').some(part => part === '..' || part === '.' || !part), '安全路径：' + name);
    digests[name] = hash(bytes);
    if (name.endsWith('.sh')) { assert.ok(!bytes.includes(Buffer.from('\r'))); if (mode !== undefined) assert.equal(mode, 0o755); }
    if (name.startsWith('data/') && mode !== undefined) assert.equal(mode, 0o600);
    if (/^(public\/|lib\/|deployment\/|offline-translation\/(?!runtime\/)|scripts\/|server\.mjs$|package\.json$)/.test(name)) {
      const exported = { 'public/index.html': 'out/index.html', 'public/admin.html': 'out/admin/index.html', 'public/_headers': 'out/_headers' };
      const sourcePath = exported[name] || (name.startsWith('public/_next/static/') ? 'out/' + name.slice(7) : name);
      let source = await readFile(path.join(root, sourcePath));
      if (name.endsWith('.sh')) source = Buffer.from(source.toString('utf8').replace(/\r\n/g, '\n'));
      assert.equal(hash(bytes), hash(source), '当前源码：' + name);
    }
  }
  assert.equal(hash(files.get('runtime/node.exe').bytes), NODE_SHA256);
  assert.equal(hash(files.get('runtime/' + LINUX_NODE_ARCHIVE).bytes), LINUX_NODE_SHA256);
  assert.equal(JSON.parse(files.get('package.json').bytes).version, version);
  for (const name of ['articles.json', 'site-content.json']) assert.deepEqual(JSON.parse(files.get('data/' + name).bytes), JSON.parse(await readFile(path.join(root, 'data', name), 'utf8')), '当前内容快照：' + name);
  if (common) assert.deepEqual(digests, common, '两平台所有文件内容相同'); else common = digests;
}
const report = { version, verifiedAt: new Date().toISOString(), manifest, fileCount: Object.keys(common).length, archiveHashes: true, aliases: true, identicalFileContents: true, currentSource: true, currentContentSnapshot: true, privateDataExcluded: true, pinnedRuntimes: true, linuxModes: true, limits: ['Linux 原生启停需要在 Linux 主机验证。'] };
await mkdir(path.join(root, 'artifacts/reports'), { recursive: true });
await writeFile(path.join(root, 'artifacts/reports', 'dual-platform-release-' + version + '.json'), JSON.stringify(report, null, 2) + '\n');
console.log(version + ' 双平台归档、' + report.fileCount + ' 个一致文件、源码/内容快照、私有数据排除、运行环境与校验清单验证通过。');
