import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Run the shipped browser controller. Only browser primitives and its HTTP
// boundary are replaced; saving, API handling and list rendering stay real.
async function workspace({ failRefresh = false, pendingSave = false, pendingRefresh = false, initialArticles = [] } = {}) {
  const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  const source = (await readFile(new URL('../public/admin.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const nodes = [];
  const byId = new Map();
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const attributes = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(item => [item[1], item[2]]));
    const classes = new Set((attributes.class || '').split(/\s+/).filter(Boolean));
    const node = {
      tagName: match[1].toUpperCase(), id: attributes.id || '',
      value: attributes.value || '', textContent: '', innerHTML: '',
      hidden: /\bhidden\b/.test(match[2]), disabled: false, open: false,
      dataset: Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()), value])),
      scopes: ['post-form', 'editor-view'].filter(id => {
        const start = html.indexOf(`id="${id}"`);
        const end = html.indexOf(id === 'post-form' ? '</form>' : '</section>', start);
        return match.index > start && match.index < end;
      }),
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), toggle(value, selected) { const next = selected ?? !classes.has(value); if (next) classes.add(value); else classes.delete(value); return next; } },
      listeners: {}, addEventListener(event, handler) { this.listeners[event] = handler; }, setAttribute(key, value) { attributes[key] = String(value); }, removeAttribute(key) { delete attributes[key]; },
      insertAdjacentHTML(_, value) { this.innerHTML += value; }, focus() {},
      showModal() { this.open = true; }, close() { this.open = false; },
      // Native form reset changes fields; a submit button keeps its value.
      reset() { for (const field of nodes) if (field.scopes.includes(this.id) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName)) field.value = ''; },
      matches(selector) {
        const parts = selector.trim().split(/\s+/);
        if (parts.length > 1 && !this.scopes.includes(parts[0].replace(/^#/, ''))) return false;
        const last = parts.at(-1);
        if (last.startsWith('#')) return this.id === last.slice(1);
        if (last.startsWith('.')) return classes.has(last.slice(1));
        const attribute = /^\[([\w-]+)(?:="?([^"\]]+)"?)?\]$/.exec(last);
        if (attribute) return Object.hasOwn(attributes, attribute[1]) && (attribute[2] === undefined || attributes[attribute[1]] === attribute[2]);
        return this.tagName === last.toUpperCase();
      }
    };
    nodes.push(node);
    if (node.id) byId.set(node.id, node);
  }
  const document = {
    querySelector: selector => byId.get(selector.slice(1)) || nodes.find(node => node.matches(selector)),
    querySelectorAll: selector => nodes.filter(node => selector.split(',').some(part => node.matches(part))),
    addEventListener() {}
  };
  const requests = [];
  let stored = structuredClone(initialArticles);
  let rejectNextRefresh = false;
  let finishSave;
  let finishRefresh;
  let markRefreshStarted;
  const refreshStarted = new Promise(resolve => { markRefreshStarted = resolve; });
  let articleLoads = 0;
  const authenticated = { authenticated: true, username: 'test_admin', csrfToken: 'test-token' };
  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const input = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, method, input });
    let result;
    if (url === '/api/admin/session') result = authenticated;
    else if (url === '/api/admin/articles' && method === 'GET') {
      articleLoads++;
      if (pendingRefresh && articleLoads > 1) { markRefreshStarted(); await new Promise(resolve => { finishRefresh = resolve; }); }
      if (rejectNextRefresh) { rejectNextRefresh = false; throw new Error('The saved article list cannot be fetched.'); }
      result = { articles: structuredClone(stored) };
    } else if (method === 'POST' || method === 'PUT') {
      if (pendingSave) await new Promise(resolve => { finishSave = resolve; });
      const article = { ...input, id: method === 'POST' ? 'article-created-1' : url.split('/').at(-1), isSample: false, createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' };
      stored = [article];
      rejectNextRefresh = failRefresh;
      result = { article };
    } else throw new Error(`Unexpected HTTP request: ${method} ${url}`);
    return { ok: true, status: 200, json: async () => structuredClone(result) };
  };
  // Website editing has its own regression suite; the article controller keeps
  // running unchanged through a module boundary stub here.
  const createWebsiteContentEditor = () => ({ dirty: false, loadPublic: async () => {}, load: async () => {}, clear() {}, discard() {} });
  // Approval/account UI is tested independently; keep this boundary focused on
  // the real article save, HTTP result and navigation controller.
  const createAdminManagement = () => ({ clear() {}, loadRequests: async () => {}, loadUsers: async () => {}, loadLogs: async () => {}, loadFeedback: async () => {}, handleClick() {} });
  const context = vm.createContext({ createWebsiteContentEditor, createAdminManagement, document, fetch, window: { addEventListener() {}, scrollTo() {} }, Intl, Date, setTimeout: () => 1, clearTimeout() {} });
  await vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run('openEditor()');
  byId.get('post-title').value = '新的政务文章';
  byId.get('post-body').value = '等待发布的文章正文。';
  run('dirty = true');
  return { run, byId, nodes, requests, refreshStarted, finishRefresh: () => finishRefresh?.(), finish: () => finishSave?.(), get stored() { return stored; } };
}

