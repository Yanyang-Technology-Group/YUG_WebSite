import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const published = { id: 'published-1', title: '已发布文章', body: ['现有正文'], category: '政务要闻', status: 'published', date: '2026-10-10', source: '政府', summary: '', createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' };

async function workspace({ role = 'admin', deferArticles = false, deferPassword = false, articleFixture = [published], reducedMotion = false } = {}) {
  const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  const source = (await readFile(new URL('../public/admin.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const nodes = new Map();
  const navigation = [...html.matchAll(/<button[^>]*data-view="([^"]+)"[^>]*>/g)].map(match => ({ dataset: { view: match[1] }, hidden: false, disabled: false, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {} }));
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, open: false, dataset: {}, listeners: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener(event, handler) { this.listeners[event] = handler; }, insertAdjacentHTML() {}, reset() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; } });
    return nodes.get(selector);
  };
  const document = { querySelector: node, querySelectorAll: selector => selector.includes('[data-view]') ? navigation : [], addEventListener() {} };
  const calls = [];
  let pendingArticles;
  let pendingPassword;
  let sessionData = { authenticated: true, userId: 'ordinary-1', username: 'ordinary', role, csrfToken: 'csrf' };
  let storedArticles = structuredClone(articleFixture);
  let firstLoad = true;
  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const input = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method, input });
    let value;
    let status = 200;
    if (url === '/api/admin/session') value = sessionData;
    else if (url === '/api/admin/articles' && method === 'GET') {
      if (deferArticles && !firstLoad) await new Promise(resolve => { pendingArticles = resolve; });
      firstLoad = false;
      value = { articles: storedArticles };
    } else if (url === '/api/admin/articles' && method === 'POST') {
      if (role === 'admin') { value = { request: { id: 'request-1', type: 'publish', status: 'pending', requestedBy: { id: 'ordinary-1', username: 'ordinary' }, createdAt: '2026-10-10T00:00:00.000Z', article: { ...input, id: 'new-1' }, note: '' } }; status = 202; }
      else { const article = { ...published, ...input, id: 'new-1' }; storedArticles.push(article); value = { article }; }
    } else if (url === '/api/admin/articles/published-1' && method === 'PUT') { const article = { ...published, ...input }; storedArticles = storedArticles.map(item => item.id === article.id ? article : item); value = { article }; }
    else if (url === '/api/admin/articles/published-1' && method === 'DELETE') {
      if (role === 'admin') { value = { request: { id: 'delete-1' } }; status = 202; }
      else { storedArticles = storedArticles.filter(item => item.id !== 'published-1'); value = { ok: true }; }
    }
    else if (url === '/api/admin/site-content') value = { content: { values: {} } };
    else if (url === '/api/admin/password') { if (deferPassword) await new Promise(resolve => { pendingPassword = resolve; }); value = { ok: true }; }
    else if (url === '/api/admin/logout') value = { ok: true };
    else if (url.startsWith('/api/admin/feedback?') && method === 'GET') value = { feedback: [], total: 0, page: 1, pageSize: 25 };
    else if (url === '/api/admin/feedback/opinion-1' && method === 'PATCH') value = { feedback: { id: 'opinion-1', type: 'suggestion', title: '意见', content: '完整意见', createdAt: '2026-10-10T00:00:00.000Z', status: 'read', readBy: { id: 'ordinary-1', username: 'ordinary' }, readAt: '2026-10-10T01:00:00.000Z' } };
    else throw new Error(`Unexpected request ${method} ${url}`);
    return { ok: true, status, json: async () => structuredClone(value) };
  };
  let requestLoads = 0;
  const createAdminManagement = () => ({ clear() {}, loadRequests: async () => { requestLoads++; }, loadUsers: async () => {}, loadLogs: async () => {}, loadFeedback: async () => {}, handleClick() {}, get dirty() { return false; } });
  const createWebsiteContentEditor = () => ({ dirty: false, loadPublic: async () => {}, load: async () => {}, clear() {}, discard() {} });
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({ createWebsiteContentEditor, createAdminManagement, document, fetch, window: { addEventListener() {}, scrollTo() {}, matchMedia: () => ({ matches: reducedMotion }) }, Intl, Date, setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id) });
  await vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  return { node, navigation, calls, run, timers, get requestLoads() { return requestLoads; }, switchSession: value => { sessionData = value; }, finishArticles: () => pendingArticles?.(), finishPassword: () => pendingPassword?.() };
}

