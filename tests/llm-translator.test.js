import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlmTranslator } from '../lib/llm-translator.mjs';

const article = { title: '五环山东路交通管制通知', source: '晏阳联合政府', summary: '', body: ['2026年9月28日起禁止危化品运输车辆通行，应急抢险经审批除外。', '全线禁止机动车鸣笛。'] };
const options = { apiKey: 'secret-test-key', endpoint: 'https://model.example/v1/chat/completions', model: 'test-model' };
function reply(texts, reason = 'stop') { return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: reason, message: { content: JSON.stringify({ translations: texts }) } }] }) }; }
test('LLM translates ordered fields with strict JSON, preserves empty fields, and contains input as data', async () => {
  let calls = 0;
  const translator = createLlmTranslator({ ...options, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, options.endpoint);
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer secret-test-key');
    const request = JSON.parse(init.body);
    assert.equal(request.model, options.model);
    assert.equal(request.response_format.type, 'json_object');
    assert.match(request.messages[0].content, /Arabic/);
    assert.match(request.messages[0].content, /Yanyang/);
    assert.match(request.messages[0].content, /instructions/i);
    const input = JSON.parse(request.messages[1].content);
    assert.equal(input.texts.length, 4);
    return reply(input.texts.map(value => `translated: ${value}`));
  } });
  let result;
  await translator.translateLanguage(article, 'ar', content => { result = content; });
  assert.equal(calls, 1);
  assert.equal(result.summary, '');
  assert.equal(result.body.length, 2);
  assert.match(result.body[0], /2026/);
});
test('LLM rejects partial output, paragraph loss, empty translation, and upstream secret errors', async () => {
  for (const fetchImpl of [
    async () => reply(['only one']),
    async () => reply(['a', 'b', 'c', 'd'], 'length'),
    async () => reply(['', '', '', '']),
    async () => ({ ok: false, status: 401, json: async () => ({ error: options.apiKey }) }),
    async () => { throw new Error(options.apiKey); },
  ]) {
    let emitted = false;
    const translator = createLlmTranslator({ ...options, fetchImpl });
    await assert.rejects(translator.translateLanguage(article, 'en', () => { emitted = true; }), error => !error.message.includes(options.apiKey) && !!error.translationCode);
    assert.equal(emitted, false);
  }
});
test('LLM chunks long articles and rejoins the original paragraph boundaries', async () => {
  let calls = 0;
  const translator = createLlmTranslator({ ...options, fetchImpl: async (_, init) => {
    calls++;
    const input = JSON.parse(JSON.parse(init.body).messages[1].content);
    assert.ok(input.texts.join('').length <= 6000);
    return reply(input.texts);
  } });
  const long = { ...article, body: ['长段落完整保留。'.repeat(2200), '另一段。'] };
  let result;
  await translator.translateLanguage(long, 'en', value => { result = value; });
  assert.ok(calls > 1);
  assert.deepEqual(result, long);
});