test('a saved new article remains editable without a duplicate POST if the following list refresh fails', async () => {
  const site = await workspace({ failRefresh: true });
  await site.run("saveArticle('draft')");
  assert.equal(site.byId.get('editor-error').textContent, '', 'a failed list refresh must not report a successful save as failed');
  assert.equal(site.byId.get('posts-view').hidden, false);
  assert.match(site.byId.get('post-table').innerHTML, /新的政务文章/, 'the saved article must remain present in the local list');
  assert.equal(site.byId.get('count-all').textContent, 1);
  site.run("openEditor('article-created-1')");
  site.byId.get('post-title').value = '再次编辑同一篇文章';
  await site.run("saveArticle('draft')");
  assert.equal(site.requests.filter(request => request.method === 'POST').length, 1, 'retrying after a successful creation must not create a second article');
  assert.ok(site.requests.some(request => request.method === 'PUT' && request.url === '/api/admin/articles/article-created-1'));
  assert.equal(site.stored[0].title, '再次编辑同一篇文章');
});

test('pending article saves lock editing and navigation until the submitted content is saved', async () => {
  const site = await workspace({ pendingSave: true });
  const saving = site.run("saveArticle('published')");
  try {
    for (const id of ['post-title', 'post-body', 'post-summary', 'post-category', 'post-date', 'post-source', 'back-posts', 'preview-post', 'logout']) {
      assert.equal(site.byId.get(id).disabled, true, `${id} must not accept changes or navigation while saving`);
    }
    for (const navigation of site.nodes.filter(node => Object.hasOwn(node.dataset, 'view'))) assert.equal(navigation.disabled, true, 'workspace navigation must wait for the save');
  } finally { site.finish(); await saving; }
  assert.equal(site.stored[0].body[0], '等待发布的文章正文。');
  assert.equal(site.byId.get('posts-view').hidden, false);
  assert.equal(site.byId.get('post-body').disabled, false, 'editing must be restored after the save');
  assert.equal(site.byId.get('logout').disabled, false);
});

test('an article refresh after a successful save cannot display success in a later logged-out session', async () => {
  const site = await workspace({ pendingRefresh: true });
  const saving = site.run("saveArticle('published')");
  await site.refreshStarted;
  site.run('clearWorkspace(); setSession(null)');
  site.finishRefresh(); await saving;
  assert.equal(site.run('articles.length'), 0);
  assert.equal(site.byId.get('workspace').hidden, true);
  assert.doesNotMatch(site.byId.get('admin-toast').textContent, /已发布/);
});

// Interpreting a datetime-local value in the device timezone would change the
// actual publication instant for an administrator outside China.
test('scheduled publication converts Beijing input to UTC and displays its publication time', async () => {
  const site = await workspace();
  const field = site.byId.get('post-scheduled-at');
  assert.ok(field, 'the shipped form must include a scheduled publication field');
  field.value = '2099-10-11T09:30';
  await site.run("saveArticle('scheduled')");
  const mutation = site.requests.find(request => request.method === 'POST');
  assert.equal(mutation.input.status, 'scheduled');
  assert.equal(mutation.input.scheduledAt, '2099-10-11T01:30:00.000Z');
  assert.match(site.byId.get('post-table').innerHTML, /待定时发布/);
  assert.match(site.byId.get('post-table').innerHTML, /09:30/);
  assert.match(site.byId.get('post-table').innerHTML, /北京时间/);
  assert.equal(site.byId.get('count-scheduled').textContent, 1);
  assert.doesNotMatch(site.byId.get('admin-toast').textContent, /文章已发布/);
});

test('the publish submit action respects the selected scheduled publication mode', async () => {
  const site = await workspace();
  assert.ok(site.byId.get('post-publish-mode'), 'the shipped form must include publication mode');
  site.byId.get('post-publish-mode').value = 'scheduled';
  site.byId.get('post-scheduled-at').value = '2099-10-11T09:30';
  await site.byId.get('post-form').listeners.submit({ preventDefault() {}, submitter: site.byId.get('publish-post') });
  assert.equal(site.requests.find(request => request.method === 'POST').input.status, 'scheduled');
});

test('missing, invalid and elapsed scheduled times prevent article mutation', async () => {
  for (const input of ['', '2000-01-01T08:00', '2099-02-31T09:30']) {
    const site = await workspace();
    assert.ok(site.byId.get('post-scheduled-at'));
    site.byId.get('post-scheduled-at').value = input;
    await site.run("saveArticle('scheduled')");
    assert.equal(site.requests.some(request => request.method === 'POST'), false, input);
    assert.match(site.byId.get('editor-error').textContent, /时间/);
  }
});

test('a scheduled article can be rescheduled, published immediately or returned to draft', async () => {
  const scheduled = { id: 'scheduled-1', title: '定时文章', category: '政务要闻', date: '2099-10-11', source: '政府', summary: '', body: ['文章正文'], status: 'scheduled', scheduledAt: '2099-10-11T01:30:00.000Z' };
  for (const status of ['scheduled', 'published', 'draft']) {
    const site = await workspace({ initialArticles: [scheduled] });
    site.run("openEditor('scheduled-1')");
    assert.ok(site.byId.get('post-scheduled-at'));
    assert.equal(site.byId.get('post-publish-mode').value, 'scheduled');
    assert.equal(site.byId.get('post-scheduled-at').value, '2099-10-11T09:30');
    site.byId.get('post-scheduled-at').value = '2099-10-12T09:30';
    await site.run(`saveArticle('${status}')`);
    const mutation = site.requests.find(request => request.method === 'PUT');
    assert.equal(mutation.input.status, status);
    if (status === 'scheduled') assert.equal(mutation.input.scheduledAt, '2099-10-12T01:30:00.000Z');
    else assert.equal(Object.hasOwn(mutation.input, 'scheduledAt'), false, 'draft/immediate publication must cancel the schedule');
  }
});
