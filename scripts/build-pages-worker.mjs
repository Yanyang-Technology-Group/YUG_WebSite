import { spawnSync } from 'node:child_process';
import { readFile, writeFile, stat, mkdtemp, readdir, rm } from 'node:fs/promises';
import { transform } from 'esbuild';
import os from 'node:os';
import path from 'node:path';

// Include the API in out/ so dashboard uploads and Git/Wrangler use the same backend.
const root = process.cwd();
const config = await readFile(path.join(root, 'wrangler.toml'), 'utf8');
const dateLine = config.split(String.fromCharCode(10)).find(line => line.startsWith('compatibility_date'));
const date = dateLine?.split('"')[1];
if (!date) throw new Error('wrangler.toml 缺少 compatibility_date。');
const staging = await mkdtemp(path.join(os.tmpdir(), 'yanyang-worker-'));
try {
  // --outfile emits a multipart upload envelope, not a JavaScript source file.
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'pages', 'functions', 'build', 'functions', '--outdir', staging, '--output-routes-path', 'out/_routes.json', '--compatibility-date', date, '--compatibility-flags', 'nodejs_compat'], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Pages 后台编译失败，不能发布仅包含静态页面的产物。');
  const files = await readdir(staging);
  if (files.length !== 1 || files[0] !== 'index.js') throw new Error('后台包含未打包模块，不能作为单文件上传。');
  // Pages' hosted uploader still re-bundles with Wrangler 3. Lower class static
  // blocks first: its second pass can lose `this` in __name(this, ...) blocks.
  const compiled = await readFile(path.join(staging, 'index.js'), 'utf8');
  const compatible = await transform(compiled, { target: 'es2021', format: 'esm', sourcefile: '_worker.js' });
  await writeFile(path.join(root, 'out/_worker.js'), compatible.code);
  const syntax = spawnSync(process.execPath, ['--check', 'out/_worker.js'], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (syntax.status !== 0) throw new Error('Pages 后台产物不是有效的 JavaScript 模块。');
  const startup = spawnSync(process.execPath, ['out/_worker.js'], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (startup.status !== 0) throw new Error('Pages 后台模块初始化失败。');
} finally { await rm(staging, { recursive: true, force: true }); }
if (!(await stat(path.join(root, 'out/_worker.js'))).size) throw new Error('Pages 后台产物为空。');
const routes = JSON.parse(await readFile(path.join(root, 'out/_routes.json'), 'utf8'));
if (routes.version !== 1 || !routes.include?.includes('/api/*')) throw new Error('Pages API 路由未正确生成。');
console.log('out/ 已包含 _worker.js 后台和 _routes.json，可整体上传 Cloudflare Pages。');