// Removing a role guard must expose a privileged view or issue a privileged HTTP mutation.
test('the welcome landing page shows the current identity and only permitted article inventory for all roles', async () => {
  const inventory = [published, { ...published, id: 'draft-1', status: 'draft' }, { ...published, id: 'scheduled-1', status: 'scheduled' }];
  for (const [role, label] of [['admin', '普通管理员'], ['senioradmin', '高级管理员'], ['superadmin', '超级管理员']]) {
    const site = await workspace({ role, articleFixture: inventory });
    assert.equal(site.run('currentView'), 'welcome', role);
    assert.equal(site.node('#welcome-view').hidden, false);
    assert.equal(site.node('#posts-view').hidden, true);
    assert.equal(site.node('#welcome-username').textContent, 'ordinary');
    assert.equal(site.node('#welcome-role').textContent, label);
    assert.equal(site.node('#welcome-published').textContent, 1);
    assert.equal(site.node('#welcome-draft-stat').hidden, role === 'admin');
    assert.equal(site.node('#welcome-scheduled-stat').hidden, role === 'admin');
    assert.equal(site.node('#welcome-draft').textContent, role === 'admin' ? 0 : 1);
    assert.equal(site.node('#welcome-scheduled').textContent, role === 'admin' ? 0 : 1);
    assert.equal(site.navigation.find(item => item.dataset.view === 'welcome')?.hidden, false);
    if (role === 'admin') assert.match(site.node('#welcome-description').textContent, /审批/);
  }
});

test('welcome shortcuts keep ordinary publication approval and unsaved-editor navigation protection', async () => {
  const site = await workspace();
  await site.node('#welcome-new-post').listeners.click();
  assert.equal(site.run('currentView'), 'editor');
  assert.equal(site.node('#approval-notice').hidden, false);
  site.node('#post-title').value = '尚未提交的文章';
  site.node('#post-body').value = '尚未提交的正文';
  site.run('dirty = true; leaveEditor(() => showView("welcome"))');
  assert.equal(site.run('currentView'), 'editor', 'returning home must not silently discard an unsaved article');
  assert.equal(site.node('#admin-dialog').open, true);
  await site.run('modalAction()');
  assert.equal(site.run('currentView'), 'welcome');
  assert.equal(site.calls.some(call => call.method === 'POST'), false);
  site.run('clearWorkspace(); setSession(null)');
  assert.equal(site.node('#welcome-username').textContent, '');
  assert.equal(site.node('#welcome-role').textContent, '');
  assert.equal(site.node('#workspace').hidden, true);
});

test('cinematic login can finish automatically, skip with its button or Escape, and cannot outlive its session', async () => {
  const site = await workspace();
  assert.equal(site.node('#welcome-transition').open, false, 'restoring an authenticated session must not replay the intro');
  site.node('#welcome-replay').listeners.click();
  assert.equal(site.node('#welcome-transition').open, true);
  assert.equal(site.node('#transition-username').textContent, 'ordinary');
  assert.equal(site.node('#transition-role').textContent, '普通管理员');
  const firstTimer = [...site.timers.values()].find(timer => timer.delay === 2400);
  assert.ok(firstTimer, 'the cinematic intro must finish without requiring a click');
  firstTimer.callback();
  assert.equal(site.node('#welcome-transition').open, false);
  assert.equal([...site.timers.values()].some(timer => timer.delay === 2400), false);
  await site.run('enterWorkspace({ animate: true })');
  const replacedTimer = [...site.timers.values()].find(timer => timer.delay === 2400);
  site.node('#welcome-replay').listeners.click();
  replacedTimer.callback();
  assert.equal(site.node('#welcome-transition').open, true, 'a superseded timer must not dismiss a newer intro');
  site.node('#transition-enter').listeners.click();
  assert.equal(site.node('#welcome-transition').open, false);
  await site.run('enterWorkspace({ animate: true })');
  let prevented = false;
  site.node('#welcome-transition').listeners.cancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(site.node('#welcome-transition').open, false);
  await site.run('enterWorkspace({ animate: true })');
  const staleTimer = [...site.timers.values()].find(timer => timer.delay === 2400);
  site.run('clearWorkspace(); setSession(null)');
  staleTimer.callback();
  assert.equal(site.node('#welcome-transition').open, false);
  assert.equal(site.node('#transition-username').textContent, '');
  assert.equal(site.node('#workspace').hidden, true);
});

test('reduced motion skips the full-screen intro and immediately exposes the welcome workspace', async () => {
  const site = await workspace({ reducedMotion: true });
  await site.run('enterWorkspace({ animate: true })');
  assert.equal(site.node('#welcome-transition').open, false);
  assert.equal([...site.timers.values()].some(timer => timer.delay === 2400), false);
  assert.equal(site.node('#welcome-view').hidden, false);
  site.node('#welcome-replay').listeners.click();
  assert.equal(site.node('#welcome-transition').open, false);
  assert.match(site.node('#admin-toast').textContent, /减少动态效果/);
});

