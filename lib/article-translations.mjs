import { articleTranslationFingerprint, translationLanguages, validateTranslatedContent, HttpError } from './articles.mjs';

class Superseded extends Error {}
export function createArticleTranslationQueue({ store, engine, now = Date.now }) {
  const attempted = new Map();
  let closed = false, running = false, requested = false, activeArticleId = null;
  const eligible = article => article?.status === 'published' && article.autoTranslate === true;
  const event = (article, result, message) => ({ action: 'article.translate', actor: { id: 'translation', username: '自动翻译', role: 'system' }, target: { type: 'article', id: article.id, title: article.title }, result, message });
  function guard() { if (closed) throw new Superseded(); }
  async function update(snapshot, transform, audit) {
    const hash = articleTranslationFingerprint(snapshot);
    await store.updateArticles(articles => {
      guard();
      const current = articles.find(article => article.id === snapshot.id);
      if (!eligible(current) || articleTranslationFingerprint(current) !== hash) throw new Superseded();
      transform(current);
      return articles;
    }, guard, audit);
  }
  async function run() {
    try {
      do {
        requested = false;
        let snapshot;
        while (!closed && (snapshot = store.getArticles().find(article => eligible(article) && article.translation?.status !== 'completed' && attempted.get(article.id) !== articleTranslationFingerprint(article)))) {
          const fingerprint = articleTranslationFingerprint(snapshot);
          attempted.set(snapshot.id, fingerprint); activeArticleId = snapshot.id;
          try {
            await update(snapshot, article => { article.translation = { fingerprint, status: 'translating', locales: article.translation?.locales || {}, updatedAt: new Date(now()).toISOString() }; });
            if (!await engine.available()) throw Object.assign(new Error('engine unavailable'), { translationCode: 'engine_unavailable' });
            await engine.translate(snapshot, async (language, content) => {
              if (!translationLanguages.includes(language)) throw new HttpError(400, '不支持此译文语言。');
              const translation = validateTranslatedContent(content, snapshot.body.length);
              await update(snapshot, article => {
                article.translation.locales[language] = translation;
                article.translation.updatedAt = new Date(now()).toISOString();
              });
            });
            await update(snapshot, article => {
              if (Object.keys(article.translation.locales).length !== translationLanguages.length) throw new Error('incomplete translation');
              article.translation.status = 'completed'; article.translation.updatedAt = new Date(now()).toISOString();
            }, event(snapshot, 'success', '已自动生成全部语言译文。'));
          } catch (error) {
            if (error instanceof Superseded || closed) continue;
            const code = ['engine_unavailable', 'translation_timeout', 'invalid_translation'].includes(error.translationCode) ? error.translationCode : 'translation_failed';
            try { await update(snapshot, article => { article.translation = { fingerprint, status: 'failed', locales: article.translation?.locales || {}, updatedAt: new Date(now()).toISOString(), error: code }; }, event(snapshot, 'failure', code === 'engine_unavailable' ? '在线与离线翻译均未配置，原文已保留。' : '自动翻译未完成，原文及已完成译文已保留，可重试。')); }
            catch (saveError) { if (!(saveError instanceof Superseded)) console.error('无法保存离线翻译状态。'); }
          } finally { activeArticleId = null; }
        }
      } while (requested && !closed);
    } finally { running = false; }
  }
  return {
    kick() { if (closed) return; requested = true; if (!running) { running = true; queueMicrotask(() => { run().catch(() => console.error('离线翻译队列未完成，将在下次启动时重试。')); }); } },
    retry(id) { attempted.delete(id); this.kick(); },
    reset() { attempted.clear(); this.kick(); },
    async status() { return { ...(engine.status ? await engine.status() : { available: await engine.available(), engine: '离线翻译', languages: [...translationLanguages] }), activeArticleId }; },
    close() { closed = true; engine.close(); },
  };
}
