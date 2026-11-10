import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, lstat, realpath, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { deflateRawSync, createGzip } from 'node:zlib';

export const NODE_VERSION = '24.21.0';
// Official https://nodejs.org/dist/v24.21.0/SHASUMS256.txt, win-x64/node.exe.
export const NODE_SHA256 = 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32';
export const LINUX_NODE_ARCHIVE = `node-v${NODE_VERSION}-linux-x64.tar.gz`;
// Official https://nodejs.org/dist/v24.21.0/SHASUMS256.txt, node-v24.21.0-linux-x64.tar.gz.
export const LINUX_NODE_SHA256 = '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff';
export const PACKAGE_NAME = 'yanyang-government-windows-x64.zip';
export const PLATFORMS = Object.freeze(['windows-x64', 'linux-x64']);
const packageInfo = Object.freeze({
  'windows-x64': Object.freeze({ platform: 'windows-x64', label: 'Windows x64', filename: PACKAGE_NAME, contentType: 'application/zip', extension: '.zip' }),
  'linux-x64': Object.freeze({ platform: 'linux-x64', label: 'Linux x64', filename: 'yanyang-government-linux-x64.tar.gz', contentType: 'application/gzip', extension: '.tar.gz' })
});
export function getPackageInfo(platform = 'windows-x64') {
  if (!PLATFORMS.includes(platform)) throw new Error('不支持的部署平台。');
  return packageInfo[platform];
}
const rootFiles = ['server.mjs', 'package.json'];
const launchFiles = ['start.cmd', 'stop.cmd', 'start-lan.cmd'];
const linuxLaunchFiles = ['start.sh', 'stop.sh', 'start-lan.sh'];
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

