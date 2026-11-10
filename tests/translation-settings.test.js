import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTranslationSettings, publicTranslationSettings, updateTranslationSettings } from '../lib/translation-settings.mjs';

const initial = { provider: 'llm', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', apiKey: 'secret-test-key', fallback: true };
test('translation settings preserve a blank key, explicitly clear it, and never expose it', () => {
  const current = resolveTranslationSettings(initial, {});
  const changed = updateTranslationSettings({ ...initial, apiKey: '', model: 'other-model' }, current);
  assert.equal(changed.apiKey, initial.apiKey);
  const visible = publicTranslationSettings(changed, 'server');
  assert.equal(visible.hasApiKey, true);
  assert.equal(visible.maskedKey, '••••••••');
  assert.ok(!JSON.stringify(visible).includes(initial.apiKey));
  const cleared = updateTranslationSettings({ ...initial, apiKey: '', clearApiKey: true }, current);
  assert.equal(cleared.apiKey, '');
  assert.equal(resolveTranslationSettings(cleared, { DEEPL_API_KEY: 'environment-secret' }).apiKey, '');
});
test('changing service or host requires a fresh key and unsafe endpoints are rejected', () => {
  assert.throws(() => updateTranslationSettings({ ...initial, endpoint: 'https://other.example/chat/completions', apiKey: '' }, initial), /重新填写/);
  for (const endpoint of ['http://example.com/chat/completions', 'https://user:pass@example.com/chat/completions', 'https://example.com/chat/completions?key=x', 'https://example.com/chat/completions#key']) {
    assert.throws(() => updateTranslationSettings({ ...initial, endpoint }, initial));
  }
  assert.throws(() => updateTranslationSettings({ ...initial, fallback: 'yes' }, initial));
  assert.throws(() => updateTranslationSettings({ ...initial, apiKey: 'bad\nheader' }, initial));
  assert.equal(resolveTranslationSettings(null, { DEEPL_API_KEY: 'environment-secret' }).apiKey, 'environment-secret');
});
