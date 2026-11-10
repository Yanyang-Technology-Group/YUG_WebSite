import { translationLanguages } from './articles.mjs';

const defaultEndpoint = 'https://api-free.deepl.com/v2/translate';
const targets = {
  'zh-TW': 'ZH-HANT', en: 'EN', ko: 'KO', ja: 'JA', de: 'DE', fr: 'FR',
  ru: 'RU', es: 'ES', ar: 'AR', pt: 'PT-BR', it: 'IT',
};
const requestLimit = 90 * 1024;
const failure = code => Object.assign(new Error(code), { translationCode: code });

export function splitLongText(value, limit = 24 * 1024) {
  if (Buffer.byteLength(value, 'utf8') <= limit) return [value];
  const sentences = value.match(/[^.!?。！？؟]+[.!?。！？؟]?/gu) || [value];
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (Buffer.byteLength(sentence, 'utf8') > limit) {
      if (current) { chunks.push(current); current = ''; }
      let part = '';
      for (const character of sentence) {
        if (part && Buffer.byteLength(part + character, 'utf8') > limit) { chunks.push(part); part = ''; }
        part += character;
      }
      if (part) chunks.push(part);
      continue;
    }
    if (current && Buffer.byteLength(current + sentence, 'utf8') > limit) { chunks.push(current); current = ''; }
    current += sentence;
  }
  if (current) chunks.push(current);
  return chunks;
}

function makeRequests(texts) {
  const requests = [];
  let current = [], bytes = 0;
  for (const entry of texts) {
    for (const text of splitLongText(entry.text)) {
      const size = Buffer.byteLength(text, 'utf8') + 64;
      if (size > requestLimit) throw failure('invalid_translation');
      if (current.length && (bytes + size > requestLimit || current.length >= 50)) { requests.push(current); current = []; bytes = 0; }
      current.push({ ...entry, text }); bytes += size;
    }
  }
  if (current.length) requests.push(current);
  return requests;
}

export function createDeepLTranslator({ apiKey = process.env.DEEPL_API_KEY, endpoint = process.env.DEEPL_API_URL || defaultEndpoint, fetchImpl = globalThis.fetch, timeoutMs = 30_000 } = {}) {
  let parsedEndpoint;
  try { parsedEndpoint = new URL(endpoint); } catch { parsedEndpoint = null; }
  const configured = typeof apiKey === 'string' && apiKey.trim().length > 0
    && parsedEndpoint?.protocol === 'https:'
    && typeof fetchImpl === 'function';

  async function translateLanguage(article, language, onTranslation) {
    if (!configured || !targets[language]) throw failure('engine_unavailable');
    const values = [article.title, article.summary || '', article.source || '', ...article.body];
    const entries = values.flatMap((text, index) => text ? [{ index, text }] : []);
    const results = values.map(text => text ? [] : ['']);
    for (const batch of makeRequests(entries)) {
      let response;
      try {
        response = await fetchImpl(parsedEndpoint.toString(), {
          method: 'POST', redirect: 'error',
          headers: { Authorization: `DeepL-Auth-Key ${apiKey.trim()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: batch.map(item => item.text), source_lang: 'ZH', target_lang: targets[language], preserve_formatting: true }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw failure(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'translation_timeout' : 'translation_failed');
      }
      if (response.status === 429 || response.status >= 500) throw failure('translation_failed');
      if (!response.ok) throw failure('translation_failed');
      let payload;
      try { payload = await response.json(); } catch { throw failure('invalid_translation'); }
      if (!Array.isArray(payload?.translations) || payload.translations.length !== batch.length
        || payload.translations.some(item => typeof item?.text !== 'string')) throw failure('invalid_translation');
      payload.translations.forEach((item, index) => results[batch[index].index].push(item.text));
    }
    const joined = results.map(parts => parts.join(''));
    await onTranslation({ title: joined[0], summary: joined[1], source: joined[2], body: joined.slice(3) });
  }

  return {
    async available() { return Boolean(configured); },
    async status() { return { available: Boolean(configured), configured: Boolean(configured) }; },
    translateLanguage,
    close() {},
  };
}

export function createTranslationEngine({ online = createDeepLTranslator(), offline, concurrency = 3 } = {}) {
  const limit = Math.max(1, Math.min(3, Math.floor(concurrency) || 1));
  const probe = async candidate => {
    try { return Boolean(candidate && await candidate.available()); } catch { return false; }
  };
  async function status() {
    const [onlineAvailable, offlineAvailable] = await Promise.all([
      probe(online), probe(offline),
    ]);
    return {
      available: onlineAvailable || offlineAvailable,
      onlineAvailable,
      offlineAvailable,
      provider: onlineAvailable ? (offlineAvailable ? 'hybrid' : 'online') : offlineAvailable ? 'offline' : 'unavailable',
      engine: onlineAvailable ? '联网优先' : '离线翻译',
      languages: [...translationLanguages],
    };
  }
  return {
    available: async () => (await status()).available,
    status,
    async translate(article, onTranslation) {
      const availability = await status();
      if (!availability.available) throw failure('engine_unavailable');
      if (!availability.onlineAvailable) return offline.translate(article, onTranslation);
      const pending = new Set(translationLanguages);
      let cursor = 0;
      const workers = Array.from({ length: Math.min(limit, pending.size) }, async () => {
        while (cursor < translationLanguages.length) {
          const language = translationLanguages[cursor++];
          let callbackError;
          try {
            await online.translateLanguage(article, language, async content => {
              try { await onTranslation(language, content); }
              catch (error) { callbackError = error; throw error; }
              pending.delete(language);
            });
          } catch {
            if (callbackError) throw callbackError;
            // Failed online locales are completed by the local model below.
          }
        }
      });
      await Promise.all(workers);
      if (!pending.size) return;
      if (!availability.offlineAvailable) throw failure('translation_failed');
      await offline.translate(article, async (language, content) => {
        if (pending.has(language)) {
          await onTranslation(language, content);
          pending.delete(language);
        }
      }, { languages: translationLanguages.filter(language => pending.has(language)) });
      if (pending.size) throw failure('translation_failed');
    },
    close() { online?.close(); offline?.close(); },
  };
}