test('ordinary administrators cannot navigate to privileged views or edit an existing article', async () => {
  const site = await workspace();
  for (const name of ['site-content', 'users', 'logs']) {
    assert.equal(site.navigation.find(item => item.dataset.view === name)?.hidden, true);
    site.run(`showView('${name}')`);
    assert.equal(site.node(`#${name}-view`).hidden, true);
  }
  site.run("openEditor('published-1')");
  assert.notEqual(site.run('currentView'), 'editor');
  assert.doesNotMatch(site.node('#post-table').innerHTML, /data-edit=/);
  assert.equal(site.node('#save-draft').hidden, true);
  assert.equal(site.node('#approval-notice').hidden, false);
  await assert.rejects(site.run("api('/api/admin/site-content', { method: 'PUT', data: {} })"), /权限/);
  assert.equal(site.calls.some(call => call.url === '/api/admin/site-content'), false);
});

// Keeping the old super-only branch would hide inventory and prevent a senior
// administrator from editing, saving a draft or deleting.
test('senior administrators have full workspace views and edit drafts and scheduled inventory directly', async () => {
  const site = await workspace({ role: 'senioradmin', articleFixture: [published, { ...published, id: 'draft-1', status: 'draft' }, { ...published, id: 'scheduled-1', status: 'scheduled', scheduledAt: '2099-10-11T01:30:00.000Z' }] });
  for (const name of ['site-content', 'users', 'logs']) {
    assert.equal(site.navigation.find(item => item.dataset.view === name)?.hidden, false, name);
    site.run(`showView('${name}')`);
    assert.equal(site.run('currentView'), name);
  }
  assert.equal(site.node('#account-role').textContent, '高级管理员');
  assert.match(site.node('#account-role-description').textContent, /等级.*超级管理员/);
  assert.equal(site.run('articles.length'), 3);
  assert.equal(site.node('#save-draft').hidden, false);
  assert.equal(site.node('#scheduled-stat').hidden, false);
  assert.equal(site.node('#approval-notice').hidden, true);
  assert.match(site.node('#post-table').innerHTML, /data-edit="draft-1"/);
  site.run("openEditor('published-1')");
  assert.equal(site.run('currentView'), 'editor');
  site.node('#post-title').value = '高级修改的草稿'; site.node('#post-body').value = '高级修改正文';
  await site.run("saveArticle('draft')");
  assert.equal(site.calls.find(call => call.method === 'PUT')?.input.status, 'draft');
  assert.match(site.node('#admin-toast').textContent, /草稿已保存/);
  await site.run("api('/api/admin/site-content', { method: 'PUT', data: { values: {} } })");
  assert.ok(site.calls.some(call => call.url === '/api/admin/site-content'));
  site.run("askDelete('published-1')");
  assert.doesNotMatch(site.node('#modal-content').innerHTML, /提交删除审批/);
  await site.run('modalAction()');
  assert.equal(site.run("articles.some(item => item.id === 'published-1')"), false);
  assert.match(site.node('#admin-toast').textContent, /已删除/);
});

test('senior administrators save scheduled publication directly', async () => {
  const site = await workspace({ role: 'senioradmin' });
  site.run('openEditor()');
  site.node('#post-title').value = '高级定时发布'; site.node('#post-body').value = '定时正文';
  site.node('#post-publish-mode').value = 'scheduled'; site.run('updatePublishSettings()');
  assert.equal(site.node('#publish-post').textContent, '保存定时发布');
  site.node('#post-scheduled-at').value = '2099-10-11T09:30';
  await site.run("saveArticle('scheduled')");
  assert.equal(site.calls.find(call => call.method === 'POST')?.input.scheduledAt, '2099-10-11T01:30:00.000Z');
  assert.match(site.node('#admin-toast').textContent, /定时发布已保存/);
  assert.doesNotMatch(site.node('#admin-toast').textContent, /审批/);
});

test('ordinary administrators submit scheduled requests without seeing scheduled inventory', async () => {
  const site = await workspace({ articleFixture: [published, { ...published, id: 'scheduled-1', status: 'scheduled', scheduledAt: '2099-10-11T01:30:00.000Z' }] });
  assert.equal(site.run('articles.length'), 1);
  assert.equal(site.node('#scheduled-stat').hidden, true);
  site.run('openEditor()');
  site.node('#post-title').value = '定时审批'; site.node('#post-body').value = '申请正文';
  site.node('#post-scheduled-at').value = '2099-10-11T09:30';
  await site.run("saveArticle('scheduled')");
  assert.equal(site.calls.find(call => call.method === 'POST')?.input.status, 'scheduled');
  assert.equal(site.calls.find(call => call.method === 'POST')?.input.scheduledAt, '2099-10-11T01:30:00.000Z');
  assert.match(site.node('#admin-toast').textContent, /审批/);
  assert.match(site.node('#admin-toast').textContent, /定时/);
  assert.doesNotMatch(site.node('#admin-toast').textContent, /已发布/);
  assert.equal(site.run('articles.length'), 1);
});

