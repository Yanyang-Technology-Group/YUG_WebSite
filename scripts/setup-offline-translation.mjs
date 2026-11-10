import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { access, readFile, stat } from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'offline-translation/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const failures = [];
for (const [relative, expected] of Object.entries(manifest.files)) {
  const filename = path.join(root, 'offline-translation', relative);
  try {
    const contents = await readFile(filename);
    const actual = createHash('sha256').update(contents).digest('hex');
    if (contents.length !== expected.bytes || actual !== expected.sha256) failures.push(`${relative}: SHA-256 或大小不匹配`);
  } catch { failures.push(`${relative}: 文件缺失`); }
}
for (const [platform, executable] of [['windows-x64', 'runtime/windows-x64/python.exe'], ['linux-x64', 'runtime/linux-x64/bin/python3']]) {
  try {
    await access(path.join(root, 'offline-translation', executable));
    if ((await stat(path.join(root, 'offline-translation', executable))).size < 1024) failures.push(`${platform}: Python 运行环境文件无效`);
  } catch { failures.push(`${platform}: Python 运行环境缺失`); }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`离线翻译资源校验通过：${Object.keys(manifest.files).length} 个模型文件，Windows/Linux Python 运行环境均已就绪。`);
}
