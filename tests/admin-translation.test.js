import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslationSettingsEditor } from '../public/admin-translation.js';

const saved = { provider: 'llm', endpoint: 'https://model.example/v1/chat/completions', model: 'my-model', fallback: false, hasApiKey: true, maskedKey: '••••••••', credentialSource: 'server' };
function harness({ deferLoad = false, deferSave = false } = {}) {
  const nodes = new Map(), calls = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id: id.replace(/^#/, ''), value: '', checked: false, hidden: false, disabled: false, textContent: '', dataset: {}, options: [], children: [], listeners: {}, classList: { toggle() {} }, appendChild(child) { this.children.push(child); this.options.push(child); }, replaceChildren(...children) { this.children = children; this.options = [...children]; }, addEventListener(type, handler) { this.listeners[type] = handler; } });
    return nodes.get(id);
  };
  let finishLoad, finishSave;
  const document = { querySelector: node, querySelectorAll: () => [] };
  const api = async (url, options = {}) => {
    calls.push({ url, ...options });
    if (!options.method && deferLoad) await new Promise(resolve => { finishLoad = resolve; });
    if (options.method === 'PUT' && deferSave) await new Promise(resolve => { finishSave = resolve; });
    if (url.endsWith('/test')) return { ok: true, message: '连接成功', preview: '<b>test</b>' };
    if (url.endsWith('/discover')) return { supported: true, models: ['qwen-plus', 'deepseek-chat'], selectedModel: 'deepseek-chat', message: '已识别 2 个可用模型。' };
    return { settings: saved };
  };
  document.createElement = name => ({ tagName: name.toUpperCase(), value: '', textContent: '' });
  const controller = createTranslationSettingsEditor({ document, api, onSaved: async () => {}, onBusyChange() {} });
  const event = (targetId = '') => ({ target: targetId ? node(targetId) : undefined, preventDefault() {} });
  return { controller, node, calls, change: (id, type = 'input', targetId = id) => node(id).listeners[type]?.(event(targetId)), finishLoad: () => finishLoad?.(), finishSave: () => finishSave?.() };
}
test('settings editor shows a masked saved key, sends no retained key, tests only saved config', async () => {
  const ui = harness();
  await ui.controller.load();
  assert.equal(ui.node('#translation-api-key').value, '');
  assert.match(ui.node('#translation-key-status').textContent, /••••/);
  ui.node('#translation-model').value = 'updated-model';
  ui.change('#translation-form');
  assert.equal(ui.controller.dirty, true);
  assert.equal(ui.node('#translation-test').disabled, true);
  await ui.change('#translation-form', 'submit');
  const put = ui.calls.find(call => call.method === 'PUT');
  assert.equal(put.data.apiKey, '');
  assert.equal(put.data.model, 'updated-model');
  assert.equal(ui.controller.dirty, false);
  await ui.change('#translation-test', 'click');
  assert.equal(ui.calls.at(-1).url, '/api/admin/translation/test');
  assert.deepEqual(ui.calls.at(-1).data, {});
  assert.equal(ui.node('#translation-test-preview').textContent, '<b>test</b>');
});
test('logout clears typed keys and ignores delayed config and save responses', async () => {
  for (const deferSave of [false, true]) {
    const ui = harness({ deferLoad: !deferSave, deferSave });
    let pending;
    if (deferSave) {
      await ui.controller.load();
      ui.node('#translation-api-key').value = 'typed-private-secret';
      ui.change('#translation-form');
      pending = ui.change('#translation-form', 'submit');
    } else pending = ui.controller.load();
    ui.controller.clear();
    ui.finishLoad(); ui.finishSave();
    await pending;
    assert.equal(ui.node('#translation-api-key').value, '');
    assert.equal(ui.node('#translation-endpoint').value, '');
    assert.equal(ui.node('#translation-key-status').textContent, '');
  }
});

test('model discovery fills the recommended model and keeps the key out of the request', async () => {
  const ui = harness();
  await ui.controller.load();
  await ui.change('#translation-discover', 'click');
  const call = ui.calls.at(-1);
  assert.equal(call.url, '/api/admin/translation/discover');
  assert.deepEqual(call.data, {});
  assert.equal(ui.node('#translation-model').value, 'deepseek-chat');
  assert.deepEqual(ui.node('#translation-model-choice').options.map(option => option.value), ['', 'qwen-plus', 'deepseek-chat']);
  assert.equal(ui.node('#translation-model-choice').value, 'deepseek-chat');
  assert.match(ui.node('#translation-discover-status').textContent, /识别/);
  assert.ok(!JSON.stringify(call).includes('typed-private-secret'));
});

test('selecting a discovered model updates the editable model name and saved setting', async () => {
  const ui = harness();
  await ui.controller.load();
  await ui.change('#translation-discover', 'click');
  ui.node('#translation-model-choice').value = 'qwen-plus';
  ui.change('#translation-form', 'change', '#translation-model-choice');
  assert.equal(ui.node('#translation-model').value, 'qwen-plus');
  assert.equal(ui.node('#translation-save').disabled, false);
  await ui.change('#translation-form', 'submit');
  assert.equal(ui.calls.find(call => call.method === 'PUT').data.model, 'qwen-plus');
});

test('logging out clears discovered model choices', async () => {
  const ui = harness();
  await ui.controller.load();
  await ui.change('#translation-discover', 'click');
  ui.controller.clear();
  assert.deepEqual(ui.node('#translation-model-choice').options.map(option => option.value), ['']);
  assert.equal(ui.node('#translation-model-choice').disabled, true);
});
