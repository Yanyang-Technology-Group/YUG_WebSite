import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverTranslationModels } from '../lib/model-discovery.mjs';

test('discovers compatible chat models from the derived models endpoint', async () => {
  let request;
  const result = await discoverTranslationModels({
    endpoint: 'https://model.example/v1/chat/completions',
    apiKey: 'private-model-key',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'deepseek-chat' }, { id: 'qwen-plus' }, { id: 3, owned_by: 4 }] }) };
    },
  });
  assert.equal(request.url, 'https://model.example/v1/models');
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.headers.Authorization, 'Bearer private-model-key');
  assert.deepEqual(result.models, ['deepseek-chat', 'qwen-plus']);
  assert.equal(result.selectedModel, 'deepseek-chat');
  assert.ok(!JSON.stringify(result).includes('private-model-key'));
});

test('returns a clear unsupported result for non-model translation services', async () => {
  let called = false;
  const result = await discoverTranslationModels({
    provider: 'deepl',
    endpoint: 'https://api-free.deepl.com/v2/translate',
    apiKey: 'private-deepl-key',
    fetchImpl: async () => { called = true; throw new Error('must not call'); },
  });
  assert.equal(called, false);
  assert.equal(result.supported, false);
  assert.match(result.message, /模型列表|手动/);
});

test('rejects malformed model responses without exposing the key', async () => {
  await assert.rejects(
    discoverTranslationModels({
      endpoint: 'https://model.example/v1/chat/completions',
      apiKey: 'private-model-key',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 3 }] }) }),
    }),
    error => error?.translationCode === 'invalid_model_list' && !String(error.message).includes('private-model-key'),
  );
});
