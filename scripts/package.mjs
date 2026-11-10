import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir, copyFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { NODE_VERSION, NODE_SHA256, LINUX_NODE_ARCHIVE, LINUX_NODE_SHA256, verifyRuntime, buildReleasePackages } from '../deployment/package.mjs';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const runtimeDir = path.join(rootDir, '.runtime');
const distribution = `https://nodejs.org/dist/v${NODE_VERSION}/`;
let officialHashes;

async function getOfficialHashes() {
  if (officialHashes !== undefined) return officialHashes;
  const response = await fetch(distribution + 'SHASUMS256.txt');
  if (!response.ok) throw new Error(`获取官方校验文件失败：${response.status}`);
  officialHashes = await response.text();
  for (const [name, expected] of [['win-x64/node.exe', NODE_SHA256], [LINUX_NODE_ARCHIVE, LINUX_NODE_SHA256]]) {
    const hash = officialHashes.split(/\r?\n/).find(line => line.endsWith('  ' + name))?.split(/\s+/)[0];
    if (hash !== expected) throw new Error(`官方 ${name} 校验值与固定版本不一致。`);
  }
  return officialHashes;
}

await mkdir(runtimeDir, { recursive: true });
for (const [filename, platform, remotePath] of [['node.exe', 'windows-x64', 'win-x64/node.exe'], [LINUX_NODE_ARCHIVE, 'linux-x64', LINUX_NODE_ARCHIVE]]) {
  let verified = false;
  // A portable deployment can publish a new pair completely offline.
  for (const directory of ['runtime', '.runtime']) {
    try {
      await verifyRuntime(path.join(rootDir, directory, filename), platform);
      verified = true;
      break;
    } catch { /* Try the other local runtime source before downloading. */ }
  }
  if (verified) continue;
  await getOfficialHashes();
  const temporary = path.join(runtimeDir, '.' + randomUUID() + '.download');
  try {
    let reused = false;
    if (platform === 'windows-x64' && process.platform === 'win32' && process.arch === 'x64') {
      try { await verifyRuntime(process.execPath); await copyFile(process.execPath, temporary); reused = true; } catch { /* Fetch the pinned official binary below. */ }
    }
    if (!reused) {
      const response = await fetch(distribution + remotePath);
      if (!response.ok) throw new Error(`下载官方 ${platform} 运行环境失败：${response.status}`);
      await writeFile(temporary, Buffer.from(await response.arrayBuffer()), { flag: 'wx', mode: 0o600 });
    }
    await verifyRuntime(temporary, platform);
    await rename(temporary, path.join(runtimeDir, filename));
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
if (officialHashes !== undefined) await writeFile(path.join(runtimeDir, 'SHASUMS256.txt'), officialHashes);

const manifest = await buildReleasePackages({ rootDir });
for (const file of manifest.packages) {
  const target = path.join(rootDir, 'downloads', manifest.version, file.filename);
  console.log(`${manifest.version} ${file.platform} 免安装部署包：${target}（${(file.bytes / 1024 / 1024).toFixed(1)} MB）`);
  console.log(`SHA-256: ${file.sha256}`);
}
console.log(`双平台发布清单：${path.join(rootDir, 'downloads', manifest.version, 'release.json')}`);
