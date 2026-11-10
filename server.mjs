import { createPortalHandler } from './lib/http-handler.mjs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, stat, realpath } from 'node:fs/promises';
import { createStore } from './lib/store.mjs';
import { HttpError } from './lib/articles.mjs';
import { createOfflineTranslator } from './lib/offline-translator.mjs';
import { createConfiguredTranslator } from './lib/configured-translator.mjs';
import { createArticleTranslationQueue } from './lib/article-translations.mjs';
import { createSessions } from './lib/auth.mjs';
import { feedbackRateLimit } from './lib/feedback.mjs';

const defaultRoot = path.dirname(fileURLToPath(import.meta.url));
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const publicFiles = new Set(['/index.html', '/styles.css', '/app.js', '/portal-data.js', '/portal-utils.js', '/portal-i18n.js', '/admin.html', '/admin.js', '/admin.css', '/admin-translation.js', '/site-content-schema.js', '/admin-site-content.js', '/admin-management.js', ...['zh-TW', 'en', 'ko', 'ja', 'de', 'fr', 'ru', 'es', 'ar', 'pt', 'it'].map(code => `/locales/${code}.json`)]);
export async function createPortalServer({ rootDir = defaultRoot, dataDir = path.join(rootDir, 'data'), deploymentDir = path.join(rootDir, 'downloads'), now = Date.now, schedulerIntervalMs = 1000, translationEngine, translationFetch } = {}) {
  rootDir = path.resolve(rootDir);
  const publicDir = path.join(rootDir, 'public');
  const realPublicDir = await realpath(publicDir);
  let contentSecurityPolicy;
  try { contentSecurityPolicy = (await readFile(path.join(publicDir, '_headers'), 'utf8')).match(/Content-Security-Policy: (.+)/)?.[1]; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const store = await createStore({ rootDir, dataDir: path.resolve(dataDir), now });
  const configuredTranslator = createConfiguredTranslator({ store, offline: createOfflineTranslator({ rootDir }), fetchImpl: translationFetch });
  const translations = createArticleTranslationQueue({ store, engine: translationEngine || configuredTranslator, now });
  const sessions = createSessions();
  const limitFeedback = feedbackRateLimit(now);
  let publishing;
  function publishDue() {
    if (publishing) return publishing;
    if (!store.hasDueArticles(now())) return Promise.resolve();
    publishing = store.publishScheduled(now()).then(result => { translations.kick(); return result; }).finally(() => { publishing = undefined; });
    return publishing;
  }
  await publishDue();
  const handler = createPortalHandler({ store, sessions, translations, configuredTranslator, publishDue, now, limitFeedback, translationFetch, contentSecurityPolicy,
    serveStatic: async (request, response, pathname) => {
      if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, '该页面不支持此请求方式。');
      const resource = pathname === '/' ? '/index.html' : pathname === '/admin' || pathname === '/admin/' ? '/admin.html' : pathname;
      if (resource.includes('\\') || resource.includes('\0') || resource.split('/').some(part => part === '..' || part === '.' || part.startsWith('.'))) throw new HttpError(404, '页面未找到。');
      if (!publicFiles.has(resource) && !resource.startsWith('/assets/') && !resource.startsWith('/_next/static/')) throw new HttpError(404, '页面未找到。');
      const filename = path.resolve(publicDir, '.' + resource);
      const resolved = await realpath(filename);
      if (!resolved.startsWith(realPublicDir + path.sep) || !(await stat(resolved)).isFile()) throw new HttpError(404, '页面未找到。');
      const content = await readFile(resolved);
      response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': content.length });
      response.end(request.method === 'HEAD' ? undefined : content);

    },
    exportDeployment: async ({ request, response, url, store, requireManager, audit }) => {
          const { buildDeploymentPackage, getPackageInfo } = await import(pathToFileURL(path.join(rootDir, 'deployment/package.mjs')).href);
          const platform = url.searchParams.get('platform') ?? 'windows-x64';
          let info;
          try { info = getPackageInfo(platform); } catch { throw new HttpError(400, '不支持的部署平台，请选择 Windows x64 或 Linux x64。'); }
          const target = { type: 'deployment', id: info.platform, title: `${info.label} 部署包` };
          audit('deployment.export', requireManager(), target);
          const archive = await buildDeploymentPackage({ rootDir, outputDir: deploymentDir, platform, articles: store.getArticles(), siteContent: store.getSiteContent() });
          const content = await readFile(archive);
          requireManager();
          await store.appendLog(() => audit('deployment.export', requireManager(), target), requireManager);
          requireManager();
          response.writeHead(200, { 'Content-Type': info.contentType, 'Content-Disposition': `attachment; filename="${info.filename}"; filename*=UTF-8''${encodeURIComponent(info.filename)}`, 'Content-Length': content.length, 'Cache-Control': 'no-store' });
          response.end(content);

    }
  });
  const server = http.createServer(handler);
  let timer;
  server.on('listening', () => { translations.kick(); timer = setInterval(() => { publishDue().catch(error => console.error('定时发布失败，将重试：', error.message)); }, schedulerIntervalMs); timer.unref(); });
  server.on('close', () => { clearInterval(timer); translations.close(); });
  const closeServer = server.close.bind(server);
  server.close = function (callback) {
    clearInterval(timer); translations.close();
    return closeServer(error => { store.whenIdle().then(() => callback?.(error), drainError => callback?.(drainError)); });
  };
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = Number(process.env.PORT || 5173);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1 至 65535 的整数。');
    const host = process.env.HOST || '127.0.0.1';
    const server = await createPortalServer();
    server.on('error', error => { console.error(`服务器启动失败：${error.message}`); process.exitCode = 1; });
    server.listen(port, host, () => console.log(`晏阳联合政府网站：http://${host}:${port}，管理模式：/admin`));
  } catch (error) { console.error(`服务器启动失败：${error.message}`); process.exitCode = 1; }
}
