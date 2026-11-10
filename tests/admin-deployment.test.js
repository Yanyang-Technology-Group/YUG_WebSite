import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function workspace(role) {
  const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  const source = (await readFile(new URL('../public/admin.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const nodes = new Map();
  const makeNode = () => ({ value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, open: false, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, setAttribute() {}, removeAttribute() {}, insertAdjacentHTML() {}, reset() {}, focus() {}, close() {} });
  const node = selector => {
    if (selector.startsWith('#') && !ids.has(selector.slice(1))) return null;
    if (!nodes.has(selector)) nodes.set(selector, makeNode());
    return nodes.get(selector);
  };
  const navigation = [...html.matchAll(/<button[^>]*data-view="([^"]+)"[^>]*>/g)].map(match => ({ ...makeNode(), dataset: { view: match[1] } }));
  const requestsLabel = makeNode();
  const document = {
    querySelector: node,
    querySelectorAll: selector => selector === '[data-view]' ? navigation : selector === '[data-requests-label]' ? [requestsLabel] : [],
    addEventListener() {}
  };
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    const value = url === '/api/admin/session' ? { authenticated: true, role, username: 'test', userId: 'test', csrfToken: 'test' } : { articles: [] };
    return { ok: true, json: async () => value };
  };
  const createWebsiteContentEditor = () => ({ dirty: false, loadPublic: async () => {}, load: async () => {}, clear() {}, discard() {} });
  const createAdminManagement = () => ({ clear() {}, loadRequests() {}, handleClick() {} });
  const context = vm.createContext({ document, fetch, createWebsiteContentEditor, createAdminManagement, window: { addEventListener() {}, scrollTo() {} }, Intl, Date, setTimeout: () => 1, clearTimeout() {} });
  await vm.runInContext(source, context);
  return { node, navigation, requestsLabel, calls, run: code => vm.runInContext(code, context) };
}

for (const role of ['admin', 'senioradmin', 'superadmin']) test(`${role} initializes and clears the workspace without a deployment or backup page`, async () => {
  // Missing HTML elements return null so stale initialization or session-reset
  // references fail at the actual browser-controller boundary.
  const site = await workspace(role);
  assert.equal(site.node('#workspace').hidden, false);
  assert.equal(site.node('#auth-view').hidden, true);
  assert.equal(site.navigation.some(button => button.dataset.view === 'deployment'), false);
  for (const id of ['deployment-view', 'download-package', 'download-linux-package', 'export-backup', 'choose-backup', 'backup-file', 'backup-error', 'package-status']) assert.equal(site.node('#' + id), null, id);
  assert.equal(site.requestsLabel.textContent, role === 'admin' ? '我的申请' : '内容审批');
  site.run("showView('deployment')");
  assert.equal(site.run('currentView'), 'welcome');
  assert.equal(site.node('#welcome-view').hidden, false);
  assert.equal(site.calls.some(url => /\/api\/admin\/(deployment|export|import)/.test(url)), false);
  site.run('clearWorkspace(); setSession(null)');
  assert.equal(site.node('#workspace').hidden, true);
});
