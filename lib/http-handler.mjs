import { HttpError, newArticle, validateArticle, validateScheduleTime, validateStoredArticles, sortArticles, articleTranslationFingerprint } from './articles.mjs';
import { resolveTranslationSettings, updateTranslationSettings, publicTranslationSettings } from './translation-settings.mjs';
import { discoverTranslationModels } from './model-discovery.mjs';
import { createSessions, hashPassword, isLoopback, validateCredentials, validatePassword, verifyPassword } from './auth.mjs';
import { validateSiteContent } from './site-content.mjs';
import { adminRoles, canManageSite, makeUser, publicUser } from './accounts.mjs';
import { articleFingerprint, contentRequest, validateReview } from './requests.mjs';
import { logPage } from './audit.mjs';
import { feedbackPage, feedbackRateLimit, newFeedback } from './feedback.mjs';
import { Buffer } from 'node:buffer';
function operationAction(pathname, method, role) {
  const actions = {
    'POST /api/admin/setup': 'account.setup', 'POST /api/admin/login': 'account.login', 'POST /api/admin/logout': 'account.logout',
    'POST /api/admin/users': 'account.create', 'PUT /api/admin/password': 'account.password', 'PUT /api/admin/site-content': 'site.update',
    'POST /api/admin/articles': role === 'admin' ? 'request.publish' : 'article.create',
    'GET /api/admin/export': 'backup.export', 'POST /api/admin/import': 'backup.import', 'GET /api/admin/deployment': 'deployment.export',
    'POST /api/feedback': 'feedback.submit'
    , 'PUT /api/admin/translation/settings': 'translation.configure', 'POST /api/admin/translation/test': 'translation.test', 'POST /api/admin/translation/discover': 'translation.discover'
  };
  const direct = actions[`${method} ${pathname}`];
  if (direct) return direct;
  if (/^\/api\/admin\/users\/[A-Za-z0-9_-]{1,80}$/.test(pathname)) return method === 'PUT' ? 'account.update' : method === 'DELETE' ? 'account.delete' : undefined;
  if (/^\/api\/admin\/articles\/[A-Za-z0-9_-]{1,80}$/.test(pathname)) return method === 'PUT' ? 'article.update' : method === 'DELETE' ? role === 'admin' ? 'request.delete' : 'article.delete' : undefined;
  if (method === 'POST' && /^\/api\/admin\/requests\/[A-Za-z0-9_-]{1,80}\/review$/.test(pathname)) return 'request.approve';
  if (method === 'POST' && /^\/api\/admin\/articles\/[A-Za-z0-9_-]{1,80}\/translate$/.test(pathname)) return 'article.translate_retry';
  if (method === 'PATCH' && /^\/api\/admin\/feedback\/[A-Za-z0-9_-]{1,80}$/.test(pathname)) return 'feedback.read';
}
function json(response, status, value, pretty = false) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value, null, pretty ? 2 : undefined) + (pretty ? '\n' : ''));
}
function checkWrite(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, '已拒绝来自其他网站的请求。');
  if (request.headers.origin) {
    let origin;
    try { origin = new URL(request.headers.origin); } catch { throw new HttpError(403, '请求来源无效。'); }
    const protocol = request.socket.encrypted ? 'https:' : 'http:';
    if (origin.protocol !== protocol || origin.host.toLowerCase() !== String(request.headers.host).toLowerCase() || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new HttpError(403, '已拒绝来自其他网站的请求。');
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw new HttpError(415, '请使用 application/json 提交数据。');
}
async function body(request, maxBytes = 20 * 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length <= maxBytes) chunks.push(chunk);
  }
  if (length > maxBytes) throw new HttpError(413, `提交内容不能超过 ${maxBytes / 1024 / 1024} MiB，请缩小文件后重试。`);
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch { throw new HttpError(400, 'JSON 数据格式不正确。'); }
}
export function createPortalHandler({ store, sessions, translations, configuredTranslator, publishDue, now = Date.now, limitFeedback = feedbackRateLimit(now), translationFetch, environment = process.env, serveStatic, exportDeployment, setupPolicy, runtime = 'node', passwordHasher = hashPassword, contentSecurityPolicy = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" }) {
  return async (request, response) => {
    let auditContext;
    function audit(action, actor, target = {}, message = '') {
      auditContext = { action, actor: actor ? { id: actor.id, username: actor.username, role: actor.role } : { id: '', username: '访客', role: 'anonymous' }, target, message };
      return auditContext;
    }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', contentSecurityPolicy);
    try {
      const url = new URL(request.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/api/')) {
        const method = request.method;
        const priorSession = sessions.from(request);
        const priorActor = priorSession && store.getUser(priorSession.userId);
        const action = operationAction(pathname, method, priorActor?.role);
        if (action) audit(action, priorActor);
        const writing = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
        if (writing) checkWrite(request);
        if (method === 'GET' && pathname === '/api/health') return json(response, 200, { ok: true, app: 'yanyang-government-portal', service: 'yanyang-government-portal', version: 1 });
        if (method === 'GET' && pathname === '/api/articles') { await publishDue(); return json(response, 200, { articles: sortArticles(store.getArticles().filter(article => article.status === 'published')) }); }
        if (method === 'GET' && pathname === '/api/site-content') return json(response, 200, { content: store.getSiteContent() });
        if (method === 'POST' && pathname === '/api/feedback') {
          audit('feedback.submit');
          limitFeedback(request.socket.remoteAddress, response);
          const feedback = newFeedback(await body(request, 16 * 1024), now());
          const event = audit('feedback.submit', undefined, { type: 'feedback', id: feedback.id, title: '访客意见反馈' });
          await store.updateFeedback(records => [...records, feedback], undefined, event);
          return json(response, 201, { feedback });
        }
        const session = sessions.from(request);
        const sessionUser = session && store.getUser(session.userId);
        const authenticated = !!sessionUser && !sessionUser.disabled;
        const users = store.getUsers();
        const setupAllowed = setupPolicy ? setupPolicy(request) : isLoopback(request.socket.remoteAddress);
        function authorize(role) {
          const activeSession = sessions.from(request);
          const current = activeSession && store.getUser(activeSession.userId);
          if (!current || current.disabled || activeSession.id !== session?.id) throw new HttpError(401, '登录已失效，请重新登录。');
          if (role && current.role !== role) throw new HttpError(403, '此操作需要超级管理员权限。');
          return current;
        }
        const requireSuper = () => authorize('superadmin');
        const requireManager = () => {
          const actor = authorize();
          if (!canManageSite(actor)) throw new HttpError(403, '此操作需要高级管理员或超级管理员权限。');
          return actor;
        };
        const sessionData = (created, user) => ({ authenticated: true, username: user.username, userId: user.id, role: user.role, csrfToken: created.csrfToken, runtime });
        if (method === 'GET' && pathname === '/api/admin/session') return json(response, 200, { authenticated, setupRequired: users.length === 0, setupAllowed, runtime, ...(authenticated ? sessionData(session, sessionUser) : {}) });
        if (method === 'POST' && pathname === '/api/admin/setup') {
          audit('account.setup');
          if (!setupAllowed) throw new HttpError(403, runtime === 'cloudflare-pages' ? '首次设置密钥无效，或未在 Pages 配置至少 32 位的 SETUP_TOKEN。' : '请在部署电脑本机打开管理模式，完成首次管理员设置。');
          const credentials = validateCredentials(await body(request));
          let user;
          await store.updateUsers(async current => {
            if (current.length) throw new HttpError(409, '管理员已设置，请直接登录。');
            user = await makeUser(credentials, 'superadmin', passwordHasher);
            return [user];
          }, undefined, () => audit('account.setup', user, { type: 'account', id: user.id, title: user.username }));
          const created = sessions.create(user.username, response, user.id);
          return json(response, 201, sessionData(created, user));
        }
        if (method === 'POST' && pathname === '/api/admin/login') {
          audit('account.login');
          const ip = request.socket.remoteAddress;
          sessions.checkAttempts(ip, response);
          const credentials = await body(request);
          if (!store.getUsers().length) throw new HttpError(409, '请先在部署电脑本机设置超级管理员。');
          const user = store.findUser(credentials.username);
          const verified = user && !user.disabled && await verifyPassword(user, credentials.password);
          const current = user && store.getUser(user.id);
          if (!verified || !current || current.disabled || current.passwordHash !== user.passwordHash) {
            sessions.failed(ip);
            throw new HttpError(401, '账号或密码不正确。');
          }
          let created;
          let latest;
          // Check credentials and create the session within the same write queue
          // as account resets, so a reset always invalidates earlier sessions.
          await store.appendLog(() => audit('account.login', latest, { type: 'account', id: latest.id, title: latest.username }), () => {
            latest = store.getUser(current.id);
            if (!latest || latest.disabled || latest.passwordHash !== current.passwordHash) throw new HttpError(401, '账号或密码不正确。');
          }, () => { sessions.succeeded(ip); created = sessions.create(latest.username, response, latest.id); });
          return json(response, 200, sessionData(created, latest));
        }
        if (!pathname.startsWith('/api/admin/')) throw new HttpError(404, '接口不存在。');
        if (!authenticated) throw new HttpError(401, '请先登录管理模式。');
        if (writing && request.headers['x-csrf-token'] !== session.csrfToken) throw new HttpError(403, '安全校验已失效，请刷新管理页面后重试。');
        if (method === 'POST' && pathname === '/api/admin/logout') {
          const actor = authorize();
          audit('account.logout', actor);
          await body(request);
          await store.appendLog(auditContext);
          sessions.logout(session, response);
          return json(response, 200, { ok: true });
        }
        if (method === 'GET' && pathname === '/api/admin/logs') {
          requireManager();
          return json(response, 200, logPage(store.getLogs(), url.searchParams));
        }
        if (method === 'GET' && pathname === '/api/admin/feedback') {
          authorize();
          return json(response, 200, feedbackPage(store.getFeedback(), url.searchParams));
        }
        const feedbackMatch = /^\/api\/admin\/feedback\/([A-Za-z0-9_-]{1,80})$/.exec(pathname);
        if (feedbackMatch && method === 'DELETE') throw new HttpError(403, '反馈记录不支持删除。');
        if (feedbackMatch && method === 'PATCH') {
          audit('feedback.read', authorize(), { type: 'feedback', id: feedbackMatch[1], title: '访客意见反馈' });
          const input = await body(request, 16 * 1024);
          if (Object.keys(input).length !== 1 || !['new', 'read'].includes(input.status)) throw new HttpError(400, '请选择已读或未读状态。');
          const guard = input.status === 'new' ? requireManager : authorize;
          audit(input.status === 'new' ? 'feedback.unread' : 'feedback.read', authorize(), { type: 'feedback', id: feedbackMatch[1], title: '访客意见反馈' });
          guard();
          let feedback;
          await store.updateFeedback(records => {
            const item = records.find(record => record.id === feedbackMatch[1]);
            if (!item) throw new HttpError(404, '反馈记录不存在。');
            const actor = guard();
            item.status = input.status;
            if (input.status === 'read') { item.readBy = { id: actor.id, username: actor.username }; item.readAt = new Date(now()).toISOString(); }
            else { delete item.readBy; delete item.readAt; }
            feedback = item;
            return records;
          }, guard, () => audit(input.status === 'new' ? 'feedback.unread' : 'feedback.read', guard(), { type: 'feedback', id: feedback.id, title: '访客意见反馈' }));
          return json(response, 200, { feedback });
        }
        if (pathname.startsWith('/api/admin/users')) requireManager();
        if (method === 'GET' && pathname === '/api/admin/users') return json(response, 200, { users: store.getUsers().map(publicUser) });
        if (method === 'POST' && pathname === '/api/admin/users') {
          audit('account.create', requireManager());
          const input = await body(request, 64 * 1024);
          const role = Object.hasOwn(input, 'role') ? input.role : 'admin';
          const guard = () => role === 'superadmin' ? requireSuper() : requireManager();
          guard();
          const user = await makeUser(validateCredentials(input), role, passwordHasher);
          await store.updateUsers(current => {
            if (current.some(item => item.username.toLowerCase() === user.username.toLowerCase())) throw new HttpError(409, '账号已存在。');
            return [...current, user];
          }, guard, () => audit('account.create', guard(), { type: 'account', id: user.id, title: user.username }));
          return json(response, 201, { user: publicUser(user) });
        }
        const userMatch = /^\/api\/admin\/users\/([A-Za-z0-9_-]{1,80})$/.exec(pathname);
        if (userMatch && ['PUT', 'DELETE'].includes(method)) {
          audit(method === 'PUT' ? 'account.update' : 'account.delete', requireManager(), { type: 'account', id: userMatch[1] });
          if (userMatch[1] === session.userId) throw new HttpError(409, '不能在账号管理中修改或删除自己的账号，请在账户设置中修改自己的密码。');
          let input;
          const guard = () => {
            const actor = requireManager();
            const target = store.getUser(userMatch[1]);
            if (!target) throw new HttpError(404, '账号不存在或已删除。');
            if (target.role === 'superadmin' || input && Object.hasOwn(input, 'role')) requireSuper();
            return actor;
          };
          guard();
          input = await body(request, 64 * 1024);
          guard();
          if (method === 'PUT') {
            if (!Object.keys(input).length || Object.keys(input).some(key => !['role', 'disabled', 'newPassword'].includes(key))) throw new HttpError(400, '账号更新字段不正确。');
            if (Object.hasOwn(input, 'role') && !adminRoles.includes(input.role)) throw new HttpError(400, '账号角色不正确。');
            if (input.disabled !== undefined && typeof input.disabled !== 'boolean') throw new HttpError(400, '账号启停状态不正确。');
            if (input.newPassword !== undefined) validatePassword(input.newPassword);
          }
          let updated, targetUser;
          await store.updateUsers(async current => {
            const index = current.findIndex(user => user.id === userMatch[1]);
            if (index < 0) throw new HttpError(404, '账号不存在或已删除。');
            targetUser = current[index];
            if (method === 'DELETE') current.splice(index, 1);
            else {
              updated = { ...current[index], ...(input.role === undefined ? {} : { role: input.role }), ...(input.disabled === undefined ? {} : { disabled: input.disabled }) };
              if (input.newPassword !== undefined) updated = { ...updated, ...await passwordHasher(updated.username, input.newPassword) };
              current[index] = updated;
            }
            if (!current.some(user => user.role === 'superadmin' && !user.disabled)) throw new HttpError(409, '至少需要保留一个启用的超级管理员。');
            return current;
          }, guard, () => audit(method === 'PUT' ? 'account.update' : 'account.delete', guard(), { type: 'account', id: targetUser.id, title: targetUser.username }));
          sessions.invalidateUser(userMatch[1]);
          return json(response, 200, method === 'DELETE' ? { ok: true } : { user: publicUser(updated) });
        }
        if (method === 'GET' && pathname === '/api/admin/requests') {
          const actor = authorize();
          return json(response, 200, { requests: store.getRequests().filter(item => canManageSite(actor) || item.requestedBy.id === actor.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)) });
        }
        const reviewMatch = /^\/api\/admin\/requests\/([A-Za-z0-9_-]{1,80})\/review$/.exec(pathname);
        if (reviewMatch && method === 'POST') {
          audit('request.approve', requireManager(), { type: 'request', id: reviewMatch[1] });
          const review = validateReview(await body(request, 64 * 1024));
          audit(review.decision === 'approve' ? 'request.approve' : 'request.reject', requireManager(), { type: 'request', id: reviewMatch[1] });
          let reviewed;
          await store.updateWorkflow(state => {
            const actor = requireManager();
            const item = state.requests.find(item => item.id === reviewMatch[1]);
            if (!item) throw new HttpError(404, '申请不存在。');
            if (item.status !== 'pending') throw new HttpError(409, '申请已经审批，请刷新列表。');
            if (review.decision === 'approve') {
              if (item.type === 'publish') {
                if (state.articles.some(article => article.id === item.article.id)) throw new HttpError(409, '申请对应的文章已经存在。');
                const approved = { ...item.article, updatedAt: new Date(now()).toISOString() };
                if (approved.status === 'scheduled' && Date.parse(approved.scheduledAt) <= now()) approved.status = 'published';
                state.articles.push(approved);
              } else {
                const index = state.articles.findIndex(article => article.id === item.articleId);
                if (index < 0 || articleFingerprint(state.articles[index]) !== item.articleHash) throw new HttpError(409, '目标文章已修改或删除，请驳回此申请后重新提交。');
                state.articles.splice(index, 1);
              }
            }
            Object.assign(item, { status: review.decision === 'approve' ? 'approved' : 'rejected', note: review.note, reviewedBy: { id: actor.id, username: actor.username }, reviewedAt: new Date(now()).toISOString() });
            reviewed = item;
            return state;
          }, requireManager, () => audit(review.decision === 'approve' ? 'request.approve' : 'request.reject', requireManager(), { type: 'request', id: reviewed.id, title: reviewed.article.title }, reviewed.type === 'publish' && review.decision === 'approve' && reviewed.article.status === 'scheduled' && Date.parse(reviewed.article.scheduledAt) <= now() ? '预定时间已过，批准后立即发布。' : ''));
          translations.kick();
          return json(response, 200, { request: reviewed });
        }
        if (method === 'GET' && pathname === '/api/admin/articles') {
          await publishDue();
          const actor = authorize();
          return json(response, 200, { articles: sortArticles(store.getArticles().filter(article => canManageSite(actor) || article.status === 'published')) });
        }
        if (pathname === '/api/admin/site-content') requireManager();
        if (method === 'GET' && pathname === '/api/admin/site-content') return json(response, 200, { content: store.getSiteContent() });
        if (method === 'PUT' && pathname === '/api/admin/site-content') {
          audit('site.update', requireManager(), { type: 'site', title: '网站区域名称与文字' });
          const content = validateSiteContent(await body(request, 2 * 1024 * 1024));
          await store.updateSiteContent(() => content, requireManager, () => audit('site.update', requireManager(), { type: 'site', title: '网站区域名称与文字' }));
          return json(response, 200, { content });
        }
        if (method === 'POST' && pathname === '/api/admin/articles') {
          const actor = authorize();
          audit(actor.role === 'admin' ? 'request.publish' : 'article.create', actor);
          const input = await body(request, 1024 * 1024);
          if (actor.role === 'admin') {
            if (!['published', 'scheduled'].includes(input.status)) throw new HttpError(400, '普通管理员只能提交立即或定时发布申请。');
            const application = contentRequest('publish', validateScheduleTime(newArticle(input), now()), actor);
            await store.updateRequests(requests => { validateScheduleTime(application.article, now()); return [...requests, application]; }, () => { if (authorize().role !== 'admin') throw new HttpError(409, '账号权限已变化，请刷新后重试。'); }, () => audit('request.publish', authorize(), { type: 'request', id: application.id, title: application.article.title }));
            return json(response, 202, { request: application });
          }
          const article = validateScheduleTime(newArticle(input), now());
          await store.updateArticles(articles => { validateScheduleTime(article, now()); return [...articles, article]; }, requireManager, () => audit('article.create', requireManager(), { type: 'article', id: article.id, title: article.title }));
          translations.kick();
          return json(response, 201, { article });
        }
        if (pathname === '/api/admin/translation/settings') {
          requireManager();
          const visibleSettings = () => publicTranslationSettings(resolveTranslationSettings(store.getTranslationSettings(), environment), store.getTranslationSettings() ? 'server' : 'environment');
          if (method === 'GET') return json(response, 200, { settings: visibleSettings() });
          if (method === 'PUT') {
            const input = await body(request, 16 * 1024);
            if (runtime === 'cloudflare-pages') {
              if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '翻译设置格式不正确。');
              if (input.provider === 'offline') throw new HttpError(400, 'Pages 不支持本机离线模型，请选择 AI 大模型或 DeepL。');
              input.fallback = false;
            }
            await store.updateTranslationSettings(current => updateTranslationSettings(input, resolveTranslationSettings(current, environment)), requireManager, () => audit('translation.configure', requireManager(), { type: 'translation', title: '翻译服务设置' }, '已更新翻译服务设置。'));
            translations.kick();
            return json(response, 200, { settings: visibleSettings() });
          }
        }
        if (method === 'POST' && pathname === '/api/admin/translation/test') {
          requireManager();
          if (Object.keys(await body(request, 1024)).length) throw new HttpError(400, '连接测试仅使用固定示例，不接受文章内容。');
          const result = await configuredTranslator.test();
          await store.appendLog(() => audit('translation.test', requireManager(), { type: 'translation', title: '翻译连接测试' }, '已完成固定示例的翻译测试。'), requireManager);
          return json(response, 200, result);
        }
        if (method === 'POST' && pathname === '/api/admin/translation/discover') {
          const actor = requireManager();
          if (Object.keys(await body(request, 1024)).length) throw new HttpError(400, '模型识别无需提交文章内容。');
          const result = await discoverTranslationModels({ ...resolveTranslationSettings(store.getTranslationSettings(), environment), fetchImpl: translationFetch });
          await store.appendLog(() => audit('translation.discover', actor, { type: 'translation', title: '自动识别翻译模型' }, '已完成翻译模型识别。'), requireManager);
          return json(response, 200, result);
        }
        if (method === 'GET' && pathname === '/api/admin/translation') {
          authorize();
          return json(response, 200, await translations.status());
        }
        const translateMatch = /^\/api\/admin\/articles\/([A-Za-z0-9_-]{1,80})\/translate$/.exec(pathname);
        if (method === 'POST' && translateMatch) {
          requireManager();
          const input = await body(request, 1024);
          if (Object.keys(input).length) throw new HttpError(400, '重新翻译无需提交文章内容。');
          if ((await translations.status()).activeArticleId === translateMatch[1] && store.getArticles().find(item => item.id === translateMatch[1])?.translation?.status === 'translating') throw new HttpError(409, '此文章正在翻译，请稍候。');
          let article;
          await store.updateArticles(articles => {
            article = articles.find(item => item.id === translateMatch[1]);
            if (!article) throw new HttpError(404, '文章不存在或已删除。');
            if (article.status !== 'published') throw new HttpError(409, '文章正式发布后才可翻译。');
            article.autoTranslate = true;
            const fingerprint = articleTranslationFingerprint(article);
            article.translation = { fingerprint, status: 'pending', locales: article.translation?.status === 'completed' ? {} : article.translation?.locales || {}, updatedAt: new Date(now()).toISOString() };
            return articles;
          }, requireManager, () => audit('article.translate_retry', requireManager(), { type: 'article', id: article.id, title: article.title }));
          translations.retry(article.id);
          return json(response, 202, { article });
        }
        const articleMatch = /^\/api\/admin\/articles\/([A-Za-z0-9_-]{1,80})$/.exec(pathname);
        if (articleMatch && ['PUT', 'DELETE'].includes(method)) {
          const actor = authorize();
          audit(method === 'PUT' ? 'article.update' : actor.role === 'admin' ? 'request.delete' : 'article.delete', actor, { type: 'article', id: articleMatch[1] });
          if (method === 'PUT') requireManager();
          const input = await body(request);
          if (method === 'DELETE' && actor.role === 'admin') {
            let application;
            await store.updateRequests((requests, articles) => {
              const article = articles.find(item => item.id === articleMatch[1] && item.status === 'published');
              if (!article) throw new HttpError(404, '已发布文章不存在或已删除。');
              if (requests.some(item => item.type === 'delete' && item.articleId === article.id && item.status === 'pending')) throw new HttpError(409, '此文章已有待审批的删除申请。');
              application = contentRequest('delete', article, authorize());
              return [...requests, application];
            }, () => { if (authorize().role !== 'admin') throw new HttpError(409, '账号权限已变化，请刷新后重试。'); }, () => audit('request.delete', authorize(), { type: 'request', id: application.id, title: application.article.title }));
            return json(response, 202, { request: application });
          }
          const fields = method === 'PUT' ? validateScheduleTime(validateArticle(input), now()) : undefined;
          let article, targetArticle;
          await store.updateArticles(articles => {
            const index = articles.findIndex(item => item.id === articleMatch[1]);
            if (index < 0) throw new HttpError(404, '文章不存在或已删除。');
            targetArticle = articles[index];
            if (method === 'DELETE') articles.splice(index, 1);
            else { validateScheduleTime(fields, now()); article = { ...articles[index], ...fields, updatedAt: new Date(now()).toISOString() }; if (!Object.hasOwn(fields, 'scheduledAt')) delete article.scheduledAt; if (article.autoTranslate !== true || article.translation?.fingerprint !== articleTranslationFingerprint(article)) delete article.translation; articles[index] = article; }
            return articles;
          }, requireManager, () => audit(method === 'PUT' ? 'article.update' : 'article.delete', requireManager(), { type: 'article', id: targetArticle.id, title: (article || targetArticle).title }));
          if (method === 'PUT' && article?.autoTranslate === true && article.status === 'published') translations.retry(article.id);
          translations.kick();
          return json(response, 200, method === 'PUT' ? { article } : { ok: true });
        }
        if (['/api/admin/export', '/api/admin/import', '/api/admin/deployment'].includes(pathname)) requireManager();
        if (method === 'GET' && pathname === '/api/admin/export') { await store.appendLog(() => audit('backup.export', requireManager()), requireManager); requireManager(); return json(response, 200, { version: 1, exportedAt: new Date(now()).toISOString(), articles: sortArticles(store.getArticles()), siteContent: store.getSiteContent() }, true); }
        if (method === 'POST' && pathname === '/api/admin/import') {
          audit('backup.import', requireManager());
          const backup = await body(request, 128 * 1024 * 1024);
          if (backup.version !== 1) throw new HttpError(400, '不支持的备份版本，请选择本系统导出的 JSON 备份。');
          const articles = validateStoredArticles(backup.articles);
          if (Object.hasOwn(backup, 'siteContent')) {
            const siteContent = validateSiteContent(backup.siteContent);
            await store.restoreContent(articles, siteContent, requireManager, () => audit('backup.import', requireManager()));
          } else await store.updateArticles(() => articles, requireManager, () => audit('backup.import', requireManager()));
          await publishDue().catch(error => console.error('恢复后的定时发布失败，将重试：', error.message));
          translations.reset();
          return json(response, 200, { ok: true, count: articles.length });
        }
        if (method === 'PUT' && pathname === '/api/admin/password') {
          audit('account.password', authorize());
          const input = await body(request);
          validatePassword(input.newPassword);
          await store.updateUsers(async current => {
            const user = current.find(user => user.id === session.userId);
            if (!(await verifyPassword(user, input.currentPassword))) throw new HttpError(401, '当前密码不正确。');
            Object.assign(user, await passwordHasher(user.username, input.newPassword));
            return current;
          }, authorize, () => audit('account.password', authorize(), { type: 'account', id: session.userId, title: authorize().username }));
          sessions.invalidateUser(session.userId, session.id);
          return json(response, 200, { ok: true });
        }
        if (method === 'GET' && pathname === '/api/admin/deployment') {
          audit('deployment.export', requireManager());
          if (!exportDeployment) throw new HttpError(501, 'Pages 环境不支持在线生成本机部署包，请在源码目录运行 npm run package。');
          return await exportDeployment({ request, response, url, store, requireManager, audit });
        }
        throw new HttpError(404, '接口不存在或请求方式不正确。');
      }
      return await serveStatic(request, response, pathname);
    } catch (error) {
      if (auditContext && !response.headersSent) {
        try { await store.appendLog({ ...auditContext, result: 'failure', message: `请求未完成（HTTP ${error.status || 500}）。` }); }
        catch (logError) { console.error('无法记录失败操作：', logError.message); }
      }
      if (response.headersSent) { response.end(); return; }
      const status = error.status || (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error instanceof URIError ? 404 : 500);
      if (status === 500) console.error('门户请求失败：', error);
      json(response, status, { message: error.status ? error.message : status === 404 ? '页面未找到。' : '操作失败，请查看服务器日志并重试。' });
    }
  };
}
