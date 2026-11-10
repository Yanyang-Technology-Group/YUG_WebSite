import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

for (const role of ['superadmin', 'senioradmin']) test(`${role} logging back into the same account keeps an unsaved website draft after a save returns 401`, async () => {
  const source = (await readFile(new URL('../public/admin.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const nodes = new Map();
  const navigation = ['posts', 'site-content', 'account'].map(view => ({ dataset: { view }, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {}, disabled: false }));
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, insertAdjacentHTML() {}, reset() {}, focus() {} });
    return nodes.get(selector);
  };
  const document = { querySelector: node, querySelectorAll: selector => selector === '[data-view]' ? navigation : [], addEventListener() {} };
  let authenticated = true;
  const account = { authenticated: true, username: 'same_admin', role, csrfToken: 'test-token' };
  const fetch = async url => {
    const unauthorized = url === '/api/admin/site-content';
    const result = unauthorized ? { message: '请先登录管理模式。' } : url === '/api/admin/session' ? authenticated ? account : { authenticated: false } : { articles: [] };
    return { ok: !unauthorized, status: unauthorized ? 401 : 200, json: async () => structuredClone(result) };
  };
  // The website draft controller has its own tests. This boundary checks the
  // actual login/expiry/navigation controller does not discard that draft.
  let clears = 0;
  const editor = { dirty: false, clear() { clears++; this.dirty = false; }, loadPublic: async () => {}, load: async () => {}, discard() { this.dirty = false; } };
  const createAdminManagement = () => ({ clear() {}, loadRequests: async () => {}, loadUsers: async () => {}, handleClick() {} });
  const context = vm.createContext({ createWebsiteContentEditor: () => editor, createAdminManagement, document, fetch, window: { addEventListener() {}, scrollTo() {} }, Intl, Date, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(source, context);
  await vm.runInContext('connect()', context);
  const clearCount = clears;
  editor.dirty = true;
  vm.runInContext("currentView = 'site-content'", context);
  authenticated = false;
  await assert.rejects(vm.runInContext("api('/api/admin/site-content', { method: 'PUT', data: {} })", context), /请先登录/);
  assert.equal(editor.dirty, true, 'an expired save must keep the website draft');
  authenticated = true;
  await vm.runInContext('connect()', context);
  assert.equal(clears, clearCount, 'returning to the same account must not clear unsaved website content');
  assert.equal(editor.dirty, true);
  assert.equal(node('#site-content-view').hidden, false, 'login should return to the retained website draft');
  await vm.runInContext('enterWorkspace({ animate: true })', context);
  assert.notEqual(node('#welcome-transition').open, true, 'draft recovery must bypass the full-screen intro');
  assert.match(node('#admin-toast').textContent, /保留/);
});
