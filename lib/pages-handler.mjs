import { Buffer } from 'node:buffer';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createD1Store } from './d1-store.mjs';
import { createPortalHandler } from './http-handler.mjs';
import { createSessions, hashPagesPassword } from './auth.mjs';
import { feedbackRateLimit } from './feedback.mjs';
import { createConfiguredTranslator } from './configured-translator.mjs';
import { HttpError, translationLanguages, validateStoredArticles } from './articles.mjs';
import { validateSiteContent } from './site-content.mjs';
import { runTranslationStep } from './pages-translations.mjs';

const offline = { available: async () => false, close() {} };
const digest = text => createHash('sha256').update(text).digest();
function secureEqual(left, right) { return typeof left === 'string' && typeof right === 'string' && timingSafeEqual(digest(left), digest(right)); }
export async function handlePages(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };
  const fail = (status, message) => new Response(JSON.stringify({ message }), { status, headers });
  if (!env.DB) return fail(503, '请绑定 D1 数据库 DB，并执行数据库迁移。');
  if (Number(request.headers.get('content-length') || 0) > 20 * 1024 * 1024) return fail(413, '提交内容超过 20 MiB。');
  const chunks = []; let bytes = 0;
  if (request.body) {
    const reader = request.body.getReader();
    while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 20 * 1024 * 1024) { await reader.cancel(); return fail(413, '提交内容超过 20 MiB。'); } chunks.push(Buffer.from(value)); }
  }
  const url = new URL(request.url);
  const db = env.DB.withSession ? env.DB.withSession('first-primary') : env.DB;
  for (let attempt = 0; attempt < 4; attempt++) {
    let translator;
    try {
      let store = await createD1Store(db);
      if (!store.state.initialized && env.ASSETS) {
        const seedResponse = await env.ASSETS.fetch(new Request(new URL('/portal-seed.json', url.origin)));
        if (seedResponse.ok) {
          const seed = await seedResponse.json();
          if (seed.version !== 1 || !Array.isArray(seed.articles) || !seed.siteContent) throw new HttpError(503, '公开内容快照格式无效。');
          const articles = validateStoredArticles(seed.articles);
          if (articles.some(article => article.status !== 'published')) throw new HttpError(503, '公开内容快照包含未发布文章。');
          const rows = [...articles.map((article, position) => ['articles', article.id, position, article]), ['siteContent', '0', 0, validateSiteContent(seed.siteContent)], ['initialized', '0', 0, true]];
          if (rows.length > 900 || rows.some(row => Buffer.byteLength(JSON.stringify(row[3])) > 1500000)) throw new HttpError(413, '初始内容超出导入上限，请减少快照内容后分批导入。');
          const uninitialized = "NOT EXISTS (SELECT 1 FROM portal_records WHERE namespace = 'initialized')";
          await db.batch([db.prepare('UPDATE portal_revision SET version = version + 1 WHERE id = 1 AND ' + uninitialized), ...rows.map(([namespace, id, position, value]) => db.prepare('INSERT OR IGNORE INTO portal_records(namespace, id, position, payload) SELECT ?, ?, ?, ? WHERE ' + uninitialized).bind(namespace, String(id), position, JSON.stringify(value)))]);
          store = await createD1Store(db);
        }
      }
      const sessionsMap = new Map(store.state.sessions.filter(([, session]) => session.expires > Date.now()));
      const failures = new Map(store.state.failures.filter(([, item]) => item.until > Date.now()));
      const limits = new Map(store.state.feedbackLimits.filter(([, item]) => item.until > Date.now()));
      const sessions = createSessions({ sessions: sessionsMap, failures, secure: url.protocol === 'https:' });
      const originalFrom = sessions.from;
      sessions.from = req => {
        const current = originalFrom(req);
        const user = current && store.getUser(current.userId);
        if (!user || user.disabled || current.fingerprint !== digest(user.passwordHash + ':' + user.role).toString('hex')) return undefined;
        return current;
      };
      const originalCreate = sessions.create;
      sessions.create = (username, response, userId) => {
        const session = originalCreate(username, response, userId);
        sessionsMap.get(session.id).fingerprint = digest(store.getUser(userId).passwordHash + ':' + store.getUser(userId).role).toString('hex');
        return session;
      };
      const req = { url: url.pathname + url.search, method: request.method, headers: Object.fromEntries(request.headers), socket: { encrypted: url.protocol === 'https:', remoteAddress: request.headers.get('cf-connecting-ip') || 'local-preview' }, async *[Symbol.asyncIterator]() { yield* chunks; } };
      req.headers.host = url.host;
      const authenticatedBefore = sessions.from(req);
      let status = 200, body = '', ended = false;
      const responseHeaders = new Headers(headers);
      const response = { headersSent: false, setHeader(name, value) { responseHeaders.set(name, String(value)); }, writeHead(code, values) { status = code; for (const [name, value] of Object.entries(values || {})) responseHeaders.set(name, String(value)); this.headersSent = true; }, end(value) { if (!ended) body = value || ''; ended = true; } };
      translator = createConfiguredTranslator({ store, offline, environment: env });
      const translations = {
        kick() {}, retry() {}, reset() {},
        async status() { return { ...await translator.status(), runtime: 'cloudflare-pages', offlineAvailable: false, languages: translationLanguages, activeArticleId: store.state.jobs.find(([, job]) => job.expires > Date.now())?.[0] || null }; }
      };
      const publishDue = () => store.publishScheduled(Date.now());
      await publishDue();
      const handler = createPortalHandler({ store, sessions, configuredTranslator: translator, translations, publishDue, environment: env, limitFeedback: feedbackRateLimit(Date.now, limits), setupPolicy: req => req.method === 'GET' ? Boolean(env.SETUP_TOKEN && env.SETUP_TOKEN.length >= 32) : Boolean(env.SETUP_TOKEN && env.SETUP_TOKEN.length >= 32 && secureEqual(req.headers['x-setup-token'], env.SETUP_TOKEN)), serveStatic: () => { throw new HttpError(404, '接口不存在。'); }, runtime: 'cloudflare-pages', passwordHasher: hashPagesPassword });
      await handler(req, response);
      const surviving = originalFrom(req);
      if (authenticatedBefore && surviving?.id === authenticatedBefore.id && sessionsMap.has(surviving.id)) {
        const user = store.getUser(surviving.userId);
        if (user) sessionsMap.get(surviving.id).fingerprint = digest(user.passwordHash + ':' + user.role).toString('hex');
      }
      store.state.sessions = [...sessionsMap]; store.state.failures = [...failures]; store.state.feedbackLimits = [...limits];
      await store.flush();
      translator.close();
      context.waitUntil(runTranslationStep(env).catch(error => console.error('Pages 翻译任务失败：', error.status || 'runtime')));
      return new Response(request.method === 'HEAD' ? null : body, { status, headers: responseHeaders });
    } catch (error) {
      translator?.close();
      if (error.status === 409 && attempt < 3) continue;
      if (!error.status) console.error('Pages API 失败：', error.message);
      return fail(error.status || 503, error.status ? error.message : '数据服务暂不可用，请确认 D1 迁移和绑定已完成。');
    }
  }
}