test('feedback is accessible to ordinary administrators but operation logs are blocked before HTTP', async () => {
  const site = await workspace();
  assert.equal(site.navigation.find(item => item.dataset.view === 'feedback')?.hidden, false);
  site.run("showView('feedback')");
  assert.equal(site.run('currentView'), 'feedback');
  await assert.rejects(site.run("api('/api/admin/logs?page=1&pageSize=25')"), /权限/);
  assert.equal(site.calls.some(call => call.url.startsWith('/api/admin/logs')), false);
  assert.equal((await site.run("api('/api/admin/feedback?page=1&pageSize=25')")).total, 0);
  assert.equal((await site.run("api('/api/admin/feedback/opinion-1', { method: 'PATCH', data: { status: 'read' } })")).feedback.status, 'read');
  await assert.rejects(site.run("api('/api/admin/feedback/opinion-1', { method: 'DELETE' })"), /权限/);
  assert.equal(site.calls.some(call => call.method === 'DELETE' && call.url.includes('/feedback/')), false);
});

test('clearing an account also clears the contents of its open management detail', async () => {
  const site = await workspace();
  site.run("openModal('意见反馈', '<h2 id=\"modal-title\">之前账号的完整意见</h2>')");
  assert.equal(site.node('#admin-dialog').open, true);
  site.run('clearWorkspace(); setSession(null)');
  assert.equal(site.node('#admin-dialog').open, false);
  assert.equal(site.node('#modal-content').innerHTML, '');
});

// Treating 202 like a persisted article would crash or falsely claim publication.
test('a new ordinary article becomes a pending request without claiming it is published', async () => {
  const site = await workspace();
  site.run('openEditor()');
  site.node('#post-title').value = '新发布申请';
  site.node('#post-body').value = '申请正文';
  site.run('dirty = true');
  await site.run("saveArticle('published')");
  assert.equal(site.node('#editor-error').textContent, '');
  assert.equal(site.run('dirty'), false);
  assert.match(site.node('#admin-toast').textContent, /审批/);
  assert.doesNotMatch(site.node('#admin-toast').textContent, /已发布/);
  assert.equal(site.run('articles.length'), 1);
  assert.equal(site.run('articles[0].id'), 'published-1');
  assert.equal(site.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(site.calls.find(call => call.method === 'POST').input.status, 'published');
  assert.ok(site.requestLoads > 0);
});

test('ordinary draft submissions are rejected before sending a mutation', async () => {
  const site = await workspace();
  site.run('openEditor()');
  site.node('#post-title').value = '不应保存草稿';
  site.node('#post-body').value = '正文';
  await site.run("saveArticle('draft')");
  assert.equal(site.calls.some(call => call.method === 'POST'), false);
  assert.match(site.node('#editor-error').textContent, /审批/);
});

test('ordinary deletion submits a request and retains the published article', async () => {
  const site = await workspace();
  site.run("askDelete('published-1')");
  assert.match(site.node('#modal-content').innerHTML, /审批/);
  await site.run('modalAction()');
  assert.equal(site.run('articles.length'), 1);
  assert.match(site.node('#admin-toast').textContent, /审批/);
  assert.doesNotMatch(site.node('#admin-toast').textContent, /已删除/);
  assert.ok(site.requestLoads > 0);
});

test('a late article response cannot repopulate the workspace after logout', async () => {
  const site = await workspace({ deferArticles: true });
  const loading = site.run('loadArticles()');
  site.run('clearWorkspace()');
  site.finishArticles();
  await loading.catch(error => { assert.equal(error.stale, true); });
  assert.equal(site.run('articles.length'), 0);
  assert.equal(site.node('#post-table').innerHTML, '');
});

test('a late password response cannot display an error or success after account state is cleared', async () => {
  const site = await workspace({ deferPassword: true });
  site.node('#new-password').value = 'replacement-password'; site.node('#new-password-confirm').value = 'replacement-password';
  const changing = site.node('#password-form').listeners.submit({ preventDefault() {}, submitter: site.node('#password-submit') });
  site.run('clearWorkspace(); setSession(null)'); site.finishPassword(); await changing;
  assert.equal(site.node('#password-error').textContent, '');
  assert.doesNotMatch(site.node('#admin-toast').textContent, /密码已更新/);
});