async function exists(filename) {
  try { await lstat(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function verifyRuntime(filename, platform = 'windows-x64') {
  getPackageInfo(platform);
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('运行环境必须是本地普通文件。');
  const contents = await readFile(filename);
  const expected = platform === 'linux-x64' ? LINUX_NODE_SHA256 : NODE_SHA256;
  if (createHash('sha256').update(contents).digest('hex') !== expected) {
    throw new Error(`Node.js 运行环境 SHA-256 校验失败，请重新获取官方 ${getPackageInfo(platform).label} 运行环境。`);
  }
  return contents;
}

export async function verifyLinuxRuntime(filename) {
  return verifyRuntime(filename, 'linux-x64');
}

async function articleSnapshot(rootDir, supplied) {
  let articles = supplied;
  if (articles === undefined) {
    const stored = path.join(rootDir, 'data/articles.json');
    if (await exists(stored)) articles = JSON.parse(await readFile(stored, 'utf8'));
    else {
      const seeds = await import(pathToFileURL(path.join(rootDir, 'public/portal-data.js')).href);
      articles = seeds.articles.map((article) => ({ ...article, status: 'published', isSample: true, source: '晏阳联合政府（示例）' }));
    }
  }
  if (!Array.isArray(articles)) articles = articles?.articles;
  if (!Array.isArray(articles)) throw new Error('文章快照格式无效。');
  return Buffer.from(JSON.stringify({ version: 1, articles }, null, 2) + '\n');
}

async function siteContentSnapshot(rootDir, supplied) {
  let siteContent = supplied;
  if (siteContent === undefined) {
    const stored = path.join(rootDir, 'data/site-content.json');
    if (await exists(stored)) siteContent = JSON.parse(await readFile(stored, 'utf8'));
    else {
      const schema = await import(pathToFileURL(path.join(rootDir, 'public/site-content-schema.js')).href);
      siteContent = schema.defaultSiteContent;
    }
  }
  if (siteContent?.version !== 1 || !siteContent.values || typeof siteContent.values !== 'object' || Array.isArray(siteContent.values)) {
    throw new Error('网站区域内容快照格式无效。');
  }
  return Buffer.from(JSON.stringify({ version: 1, values: siteContent.values }, null, 2) + '\n');
}

async function* directoryFiles(rootDir, directory) {
  const entries = await readdir(path.join(rootDir, directory), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = directory + '/' + entry.name;
    if (entry.isSymbolicLink()) {
      if (!relative.startsWith('offline-translation/')) throw new Error(`部署资源不允许符号链接：${relative}`);
      const resolved = await realpath(path.join(rootDir, relative));
      if (!resolved.startsWith(rootDir + path.sep)) throw new Error(`部署资源符号链接越界：${relative}`);
      yield relative;
      continue;
    }
    if (entry.isDirectory()) yield* directoryFiles(rootDir, relative);
    else if (entry.isFile()) yield relative;
  }
}

async function* deploymentEntries(rootDir, articles, siteContent, includeRuntime) {
  // Both portable platforms serve the same exported Next pages as Pages. A
  // portable export can be repackaged offline using its existing public assets.
  const nextExport = await exists(path.join(rootDir, 'out/index.html'));
  const overlays = nextExport ? new Map([['public/index.html', 'out/index.html'], ['public/admin.html', 'out/admin/index.html'], ['public/_headers', 'out/_headers']]) : new Map();
  if (includeRuntime) {
    for (const [name, platform] of [['node.exe', 'windows-x64'], [LINUX_NODE_ARCHIVE, 'linux-x64']]) {
      const runtimeDir = await exists(path.join(rootDir, 'runtime', name)) ? 'runtime' : '.runtime';
      yield { name: 'runtime/' + name, contents: await verifyRuntime(path.join(rootDir, runtimeDir, name), platform) };
    }
    yield { name: 'runtime/NOTICE.txt', contents: Buffer.from(`Node.js v${NODE_VERSION}\nWindows x64 node.exe SHA-256: ${NODE_SHA256}\nLinux x64 ${LINUX_NODE_ARCHIVE} SHA-256: ${LINUX_NODE_SHA256}\nBoth official runtimes are included for offline cross-platform exports.\nLinux runtime requires x86_64 Linux with glibc >= 2.28.\nRuntime obtained from the Node.js official distribution.\nFull Node.js and bundled third-party licenses: ../deployment/LICENSE-node.txt.\n`) };
  }
  if (includeRuntime && await exists(path.join(rootDir, 'offline-translation'))) {
    for await (const name of directoryFiles(rootDir, 'offline-translation')) {
      if (!name.startsWith('offline-translation/runtime/')) continue;
      let contents = await readFile(path.join(rootDir, name));
      if (name.endsWith('.sh')) contents = Buffer.from(contents.toString('utf8').replace(/\r\n/g, '\n'));
      const target = name.startsWith('offline-translation/runtime/windows-x64/')
        ? name.replace('offline-translation/runtime/windows-x64/', 'runtime/translation/windows-x64/')
        : name.startsWith('offline-translation/runtime/linux-x64/')
          ? name.replace('offline-translation/runtime/linux-x64/', 'runtime/translation/linux-x64/')
          : name;
      yield { name: target, contents };
    }
  }
  for (const name of rootFiles) {
    const info = await lstat(path.join(rootDir, name));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`缺少部署文件：${name}`);
    yield { name, contents: await readFile(path.join(rootDir, name)) };
  }
  for (const name of ['scripts/build.mjs', 'scripts/package.mjs', 'scripts/setup-offline-translation.mjs']) {
    if (await exists(path.join(rootDir, name))) yield { name, contents: await readFile(path.join(rootDir, name)) };
  }
  // Explicit source directories only: never copy data/, artifacts/, downloads/, logs or account files.
  for (const directory of ['public', 'lib', 'deployment', 'offline-translation']) {
    if (!(await exists(path.join(rootDir, directory)))) continue;
    for await (const name of directoryFiles(rootDir, directory)) {
      if (includeRuntime && name.startsWith('offline-translation/runtime/')) continue;
      if (nextExport && name.startsWith('public/_next/')) continue;
      let contents = await readFile(path.join(rootDir, overlays.get(name) || name));
      if (name.endsWith('.sh')) contents = Buffer.from(contents.toString('utf8').replace(/\r\n/g, '\n'));
      yield { name, contents };
    }
  }
  if (nextExport) {
    for await (const name of directoryFiles(rootDir, 'out/_next/static')) {
      yield { name: 'public/' + name.slice(4), contents: await readFile(path.join(rootDir, name)) };
    }
  }
  for (const name of launchFiles) {
    const contents = await readFile(path.join(rootDir, 'deployment', name));
    yield { name, contents };
    yield { name: { 'start.cmd': '启动网站.cmd', 'stop.cmd': '停止网站.cmd', 'start-lan.cmd': '局域网启动.cmd' }[name], contents };
  }
  for (const name of linuxLaunchFiles) {
    yield { name, contents: Buffer.from((await readFile(path.join(rootDir, 'deployment', name), 'utf8')).replace(/\r\n/g, '\n')) };
  }
  yield { name: 'README.txt', contents: await readFile(path.join(rootDir, 'deployment/README.txt')) };
  yield { name: 'README-linux.txt', contents: await readFile(path.join(rootDir, 'deployment/README-linux.txt')) };
  yield { name: 'data/articles.json', contents: await articleSnapshot(rootDir, articles) };
  yield { name: 'data/site-content.json', contents: await siteContentSnapshot(rootDir, siteContent) };
}

export async function buildDeploymentDirectory({ rootDir, outputDir, articles, siteContent, includeRuntime = false }) {
  rootDir = path.resolve(rootDir);
  outputDir = path.resolve(outputDir);
  if (outputDir === rootDir || !outputDir.startsWith(rootDir + path.sep)) throw new Error('构建目录必须位于项目目录内部。');
  await mkdir(outputDir, { recursive: true });
  for await (const entry of deploymentEntries(rootDir, articles, siteContent, includeRuntime)) {
    const target = path.join(outputDir, entry.name);
    await mkdir(path.dirname(target), { recursive: true, mode: entry.name.startsWith('data/') ? 0o700 : 0o755 });
    const executable = entry.name.endsWith('.sh') || entry.name.startsWith('offline-translation/runtime/linux-x64/bin/') || entry.name.startsWith('runtime/translation/linux-x64/bin/');
    await writeFile(target, entry.contents, { mode: executable ? 0o755 : entry.name.startsWith('data/') ? 0o600 : 0o644 });
  }
  return outputDir;
}

async function writeZip(entries, temporary) {
  const output = await open(temporary, 'wx');
  const central = [];
  let offset = 0;
  let count = 0;
  try {
    for await (const { name, contents } of entries) {
      const filename = Buffer.from(name, 'utf8');
      const compressed = deflateRawSync(contents, { level: 6 });
      const crc = crc32(contents);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x800, 6);
      local.writeUInt16LE(8, 8);
      local.writeUInt16LE(0x5cc1, 12); // Valid DOS date: 2026-06-01.
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(contents.length, 22);
      local.writeUInt16LE(filename.length, 26);
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(20, 4);
      entry.writeUInt16LE(20, 6);
      entry.writeUInt16LE(0x800, 8);
      entry.writeUInt16LE(8, 10);
      entry.writeUInt16LE(0x5cc1, 14);
      entry.writeUInt32LE(crc, 16);
      entry.writeUInt32LE(compressed.length, 20);
      entry.writeUInt32LE(contents.length, 24);
      entry.writeUInt16LE(filename.length, 28);
      entry.writeUInt32LE(offset, 42);
      await output.writeFile(local);
      await output.writeFile(filename);
      await output.writeFile(compressed);
      central.push(entry, filename);
      offset += local.length + filename.length + compressed.length;
      count++;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(count, 8);
    end.writeUInt16LE(count, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    await output.writeFile(directory);
    await output.writeFile(end);
    await output.close();
  } catch (error) {
    await output.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function tarHeader(name, size, mode, directory = false) {
  const header = Buffer.alloc(512);
  let prefix = '';
  let filename = name;
  if (Buffer.byteLength(filename) > 100) {
    const slash = [];
    for (let index = 0; index < name.length; index++) if (name[index] === '/') slash.push(index);
    const split = slash.reverse().find(index => index < name.length - 1 && Buffer.byteLength(name.slice(0, index)) <= 155 && Buffer.byteLength(name.slice(index + 1)) <= 100);
    if (split === undefined) throw new Error(`部署文件路径过长，无法写入 tar：${name}`);
    prefix = name.slice(0, split);
    filename = name.slice(split + 1);
  }
  const octal = (value, offset, width) => {
    const digits = value.toString(8);
    if (digits.length >= width) throw new Error('部署文件超过 tar 格式限制。');
    header.write(digits.padStart(width - 1, '0') + '\0', offset, width, 'ascii');
  };
  header.write(filename, 0, 100, 'utf8');
  octal(mode, 100, 8);
  octal(0, 108, 8);
  octal(0, 116, 8);
  octal(size, 124, 12);
  octal(1780272000, 136, 12); // Reproducible timestamp: 2026-06-01 UTC.
  header.fill(32, 148, 156);
  header.write(directory ? '5' : '0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write(prefix, 345, 155, 'utf8');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}

async function* tarChunks(entries) {
  const directories = new Set();
  for await (const { name, contents } of entries) {
    const segments = name.split('/');
    for (let index = 1; index < segments.length; index++) {
      const directory = segments.slice(0, index).join('/') + '/';
      if (!directories.has(directory)) {
        directories.add(directory);
        yield tarHeader(directory, 0, directory === 'data/' ? 0o700 : 0o755, true);
      }
    }
    const mode = name.startsWith('data/') ? 0o600
      : name.endsWith('.sh') || name.startsWith('runtime/translation/linux-x64/bin/') ? 0o755
        : 0o644;
    yield tarHeader(name, contents.length, mode);
    yield contents;
    if (contents.length % 512) yield Buffer.alloc(512 - contents.length % 512);
  }
  yield Buffer.alloc(1024);
}

async function writeArchive(entries, platform, target) {
  const temporary = path.join(path.dirname(target), '.' + randomUUID() + getPackageInfo(platform).extension);
  try {
    if (platform === 'windows-x64') await writeZip(entries, temporary);
    else await pipeline(Readable.from(tarChunks(entries)), createGzip({ level: 6 }), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    await rename(temporary, target);
    return target;
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function buildDeploymentPackage({ rootDir, outputDir, articles, siteContent, platform = 'windows-x64' }) {
  const info = getPackageInfo(platform);
  rootDir = path.resolve(rootDir);
  outputDir = path.resolve(outputDir ?? path.join(rootDir, 'downloads'));
  await mkdir(outputDir, { recursive: true });
  return writeArchive(deploymentEntries(rootDir, articles, siteContent, true), platform, path.join(outputDir, info.filename));
}

export async function buildReleasePackages({ rootDir, outputDir, version, articles, siteContent }) {
  rootDir = path.resolve(rootDir);
  outputDir = path.resolve(outputDir ?? path.join(rootDir, 'downloads'));
  const metadata = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
  version ??= metadata.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version)) throw new Error('发布版本号格式无效。');
  const snapshot = [];
  for await (const entry of deploymentEntries(rootDir, articles, siteContent, true)) {
    snapshot.push(entry.name === 'package.json' ? { name: entry.name, contents: Buffer.from(JSON.stringify({ ...metadata, version }, null, 2) + '\n') } : entry);
  }
  await mkdir(outputDir, { recursive: true });
  const staging = path.join(outputDir, '.' + version + '-' + randomUUID());
  const targetDir = path.join(outputDir, version);
  const previousDir = path.join(outputDir, '.previous-' + randomUUID());
  const manifest = { version, createdAt: new Date().toISOString(), packages: [] };
  const aliases = [];
  let movedPrevious = false;
  let published = false;
  let committed = false;
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const platform of PLATFORMS) {
      const info = getPackageInfo(platform);
      const filename = `yanyang-government-${version}-${platform}${info.extension}`;
      const target = await writeArchive(snapshot, platform, path.join(staging, filename));
      const contents = await readFile(target);
      manifest.packages.push({ platform, filename, bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') });
      const alias = path.join(outputDir, info.filename);
      if (await exists(alias)) {
        const info = await lstat(alias);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('固定下载链接必须是本地普通文件。');
      }
      const temporary = path.join(outputDir, '.' + randomUUID() + '.download');
      const backup = path.join(outputDir, '.previous-' + randomUUID() + '.download');
      aliases.push({ alias, temporary, backup, movedPrevious: false, replaced: false });
      await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
    }
    await writeFile(path.join(staging, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
    if (await exists(targetDir)) {
      await rename(targetDir, previousDir);
      movedPrevious = true;
    }
    await rename(staging, targetDir);
    published = true;
    for (const entry of aliases) {
      if (await exists(entry.alias)) {
        const info = await lstat(entry.alias);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('固定下载链接必须是本地普通文件。');
        await rename(entry.alias, entry.backup);
        entry.movedPrevious = true;
      }
      await rename(entry.temporary, entry.alias);
      entry.replaced = true;
    }
    committed = true;
    return manifest;
  } catch (error) {
    const rollbackErrors = [];
    for (const entry of [...aliases].reverse()) {
      try {
        if (entry.replaced) await rm(entry.alias, { force: true });
        if (entry.movedPrevious) await rename(entry.backup, entry.alias);
      } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    try {
      if (published) await rm(targetDir, { recursive: true, force: true });
      if (movedPrevious) await rename(previousDir, targetDir);
    } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], '发布失败，部分旧文件回滚失败；已保留 .previous 备份以便恢复。');
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    for (const entry of aliases) {
      await rm(entry.temporary, { force: true }).catch(() => {});
      if (committed && entry.movedPrevious) await rm(entry.backup, { force: true }).catch(() => {});
    }
    if (committed && movedPrevious) await rm(previousDir, { recursive: true, force: true }).catch(() => {});
  }
}
