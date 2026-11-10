import { createD1Store } from './d1-store.mjs';
import { createDeepLTranslator } from './online-translator.mjs';
import { createLlmTranslator } from './llm-translator.mjs';
import { resolveTranslationSettings } from './translation-settings.mjs';
import { articleTranslationFingerprint, translationLanguages, validateTranslatedContent } from './articles.mjs';
import { randomUUID } from 'node:crypto';

// Pages has a bounded background lifetime. Translate one language per request,
// keep partial results, and resume on later requests (including admin polling).
export async function runTranslationStep(env, { fetchImpl: requestFetch = globalThis.fetch } = {}) {
  const db = env.DB.withSession ? env.DB.withSession('first-primary') : env.DB;
  const store = await createD1Store(db);
  const config = resolveTranslationSettings(store.getTranslationSettings(), env);
  if (config.provider === 'offline' || !config.apiKey) return;
  const eligible = article => article.status === 'published' && article.autoTranslate === true && article.translation?.status !== 'completed' && article.translation?.status !== 'failed';
  const jobs = new Map(store.state.jobs.filter(([, job]) => job.expires > Date.now()));
  const snapshot = store.getArticles().find(article => eligible(article) && !jobs.has(article.id));
  if (!snapshot) return;
  const fingerprint = articleTranslationFingerprint(snapshot);
  const token = randomUUID();
  jobs.set(snapshot.id, { token, fingerprint, expires: Date.now() + 45000 });
  store.state.jobs = [...jobs];
  await store.updateArticles(articles => { const article = articles.find(item => item.id === snapshot.id); article.translation = { fingerprint, status: 'translating', locales: article.translation?.fingerprint === fingerprint ? article.translation.locales : {}, updatedAt: new Date().toISOString() }; return articles; });
  try { await store.flush(); } catch (error) { if (error.status === 409) return; throw error; }
  const language = translationLanguages.find(code => !snapshot.translation?.locales?.[code] || snapshot.translation.fingerprint !== fingerprint);
  const deadline = Date.now() + 23000;
  const fetchImpl = (url, options = {}) => {
    const remaining = deadline - Date.now();
    if (remaining < 1) throw Object.assign(new Error('translation_timeout'), { translationCode: 'translation_timeout' });
    return requestFetch(url, { ...options, signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(remaining)]) });
  };
  const adapter = config.provider === 'llm' ? createLlmTranslator({ ...config, fetchImpl, timeoutMs: 20000 }) : createDeepLTranslator({ ...config, fetchImpl, timeoutMs: 20000 });
  let translated, failed;
  try { if (language) await adapter.translateLanguage(snapshot, language, value => { translated = validateTranslatedContent(value, snapshot.body.length); }); }
  catch (error) { failed = ['translation_timeout', 'invalid_translation'].includes(error.translationCode) ? error.translationCode : 'translation_failed'; }
  finally { adapter.close(); }
  for (let attempt = 0; attempt < 4; attempt++) {
    const latest = await createD1Store(db);
    const currentJob = new Map(latest.state.jobs).get(snapshot.id);
    if (currentJob?.token !== token) return;
    latest.state.jobs = latest.state.jobs.filter(([id]) => id !== snapshot.id);
    const current = latest.getArticles().find(article => article.id === snapshot.id);
    if (current && current.status === 'published' && current.autoTranslate && articleTranslationFingerprint(current) === fingerprint) {
      await latest.updateArticles(articles => {
        const article = articles.find(item => item.id === snapshot.id);
        const locales = { ...article.translation?.locales, ...(translated ? { [language]: translated } : {}) };
        article.translation = { fingerprint, status: failed ? 'failed' : translationLanguages.every(code => locales[code]) ? 'completed' : 'pending', locales, updatedAt: new Date().toISOString(), ...(failed ? { error: failed } : {}) };
        return articles;
      }, undefined, failed ? { action: 'article.translate', result: 'failure', target: { type: 'article', id: snapshot.id, title: snapshot.title }, message: '在线翻译未完成，原文及已完成译文已保留，可重试。' } : undefined);
    }
    try { await latest.flush(); return; } catch (error) { if (error.status !== 409 || attempt === 3) throw error; }
  }
}
