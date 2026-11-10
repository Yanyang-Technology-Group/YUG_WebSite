import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, rm } from 'node:fs/promises';
import { buildDeploymentDirectory } from '../deployment/package.mjs';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const outputDir = path.join(rootDir, 'dist');
try {
  if ((await lstat(outputDir)).isSymbolicLink()) throw new Error('dist 不允许是符号链接。');
  await rm(outputDir, { recursive: true, force: true });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await buildDeploymentDirectory({ rootDir, outputDir });
console.log('构建完成：dist/（包含后台服务、文章与网站区域内容快照，不含管理员凭据；用 node dist/server.mjs 运行）');
