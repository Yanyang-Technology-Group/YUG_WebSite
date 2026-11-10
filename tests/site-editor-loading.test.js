import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebsiteContentEditor } from '../public/admin-site-content.js';
import { defaultSiteContent } from '../public/site-content-schema.js';

function harness(t) {
  const previousDocument = globalThis.document;
  const nodes = new Map();
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', textContent: '', innerHTML: '', disabled: false,
      listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
    });
    return nodes.get(selector);
  }
  globalThis.document = {
    querySelector: node,
    querySelectorAll: () => [],
  };
  t.after(() => { globalThis.document = previousDocument; });
  const requests = [];
  const changes = [];
  const editor = createWebsiteContentEditor({
    api(url) {
      return new Promise((resolve, reject) => { requests.push({ url, resolve, reject }); });
    },
    toast() {}, openModal() {}, closeModal() {}, onBusyChange() {},
    onContentChanged(content) { changes.push(structuredClone(content)); },
  });
  const content = name => {
    const value = structuredClone(defaultSiteContent);
    value.values['site.name'] = name;
    return value;
  };
  const inputName = value => node('#site-fields').listeners.input({ target: { dataset: { contentKey: 'site.name' }, value } });
  return { editor, requests, changes, node, content, inputName };
}

test('concurrent website content loads share a request and cannot overwrite new edits', async t => {
  const { editor, requests, changes, content, inputName } = harness(t);
  const first = editor.load();
  const second = editor.load();
  assert.equal(requests.length, 1, 'reopening a loading view must reuse the pending request');
  requests[0].resolve({ content: content('服务器名称') });
  await first;
  inputName('尚未保存的名称');
  await second;
  assert.equal(editor.dirty, true);
  assert.equal(changes.length, 1);
});

test('clearing the editor invalidates an earlier load response across sessions', async t => {
  const { editor, requests, changes, content, inputName } = harness(t);
  const oldLoad = editor.load();
  editor.clear();
  const newLoad = editor.load();
  assert.equal(requests.length, 2);
  requests[1].resolve({ content: content('新会话名称') });
  await newLoad;
  inputName('新会话未保存内容');
  requests[0].resolve({ content: content('旧会话名称') });
  await oldLoad;
  assert.equal(changes.length, 1, 'a stale response must not publish old session content');
  assert.equal(changes[0].values['site.name'], '新会话名称');
  assert.equal(editor.dirty, true, 'stale responses must preserve the current session draft');
});

test('reloading saved website content disables edits until the fresh response arrives', async t => {
  const { editor, requests, node, content, inputName } = harness(t);
  const initial = editor.load();
  requests[0].resolve({ content: content('已保存名称') });
  await initial;
  const reloading = node('#site-retry').listeners.click();
  assert.equal(requests.length, 2);
  assert.equal(node('#site-save').disabled, true, 'a reload must prevent saving the previous snapshot');
  assert.match(node('#site-fields').innerHTML, /data-content-key="site\.name"[^>]*\bdisabled\b/, 'existing inputs must be disabled during reload');
  inputName('重新加载时的输入');
  assert.equal(editor.dirty, false, 'reload must not accept edits that the response would discard');
  requests[1].resolve({ content: content('重新加载名称') });
  await reloading;
  await Promise.resolve();
  assert.equal(node('#site-save').disabled, false);
  assert.equal(editor.dirty, false);
});
